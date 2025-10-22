<script lang="ts">
	import type { HourEntry } from '$lib/stores/day-log';

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
</script>

<div class={`flex items-center justify-between`} role="list" aria-label="Hours">
	{#each entries as entry (entry.startHour)}
		{@const note = noteFor(entry)}
		<span
			class={`${sizeClass} rounded-full border ${circleClassFor(entry)} block`}
			role="listitem"
			aria-label={`${rangeLabel(entry)} — ${note || fallbackNote}`}
		></span>
	{/each}
</div>
