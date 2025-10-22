<script lang="ts">
	import { fade, fly } from 'svelte/transition';

	type Tone = 'neutral' | 'success' | 'warning' | 'danger';

	const {
		message = '',
		tone = 'neutral' as Tone,
		open = false,
		autoHide = 4000,
		onClose = () => {}
	} = $props<{
		message?: string;
		tone?: Tone;
		open?: boolean;
		autoHide?: number;
		onClose?: () => void; // callback prop (no events)
	}>();

	let timeout: ReturnType<typeof setTimeout> | undefined;

	const toneStyles: Record<Tone, { container: string; accent: string; close: string }> = {
		neutral: {
			container:
				'border-stone-200 bg-white text-stone-700 shadow-[0_12px_24px_rgba(15,23,42,0.08)]',
			accent: 'bg-stone-300/80',
			close: 'text-stone-400 hover:text-stone-600'
		},
		success: {
			container:
				'border-emerald-200 bg-emerald-50 text-emerald-900 shadow-[0_12px_24px_rgba(16,185,129,0.18)]',
			accent: 'bg-emerald-500',
			close: 'text-emerald-500/80 hover:text-emerald-700'
		},
		warning: {
			container:
				'border-amber-200 bg-amber-50 text-amber-900 shadow-[0_12px_24px_rgba(245,158,11,0.2)]',
			accent: 'bg-amber-500',
			close: 'text-amber-500/80 hover:text-amber-700'
		},
		danger: {
			container:
				'border-rose-200 bg-rose-50 text-rose-900 shadow-[0_12px_24px_rgba(244,63,94,0.2)]',
			accent: 'bg-rose-500',
			close: 'text-rose-500/80 hover:text-rose-700'
		}
	};

	$effect(() => {
		if (!open || autoHide <= 0) {
			if (timeout) {
				clearTimeout(timeout);
				timeout = undefined;
			}
			return;
		}
		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(() => onClose(), autoHide);

		return () => {
			if (timeout) {
				clearTimeout(timeout);
				timeout = undefined;
			}
		};
	});

	function handleDismiss() {
		onClose();
	}
</script>

{#if open}
	<div class="pointer-events-none fixed right-6 bottom-6 z-[10000] flex flex-col items-end gap-3">
		<div
			class={`pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border px-4 py-3 pl-5 transition ${toneStyles[tone].container}`}
			role="status"
			aria-live="polite"
			onclick={handleDismiss}
			in:fly={{ y: 16, duration: 200 }}
			out:fade={{ duration: 150 }}
		>
			<div class="flex items-start gap-2">
				<div class="mt-0.5 inline-flex h-4 w-4 items-center justify-center">
					{#if tone === 'success'}
						<svg
							viewBox="0 0 24 24"
							class="h-5 w-5"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="9" />
							<path d="M8.5 12.5l2.5 2.5 4.5-5" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					{:else if tone === 'warning'}
						<svg
							viewBox="0 0 24 24"
							class="h-5 w-5"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M12 3l9 16H3l9-16Z" stroke-linejoin="round" />
							<path d="M12 9v4" stroke-linecap="round" />
							<path d="M12 16.5h.01" stroke-linecap="round" />
						</svg>
					{:else if tone === 'danger'}
						<svg
							viewBox="0 0 24 24"
							class="h-5 w-5"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="9" />
							<path d="M15 9l-6 6M9 9l6 6" stroke-linecap="round" />
						</svg>
					{:else}
						<svg
							viewBox="0 0 24 24"
							class="h-5 w-5"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="9" />
							<path d="M12 8h.01" stroke-linecap="round" />
							<path d="M12 11v5" stroke-linecap="round" />
						</svg>
					{/if}
				</div>
				<p class="flex-1 text-xs leading-5">{message}</p>
			</div>
		</div>
	</div>
{/if}
