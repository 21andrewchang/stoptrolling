<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	const {
		open = false,
		loading = false,
		error = '',
		onAuthorize = null,
		onClose = null
	} = $props<{
		open?: boolean;
		loading?: boolean;
		error?: string;
		onAuthorize?: (() => void) | null;
		onClose?: (() => void) | null;
	}>();

	function handleCloseClick() {
		if (loading) return;
		onClose?.();
	}

	function handleAuthorizeClick() {
		if (loading) return;
		onAuthorize?.();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (loading) return;
		if (event.target === event.currentTarget) onClose?.();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (loading) return;
		if (event.key === 'Escape') onClose?.();
	}
</script>

{#if open}
	<div
		in:fade={{ duration: 200 }}
		class="fixed inset-0 z-[130] flex items-center justify-center bg-stone-50/80"
		role="dialog"
		aria-modal="true"
		aria-label="Authorize auto-posting"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div
			in:scale={{ start: 0.96, duration: 180 }}
			class="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-6 text-stone-800 shadow-[0_12px_32px_rgba(15,15,15,0.12)]"
			role="document"
		>
			<div class="flex items-center justify-between">
				<div class="text-sm font-semibold tracking-tight text-stone-900">
					Authorize auto-posting
				</div>
				<button
					type="button"
					class="rounded-full p-1 text-stone-500 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
					onclick={handleCloseClick}
					aria-label="Close auto-post authorization"
					disabled={loading}
				>
					<svg
						viewBox="0 0 24 24"
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M6 6l12 12M6 18L18 6" stroke-linecap="round" />
					</svg>
				</button>
			</div>

			<p class="mt-2 text-xs text-stone-500">
				Connect your Twitter to keep yourself accountable. Summary gets posted automatically at
				12am.
			</p>

			<button
				type="button"
				onclick={handleAuthorizeClick}
				disabled={loading}
				class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-3 text-sm font-medium text-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="h-4 w-4"
					fill="currentColor"
					aria-hidden="true"
				>
					<path
						d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z"
					/>
				</svg>
				<span>{loading ? 'Redirecting…' : 'Authorize'}</span>
			</button>

			{#if error}
				<p class="mt-3 text-xs text-rose-600">{error}</p>
			{/if}
		</div>
	</div>
{/if}
