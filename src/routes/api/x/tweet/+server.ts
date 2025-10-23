import { env as dyn } from '$env/dynamic/private';
import { PUBLIC_X_CLIENT_ID } from '$env/static/public';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
const TWEET_URL = 'https://api.x.com/2/tweets';
const REFRESH_SKEW_MS = 60_000;

type TokenRecord = {
	access_token: string;
	refresh_token: string | null;
	expires_at: string;
	scope: string | null;
	token_type: string | null;
};

const computeExpiresAt = (expires_at: unknown, expires_in: unknown): string | null => {
	if (typeof expires_at === 'string') {
		return expires_at;
	}
	if (typeof expires_in === 'number') {
		return new Date(Date.now() + expires_in * 1000).toISOString();
	}
	if (typeof expires_in === 'string') {
		const parsed = Number.parseInt(expires_in, 10);
		if (Number.isFinite(parsed)) {
			return new Date(Date.now() + parsed * 1000).toISOString();
		}
	}
	return null;
};

const refreshAccessToken = async (
	refreshToken: string,
	fetchFn: typeof fetch
): Promise<TokenRecord | null> => {
	const CLIENT_SECRET = dyn.X_CLIENT_SECRET;
	if (!CLIENT_SECRET) {
		throw new Error('X client secret is not configured');
	}

	const basic = Buffer.from(`${PUBLIC_X_CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

	const response = await fetchFn(TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Authorization': `Basic ${basic}`
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken
		})
	});

	const tokens = await response.json();
	if (!response.ok) {
		console.error('X OAuth refresh failed', tokens);
		return null;
	}

	const expiresAt = computeExpiresAt(tokens.expires_at, tokens.expires_in);
	if (!expiresAt) {
		console.error('Missing expires_at in refresh response', tokens);
		return null;
	}

	return {
		access_token: tokens.access_token,
		refresh_token: tokens.refresh_token ?? refreshToken,
		expires_at: expiresAt,
		scope: tokens.scope ?? null,
		token_type: tokens.token_type ?? 'bearer'
	};
};

export const POST: RequestHandler = async ({ request, locals, fetch }) => {
	if (!locals.session?.user) {
		return json({ error: 'auth_required' }, { status: 401 });
	}

	let payload: { image?: unknown; text?: unknown };
	try {
		payload = await request.json();
	} catch (error) {
		console.error('Invalid JSON payload', error);
		return json({ error: 'invalid_payload' }, { status: 400 });
	}

	const imageData = typeof payload.image === 'string' ? payload.image : null;
	if (!imageData) {
		return json({ error: 'image_required' }, { status: 400 });
	}

	const base64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;
	if (!base64) {
		return json({ error: 'invalid_image' }, { status: 400 });
	}

	const userId = locals.session.user.id;
	const { data: tokenRow, error: tokenError } = await locals.supabase
		.from('x_tokens')
		.select('access_token, refresh_token, expires_at, scope, token_type')
		.eq('user_id', userId)
		.maybeSingle();

	if (tokenError) {
		console.error('Failed to load X tokens', tokenError);
		return json({ error: 'token_lookup_failed' }, { status: 500 });
	}

	if (!tokenRow) {
		return json({ error: 'tokens_missing' }, { status: 409 });
	}

	const tokensData = tokenRow as TokenRecord;
	let tokens: TokenRecord = tokensData;

	const needsRefresh =
		!tokens.expires_at ||
		new Date(tokens.expires_at).getTime() - REFRESH_SKEW_MS <= Date.now();

	if (needsRefresh) {
		if (!tokens.refresh_token) {
			return json({ error: 'refresh_unavailable' }, { status: 401 });
		}

		const refreshed = await refreshAccessToken(tokens.refresh_token, fetch);
		if (!refreshed) {
			return json({ error: 'refresh_failed' }, { status: 401 });
		}

		tokens = refreshed;

		const { error: persistError } = await locals.supabase.from('x_tokens').upsert(
			{
				user_id: userId,
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token,
				expires_at: tokens.expires_at,
				scope: tokens.scope,
				token_type: tokens.token_type ?? 'bearer'
			},
			{ onConflict: 'user_id' }
		);

		if (persistError) {
			console.error('Failed to persist refreshed X tokens', persistError);
		}
	}

	const mediaResponse = await fetch(MEDIA_UPLOAD_URL, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${tokens.access_token}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			media_data: base64
		})
	});
	console.log('media', mediaResponse);

	const mediaJson = await mediaResponse.json();

	if (!mediaResponse.ok) {
		console.error('X media upload failed', mediaJson);
		const status = mediaResponse.status === 401 ? 401 : 502;
		return json({ error: 'media_upload_failed', detail: mediaJson }, { status });
	}

	const mediaId = mediaJson.media_id_string ?? mediaJson.media_id;
	if (!mediaId) {
		return json({ error: 'media_missing' }, { status: 502 });
	}

	const text =
		typeof payload.text === 'string' && payload.text.trim().length
			? payload.text.trim()
			: undefined;

	const tweetResponse = await fetch(TWEET_URL, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${tokens.access_token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			text,
			media: {
				media_ids: [mediaId]
			}
		})
	});

	const tweetJson = await tweetResponse.json();

	if (!tweetResponse.ok) {
		console.error('Tweet creation failed', tweetJson);
		const status = tweetResponse.status === 401 ? 401 : 502;
		return json({ error: 'tweet_failed', detail: tweetJson }, { status });
	}

	return json({ success: true, tweet: tweetJson.data ?? tweetJson });
};
