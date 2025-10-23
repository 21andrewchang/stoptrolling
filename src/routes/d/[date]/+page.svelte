<script lang="ts">
	import ReviewModal from '$lib/components/ReviewModal.svelte';
	import DayDots from '$lib/components/DayDots.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { dayLog, type HourEntry, endHourOf, defaultHours } from '$lib/stores/day-log';
	import { ymd, slotRange, minutesUntil, rangeLabel as labelFor } from '$lib/utils/time';
	import { supabase } from '$lib/supabase';
	import type { User } from '@supabase/supabase-js';

	// ---------- Props ----------
	let { data } = $props<{ data: { date: string } }>();
	const { date } = data;

	// ---------- Ensure store for date ----------
	let dayId = $state<string | null>(null);
	let firstName = $state<string | null>(null);
	let userEmail = $state<string | null>(null);
	let hasUser = $state(false);
	let authResolved = $state(false);

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
		const { data: userRes, error: authErr } = await supabase.auth.getUser();
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
		authResolved = true;

		// Upsert the day row and return its id
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

	async function post() {
		const { data: sessionData } = await supabase.auth.getSession();
		const session = sessionData.session;
		const providerToken =
			session?.provider_token ?? (session?.user?.identities?.[0] as any)?.access_token;
		if (!providerToken) {
			console.warn('No provider token available for posting to X.');
			return;
		}

		await fetch('/api/x/post-now', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ access_token: providerToken, text: 'holy shit it works' })
		});
	}

	onMount(async () => {
		await post();
		dayLog.ensure(date);
		await syncFromDatabase();
	});

	async function handleAuthButtonClick(): Promise<void> {
		if (hasUser) return;
		try {
			const redirectTo =
				typeof window !== 'undefined' ? `${window.location.origin}/d/${date}` : undefined;
			const { error } = await supabase.auth.signInWithOAuth({
				provider: 'google',
				options: redirectTo ? { redirectTo } : undefined
			});
			if (error) console.error('Supabase sign-in failed:', error);
		} catch (err) {
			console.error('Supabase sign-in exception:', err);
		}
	}

	// ---------- State ----------
	let showReview = $state(false);

	let goal = $state('');
	let entries = $state<HourEntry[]>([]);
	let now = $state(new Date());

	// Mirror store -> local state
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

		// Regular path
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

	// ---------- UI helpers ----------
	function isFuture(entry: HourEntry): boolean {
		const today = ymd(now);
		if (date > today) return true; // viewing a future day
		if (date < today) return false; // viewing a past day
		// same day → compare to slot start
		const { start } = slotRange(date, entry.startHour, endHourOf);
		return now.getTime() < start.getTime();
	}

	function circleClassFor(entry: HourEntry): string {
		const hasBody = !!entry.body && entry.body.trim().length > 0;
		// all gray; fill if there's a note
		const base = hasBody ? 'bg-stone-400 border-stone-400' : 'bg-transparent border-stone-400';
		// dashed only for future
		return isFuture(entry) ? `${base} border-dashed` : base;
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

		// choose the body: staged input if this is the same slot, otherwise existing text
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

		// advance UI
		reviewIndex = null;
		const isLast = editingIndex === entries.length - 1;
		if (isLast) {
			showReview = true;
		} else {
			editingIndex = Math.min(idx + 1, entries.length - 1);
		}
	}

	// ---------- Styles ----------
	const basePill =
		'inline-flex items-center gap-1 rounded-md px-3 py-1 font-mono text-xs transition-colors focus-visible:outline-none';
	const neutralPill = `${basePill} border border-stone-300 text-stone-700 hover:bg-stone-100`;
	const activePill = `${basePill} bg-stone-900 text-white border border-stone-900`;

	// ---------- Score ----------
	const dots = $derived(entries.map((e) => (e.aligned === undefined ? null : !!e.aligned)));
	const TOTAL = 16;
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
	<header class="fixed top-4 left-6 z-10 text-stone-600">
		<div class="flex items-center gap-2 font-mono text-sm">
			<span class="font-semibold text-stone-800">{date.slice(5)}</span>
			<span
				class="max-w-[50vw] truncate"
				transition:fly|global={{ y: 4, delay: 400, duration: 200 }}
				>{goal ? `I will ${goal}` : ''}</span
			>
		</div>
	</header>

	<header class="fixed top-4 right-6 z-10">
		<button
			type="button"
			class="flex items-center gap-2"
			onclick={handleAuthButtonClick}
			aria-label={authResolved
				? (firstName ?? userEmail ?? 'Sign In')
				: 'Loading account information'}
		>
			<div class="text-stone-500">
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
			</div>
			<span class="font-mono text-sm text-stone-500">
				{#if firstName}
					{firstName}
				{:else if userEmail}
					{userEmail}
				{:else}
					Sign In
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
