<script lang="ts">
	import { onMount } from 'svelte';
	import { dayLog, endHourOf, type DayRecord, type HourEntry } from '$lib/stores/day-log';

	let { data } = $props<{ data: { date: string } }>();
	const { date } = data;

	onMount(() => {
		dayLog.ensure(date);
	});

	let record = $state<DayRecord | undefined>(undefined);
	let entries = $state<HourEntry[]>([]);

	$effect(() => {
		record = $dayLog[date];
		entries = record?.hours ?? [];
	});

	function slotRange(startHour: number) {
		const [y, m, d] = date.split('-').map((value: string) => parseInt(value, 10));
		const start = new Date(y, m - 1, d, startHour, 0, 0, 0);
		const end = new Date(y, m - 1, d, endHourOf(startHour), 0, 0, 0);
		return { start, end };
	}

	function rangeLabel(entry: HourEntry) {
		const { start, end } = slotRange(entry.startHour);
		return `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
	}

	function trimmedBody(entry: HourEntry) {
		return entry.body?.trim() ?? '';
	}
</script>

<main class="min-h-screen bg-stone-50 px-6 py-10">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
		<nav>
			<a class="font-mono text-sm text-stone-500 transition hover:text-stone-700" href="/r"
				>← Back to review</a
			>
		</nav>

		<header class="space-y-2">
			<p class="font-mono text-sm uppercase tracking-wide text-stone-500">Review</p>
			<h1 class="font-mono text-4xl font-semibold text-stone-900">{date}</h1>
			<p class="text-sm text-stone-600">
				{record?.goal ? record.goal : 'No goal was recorded for this day.'}
			</p>
		</header>

		<section class="rounded-lg border border-stone-200 bg-white">
			{#if entries.length}
				<ul class="divide-y divide-stone-100">
					{#each entries as entry (entry.startHour)}
						{@const note = trimmedBody(entry)}
						<li class="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<p class="font-mono text-sm text-stone-500">{rangeLabel(entry)}</p>
							</div>
							<p class="text-sm text-stone-800 sm:max-w-xl">
								{#if note}
									{note}
								{:else}
									<span class="text-stone-400">No note recorded.</span>
								{/if}
							</p>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="px-4 py-6 text-sm text-stone-500">No hour entries saved for this day.</p>
			{/if}
		</section>
	</div>
</main>
