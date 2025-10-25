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
				class={`day-dot ${sizeClass} rounded-full ${circleClassFor(entry)} block`}
				role="listitem"
				aria-label={`${rangeLabel(entry)} — ${entry.body?.trim() ?? 'Trolling'}`}
			/>
		{/each}
	</div>
{/if}

<style>
	.day-dot {
		transform-origin: center;
		backface-visibility: hidden;
		will-change: transform, background-color, box-shadow;
	}

	.day-dot.is-rating {
		animation: dot-pulse 900ms ease-in-out infinite alternate;
		animation-delay: 400ms;
		animation-fill-mode: both;
	}
	@keyframes dot-pulse {
		0%,
		100% {
			transform: translateZ(0) scale(1);
			opacity: 0.95;
		}
		50% {
			transform: translateZ(0) scale(1.2);
			opacity: 0.88;
		}
	}

	:root {
		--dot-pop-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
	}
	.day-dot.is-finishing {
		animation: dot-finish 520ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
		transition-delay: 60ms;
		box-shadow: var(--dot-pop-shadow);
	}
	@keyframes dot-finish {
		0% {
			transform: translateZ(0) scale(1);
			--dot-pop-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
		}
		22% {
			transform: translateZ(0) scale(0.5);
			--dot-pop-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
		}
		58% {
			transform: translateZ(0) scale(1.2);
			--dot-pop-shadow: 0 6px 14px -6px rgba(0, 0, 0, 0.25);
		}
		100% {
			transform: translateZ(0) scale(1);
			--dot-pop-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.day-dot,
		.day-dot.is-rating,
		.day-dot.is-finishing,
		.day-dot.is-rating::after {
			animation: none !important;
			transition: none !important;
			transform: scale(1) !important;
			box-shadow: none !important;
			opacity: 1 !important;
		}
	}
</style>
