<script lang="ts">
	import { fly } from 'svelte/transition';
	import type { HourEntry } from '$lib/stores/day-log';
	import { onMount } from 'svelte';

	let {
		entries = [],
		circleClassFor,
		rangeLabel,
		sizeClass = 'h-5 w-5',
		gapClass = 'gap-4'
	} = $props<{
		entries?: HourEntry[];
		circleClassFor: (entry: HourEntry) => string;
		rangeLabel: (entry: HourEntry) => string;
		sizeClass?: string;
		gapClass?: string;
	}>();

	const fallbackNote = 'Trolling';
	const noteFor = (entry: HourEntry): string => entry.body?.trim() ?? '';

	let ready = $state(false);
	onMount(() => (ready = true));
</script>

{#if ready}
	<div class="flex items-center justify-between" role="list" aria-label="Hours">
		{#each entries as entry, index (entry.startHour)}
			<span
				in:fly|global={{ y: 8, delay: 20 * index, duration: 300 }}
				class={`${sizeClass} rounded-full ${circleClassFor(entry)} block`}
				role="listitem"
				aria-label={`${rangeLabel(entry)} — ${entry.body?.trim() ?? 'Trolling'}`}
			/>
		{/each}
	</div>
{/if}
