<script lang="ts">
	import ReviewModal from '$lib/components/ReviewModal.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { dayLog, type HourEntry, endHourOf, defaultHours } from '$lib/stores/day-log';
	import { ymd, slotRange, minutesUntil, rangeLabel as labelFor } from '$lib/utils/time';
	import { supabase } from '$lib/supabase';

	// ---------- Props ----------
	let { data } = $props<{ data: { date: string } }>();
	const { date } = data;

	// ---------- Constants ----------
	const username = '21andrewch';

	// ---------- Ensure store for date ----------
	let dayId = $state<string | null>(null);

	async function ensureDayId(): Promise<string | null> {
		const { data: userRes, error: authErr } = await supabase.auth.getUser();
		if (authErr) {
			console.error('auth error', authErr);
			return null;
		}
		const user_id = userRes?.user?.id;
		if (!user_id) return null;

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
		console.log(remote.goal);
	}

	onMount(() => {
		dayLog.ensure(date);
		void syncFromDatabase();
	});

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

	let currentBody = $state('');
	$effect(() => {
		currentBody = displayedEntry ? (displayedEntry.body ?? '') : '';
	});

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
	const rawScore = $derived(((goodCount + badCount) / 16) * 100 + goodCount * 3 - badCount * 2);
	const score = $derived(Math.max(0, Math.min(150, Math.round(rawScore))));
</script>

<ReviewModal
	open={showReview}
	{date}
	{dots}
	{score}
	siteLabel="stoptrolling.app"
	onClose={() => (showReview = false)}
/>

<header class="fixed top-4 left-6 z-10 text-stone-600">
	<div class="flex items-center gap-2 font-mono text-sm" in:fly={{ y: 5, delay: 0, duration: 300 }}>
		<span class="font-semibold text-stone-800">{date.slice(5)}</span>
		<span class="max-w-[50vw] truncate">{goal ? `I will ${goal}` : ''}</span>
	</div>

	<div class="mt-2 flex flex-wrap items-center gap-1" aria-label="Hours" role="list">
		{#each entries as entry, i}
			<button
				type="button"
				in:fly|global={{ y: 5, delay: i * 30 + 100, duration: 300 }}
				class={`h-3 w-3 rounded-full border ${circleClassFor(entry)} cursor-pointer outline-none`}
				role="listitem"
				aria-label={`${rangeLabel(entry)} — ${entry.body?.trim() ? entry.body.trim() : 'Trolling'}`}
			/>
		{/each}
	</div>
</header>

{#if username}
	<header class="fixed top-4 right-6 z-10">
		<button class="flex items-center gap-2">
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
			<span class="font-mono text-sm text-stone-500">{username}</span>
		</button>
	</header>
{/if}

<div class="flex min-h-screen items-center justify-center bg-stone-50 px-6">
	{#if !showReview}
		<div class="w-full max-w-xl">
			<div class="flex items-center justify-between gap-4 text-stone-600">
				<div class="flex items-center justify-between text-stone-600">
					<div class="flex min-w-0 items-center gap-2">
						<span class="font-mono text-lg tracking-widest">
							{displayedEntry ? rangeLabel(displayedEntry) : ''}
						</span>

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
