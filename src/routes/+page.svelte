<script lang="ts">
	import ReviewModal from '$lib/components/ReviewModal.svelte';
	import HistoryModal from '$lib/components/HistoryModal.svelte';
	import DayDots from '$lib/components/DayDots.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { dayLog, type HourEntry, endHourOf, defaultHours } from '$lib/stores/day-log';
	import { historyStore, historyLoading, historyLoaded, historyError } from '$lib/stores/history';
	import type { HistoryDay } from '$lib/stores/history';
	import { ymd, slotRange, minutesUntil, rangeLabel as labelFor } from '$lib/utils/time';
	import { supabase } from '$lib/supabase';
	import { PUBLIC_X_CLIENT_ID, PUBLIC_X_REDIRECT_URI } from '$env/static/public';
	import type { User } from '@supabase/supabase-js';
	import { get } from 'svelte/store';

	const date = ymd(new Date());
	const HISTORY_SLOT_COUNT = 16;

	let dayId = $state<string | null>(null);
	let firstName = $state<string | null>(null);
	let userEmail = $state<string | null>(null);
	let userId = $state<string | null>(null);
	let hasUser = $state(false);
	let hasXAuthorization = $state(false);
	let authResolved = $state(false);
	let showAuthModal = $state(false);
	let showHIWModal = $state(false);
	let showAutoPostModal = $state(false);
	let showHistory = $state(false);
	let authLoading = $state(false);
	let authError = $state('');
	let xAuthorizeError = $state('');
	let historyFetchPromise: Promise<void> | null = null;
	let historyForUser: string | null = null;

	function deriveFirstName(user: User): string | null {
		const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
		const getString = (key: string): string => {
			const value = metadata[key];
			return typeof value === 'string' ? value.trim() : '';
		};

		const candidate = getString('first_name');
		if (candidate) return candidate.split(/\s+/)[0] ?? candidate;

		const fullName = getString('full_name') || getString('name');
		if (fullName) return fullName.split(/\s+/)[0] ?? fullName;

		const email = typeof user.email === 'string' ? user.email : '';
		if (email) return email.split('@')[0] ?? email;

		return null;
	}

	async function ensureDayId(): Promise<string | null> {
		let userRes: Awaited<ReturnType<typeof supabase.auth.getUser>>['data'] | undefined;
		let authErr: Awaited<ReturnType<typeof supabase.auth.getUser>>['error'] | null | undefined;
		try {
			const result = await supabase.auth.getUser();
			userRes = result.data;
			console.log('user: ', userRes);
			authErr = result.error;
		} catch (err) {
			console.error('Supabase getUser exception:', err);
			firstName = null;
			userEmail = null;
			hasUser = false;
			authResolved = true;
			return null;
		}
		if (authErr) {
			console.error('auth error', authErr);
			firstName = null;
			userEmail = null;
			hasUser = false;
			authResolved = true;
			return null;
		}
		const user = userRes?.user ?? null;
		const user_id = user?.id;
		if (!user_id || !user) {
			firstName = null;
			userEmail = null;
			hasUser = false;
			authResolved = true;
			return null;
		}

		firstName = deriveFirstName(user);
		userEmail = typeof user.email === 'string' ? user.email : null;
		hasUser = true;
		userId = user_id;
		authResolved = true;
		console.log('authresolved: ', authResolved);

		await syncServerSupabaseSession();
		await upsertTimezoneIfNeeded(user_id);
		await checkAutoPostAuthorization(user_id);
		void loadHistoryInBackground(user_id);

		const { data, error } = await supabase
			.from('days')
			.upsert({ user_id, date }, { onConflict: 'user_id,date' })
			.select('id')
			.single();

		if (error) {
			console.error('ensureDayId upsert failed:', error);
			return null;
		}
		return data.id;
	}

	type DbHourRow = {
		start_hour: number;
		body: string | null;
		aligned: boolean | null;
	};

	async function loadDayFromDatabase(
		id: string
	): Promise<{ goal: string; hours: HourEntry[] } | null> {
		try {
			const [dayRes, hoursRes] = await Promise.all([
				supabase.from('days').select('goal').eq('id', id).maybeSingle(),
				supabase
					.from('day_hours')
					.select('start_hour, body, aligned')
					.eq('day_id', id)
					.order('start_hour', { ascending: true })
			]);

			if (dayRes.error) {
				console.error('Supabase day load failed:', dayRes.error);
				return null;
			}
			if (hoursRes.error) {
				console.error('Supabase day_hours load failed:', hoursRes.error);
				return null;
			}

			const goalFromDb = (dayRes.data?.goal ?? '') as string;
			const rows = (hoursRes.data ?? []) as DbHourRow[];
			const rowMap = new Map<number, DbHourRow>();
			for (const row of rows) {
				const startHour =
					typeof row.start_hour === 'number' ? row.start_hour : Number(row.start_hour);
				if (Number.isNaN(startHour)) continue;
				rowMap.set(startHour, row);
			}

			const fallback = defaultHours();
			const hours = fallback.map((slot) => {
				const remote = rowMap.get(slot.startHour);
				if (!remote) {
					return { ...slot };
				}

				const entry: HourEntry = {
					startHour: slot.startHour,
					body: remote.body ?? ''
				};

				if (remote.aligned !== null && remote.aligned !== undefined) {
					entry.aligned = remote.aligned;
				}

				return entry;
			});

			return { goal: goalFromDb, hours };
		} catch (err) {
			console.error('Failed to load day from Supabase:', err);
			return null;
		}
	}

	async function syncFromDatabase(): Promise<void> {
		const id = await ensureDayId();
		dayId = id;
		if (!id) return;

		const remote = await loadDayFromDatabase(id);
		if (!remote) return;

		console.log('Loaded day from database', { date, ...remote });
		dayLog.replaceHours(date, remote.hours);
		dayLog.setGoal(date, remote.goal);
	}

	async function upsertTimezoneIfNeeded(user_id: string): Promise<void> {
		try {
			// browser-only; if somehow called server-side, just bail
			if (typeof Intl === 'undefined' || typeof window === 'undefined') return;

			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

			// read current value to avoid useless writes
			const { data: existing, error: readErr } = await supabase
				.from('users')
				.select('timezone')
				.eq('id', user_id)
				.maybeSingle();

			if (readErr) {
				console.warn('profiles read failed (timezone check):', readErr);
				// fall through to attempt upsert anyway
			}

			// only write if missing/different
			if (!existing || existing.timezone !== tz) {
				const { error: upsertErr } = await supabase.from('users').upsert(
					{ user_id: user_id, timezone: tz }, // include PK so insert works
					{ onConflict: 'user_id' }
				);

				if (upsertErr) console.error('profiles upsert (timezone) failed:', upsertErr);
			}
		} catch (err) {
			console.error('profiles upsert (timezone) exception:', err);
		}
	}

	onMount(async () => {
		dayLog.ensure(date);
		await syncFromDatabase();
	});

	function openAuthModal() {
		authError = '';
		showAuthModal = true;
	}
	function openAutoPostModal() {
		if (!hasUser) return;
		xAuthorizeError = '';
		showAutoPostModal = true;
		if (userId) {
			void checkAutoPostAuthorization(userId);
		}
	}
	function openHistoryModal() {
		if (!hasUser || !userId) {
			openAuthModal();
			return;
		}

		showHistory = true;

		const loaded = get(historyLoaded);
		const error = get(historyError);

		if ((!loaded || error) && !historyFetchPromise) {
			void loadHistoryInBackground(userId);
		}
	}
	function openHIWModal() {
		showHIWModal = true;
	}
	function closeHIWModal() {
		showHIWModal = false;
	}

	function closeAuthModal() {
		if (authLoading) return;
		showAuthModal = false;
	}
	function closeAutoPostModal() {
		if (xAuthorizeLoading) return;
		showAutoPostModal = false;
		xAuthorizeError = '';
	}

	function resetLocalSessionState() {
		dayId = null;
		firstName = null;
		userEmail = null;
		hasUser = false;
		userId = null;
		hasXAuthorization = false;
		showReview = false;
		reviewIndex = null;
		editingIndex = null;
		pendingIndex = null;
		pendingBody = null;
		currentBody = '';
		goal = '';
		entries = [];
		showAutoPostModal = false;
		showHistory = false;
		xAuthorizeLoading = false;
		xAuthorizeError = '';
		historyStore.set([]);
		historyLoaded.set(false);
		historyLoading.set(false);
		historyError.set(null);
		historyFetchPromise = null;
		historyForUser = null;
	}

	async function signOutCurrentUser() {
		if (authLoading) return;
		try {
			authLoading = true;
			const { error } = await supabase.auth.signOut();
			if (error) throw error;
			resetLocalSessionState();
			dayLog.clearAll();
			const rec = dayLog.ensure(date);
			goal = rec.goal;
			entries = rec.hours;
		} catch (err) {
			console.error('Supabase signOut failed:', err);
		} finally {
			showAuthModal = false;
			showHIWModal = false;
			authError = '';
			authLoading = false;
		}
	}

	async function signInWithTwitter() {
		try {
			authLoading = true;
			authError = '';

			const redirectTo = `${window.location.origin}/`;

			const { error } = await supabase.auth.signInWithOAuth({
				provider: 'twitter',
				options: { redirectTo }
			});

			if (error) throw error;
		} catch (err: any) {
			authError = err?.message ?? 'Sign-in failed. Please try again.';
			authLoading = false;
		}
	}

	async function handleAuthButtonClick(): Promise<void> {
		if (authLoading) return;
		if (hasUser) {
			await signOutCurrentUser();
			return;
		}
		openAuthModal();
	}

	let showReview = $state(false);

	let goal = $state('');
	let entries = $state<HourEntry[]>([]);
	let now = $state(new Date());
	let xAuthorizeLoading = $state(false);

	$effect(() => {
		const rec = $dayLog[date];
		goal = rec?.goal ?? '';
		entries = rec?.hours ?? [];
	});

	let timer: ReturnType<typeof setInterval> | null = null;
	onMount(() => {
		timer = setInterval(() => (now = new Date()), 60_000);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	const currentIndex = $derived(
		(() => {
			if (!entries.length) return null as number | null;
			const today = ymd(now);
			if (date !== today) return null;
			const START = entries[0].startHour;
			const SLOTS = entries.length;
			const h = now.getHours();
			return h >= START && h < START + SLOTS ? h - START : null;
		})()
	);
	let editingIndex = $state<number | null>(null);
	let reviewIndex = $state<number | null>(null);

	$effect(() => {
		if (entries.length === 0) {
			editingIndex = null;
			reviewIndex = null;
			return;
		}

		const today = ymd(now);
		if (date === today) {
			const START = entries[0].startHour;
			const h = now.getHours();
			if (h < START) {
				editingIndex = 0;
				reviewIndex = null;
				return;
			}
		}

		if (currentIndex === null) {
			editingIndex = null;
			reviewIndex = null;
			return;
		}

		const cur = entries[currentIndex];
		const hasBody = !!cur?.body?.trim();
		const reviewed = cur?.aligned !== undefined;
		const needsReview = hasBody && !reviewed;

		if (needsReview) {
			editingIndex = currentIndex;
			reviewIndex = reviewIndex ?? currentIndex;
			return;
		}

		const target =
			hasBody && reviewed ? Math.min(currentIndex + 1, entries.length - 1) : currentIndex;

		if (editingIndex === null || editingIndex < target) {
			editingIndex = target;
		}

		if (editingIndex !== currentIndex) {
			reviewIndex = null;
		}
	});

	const displayedEntry = $derived<HourEntry | undefined>(
		(() => (editingIndex !== null ? entries[editingIndex] : undefined))()
	);

	const isActiveSlot = $derived((() => editingIndex !== null && editingIndex === currentIndex)());
	const placeholderStr = $derived(
		(() => {
			const e = displayedEntry;
			if (!e) return '';
			if (isActiveSlot) return 'What are you doing right now?';

			const { start, end } = slotRange(date, e.startHour, endHourOf);
			const tNow = now.getTime();
			const today = ymd(now);

			if (date > today) {
				const mins = minutesUntil(start, now);
				return mins === 0
					? 'Almost time…'
					: `Come back in ${mins} minute${mins === 1 ? '' : 's'}...`;
			}
			if (date < today) return 'This hour has passed';

			if (tNow < start.getTime()) {
				const mins = minutesUntil(start, now);
				return mins === 0
					? 'Almost time…'
					: `Come back in ${mins} minute${mins === 1 ? '' : 's'}...`;
			}
			if (tNow >= end.getTime()) return 'This hour has passed';

			return 'What are you doing right now?';
		})()
	);
	const leadingText = $derived(
		displayedEntry ? (isActiveSlot ? rangeLabel(displayedEntry) : placeholderStr) : ''
	);

	let currentBody = $state('');
	$effect(() => {
		currentBody = displayedEntry ? (displayedEntry.body ?? '') : '';
	});

	function isFuture(entry: HourEntry): boolean {
		const today = ymd(now);
		if (date > today) return true;
		if (date < today) return false;
		const { start } = slotRange(date, entry.startHour, endHourOf);
		return now.getTime() < start.getTime();
	}

	const X_AUTHORIZE_ENDPOINT = 'https://x.com/i/oauth2/authorize';
	const X_OAUTH_SCOPES = [
		'tweet.read',
		'tweet.write',
		'users.read',
		'offline.access',
		'media.write'
	];
	const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

	function base64UrlEncode(buffer: ArrayBuffer): string {
		if (typeof btoa !== 'function') {
			throw new Error('Base64 encoding is unavailable in this environment');
		}
		const bytes = new Uint8Array(buffer);
		let binary = '';
		bytes.forEach((b) => (binary += String.fromCharCode(b)));
		return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}

	function buildRandomString(length: number, alphabet: string): string {
		if (typeof window === 'undefined' || !window.crypto?.getRandomValues) {
			throw new Error('Secure randomness unavailable in this environment');
		}
		const randomValues = new Uint8Array(length);
		window.crypto.getRandomValues(randomValues);
		const chars = alphabet.length;
		let out = '';
		for (let i = 0; i < length; i++) {
			out += alphabet[randomValues[i] % chars];
		}
		return out;
	}

	function createPkceVerifier(): string {
		return buildRandomString(64, PKCE_CHARSET);
	}

	async function createPkceChallenge(verifier: string): Promise<string> {
		if (!window.crypto?.subtle) {
			throw new Error('PKCE challenge generation requires Web Crypto support');
		}
		const data = new TextEncoder().encode(verifier);
		const digest = await window.crypto.subtle.digest('SHA-256', data);
		return base64UrlEncode(digest);
	}

	function persistPkceState(verifier: string, stateValue: string): void {
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem('stoptrolling:x:code_verifier', verifier);
				localStorage.setItem('stoptrolling:x:oauth_state', stateValue);
			}

			const maxAge = 600; // 10 minutes
			const secure = location.protocol === 'https:' ? '; Secure' : '';
			document.cookie = `x_pkce_verifier=${encodeURIComponent(verifier)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
			document.cookie = `x_oauth_state=${encodeURIComponent(stateValue)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
		} catch (err) {
			console.warn('Failed to persist X OAuth state', err);
		}
	}

	async function syncServerSupabaseSession(): Promise<boolean> {
		try {
			const {
				data: { session },
				error
			} = await supabase.auth.getSession();
			console.log(session);

			if (error || !session) {
				console.error('Failed to fetch Supabase session for server sync', error);
				return false;
			}

			const { access_token: accessToken, refresh_token: refreshToken } = session;

			if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
				console.error('Supabase session missing tokens for server sync');
				return false;
			}

			const res = await fetch('/api/auth/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					access_token: accessToken,
					refresh_token: refreshToken
				}),
				credentials: 'same-origin'
			});

			if (!res.ok) {
				console.error('Server Supabase session sync failed', await res.text());
				return false;
			}

			return true;
		} catch (err) {
			console.error('Unexpected error syncing Supabase session to server', err);
			return false;
		}
	}

	async function checkAutoPostAuthorization(user_id: string): Promise<boolean> {
		try {
			const { data, error } = await supabase
				.from('x_tokens')
				.select('user_id')
				.eq('user_id', user_id)
				.maybeSingle();

			if (error) {
				console.error('Failed to verify X authorization status:', error);
				hasXAuthorization = false;
				showAutoPostModal = false;
				return false;
			}

			const authorized = !!data?.user_id;
			hasXAuthorization = authorized;
			if (authorized) {
				showAutoPostModal = false;
			} else {
				xAuthorizeError = '';
				showAutoPostModal = true;
			}
			return authorized;
		} catch (err) {
			console.error('Unexpected error verifying X authorization:', err);
			hasXAuthorization = false;
			showAutoPostModal = false;
			return false;
		}
	}

	type DayRow = {
		id: string;
		date: string | null;
	};

	type HourRow = {
		day_id: string;
		start_hour: number;
		aligned: boolean | null;
	};

	async function loadHistoryInBackground(user_id: string): Promise<void> {
		if (!user_id) return;
		if (historyForUser === user_id && get(historyLoaded)) return;
		if (historyFetchPromise) return;

		const promise = (async () => {
			historyLoading.set(true);
			historyError.set(null);

			try {
				const { data: dayData, error: dayError } = await supabase
					.from('days')
					.select('id, date')
					.eq('user_id', user_id)
					.order('date', { ascending: false });

				if (dayError) throw dayError;

				const days = (dayData ?? []).filter((row): row is DayRow => {
					return typeof row?.id === 'string';
				});

				if (!days.length) {
					historyStore.set([]);
					historyLoaded.set(true);
					historyForUser = user_id;
					return;
				}

				const dayIds = days.map((row) => row.id);

				const { data: hourData, error: hourError } = await supabase
					.from('day_hours')
					.select('day_id, start_hour, aligned')
					.in('day_id', dayIds)
					.order('start_hour', { ascending: true });

				if (hourError) throw hourError;

				const hours = (hourData ?? []).filter((row): row is HourRow => {
					const startHour =
						typeof row?.start_hour === 'number'
							? row.start_hour
							: Number.parseInt(String(row?.start_hour ?? NaN), 10);
					return (
						typeof row?.day_id === 'string' &&
						Number.isInteger(startHour) &&
						startHour >= 0 &&
						startHour <= 23
					);
				});

				const hoursByDay = new Map<string, Map<number, boolean | null>>();
				for (const row of hours) {
					const startHour =
						typeof row.start_hour === 'number'
							? row.start_hour
							: Number.parseInt(String(row.start_hour), 10);
					if (Number.isNaN(startHour)) continue;
					const dayHours = hoursByDay.get(row.day_id) ?? new Map<number, boolean | null>();
					const alignment =
						row.aligned === null || row.aligned === undefined ? null : row.aligned === true;
					dayHours.set(startHour, alignment);
					hoursByDay.set(row.day_id, dayHours);
				}

				const fallback = defaultHours();

				const history = days.map<HistoryDay>((day) => {
					const statusMap = hoursByDay.get(day.id) ?? new Map<number, boolean | null>();
					const dots = fallback.map((slot) => {
						if (!statusMap.has(slot.startHour)) return null;
						const aligned = statusMap.get(slot.startHour);
						return aligned === null ? null : !!aligned;
					});

					const first = dots.slice(0, HISTORY_SLOT_COUNT);
					const goodCount = first.filter((d) => d === true).length;
					const badCount = first.filter((d) => d === false).length;
					const rawScore =
						((goodCount + badCount) / HISTORY_SLOT_COUNT) * 100 + goodCount - badCount;
					const score = Math.max(0, Math.min(100, Math.round(rawScore)));

					const isoDate =
						typeof day.date === 'string' && day.date
							? day.date
							: day.date
								? ymd(new Date(day.date))
								: '';

					return {
						id: day.id,
						date: isoDate,
						dots: first,
						score
					};
				});

				historyStore.set(history);
				historyLoaded.set(true);
				historyForUser = user_id;
			} catch (err) {
				console.error('Failed to load history', err);
				historyError.set('Unable to load history. Please try again later.');
				historyLoaded.set(false);
			} finally {
				historyLoading.set(false);
				historyFetchPromise = null;
			}
		})();

		historyFetchPromise = promise;
		await promise;
	}

	async function authorizeAutoPost() {
		if (!hasUser || xAuthorizeLoading) return;
		if (!PUBLIC_X_CLIENT_ID || !PUBLIC_X_REDIRECT_URI) {
			console.error('X OAuth client configuration is missing');
			return;
		}
		if (typeof window === 'undefined') return;

		try {
			xAuthorizeLoading = true;
			xAuthorizeError = '';
			const serverSessionSynced = await syncServerSupabaseSession();
			if (!serverSessionSynced) {
				xAuthorizeLoading = false;
				xAuthorizeError = 'We could not confirm your Supabase session. Please sign in again.';
				return;
			}

			const verifier = createPkceVerifier();
			const challenge = await createPkceChallenge(verifier);
			const stateValue = buildRandomString(32, PKCE_CHARSET);
			persistPkceState(verifier, stateValue);

			const params = new URLSearchParams({
				response_type: 'code',
				client_id: PUBLIC_X_CLIENT_ID,
				redirect_uri: PUBLIC_X_REDIRECT_URI,
				scope: X_OAUTH_SCOPES.join(' '),
				state: stateValue,
				code_challenge: challenge,
				code_challenge_method: 'S256'
			});

			showAutoPostModal = false;
			window.location.href = `${X_AUTHORIZE_ENDPOINT}?${params.toString()}`;
		} catch (err) {
			console.error('Failed to initiate X OAuth authorization', err);
			xAuthorizeLoading = false;
			xAuthorizeError =
				'Failed to start X authorization. Please try again or sign out and back in.';
		}
	}

	function circleClassFor(entry: HourEntry): string {
		if (isFuture(entry)) {
			return 'border-dashed border-stone-400 border bg-transparent';
		}
		if (entry.aligned === true) return 'bg-emerald-400';
		if (entry.aligned === false) return 'bg-red-400';

		// Not rated yet:
		const hasBody = !!entry.body?.trim();

		// Logged but not rated -> neutral ring
		if (hasBody) return 'bg-stone-400';

		// Not logged -> soft gray fill
		return 'bg-transparent border border-stone-400';
	}

	function rangeLabel(entry: HourEntry): string {
		return labelFor(entry.startHour, endHourOf);
	}

	function onInput(e: Event) {
		currentBody = (e.currentTarget as HTMLInputElement).value;
	}

	let pendingIndex = $state<number | null>(null);
	let pendingBody = $state<string | null>(null);

	async function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!isActiveSlot || editingIndex === null) return;

		const idx = editingIndex;
		const entry = entries[idx];
		if (!entry) return;

		const trimmed = currentBody.trim();
		const startHour = entry.startHour;
		const aligned = entry.aligned ?? null;

		let synced = false;

		try {
			if (!dayId) dayId = await ensureDayId();
			if (!dayId) {
				console.warn('No dayId available; storing note locally only.');
			} else {
				const { error } = await supabase.from('day_hours').upsert(
					{
						day_id: dayId,
						start_hour: startHour,
						body: trimmed,
						aligned
					},
					{ onConflict: 'day_id,start_hour' }
				);

				if (error) {
					throw error;
				}
				synced = true;
			}
		} catch (err) {
			console.error('Supabase day_hours upsert failed:', err);
		}

		dayLog.patchHour(date, idx, { body: trimmed });
		reviewIndex = idx;

		if (!synced) {
			pendingIndex = idx;
			pendingBody = trimmed;
		} else if (pendingIndex === idx) {
			pendingIndex = null;
			pendingBody = null;
		}
	}

	async function recordAlignment(isAligned: boolean) {
		if (reviewIndex === null) return;
		const idx = reviewIndex;

		const bodyToSave =
			pendingIndex === idx && pendingBody !== null ? pendingBody : (entries[idx]?.body ?? '');

		const entry = entries[idx];
		if (!entry) return;

		const startHour = entry.startHour;

		let synced = false;

		try {
			if (!dayId) dayId = await ensureDayId();
			if (!dayId) {
				console.warn('No dayId available; skipping remote alignment upsert.');
			} else {
				const { error } = await supabase.from('day_hours').upsert(
					{
						day_id: dayId,
						start_hour: startHour,
						body: bodyToSave,
						aligned: isAligned
					},
					{ onConflict: 'day_id,start_hour' }
				);
				if (error) {
					throw error;
				}
				synced = true;
			}
		} catch (err) {
			console.error('Supabase day_hours upsert exception:', err);
		}

		dayLog.patchHour(date, idx, { body: bodyToSave, aligned: isAligned });

		if (synced) {
			if (pendingIndex === idx) {
				pendingIndex = null;
				pendingBody = null;
			}
		} else {
			pendingIndex = idx;
			pendingBody = bodyToSave;
		}

		reviewIndex = null;
		const isLast = editingIndex === entries.length - 1;
		if (isLast) {
			showReview = true;
		} else {
			editingIndex = Math.min(idx + 1, entries.length - 1);
		}
	}

	const basePill =
		'inline-flex items-center gap-1 rounded-md px-3 py-1 font-mono text-xs transition-colors focus-visible:outline-none';
	const neutralPill = `${basePill} border border-stone-300 text-stone-700 hover:bg-stone-100`;
	const activePill = `${basePill} bg-stone-900 text-white border border-stone-900`;

	const dots = $derived(entries.map((e) => (e.aligned === undefined ? null : !!e.aligned)));
	const TOTAL = HISTORY_SLOT_COUNT;
	const goodCount = $derived(entries.slice(0, TOTAL).filter((e) => e.aligned === true).length);
	const badCount = $derived(entries.slice(0, TOTAL).filter((e) => e.aligned === false).length);
	const rawScore = $derived(((goodCount + badCount) / 16) * 100 + goodCount - badCount);
	const score = $derived(Math.max(0, Math.min(100, Math.round(rawScore))));
