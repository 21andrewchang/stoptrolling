<script lang="ts">
	import { fly, blur } from 'svelte/transition';
	let {
		open = false,
		date = '',
		dots = [] as Array<true | false | null>,
		badge = 0,
		siteLabel = 'stoptrolling.app',
		onClose = () => {}
	} = $props<{
		open?: boolean;
		date?: string;
		dots?: Array<true | false | null>;
		badge?: number;
		siteLabel?: string;
		onClose?: () => void; // callback prop
	}>();

	function close() {
		onClose();
	}
	function onBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) close();
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[9999] flex items-center justify-center bg-stone-50/80 backdrop-blur-sm"
		transition:blur={{ duration: 200 }}
	>
		<div aria-modal="true" class=" mx-4 rounded-2xl">
			<div class="relative h-full w-full p-10">
				<div
					class="flex flex-row justify-between"
					transition:fly={{ y: 10, delay: 200, duration: 200 }}
				>
					<h2 class="font-mono text-xl leading-tight text-stone-900">
						{date || ''}
					</h2>
					<div class="rounded-lg bg-stone-500/80 px-2.5 py-1 font-mono text-sm text-white">
						{badge}
					</div>
				</div>

				<div
					class="mt-6 flex w-full items-center justify-center"
					transition:fly={{ y: 10, delay: 300, duration: 200 }}
				>
					<div class="flex flex-wrap gap-3">
						{#each dots as d, i}
							<span
								class="inline-block h-5 w-5 rounded-full"
								class:bg-rose-500={d === false}
								class:bg-emerald-500={d === true}
								class:bg-stone-300={d === null}
								aria-label={`dot ${i + 1}`}
							/>
						{/each}
					</div>
				</div>

				<div
					class="mt-6 flex w-full justify-end font-mono text-sm text-stone-500 select-none"
					transition:fly={{ y: 10, delay: 400, duration: 200 }}
				>
					{siteLabel}
				</div>
			</div>
		</div>
	</div>
{/if}
