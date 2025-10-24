<script lang="ts">
	import { fly } from 'svelte/transition';
	import DayDots from '$lib/components/DayDots.svelte';

	let {
		isQuietHours = false,
		showDisplay = false,
		entries = [],
		circleClassFor,
		rangeLabel,
		statusText = ''
	} = $props<{
		isQuietHours?: boolean;
		showDisplay: boolean;
		entries?: any[];
		circleClassFor: (e: any) => string;
		rangeLabel: (e: any) => string;
		slotLabel?: string;
		statusText?: string;
	}>();
</script>

{#if showDisplay}
	<div class="mb-4 flex items-center justify-between gap-4 text-stone-600">
		<div class="flex items-center justify-between text-stone-600">
			<div
				class="flex min-w-0 flex-row items-center gap-2"
				in:fly|global={{ y: 4, delay: 200, duration: 200 }}
			>
				{#if isQuietHours}
					<div class="font-mono text-lg">Goodnight</div>
				{/if}
				<span class="font-mono text-lg tracking-widest">{statusText}</span>
			</div>
		</div>
	</div>

	<DayDots {entries} {circleClassFor} {rangeLabel} />
{/if}
