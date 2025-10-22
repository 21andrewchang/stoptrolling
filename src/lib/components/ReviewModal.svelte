<script lang="ts">
	import Toast from '$lib/components/Toast.svelte';
	import { fly, blur } from 'svelte/transition';
	import { onMount } from 'svelte';

	let {
		open = false,
		date = '',
		dots = [] as Array<true | false | null>,
		score = 0,
		siteLabel = 'stoptrolling.app',
		onClose = () => {}
	} = $props<{
		open?: boolean;
		date?: string;
		dots?: Array<true | false | null>;
		score?: number;
		siteLabel?: string;
		onClose?: () => void;
	}>();

	let toastOpen = $state(false);
	let msg = $state('');
	let tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral';

	function openToast() {
		toastOpen = true;
	}
	function closeToast() {
		toastOpen = false;
	}

	function notify(message: string, t: typeof tone = 'neutral', autoHide = 3000) {
		msg = message;
		tone = t;
		toastOpen = true;
	}
	let cardEl: HTMLElement | null = null;

	async function copySummary() {
		notify('Summary has been saved to clipboard', 'success');
		try {
			const total = dots.length || 0;
			const good = dots.filter((d) => d === true).length;
			const score = total ? Math.round((good / total) * 100) : 0;

			const line = dots.map((d) => (d === true ? '🟢' : d === false ? '🔴' : '⚪')).join('');

			const text = `${date || 'today'} | Score: ${score} | stoptrolling.app\n${line} `;

			await navigator.clipboard.writeText(text);
		} catch (e) {
			console.error('Copy failed', e);
		}
	}

	async function screenshot() {
		notify('Screenshot has been saved to clipboard', 'success');
		if (!cardEl || typeof window === 'undefined') return;

		const { toBlob, toPng } = await import('html-to-image');

		const opts = {
			backgroundColor: '#F5F5F4', // matches your backdrop tint
			pixelRatio: 2 // crisp PNG
		};

		try {
			// Prefer: write PNG to clipboard (secure context + user gesture required)
			const blob = await toBlob(cardEl, opts);
			if (!blob) throw new Error('Failed to render blob');

			const canClipboard =
				'clipboard' in navigator && 'write' in navigator.clipboard && 'ClipboardItem' in window;

			if (canClipboard) {
				const item = new (window as any).ClipboardItem({ 'image/png': blob });
				await navigator.clipboard.write([item]);
				// optional: set some `copied = true` UI feedback here
				return;
			}

			// Fallback: download as PNG (your original flow)
			const dataUrl = await toPng(cardEl, opts);
			const a = document.createElement('a');
			a.href = dataUrl;
			a.download = `review-${date || 'today'}.png`;
			a.click();
		} catch (err) {
			console.error(err);
			// Optional: show a toast/error to the user
		}
	}

	function close() {
		onClose();
	}
	function onBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) close();
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-stone-50/80 backdrop-blur-sm"
		transition:blur={{ duration: 200 }}
	>
		<Toast open={toastOpen} message={msg} {tone} autoHide={3000} onClose={closeToast} />
		<div aria-modal="true" class="mx-4 rounded-2xl">
			<div bind:this={cardEl} class="relative h-full w-full p-2">
				<div
					class="flex flex-row justify-between"
					transition:fly={{ y: 10, delay: 200, duration: 200 }}
				>
					<h2 class="font-mono text-xl leading-tight text-stone-900">{date || ''}</h2>
					<div class="rounded-lg bg-stone-500/80 px-2.5 py-1 font-mono text-sm text-white">
						{score}
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
			<div class="flex w-full justify-between">
				<div class="flex flex-row gap-2">
					<button
						type="button"
						class="flex rounded-md p-2 text-stone-600 transition hover:bg-stone-200/50 focus:ring-2 focus:ring-stone-400 focus:outline-none"
						onclick={screenshot}
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path
								d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z"
							/>
							<circle cx="12" cy="13" r="4" />
						</svg>
					</button>
					<button
						type="button"
						class="flex rounded-md bg-stone-50 p-2 text-stone-600 transition hover:bg-stone-200/50 focus:ring-2 focus:ring-stone-400 focus:outline-none"
						onclick={copySummary}
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="#FAFAF9"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<rect x="9" y="9" width="13" height="13" rx="2" />
							<rect x="3" y="3" width="13" height="13" rx="2" />
						</svg>
					</button>
				</div>
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-md bg-stone-50 p-2
           font-mono text-xs text-stone-700 transition hover:bg-stone-200/50 focus:ring-2
           focus:ring-stone-400 focus:outline-none"
					onclick={close}
					aria-label="Continue"
					title="Continue"
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M9 18l6-6-6-6" />
					</svg>
				</button>
			</div>
		</div>
	</div>
{/if}
