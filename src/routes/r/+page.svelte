<script lang="ts">
	import { onMount } from 'svelte';
	import { dayLog, type DayRecord } from '$lib/stores/day-log';

	type DaySummary = {
		date: string;
		goal: string;
		total: number;
		completed: number;
	};

	let summaries = $state<DaySummary[]>([]);

	onMount(() => {
		dayLog.loadAll();
	});

	$effect(() => {
		const records = Object.entries($dayLog) as [string, DayRecord][];
		const next = records
			.map(([date, record]) => {
				const total = record.hours.length;
				const completed = record.hours.filter((entry) => entry.body?.trim()?.length).length;
				return {
					date,
					goal: record.goal,
					total,
					completed
				};
			})
			.sort((a, b) => b.date.localeCompare(a.date));

		summaries = next;
	});
</script>

<main class="min-h-screen bg-stone-50 px-6 py-10">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-8">
		<header>
			<h1 class="font-mono text-4xl font-semibold text-stone-900">Review</h1>
			<p class="mt-2 max-w-xl text-sm text-stone-600">
				Check in on past logs, revisit goals, and see how each day unfolded.
			</p>
		</header>

		{#if summaries.length}
			<ul class="flex flex-col gap-3">
				{#each summaries as summary}
					<li class="rounded-lg border border-stone-200 bg-white transition hover:border-stone-300">
						<a
							class="flex flex-col gap-1 px-4 py-3 text-stone-800"
							href={`/r/${summary.date}`}
						>
							<div class="flex items-baseline justify-between">
								<h2 class="font-mono text-lg font-semibold">{summary.date}</h2>
								<span class="text-xs uppercase tracking-wide text-stone-500">
									{summary.completed}/{summary.total} slots
								</span>
							</div>
							<p class="text-sm text-stone-600">
								{summary.goal ? summary.goal : 'No goal set'}
							</p>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-stone-500">
				Once you log a day, it will show up here for quick review.
			</p>
		{/if}
	</div>
</main>
