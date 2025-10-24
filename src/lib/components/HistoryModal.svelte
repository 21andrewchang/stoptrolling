<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { historyStore, historyLoading, historyError } from '$lib/stores/history';

	export let open = false;
	export let onClose: (() => void) | undefined;

	const shortDate = (iso: string): string => {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return iso;
		return date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	};

	const dotClass = (value: boolean | null): string => {
		if (value === true) return 'bg-emerald-400';
		if (value === false) return 'bg-red-400';
		return 'border border-stone-300 bg-transparent';
	};

	function handleClose() {
		if (typeof onClose === 'function') onClose();
	}

	function onBackdropInteraction(event: MouseEvent | KeyboardEvent) {
		if (event instanceof MouseEvent) {
			if (event.target === event.currentTarget) handleClose();
			return;
		}
		if (event instanceof KeyboardEvent && event.key === 'Escape') {
			event.stopPropagation();
			handleClose();
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[140] flex items-center justify-center bg-stone-50"
		role="dialog"
		aria-modal="true"
		aria-label="Day history"
		tabindex="-1"
		onclick={onBackdropInteraction}
		onkeydown={onBackdropInteraction}
		transition:fade={{ duration: 150 }}
	>
		<button
			type="button"
			class="absolute top-4 left-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 transition hover:text-stone-800 focus:outline-none"
			onclick={handleClose}
			aria-label="Close history"
		>
			<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M6 6l12 12M6 18L18 6" stroke-linecap="round" />
			</svg>
		</button>

		<div
			class="relative w-full max-w-xl text-stone-800"
			in:scale={{ start: 0.96, duration: 180 }}
			role="document"
		>
			<h2 class="text-start text-lg font-semibold tracking-tight text-stone-900">History</h2>

			<div class="mt-6 max-h-[60vh] overflow-y-auto pr-2">
				{#if $historyLoading}
					<p class="py-12 text-center text-sm text-stone-500">Loading history…</p>
				{:else if $historyError}
					<p class="py-12 text-center text-sm text-rose-500">{$historyError}</p>
				{:else if !$historyStore.length}
					<p class="py-12 text-center text-sm text-stone-500">No history yet.</p>
				{:else}
					<ul class="space-y-4">
						{#each $historyStore as day (day.id)}
							<li class="rounded-xl border border-stone-200 bg-stone-50 p-4">
								<div class="flex items-center justify-between">
									<span class="font-mono text-sm text-stone-600">{shortDate(day.date)}</span>
									<span class="rounded-lg bg-stone-900 px-2.5 py-1 font-mono text-sm text-white">
										{day.score}
									</span>
								</div>
								<div class="mt-3 flex w-full items-center">
									<div class="flex w-full justify-between">
										{#each day.dots as dot, index}
											<div class="relative flex flex-col items-center pb-3">
												<span
													class={`inline-block h-6 w-6 rounded-full ${dotClass(dot)}`}
													aria-label={`Hour dot ${index + 1}`}
												></span>
											</div>
										{/each}
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</div>
{/if}
