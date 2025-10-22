<script lang="ts">
	import { goto } from '$app/navigation';
	import ReviewModal from '$lib/components/ReviewModal.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { fly, blur } from 'svelte/transition';
	import { dayLog, type HourEntry, endHourOf } from '$lib/stores/day-log';

	let { data } = $props<{ data: { date: string } }>();
	const { date } = data;

	const username = '21andrewch';
	onMount(() => dayLog.ensure(date));
	let showReview = $state(false);

	function handleCloseModal() {
		showReview = false;
	}

	// store mirrors
	let goal = $state('');
	let entries = $state<HourEntry[]>([]);
	let now = $state(new Date());
	$effect(() => {
		const rec = $dayLog[date];
		goal = rec?.goal ?? '';
		entries = rec?.hours ?? [];
	});

	// clock
	let timer: ReturnType<typeof setInterval> | null = null;
	onMount(() => {
		timer = setInterval(() => (now = new Date()), 60_000);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	// helpers
	function ymd(d: Date) {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${dd}`;
	}
	function slotRange(startHour: number) {
		const [y, m, d] = date.split('-').map((n: string) => parseInt(n, 10));
		const start = new Date(y, m - 1, d, startHour, 0, 0, 0);
		const end = new Date(y, m - 1, d, endHourOf(startHour), 0, 0, 0);
		return { start, end };
	}
	type Visual = 'past' | 'current' | 'future';
	function visualFor(entry: HourEntry): Visual {
		const today = ymd(now);
		if (date < today) return 'past';
		if (date > today) return 'future';
		const { start, end } = slotRange(entry.startHour);
		const t = now.getTime();
		if (t >= end.getTime()) return 'past';
		if (t >= start.getTime() && t < end.getTime()) return 'current';
		return 'future';
	}
	function formatHour(h: number) {
		const hour12 = ((h + 11) % 12) + 1; // 0→12, 13→1, etc
		const meridiem = h < 12 ? 'AM' : 'PM';
		return { hour12, meridiem };
	}
	function rangeLabel(entry: HourEntry) {
		const start = entry.startHour;
		const end = endHourOf(start); // e.g. +1
		const { hour12: sH, meridiem: sM } = formatHour(start);
		const { hour12: eH, meridiem: eM } = formatHour(end % 24);

		return sM === eM ? `${sH}–${eH}${eM}` : `${sH}${sM}–${eH}${eM}`;
	}

	let manualIndex = $state<number | null>(15);
	let currentIndex = $state<number | null>(null);

	$effect(() => {
		if (!entries.length) {
			currentIndex = null;
			return;
		}
		const today = ymd(now);
		if (date !== today) {
			currentIndex = null;
			return;
		}
		const START = entries[0].startHour,
			SLOTS = entries.length,
			h = now.getHours();
		// currentIndex = h >= START && h < START + SLOTS ? h - START : null;
		currentIndex = manualIndex;
	});

	let editingIndex = $state<number | null>(null);

	$effect(() => {
		if (currentIndex === null || entries.length === 0) {
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

		// Otherwise, target current (if empty) or next (if reviewed)
		const target =
			hasBody && reviewed ? Math.min(currentIndex + 1, entries.length - 1) : currentIndex;

		if (editingIndex === null || editingIndex < target) {
			editingIndex = target;
		}

		// If we moved away from current, make sure review UI is closed
		if (editingIndex !== currentIndex) {
			reviewIndex = null;
		}
	});

	// minutes until the start of a given slot (>= 0)
	function minutesUntilStart(startHour: number): number {
		const { start } = slotRange(startHour);
		const ms = start.getTime() - now.getTime();
		return Math.max(0, Math.ceil(ms / 60000));
	}

	// input model (kept in sync with the displayed slot)
	let currentBody = $state('');
	$effect(() => {
		currentBody = displayedEntry ? (displayedEntry.body ?? '') : '';
	});

	function onInput(e: Event) {
		currentBody = (e.currentTarget as HTMLInputElement).value;
	}

	// below onSubmit, add this state:
	let reviewIndex = $state<number | null>(null);

	function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!isActiveSlot || editingIndex === null) return;

		const trimmed = currentBody.trim();
		dayLog.patchHour(date, editingIndex, { body: trimmed });

		// enter review mode for this slot
		reviewIndex = editingIndex;
	}

	const dots = $derived(entries.map((e) => (e.aligned === undefined ? null : !!e.aligned)));
	const badge = $derived(entries.filter((e) => e.aligned === true).length);

	function recordAlignment(isAligned: boolean) {
		if (reviewIndex === null) return;
		const idx = reviewIndex;
		dayLog.patchHour(date, idx, { aligned: isAligned });
		reviewIndex = null;

		const isLast = editingIndex === entries.length - 1;
		if (isLast) {
			showReview = true; // open modal
			return;
		}
		editingIndex = Math.min(idx + 1, entries.length - 1);
	}

	let displayedEntry = $state<HourEntry | undefined>(undefined);
	let isActiveSlot = $state(false);
	let placeholderStr = $state('');

	$effect(() => {
		displayedEntry = editingIndex !== null ? entries[editingIndex] : undefined;
		isActiveSlot = editingIndex !== null && editingIndex === currentIndex;

		if (!displayedEntry) {
			placeholderStr = '';
			return;
		}

		if (isActiveSlot) {
			placeholderStr = 'What are you doing right now?';
			return;
		}

		// Not the active slot: choose message based on time relation
		const rel = visualFor(displayedEntry);
		if (rel === 'future') {
			const mins = minutesUntilStart(displayedEntry.startHour);
			placeholderStr =
				mins === 0 ? 'Almost time…' : `Come back in ${mins} minute${mins === 1 ? '' : 's'}...`;
		} else {
			// past
			placeholderStr = 'This hour has passed';
		}
	});

	// dot styles
	function circleClassFor(entry: HourEntry): string {
		const v = visualFor(entry);
		const hasBody = !!entry.body && entry.body.trim().length > 0;
		if (v === 'future') return 'bg-transparent border-stone-400 border-dashed';
		if (v === 'current')
			return hasBody ? 'bg-stone-900 border-stone-900' : 'bg-stone-50 border-stone-900';
		// past
		return hasBody ? 'bg-stone-400 border-stone-400' : 'bg-transparent border-stone-400';
	}

	function clearHour(index: number) {
		if (index < 0 || index >= entries.length) return;
		dayLog.patchHour(date, index, { body: '', aligned: undefined });
		if (reviewIndex === index) reviewIndex = null;
	}
	function lastLoggedIndex(): number {
		for (let i = entries.length - 1; i >= 0; i--) {
			if (entries[i]?.body?.trim()) return i;
		}
		return -1;
	}

	type DotTip = { show: boolean; x: number; y: number; when: string; note: string };
	let dotTooltip = $state<DotTip>({ show: false, x: 0, y: 0, when: '', note: '' });

	function showDotTooltip(event: MouseEvent | FocusEvent, entry: HourEntry) {
		const target = event.currentTarget as HTMLElement | null;
		if (!target) return;
		const rect = target.getBoundingClientRect();
		dotTooltip = {
			show: true,
			x: rect.left + rect.width / 2,
			y: rect.bottom + 10,
			when: rangeLabel(entry),
			note: entry.body?.trim() ? entry.body.trim() : 'Trolling'
		};
	}
	function hideDotTooltip() {
		dotTooltip.show = false;
	}
	function showCurrentTooltip(event: MouseEvent | FocusEvent) {
		if (currentIndex === null) return;
		const entry = entries[currentIndex];
		showDotTooltip(event, entry);
	}

	const aligned = $derived(
		reviewIndex !== null ? entries[reviewIndex]?.aligned : displayedEntry?.aligned
	);

	const basePill =
		'inline-flex items-center gap-1 rounded-md px-3 py-1 font-mono text-xs transition-colors focus-visible:outline-none';

	const neutralPill = `${basePill} border border-stone-300 text-stone-700 hover:bg-stone-100`;

	const activePill = `${basePill} bg-stone-900 text-white border border-stone-900`;
</script>

<ReviewModal
	open={showReview}
	{date}
	{dots}
	{badge}
	siteLabel="stoptrolling.app"
	onClose={handleCloseModal}
/>
{#if goal}
	<header class="fixed top-4 left-6 z-10 text-stone-600">
		<div
			in:fly={{ y: 5, delay: 0, duration: 300 }}
			class="flex items-center gap-2 font-mono text-sm"
		>
			<span class="font-semibold text-stone-800">{date.slice(5)}</span>
			<span class="max-w-[50vw] truncate">{goal ? `I will ${goal}` : ''}</span>
		</div>

		<div class="mt-2 flex flex-wrap items-center gap-2" aria-label="Hours" role="list">
			{#each entries as entry, i}
				<button
					type="button"
					in:fly|global={{ y: 5, delay: i * 30 + 100, duration: 300 }}
					class={`h-2.5 w-2.5 rounded-full border ${circleClassFor(entry)} cursor-pointer outline-none`}
					role="listitem"
					aria-label={`${rangeLabel(entry)} — ${entry.body?.trim() ? entry.body.trim() : 'Trolling'}`}
					onmouseenter={(e) => showDotTooltip(e, entry)}
					onmouseleave={hideDotTooltip}
					onfocus={(e) => showDotTooltip(e, entry)}
					onblur={hideDotTooltip}
				/>
			{/each}
		</div>
	</header>
{/if}
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

<div class="fixed bottom-4 left-6 z-50">
	<button
		type="button"
		class="rounded border border-stone-300 bg-white px-3 py-1.5 font-mono text-xs text-stone-700 hover:bg-stone-100"
		onclick={() => {
			const i = lastLoggedIndex();
			if (i >= 0) clearHour(i);
		}}
		title="Clear the most recent logged hour"
	>
		Clear last hour
	</button>
</div>

<main
	class="flex min-h-screen items-center justify-center bg-stone-50 px-6"
	in:fly|global={{ y: 5, delay: 1000, duration: 300 }}
>
	{#if !showReview}
		<div class="w-full max-w-xl">
			<div class="flex items-center justify-between gap-4 text-stone-600">
				<div class="flex items-center justify-between text-stone-600">
					<div class="flex min-w-0 items-center gap-2">
						<button
							type="button"
							class={`inline-block h-4 w-4 rounded-full border ${
								displayedEntry
									? circleClassFor(displayedEntry)
									: 'border-dashed border-stone-400 bg-transparent'
							}`}
							onmouseenter={showCurrentTooltip}
							onmouseleave={hideDotTooltip}
							onfocus={showCurrentTooltip}
							onblur={hideDotTooltip}
							aria-label={displayedEntry ? `Status for ${rangeLabel(displayedEntry)}` : 'Status'}
						/>

						<span class="font-mono text-lg tracking-widest">
							{displayedEntry ? rangeLabel(displayedEntry) : ''}
						</span>

						{#if reviewIndex !== null && entries[reviewIndex]?.body?.trim()}
							<span class="text-stone-300 select-none">•</span>
							<span
								in:fly|global={{ y: 6, duration: 180 }}
								class="truncate font-mono text-lg text-stone-800"
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
						class={(aligned === true ? activePill : neutralPill) + ' h-14 flex-1 justify-center'}
						onclick={() => recordAlignment(true)}
						aria-pressed={aligned === true}
						autofocus
					>
						<span class="text-lg">Good</span>
					</button>

					<button
						type="button"
						class={(aligned === false ? activePill : neutralPill) +
							' h-14 flex-1 justify-center text-xl'}
						onclick={() => recordAlignment(false)}
						aria-pressed={aligned === false}
					>
						<span class="text-lg">Bad</span>
					</button>
				</div>
			{/if}
		</div>
	{/if}
</main>

{#if dotTooltip.show}
	<div
		class="pointer-events-none fixed z-50 rounded-md border border-stone-200 bg-white px-3 py-2 text-xs text-stone-900 shadow-xl transition-transform duration-150"
		style="
      left: {dotTooltip.x}px;
      top: {dotTooltip.y}px;
      transform: translateX(-50%);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
      white-space: nowrap;
    "
		role="tooltip"
	>
		<div class="font-mono text-[11px] text-stone-500">{dotTooltip.when}</div>
		<div class="mt-1 text-[13px]">{dotTooltip.note}</div>
	</div>
{/if}