</script>

<ReviewModal
	open={showReview}
	{date}
	{dots}
	{score}
	siteLabel="stoptrolling.app"
	onClose={() => (showReview = false)}
/>

{#if authResolved}
	<header class="fixed top-4 left-6 z-10">
		<button
			type="button"
			class="flex items-center gap-2 rounded-lg bg-transparent px-2 py-1 font-mono text-sm text-stone-600 transition hover:text-stone-800 focus:outline-none"
			onclick={openHistoryModal}
			aria-label="View history"
		>
			<span class="font-semibold text-stone-500">{date.slice(5)}</span>
			<span
				class="max-w-[50vw] truncate"
				transition:fly|global={{ y: 4, delay: 400, duration: 200 }}
				>{goal ? `I will ${goal}` : ''}</span
			>
		</button>
	</header>

	<header class="fixed top-4 right-6 z-10 flex flex-row items-center gap-6">
		<button type="button" class="flex items-center" onclick={openHIWModal}>
			<span class="font-mono text-sm tracking-tighter text-stone-500">How it works</span>
		</button>

		{#if hasUser && !hasXAuthorization}
			<button
				type="button"
				class="flex items-center"
				aria-label="Authorize auto-posting via X OAuth"
				onclick={openAutoPostModal}
				disabled={xAuthorizeLoading}
			>
				<span class="font-mono text-sm tracking-tighter text-stone-500">
					{xAuthorizeLoading ? 'Authorizing…' : 'Authorize auto-post'}
				</span>
			</button>
		{/if}

		<button
			type="button"
			class="flex items-center gap-2"
			onclick={handleAuthButtonClick}
			aria-label={authResolved
				? (firstName ?? userEmail ?? 'Sign In')
				: 'Loading account information'}
		>
			<span class="font-mono text-sm tracking-tighter text-stone-500">
				{#if firstName}
					{firstName}
				{:else if userEmail}
					{userEmail}
				{:else}
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="currentColor"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						shape-rendering="geometricPrecision"
						class="h-4 w-4 transition-colors duration-200"
					>
						<path d="M20 21.5v-2.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2.5h16" />
						<circle cx="12" cy="7" r="4" />
					</svg>
				{/if}
			</span>
		</button>
	</header>
{/if}

<div class="flex min-h-screen items-center justify-center bg-stone-50 px-6">
	{#if !showReview}
		<div class="w-full max-w-xl">
			<div class="flex items-center justify-between gap-4 text-stone-600">
				<div class="flex items-center justify-between text-stone-600">
					<div class="flex min-w-0 items-center gap-2">
						{#if leadingText}
							<span
								class="font-mono text-lg tracking-widest"
								in:fly|global={{ y: 4, delay: 400, duration: 200 }}
							>
								{leadingText}
							</span>
						{/if}

						{#if reviewIndex !== null && entries[reviewIndex]?.body?.trim()}
							<span class="text-stone-300 select-none">•</span>
							<span
								class="truncate font-mono text-lg text-stone-800"
								in:fly={{ y: 6, duration: 180 }}
								title={entries[reviewIndex].body}
							>
								{entries[reviewIndex].body}
							</span>
						{/if}
					</div>
				</div>
			</div>

			{#if reviewIndex === null}
				{#if isActiveSlot || !displayedEntry}
					<form onsubmit={onSubmit} class="flex flex-row">
						<input
							type="text"
							placeholder={placeholderStr}
							value={currentBody}
							oninput={onInput}
							disabled={!isActiveSlot || !displayedEntry}
							class="h-14 w-full border-none bg-transparent pr-2 pl-0 font-mono text-3xl font-light
                   text-stone-900 ring-0 outline-none placeholder:text-stone-300
                   focus:border-transparent focus:ring-0 focus:outline-none"
							autofocus
							aria-label="Current hour note"
						/>
					</form>
				{:else}
					<div class="mt-4">
						<DayDots {entries} {circleClassFor} {rangeLabel} />
					</div>
				{/if}
			{:else}
				<div class="mt-2 flex w-full items-center gap-2">
					<button
						type="button"
						class={activePill + ' h-12 flex-1 justify-center'}
						onclick={() => recordAlignment(true)}
					>
						<span class="self-center text-lg">Good</span>
					</button>

					<button
						type="button"
						class={neutralPill + ' h-12 flex-1 justify-center text-xl'}
						onclick={() => recordAlignment(false)}
					>
						<span class="self-center text-lg">Bad</span>
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if showHIWModal}
	<div
		in:fade={{ duration: 200 }}
		class="fixed inset-0 z-[120] flex items-center justify-center bg-stone-50"
		role="dialog"
		aria-modal="true"
		aria-label="Sign in"
		tabindex="-1"
		onclick={(e) => {
			if (!authLoading && e.target === e.currentTarget) closeHIWModal();
		}}
		onkeydown={(e) => {
			if (!authLoading && e.key === 'Escape') closeHIWModal();
		}}
	>
		<div
			in:scale={{ start: 0.96, duration: 180 }}
			class="w-full max-w-lg rounded-3xl p-6 text-stone-800"
			role="document"
		>
			<div class="space-y-3 text-stone-700">
				<div class="flex flex-row items-center justify-between">
					<h3 class="text-xl font-semibold text-stone-900">How it works</h3>

					<div class="flex flex-wrap items-center justify-center gap-3">
						<span class="inline-flex items-center gap-1">
							<span class="inline-block h-3.5 w-3.5 rounded-full bg-emerald-400" aria-hidden="true"
							></span>
							<span class="text-xs">Good</span>
						</span>
						<span class="inline-flex items-center gap-1">
							<span class="inline-block h-3.5 w-3.5 rounded-full bg-red-400" aria-hidden="true"
							></span>
							<span class="text-xs">Bad</span>
						</span>
						<span class="inline-flex items-center gap-1">
							<span
								class="inline-block h-3.5 w-3.5 rounded-full border border-stone-400"
								aria-hidden="true"
							></span>
							<span class="text-xs">Empty</span>
						</span>
						<span class="inline-flex items-center gap-1">
							<span
								class="inline-block h-3.5 w-3.5 rounded-full border border-dashed border-stone-400 bg-transparent"
								aria-hidden="true"
							></span>
							<span class="text-xs">Future</span>
						</span>
					</div>
				</div>
				<ul class="list-disc space-y-2 pl-5">
					<li>
						<span class="text-stone-900">Log each hour (8am–11pm)</span>
					</li>
					<li>
						<span class="text-stone-900">AI rates what you're doing</span>
					</li>
					<li>
						<span class="text-stone-900">Summary at end of day</span>
					</li>
					<li>
						<span class="text-stone-900">Autoposts summary image to Twitter for accountability</span
						>
					</li>
					<li>
						<span class="text-stone-900">Posts "I didn't do shit today" if no logs</span>
					</li>
				</ul>
			</div>
			{#if !hasUser}
				<button
					type="button"
					onclick={signInWithTwitter}
					disabled={authLoading}
					class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-transparent px-4 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						class="h-5 w-5"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z"
						/>
					</svg>
					<span>{authLoading ? 'Redirecting…' : 'Continue with Twitter'}</span>
				</button>
			{/if}
		</div>
	</div>
{/if}
{#if showAuthModal}
	<div
		in:fade={{ duration: 200 }}
		class="fixed inset-0 z-[120] flex items-center justify-center bg-stone-50/80"
		role="dialog"
		aria-modal="true"
		aria-label="Sign in"
		tabindex="-1"
		onclick={(e) => {
			if (!authLoading && e.target === e.currentTarget) closeAuthModal();
		}}
		onkeydown={(e) => {
			if (!authLoading && e.key === 'Escape') closeAuthModal();
		}}
	>
		<div
			in:scale={{ start: 0.96, duration: 180 }}
			class="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-6 text-stone-800 shadow-[0_12px_32px_rgba(15,15,15,0.12)]"
			role="document"
		>
			<div class="flex items-center justify-between">
				<div class="text-sm font-semibold tracking-tight text-stone-900">Sign in</div>
				<button
					type="button"
					class="rounded-full p-1 text-stone-500 hover:text-stone-800"
					onclick={closeAuthModal}
					aria-label="Close sign in"
					{...{ disabled: authLoading } as any}
				>
					<svg
						viewBox="0 0 24 24"
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M6 6l12 12M6 18L18 6" stroke-linecap="round" />
					</svg>
				</button>
			</div>

			<p class="mt-2 text-xs text-stone-500">Continue to save logs and track your progress.</p>

			<button
				type="button"
				onclick={signInWithTwitter}
				disabled={authLoading}
				class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="h-5 w-5"
					fill="currentColor"
					aria-hidden="true"
				>
					<path
						d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z"
					/>
				</svg>
				<span>{authLoading ? 'Redirecting…' : 'Continue with Twitter'}</span>
			</button>

			{#if authError}
				<p class="mt-3 text-xs text-rose-600">{authError}</p>
			{/if}
		</div>
	</div>
{/if}
{#if showAutoPostModal && hasUser}
	<div
		in:fade={{ duration: 200 }}
		class="fixed inset-0 z-[130] flex items-center justify-center bg-stone-50/80"
		role="dialog"
		aria-modal="true"
		aria-label="Authorize auto-posting"
		tabindex="-1"
		onclick={(e) => {
			if (!xAuthorizeLoading && e.target === e.currentTarget) closeAutoPostModal();
		}}
		onkeydown={(e) => {
			if (!xAuthorizeLoading && e.key === 'Escape') closeAutoPostModal();
		}}
	>
		<div
			in:scale={{ start: 0.96, duration: 180 }}
			class="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-6 text-stone-800 shadow-[0_12px_32px_rgba(15,15,15,0.12)]"
			role="document"
		>
			<div class="flex items-center justify-between">
				<div class="text-sm font-semibold tracking-tight text-stone-900">
					Authorize auto-posting
				</div>
				<button
					type="button"
					class="rounded-full p-1 text-stone-500 hover:text-stone-800"
					onclick={closeAutoPostModal}
					aria-label="Close auto-post authorization"
					{...{ disabled: xAuthorizeLoading } as any}
				>
					<svg
						viewBox="0 0 24 24"
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M6 6l12 12M6 18L18 6" stroke-linecap="round" />
					</svg>
				</button>
			</div>

			<p class="mt-2 text-xs text-stone-500">
				Connect your X account so we can share your daily summary automatically.
			</p>

			<button
				type="button"
				onclick={authorizeAutoPost}
				disabled={xAuthorizeLoading}
				class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="h-5 w-5"
					fill="currentColor"
					aria-hidden="true"
				>
					<path
						d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z"
					/>
				</svg>
				<span>{xAuthorizeLoading ? 'Redirecting…' : 'Authorize with X'}</span>
			</button>

			{#if xAuthorizeError}
				<p class="mt-3 text-xs text-rose-600">{xAuthorizeError}</p>
			{/if}
		</div>
	</div>
{/if}
<HistoryModal open={showHistory} onClose={() => (showHistory = false)} />
