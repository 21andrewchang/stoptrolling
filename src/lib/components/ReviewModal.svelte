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
	function shortDate(d: string): string {
		if (!d) return '';
		// Try robust locale formatting (handles 'YYYY-MM-DD' and ISO strings)
		const tryISO = new Date(d);
		if (!Number.isNaN(tryISO.getTime())) {
			return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(tryISO);
		}
		// Fallback: strip a leading year from common patterns
		return d.replace(/^(\d{4})[\/-]?/, ''); // e.g., '2025-10-22' -> '10-22'
	}
	type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

	let toastOpen = $state(false);
	let msg = $state('');
	let tone = $state<ToastTone>('neutral');

	function openToast() {
		toastOpen = true;
	}
	function closeToast() {
		toastOpen = false;
	}

	function notify(message: string, t: ToastTone = 'neutral', autoHide = 3000) {
		msg = message;
		tone = t;
		toastOpen = true;
	}
	let cardEl = $state<HTMLElement | null>(null);
	let postLoading = $state(false);

	async function copySummary() {
		notify('Summary has been saved to clipboard', 'success');
		try {
			const total = dots.length || 0;
			const good = dots.filter((d: true | false | null) => d === true).length;
			const score = total ? Math.round((good / total) * 100) : 0;

			const line = dots
				.map((d: true | false | null) => (d === true ? '🟢' : d === false ? '🔴' : '⚪'))
				.join('');

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

	async function postToX() {
		if (postLoading) return;
		if (!cardEl) {
			notify('Preview is not ready yet. Try again in a moment.', 'warning');
			return;
		}

		try {
			postLoading = true;
			const { toPng } = await import('html-to-image');
			const dataUrl = await toPng(cardEl, {
				backgroundColor: '#F5F5F4',
				pixelRatio: 2
			});

			const payload = {
				image: dataUrl,
				text: `${date || 'today'} · Score ${score}/100 · stoptrolling.app`
			};

			const res = await fetch('/api/x/tweet', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				credentials: 'same-origin'
			});
			console.log(res);

			if (!res.ok) {
				const detail = await res.json().catch(() => ({}));
				const message = detail?.error ?? 'Failed to share to X';
				throw new Error(message);
			}

			notify('Shared to X successfully!', 'success', 5000);
		} catch (err: any) {
			console.error('Failed to post to X', err);
			notify(err?.message ?? 'Sharing to X failed. Try again later.', 'danger', 5000);
		} finally {
			postLoading = false;
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-stone-50/80 backdrop-blur-sm"
		transition:blur={{ duration: 200 }}
	>
		<Toast open={toastOpen} message={msg} {tone} autoHide={3000} onClose={closeToast} />
		<div aria-modal="true" class="mx-4 rounded-2xl">
			<div bind:this={cardEl} class="relative flex h-full w-full flex-col justify-center p-6">
				<div
					class="flex flex-row justify-between"
					transition:fly={{ y: 10, delay: 200, duration: 200 }}
				>
					<h2 class="font-mono text-xl leading-tight text-stone-900">
						{shortDate(date) || ''}
					</h2>
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
							<div class="relative flex flex-col items-center pb-3" style="width:1.25rem">
								<span
									class="inline-block h-5 w-5 rounded-full"
									class:bg-rose-500={d === false}
									class:bg-emerald-500={d === true}
									class:bg-stone-300={d === null}
									aria-label={`dot ${i + 1}`}
								/>
								{#if i === 0}
									<div
										class="pointer-events-none absolute -bottom-1 left-1/2 -translate-x-1/2
                 font-mono text-[8px] whitespace-nowrap text-stone-400"
									>
										8 AM
									</div>
								{/if}
								{#if i === 15}
									<div
										class="pointer-events-none absolute -bottom-1 left-1/2 -translate-x-1/2
                 font-mono text-[8px] whitespace-nowrap text-stone-400"
									>
										11 PM
									</div>
								{/if}
							</div>
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
			<div class="flex w-full justify-between p-4">
				<div class="flex flex-row gap-2">
					<button
						type="button"
						class="flex items-center gap-2 rounded-md bg-stone-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-stone-800 focus:ring-2 focus:ring-stone-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
						onclick={postToX}
						disabled={postLoading}
						aria-label="Share this summary to X"
						title="Share to X"
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
						<span>{postLoading ? 'Posting…' : 'Post to X'}</span>
					</button>
					<button
						type="button"
						class="ml-2 flex rounded-md p-2 text-stone-600 transition hover:bg-stone-200/50 focus:ring-2 focus:ring-stone-400 focus:outline-none"
						onclick={screenshot}
						aria-label="Copy this review as an image"
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
						aria-label="Copy a text summary"
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
