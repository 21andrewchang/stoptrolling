<script lang="ts">
	import ReviewModal from '$lib/components/ReviewModal.svelte';
	import DayDots from '$lib/components/DayDots.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { dayLog, type HourEntry, endHourOf, defaultHours } from '$lib/stores/day-log';
	import { ymd, slotRange, minutesUntil, rangeLabel as labelFor } from '$lib/utils/time';
	import { supabase } from '$lib/supabase';
	import type { User } from '@supabase/supabase-js';

	const date = ymd(new Date());

	let dayId = $state<string | null>(null);
	let firstName = $state<string | null>(null);
	let userEmail = $state<string | null>(null);
	let hasUser = $state(false);
	let authResolved = $state(false);
	let showAuthModal = $state(false);
	let showHIWModal = $state(false);
	let authLoading = $state(false);
	let authError = $state('');

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
		authResolved = true;

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

	onMount(async () => {
		dayLog.ensure(date);
		await syncFromDatabase();
	});

	function openAuthModal() {
		authError = '';
		showAuthModal = true;
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
		if (hasUser) return;
		openAuthModal();
	}

	let showReview = $state(false);

	let goal = $state('');
	let entries = $state<HourEntry[]>([]);
	let now = $state(new Date());

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

	function circleClassFor(entry: HourEntry): string {
		const hasBody = !!entry.body && entry.body.trim().length > 0;
		const base = hasBody ? 'bg-stone-400 border-stone-400' : 'bg-transparent border-stone-400';
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
	<header class="fixed top-4 left-6 z-10">
		<div class="flex items-center gap-2 font-mono text-sm">
			<span class="font-semibold text-stone-500">{date.slice(5)}</span>
			<span
				class="max-w-[50vw] truncate"
				transition:fly|global={{ y: 4, delay: 400, duration: 200 }}
				>{goal ? `I will ${goal}` : ''}</span
			>
		</div>
	</header>

	<header class="fixed top-4 right-6 z-10 flex flex-row items-center gap-6">
		{#if !hasUser}
			<button type="button" class="flex items-center" onclick={openHIWModal}>
				<span class="font-mono text-sm tracking-tighter text-stone-500">How it works</span>
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
			class="w-full max-w-sm rounded-3xl p-6 text-stone-800"
			role="document"
		>
			<div class="flex items-center justify-between">
				<div class="text-sm font-semibold tracking-tight text-stone-900">Sign in</div>
				<button
					type="button"
					class="rounded-full p-1 text-stone-500 hover:text-stone-800"
					onclick={closeHIWModal}
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
				<span>{authLoading ? 'Redirecting…' : 'Continue with X'}</span>
			</button>
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
				<span>{authLoading ? 'Redirecting…' : 'Continue with X'}</span>
			</button>

			{#if authError}
				<p class="mt-3 text-xs text-rose-600">{authError}</p>
			{/if}
		</div>
	</div>
{/if}
