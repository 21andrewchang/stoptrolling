<script lang="ts">
	import InputState from '$lib/components/InputState.svelte';
	import DisplayState from '$lib/components/DisplayState.svelte';
	import ReviewModal from '$lib/components/ReviewModal.svelte';
	import HistoryModal from '$lib/components/HistoryModal.svelte';
	import AutoPostModal from '$lib/components/AutoPostModal.svelte';
	import AuthModal from '$lib/components/AuthModal.svelte';
	import HowItWorksModal from '$lib/components/HowItWorksModal.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { dayLog, type HourEntry, endHourOf, defaultHours } from '$lib/stores/day-log';
	import { historyStore, historyLoading, historyLoaded, historyError } from '$lib/stores/history';
	import type { HistoryDay } from '$lib/stores/history';
	import { ymd, slotRange, minutesUntil, rangeLabel as labelFor } from '$lib/utils/time';
	import { supabase } from '$lib/supabase';
	import { PUBLIC_X_CLIENT_ID, PUBLIC_X_REDIRECT_URI } from '$env/static/public';
	import type { User } from '@supabase/supabase-js';
	import { get } from 'svelte/store';
	import { makeDayService } from '$lib/services/day';
	import { makeRatingService } from '$lib/services/rating';
	import { makeSessionService } from '$lib/services/session';
	import { buildRandomString, createPkceChallenge, persistPkceState } from '$lib/xoauth/client';
	import type { PageData } from './$types';

	const date = ymd(new Date());
	const HISTORY_SLOT_COUNT = 16;

	const daySvc = makeDayService(supabase);
	const ratingSvc = makeRatingService(supabase, fetch);
	const sessionSvc = makeSessionService(supabase, fetch);

	const { data } = $props<{ data: PageData }>();
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

	const initialGoal = data?.day?.goal ?? '';
	const initialHours = data?.day?.hours ?? defaultHours();

	if (data?.user) {
		hasUser = true;
		userId = data.user.id;
		userEmail = typeof data.user.email === 'string' ? data.user.email : null;
		authResolved = true;
	}

	if (data?.day) {
		dayId = data.day.id;
		dayLog.replaceHours(date, initialHours);
		dayLog.setGoal(date, initialGoal);
	}

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

	async function ensureTodayRecord(): Promise<{ id: string; goal: string } | null> {
		try {
			const { user, error } = await sessionSvc.getAuthedUser();
			if (error || !user) {
				if (error) console.error('Supabase getUser error:', error);
				firstName = null;
				userEmail = null;
				hasUser = false;
				userId = null;
				authResolved = true;
				return null;
			}

			firstName = deriveFirstName(user);
			userEmail = typeof user.email === 'string' ? user.email : null;
			hasUser = true;
			userId = user.id;
			authResolved = true;

			await sessionSvc.syncServerSession();
			await upsertTimezoneIfNeeded(user.id);
			await checkAutoPostAuthorization(user.id);
			void loadHistoryInBackground(user.id);

			const today = await daySvc.ensureToday(user.id);
			dayId = today.id;
			return { id: today.id, goal: today.goal };
		} catch (err) {
			console.error('ensureTodayRecord failed:', err);
			firstName = null;
			userEmail = null;
			hasUser = false;
			userId = null;
			authResolved = true;
			return null;
		}
	}

	async function syncFromDatabase(): Promise<void> {
		const today = await ensureTodayRecord();
		if (!today) return;

		try {
			const hours = await daySvc.loadDayHours(today.id);
			dayLog.replaceHours(date, hours);
			dayLog.setGoal(date, today.goal);
		} catch (err) {
			console.error('Failed to load day data:', err);
		}
	}

	async function ensureDayId(): Promise<string | null> {
		const today = await ensureTodayRecord();
		return today?.id ?? null;
	}

	async function upsertTimezoneIfNeeded(user_id: string): Promise<void> {
		try {
			if (typeof Intl === 'undefined' || typeof window === 'undefined') return;

			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

			const { data: existing, error: readErr } = await supabase
				.from('users')
				.select('timezone')
				.eq('user_id', user_id)
				.maybeSingle();

			if (readErr) {
				console.warn('profiles read failed (timezone check):', readErr);
			}
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
	let hydrated = $state(false);

	onMount(async () => {
		dayLog.ensure(date);
		await syncFromDatabase();
		hydrated = true;
	});

	function openAuthModal() {
		authError = '';
		showAuthModal = true;
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
		pendingIndex = null;
		pendingBody = null;
		currentBody = '';
		goal = '';
		goalDraft = '';
		goalSaving = false;
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
	let goal = $state(initialGoal);
	let goalDraft = $state(initialGoal);
	let goalSaving = $state(false);
	let entries = $state<HourEntry[]>(initialHours);
	let now = $state(new Date());
	let xAuthorizeLoading = $state(false);

	const isQuietHours = $derived(
		(() => {
			const h = now.getHours();
			return h < 8;
		})()
	);

	function nextEightAM(from: Date): Date {
		const d = new Date(from);
		const eight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0, 0, 0);
		if (d.getHours() < 8) return eight;
		const tomorrow = new Date(eight);
		tomorrow.setDate(tomorrow.getDate() + 1);
		return tomorrow;
	}

	const msUntil8 = $derived(
		(() => {
			if (!isQuietHours) return 0;
			return Math.max(0, nextEightAM(now).getTime() - now.getTime());
		})()
	);

	const countdown = $derived(
		(() => {
			if (!isQuietHours || msUntil8 <= 0) return { hours: 0, minutes: 0 };
			const totalMinutes = Math.ceil(msUntil8 / 60000);
			const hours = Math.floor(totalMinutes / 60);
			const minutes = totalMinutes % 60;
			return { hours, minutes };
		})()
	);

	$effect(() => {
		const rec = $dayLog[date];
		const nextGoal = rec?.goal ?? '';
		goal = nextGoal;
		goalDraft = nextGoal;
		entries = rec?.hours ?? [];
	});

	let timer: ReturnType<typeof setInterval> | null = null;
	onMount(() => {
		timer = setInterval(() => (now = new Date()), 60_000);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	const SLOT_COUNT = 16;

	const currentIndex = $derived(
		(() => {
			if (!entries.length) return null as number | null;
			const today = ymd(now);
			if (date !== today) return null;
			const startHour = entries[0].startHour;
			const hour = now.getHours();
			const idx = hour - startHour;
			return idx >= 0 && idx < SLOT_COUNT ? idx : null;
		})()
	);

	const currentEntry = $derived<HourEntry | undefined>(
		(() => (currentIndex !== null ? entries[currentIndex] : undefined))()
	);

	const hasCurrentLog = $derived(
		(() => {
			if (!currentEntry) return false;
			return !!currentEntry.body?.trim();
		})()
	);

	const showInput = $derived((() => !isQuietHours && !!currentEntry && !hasCurrentLog)());

	const inputPlaceholder = 'What are you doing right now?';

	const slotLabel = $derived(
		(() => {
			const entry = currentEntry;
			if (!entry || !showInput) return '';
			return rangeLabel(entry);
		})()
	);

	const statusText = $derived(
		(() => {
			if (isQuietHours) {
				const parts: string[] = [];
				if (countdown.hours > 0) {
					parts.push(`${countdown.hours} hour${countdown.hours === 1 ? '' : 's'}`);
				}
				if (countdown.minutes > 0) {
					parts.push(`${countdown.minutes} minute${countdown.minutes === 1 ? '' : 's'}`);
				}
				const suffix = parts.length ? `Come back in ${parts.join(' and ')}.` : 'Come back soon.';
				return `Goodnight. ${suffix}`;
			}

			const entry = currentEntry;
			if (!entry) return '';

			const { start, end } = slotRange(date, entry.startHour, endHourOf);
			const tNow = now.getTime();
			const today = ymd(now);

			const minsUntilStart = minutesUntil(start, now);
			const minsUntilEnd = minutesUntil(end, now);
			const labelForMins = (mins: number) =>
				mins <= 0 ? 'Almost time…' : `Come back in ${mins} minute${mins === 1 ? '' : 's'}...`;

			if (date > today) return labelForMins(minsUntilStart);
			if (date < today) return 'This hour has passed';

			if (tNow < start.getTime()) return labelForMins(minsUntilStart);
			if (tNow >= end.getTime()) return 'This hour has passed';

			return labelForMins(minsUntilEnd);
		})()
	);

	let currentBody = $state('');
	$effect(() => {
		currentBody = currentEntry ? (currentEntry.body ?? '') : '';
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
			const serverSessionSynced = await sessionSvc.syncServerSession();
			if (!serverSessionSynced) {
				xAuthorizeLoading = false;
				xAuthorizeError = 'We could not confirm your Supabase session. Please sign in again.';
				return;
			}

			const verifier = buildRandomString(64);
			const challenge = await createPkceChallenge(verifier);
			const stateValue = buildRandomString(32);
			try {
				persistPkceState(verifier, stateValue);
			} catch (err) {
				console.warn('Failed to persist X OAuth state', err);
			}

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

	async function backgroundRateAndPersist(
		dayId: string,
		dayKey: string,
		startHour: number,
		body: string,
		goalText: string | null
	): Promise<void> {
		try {
			const aligned = await ratingSvc.rateAndPersist(dayId, startHour, body, goalText ?? '');

			const recIdx = entries.findIndex((e) => e.startHour === startHour);
			if (recIdx !== -1) dayLog.patchHour(dayKey, recIdx, { aligned });

			if (pendingIndex === recIdx) {
				pendingIndex = null;
				pendingBody = null;
			}
		} catch (err) {
			console.error('backgroundRateAndPersist failed:', err);
		}
	}
	let pendingIndex = $state<number | null>(null);
	let pendingBody = $state<string | null>(null);

	async function submitGoal(e: SubmitEvent) {
		e.preventDefault();
		const trimmed = goalDraft.trim();
		if (!trimmed) return;

		let synced = false;

		try {
			goalSaving = true;
			if (!dayId) dayId = await ensureDayId();
			if (!dayId) {
				console.warn('No dayId available; storing goal locally only.');
			} else {
				await daySvc.upsertGoal(dayId, trimmed);
				synced = true;
			}
		} catch (err) {
			console.error('Supabase goal update failed:', err);
		} finally {
			goalSaving = false;
		}

		dayLog.setGoal(date, trimmed);

		if (!synced) {
			console.warn('Goal saved locally; will sync once Supabase is available.');
		}
	}

	async function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!showInput || currentIndex === null) return;

		const idx = currentIndex;
		const entry = entries[idx];
		if (!entry) return;

		const trimmed = currentBody.trim();
		if (!trimmed) return;

		const startHour = entry.startHour;
		const entryDayKey = date;

		let synced = false;

		try {
			if (!dayId) dayId = await ensureDayId();
			if (!dayId) {
				console.warn('No dayId available; storing note locally only.');
			} else {
				await daySvc.upsertHour(dayId, startHour, trimmed);
				synced = true;
			}
		} catch (err) {
			console.error('Supabase day_hours upsert failed:', err);
		}

		dayLog.patchHour(entryDayKey, idx, { body: trimmed });

		if (!synced) {
			pendingIndex = idx;
			pendingBody = trimmed;
		} else if (pendingIndex === idx) {
			pendingIndex = null;
			pendingBody = null;
		}

		if (dayId) {
			void backgroundRateAndPersist(dayId, entryDayKey, startHour, trimmed, goal);
		}

		const isLast = currentIndex === entries.length - 1;
		if (isLast) showReview = true;
	}

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
	<header
		class="fixed top-4 left-6 z-10 flex flex-row"
		transition:fly|global={{ y: 2, delay: 400, duration: 800, easing: cubicOut }}
	>
		<button
			type="button"
			class="flex items-center gap-2 rounded-lg bg-transparent px-2 py-1 font-mono text-sm text-stone-800 transition hover:text-stone-800 focus:outline-none"
			onclick={openHistoryModal}
			aria-label="View history"
		>
			<span class="font-semibold text-stone-800">{date.slice(5)}</span>
		</button>
		<form class="max-w-[60vw]" onsubmit={submitGoal} aria-label="Set today's goal">
			<input
				class="w-full rounded-md border-0 bg-transparent px-2 py-1 font-mono text-sm tracking-tighter text-stone-600 placeholder:text-stone-400 focus:ring-0 focus:outline-none disabled:opacity-60"
				type="text"
				name="goal"
				bind:value={goalDraft}
				placeholder={isQuietHours ? "Set tomorrow's goal..." : "Set today's goal..."}
				autocomplete="off"
				disabled={goalSaving}
			/>
		</form>
	</header>

	<header
		class="fixed top-4 right-6 z-10 flex flex-row items-center gap-6"
		transition:fly|global={{ y: 2, delay: 400, duration: 800, easing: cubicOut }}
	>
		<button type="button" class="flex items-center" onclick={openHIWModal}>
			<span class="font-mono text-sm tracking-tighter text-stone-500">How it works</span>
		</button>

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
	<div class="w-full max-w-xl">
		{#key showInput}
			{#if hydrated}
				<InputState
					{showInput}
					{slotLabel}
					{statusText}
					{inputPlaceholder}
					{currentBody}
					{currentEntry}
					{onInput}
					{onSubmit}
				/>
				<DisplayState
					showDisplay={!showInput}
					{isQuietHours}
					{entries}
					{circleClassFor}
					{rangeLabel}
					{slotLabel}
					{statusText}
				/>
			{/if}
		{/key}
	</div>
</div>

<HowItWorksModal
	open={showHIWModal}
	loading={authLoading}
	{hasUser}
	onClose={closeHIWModal}
	onSignIn={signInWithTwitter}
/>
<AuthModal
	open={showAuthModal}
	loading={authLoading}
	error={authError}
	onSignIn={signInWithTwitter}
	onClose={closeAuthModal}
/>
<AutoPostModal
	open={showAutoPostModal && hasUser}
	loading={xAuthorizeLoading}
	error={xAuthorizeError}
	onAuthorize={authorizeAutoPost}
	onClose={closeAutoPostModal}
/>
<HistoryModal open={showHistory} onClose={() => (showHistory = false)} />
