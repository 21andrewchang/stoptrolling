<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	const {
		open = false,
		loading = false,
		hasUser = false,
		onClose = null,
		onSignIn = null
	} = $props<{
		open?: boolean;
		loading?: boolean;
		hasUser?: boolean;
		onClose?: (() => void) | null;
		onSignIn?: (() => void) | null;
	}>();

	function handleClose() {
		if (loading) return;
		onClose?.();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (loading) return;
		if (event.target === event.currentTarget) onClose?.();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (loading) return;
		if (event.key === 'Escape') onClose?.();
	}

	function handleSignIn() {
		if (loading) return;
		onSignIn?.();
	}
</script>

{#if open}
	<div
		in:fade={{ duration: 200 }}
		class="fixed inset-0 z-[120] flex items-center justify-center bg-stone-50/70"
		role="dialog"
		aria-modal="true"
		aria-label="How it works"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div
			in:scale={{ start: 0.96, duration: 180 }}
			class="w-full max-w-2xl rounded-2xl border border-stone-200 bg-stone-50 p-16 text-stone-800"
			role="document"
		>
			<div class="space-y-6 text-stone-700">
				<div class="flex flex-row items-center justify-between">
					<h3 class="text-xl font-semibold text-stone-900">How it works</h3>

					<div class="flex flex-wrap items-center justify-center gap-3">
						<span class="inline-flex items-center gap-1">
							<span class="inline-block h-3.5 w-3.5 rounded-full bg-emerald-400" aria-hidden="true"
							></span>
							<span class="text-xs">Good</span>
						</span>
						<span class="inline-flex items-center gap-1">
							<span class="inline-block h-3.5 w-3.5 rounded-full bg-red-400" aria-hidden="true"
							></span>
							<span class="text-xs">Bad</span>
						</span>
						<span class="inline-flex items-center gap-1">
							<span
								class="inline-block h-3.5 w-3.5 rounded-full border border-stone-400"
								aria-hidden="true"
							></span>
							<span class="text-xs">Empty</span>
						</span>
						<span class="inline-flex items-center gap-1">
							<span
								class="inline-block h-3.5 w-3.5 rounded-full border border-dashed border-stone-400 bg-transparent"
								aria-hidden="true"
							></span>
							<span class="text-xs">Future</span>
						</span>
					</div>
				</div>
				<ul class="list-disc space-y-2 pl-5">
					<li>
						<span class="text-stone-900">Work day is 8am-12am, sleep 8hrs</span>
					</li>
					<li>
						<span class="text-stone-900">Every hour, log what you're doing</span>
					</li>
					<li>
						<span class="text-stone-900">AI rates how productive you are (Good/Bad)</span>
					</li>
					<li>
						<span class="text-stone-900">Summary gets auto-posted to twitter at end of day</span>
					</li>
					<li>
						<span class="text-stone-900"
							>If you didn't log anything, it posts "I didn't do shit today"</span
						>
					</li>
					<li>
						<span class="text-stone-900">Stop trolling, start working</span>
					</li>
				</ul>
			</div>
			{#if !hasUser}
				<button
					type="button"
					onclick={handleSignIn}
					disabled={loading}
					class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-transparent px-4 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						class="h-5 w-5"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z"
						/>
					</svg>
					<span>{loading ? 'Redirecting…' : 'Continue with Twitter'}</span>
				</button>
			{/if}
		</div>
	</div>
{/if}
