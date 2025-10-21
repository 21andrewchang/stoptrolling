<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { dailyGoal } from '$lib/stores/goal';
	import { dayLog, type HourEntry, endHourOf } from '$lib/stores/day-log';

	let { data } = $props<{ data: { date: string } }>();
	const { date } = data;

	// Ensure 08:00–24:00 defaults on client
	onMount(() => dayLog.ensure(date));

	// Keep entries and time in local rune state
	let entries = $state<HourEntry[]>([]);
	let now = $state(new Date());

	$effect(() => {
		entries = $dayLog[date] ?? [];
	});

	// tick clock every minute
	let timer: ReturnType<typeof setInterval> | null = null;
	onMount(() => {
		timer = setInterval(() => (now = new Date()), 60_000);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	// Utilities
	function ymd(d: Date) {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${dd}`;
	}

	// Build Date objects for a slot on the page’s date (local time)
	function slotRange(startHour: number) {
		const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
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

	function rangeLabel(entry: HourEntry) {
		const { start, end } = slotRange(entry.startHour);
		return `${start.toLocaleTimeString([], { hour: 'numeric' })} – ${end.toLocaleTimeString([], { hour: 'numeric' })}`;
	}

	// Tailwind classes per visual state
	const circleClass = {
		past: 'bg-stone-900 border-stone-900',
		current: 'bg-stone-400 border-stone-400',
		future: 'bg-transparent border-stone-400 border-dotted'
	} as const;
</script>

<main class="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-6">
	<h1 class="text-center font-mono text-4xl font-semibold text-stone-900 md:text-5xl">
		Today is {date}
	</h1>

	<p class="mt-8 max-w-2xl text-center text-2xl font-light text-stone-700">
		{$dailyGoal ? `Your focus: ${$dailyGoal}` : 'You have not set a goal yet.'}
	</p>

	<section class="mt-10 w-full max-w-4xl">
		<div class="flex flex-wrap items-center justify-center gap-3" aria-label="Hours" role="list">
			{#each entries as entry, i}
				{@const v = visualFor(entry)}
				<span
					in:fly|global={{ y: 5, delay: i * 40, duration: 500 }}
					class={`inline-block h-4 w-4 rounded-full border-2 transition-colors ${circleClass[v]}`}
					role="listitem"
					aria-label={`${rangeLabel(entry)} (${v})`}
					title={`${rangeLabel(entry)} (${v})`}
				/>
			{/each}
		</div>
	</section>
</main>
