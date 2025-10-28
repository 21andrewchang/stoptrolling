import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- Env (configure in Project → Settings → Functions → Secrets) ---
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY')!;
const X_CLIENT_ID = Deno.env.get('X_CLIENT_ID')!;
const X_CLIENT_SECRET = Deno.env.get('X_CLIENT_SECRET')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

// --- Small helpers ---
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });

const cors = (res: Response) =>
  new Response(res.body, {
    status: res.status,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'content-type': res.headers.get('content-type') ?? 'application/json'
    }
  });

const unauthorized = (message = 'Unauthorized') => cors(json({ error: message }, 401));

function isCronAuthorized(req: Request): boolean {
  if (!CRON_SECRET) return false;
  const headerSecret = req.headers.get('x-cron-secret');
  if (headerSecret && headerSecret === CRON_SECRET) return true;
  const h = req.headers.get('authorization') || '';
  if (h.toLowerCase().startsWith('bearer ') && h.slice(7).trim() === CRON_SECRET) return true;
  return false;
}

function prettyMonthDay(ymdStr: string, timeZone: string): string {
  // Use noon UTC to avoid DST edge weirdness when converting to the user's TZ
  const safe = new Date(`${ymdStr}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: '2-digit'
  }).format(safe); // e.g. "Oct 25"
}
// --- X OAuth helpers ---
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const REFRESH_SKEW_MS = 60_000; // refresh 1m early

type TokenRecord = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null; // ISO
  scope?: string | null;
  token_type?: string | null;
};

const computeExpiresAt = (expires_at?: unknown, expires_in?: unknown): string | null => {
  if (typeof expires_at === 'string' && expires_at) return expires_at;
  const sec =
    typeof expires_in === 'number' ? expires_in :
      typeof expires_in === 'string' ? Number.parseInt(expires_in, 10) : NaN;
  if (!Number.isFinite(sec)) return null;
  return new Date(Date.now() + sec * 1000).toISOString();
};

const isExpired = (expires_at?: string | null): boolean =>
  !expires_at || (new Date(expires_at).getTime() - REFRESH_SKEW_MS) <= Date.now();

async function refreshAccessToken(refreshToken: string): Promise<TokenRecord | null> {
  const basic = btoa(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('X OAuth refresh failed', payload);
    return null;
  }

  const expires_at = computeExpiresAt(payload.expires_at, payload.expires_in);
  if (!expires_at) {
    console.error('X refresh missing expires_at/expires_in', payload);
    return null;
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? refreshToken,
    expires_at,
    scope: payload.scope ?? null,
    token_type: payload.token_type ?? 'bearer',
  };
}

async function upsertTokensForUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  tokens: TokenRecord
) {
  const { error } = await supabase
    .from('x_tokens')
    .upsert(
      {
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        scope: tokens.scope ?? null,
        token_type: tokens.token_type ?? 'bearer',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  if (error) console.error('Persist refreshed X tokens failed', { user_id: userId, error });
}

// --- Date helpers ---
const ymd = (d: Date) => d.toISOString().slice(0, 10); // 'YYYY-MM-DD'

// Convert a UTC Date to the user's local parts using Intl
function partsInTZ(d: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === t)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second')
  };
}

// Compute YYYY-MM-DD for "yesterday" in the user's timezone
function localYesterday(dateUtc: Date, timeZone: string): string {
  const { year, month, day } = partsInTZ(dateUtc, timeZone);
  // local midnight in UTC
  const localMidnightUtcMs = Date.UTC(year, month - 1, day);
  // subtract one day to get "yesterday" in that tz, then format as UTC ymd
  return ymd(new Date(localMidnightUtcMs - 24 * 60 * 60 * 1000));
}

// Should we post now for this user? (true only within the midnight window in their tz)
function isMidnightWindow(dateUtc: Date, timeZone: string, windowMinutes = 15): boolean {
  const { hour, minute } = partsInTZ(dateUtc, timeZone);
  return hour === 0 && minute >= 0 && minute < windowMinutes;
}

// --- Main handler ---
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

  // Gate behind cron secret (works for pg_net, curl, etc.)
  if (!isCronAuthorized(req)) return unauthorized();

  // Optional toggles from body
  let dryRun = false;
  let dateOverride: string | null = null; // 'YYYY-MM-DD' (interpreted as a reference date)
  try {
    const body = await req.clone().json().catch(() => null);
    dryRun = !!body?.dry_run;
    if (typeof body?.date_override === 'string' && body.date_override.trim()) {
      dateOverride = body.date_override.trim();
    }
  } catch { /* ignore body */ }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Use ONLY your internal users table (not auth.users)
  const { data: users, error: usersErr } = await supabase
    .from('users')
    .select('user_id, timezone')
    .neq('timezone', null);

  if (usersErr) return cors(json({ error: usersErr.message }, 500));

  const nowUtc = new Date();

  // Canonical slotting: 8am..11pm (16 slots)
  const START_HOUR = 8;
  const TOTAL = 16;

  const results: Array<{ user_id: string; ok: boolean; reason?: string }> = [];

  console.log('[post-daily-summary] invoked at (UTC):', nowUtc.toISOString());
  console.log('[post-daily-summary] users found:', users?.length ?? 0);

  for (const u of users ?? []) {
    const userId = u.user_id;
    const tz = u.timezone || 'UTC';

    try {
      const reference = dateOverride ? new Date(`${dateOverride}T12:00:00Z`) : nowUtc;
      const targetDate = localYesterday(reference, tz);
      console.log('date: ', targetDate);

      if (!dateOverride && !isMidnightWindow(nowUtc, tz)) {
        console.log('it is not midnight for: ', userId);
        console.log('they are in: ', tz);
        results.push({ user_id: userId, ok: false, reason: 'not_midnight_window' });
        continue;
      }

      // Find the day row for targetDate
      const { data: day, error: dayErr } = await supabase
        .from('days')
        .select('id, date')
        .eq('user_id', userId)
        .eq('date', targetDate)
        .maybeSingle();

      if (dayErr || !day) {
        results.push({ user_id: userId, ok: false, reason: `no day for ${targetDate}` });
        continue;
      }

      // Load all hours for that day
      const { data: hours, error: hoursErr } = await supabase
        .from('day_hours')
        .select('start_hour, aligned')
        .eq('day_id', day.id)
        .order('start_hour');


      if (hoursErr) {
        results.push({ user_id: userId, ok: false, reason: 'hours query failed' });
        continue;
      }

      // Map start_hour -> aligned
      const byHour = new Map<number, boolean | null>();
      for (const row of (hours ?? [])) {
        const h = typeof row.start_hour === 'number'
          ? row.start_hour
          : Number.parseInt(String(row.start_hour), 10);
        if (Number.isNaN(h)) continue;
        const aligned =
          row.aligned === null || row.aligned === undefined ? null : !!row.aligned;
        byHour.set(h, aligned);
      }

      // Always build 16 canonical slots (8..23), fill gaps with null (white)
      const dots: Array<boolean | null> = Array.from({ length: TOTAL }, (_, i) => {
        const hour = START_HOUR + i;
        return byHour.has(hour) ? (byHour.get(hour) as boolean | null) : null;
      });

      // Score
      const good = dots.filter(d => d === true).length;
      const bad = dots.filter(d => d === false).length;
      const rawScore = ((good + bad) / TOTAL) * 100 + good - bad;
      const score = Math.max(0, Math.min(100, Math.round(rawScore)));

      // X tokens
      const { data: xtokRow, error: tokErr } = await supabase
        .from('x_tokens')
        .select('access_token, refresh_token, expires_at, scope, token_type')
        .eq('user_id', userId)
        .maybeSingle();

      if (tokErr || !xtokRow?.access_token) {
        results.push({ user_id: userId, ok: false, reason: 'no x tokens' });
        continue;
      }

      // Normalize & refresh if needed
      let tokens: TokenRecord = {
        access_token: xtokRow.access_token,
        refresh_token: xtokRow.refresh_token ?? null,
        expires_at: xtokRow.expires_at ?? null,
        scope: xtokRow.scope ?? null,
        token_type: xtokRow.token_type ?? 'bearer',
      };

      if (isExpired(tokens.expires_at)) {
        if (!tokens.refresh_token) {
          results.push({ user_id: userId, ok: false, reason: 'expired & no refresh token' });
          continue;
        }
        const refreshed = await refreshAccessToken(tokens.refresh_token);
        if (!refreshed) {
          results.push({ user_id: userId, ok: false, reason: 'refresh_failed' });
          continue;
        }
        tokens = refreshed;
        await upsertTokensForUser(supabase, userId, tokens);
      }

      const line = dots.map(d => (d === true ? '🟢' : d === false ? '🔴' : '⚪')).join('');

      const allWhite = dots.every(d => d === null);
      const textLines: string[] = [];
      if (allWhite) textLines.push("i didn't do shit today");
      const prettyDate = prettyMonthDay(targetDate, tz);
      textLines.push(`${prettyDate} | Productivity Score: ${score} | stoptrolling[dot]app`);
      textLines.push(line);
      const text = textLines.join('\n');

      if (dryRun) {
        results.push({ user_id: userId, ok: true, reason: 'dry_run' });
        continue;
      }

      // Post to X
      const postRes = await fetch('https://api.x.com/2/tweets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!postRes.ok) {
        const detail = await postRes.json().catch(() => ({}));
        results.push({ user_id: userId, ok: false, reason: `x post failed: ${JSON.stringify(detail)}` });
        continue;
      }

      results.push({ user_id: userId, ok: true });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'unknown';
      results.push({ user_id: userId, ok: false, reason });
    }
  }

  return cors(json({ ran_for: users?.length ?? 0, dry_run: dryRun, results }));
});
