<script lang="ts">
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { dayLog } from '$lib/stores/day-log';
	import { fade, scale } from 'svelte/transition';

	// today (local)
	function todayYMD() {
		const n = new Date();
		const y = n.getFullYear();
		const m = String(n.getMonth() + 1).padStart(2, '0');
		const d = String(n.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}
	const today = todayYMD();

	let goalDraft = $state('');

	// --- Auth modal state ---
	let showAuthModal = $state(false);
	let authLoading = $state(false);
	let authError = $state('');

	function openAuthModal() {
		authError = '';
		showAuthModal = true;
	}
	function closeAuthModal() {
		if (authLoading) return;
		showAuthModal = false;
	}

	async function signInWithGoogle() {
		try {
			authLoading = true;
			authError = '';

			const redirectTo = `${window.location.origin}/d/${today}`;

			const { error } = await supabase.auth.signInWithOAuth({
				provider: 'twitter',
				options: { redirectTo }
			});

			if (error) throw error; // browser will redirect on success
		} catch (err: any) {
			authError = err?.message ?? 'Sign-in failed. Please try again.';
			authLoading = false;
		}
	}

	$effect(() => {
		dayLog.ensure(today);
		goalDraft = $dayLog[today]?.goal ?? '';
	});

	const handleSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		const trimmed = goalDraft.trim();
		if (!trimmed) return;
		dayLog.setGoal(today, trimmed);
		goto(`/d/${today}`);
	};
</script>

<main class="flex min-h-screen items-center justify-center bg-stone-50 px-6">
	<div>
		<h1 class="text-left font-mono text-3xl text-stone-900">What is your goal for today?</h1>

		<form class="mt-6" onsubmit={handleSubmit}>
			<input
				id="daily-goal"
				type="text"
				placeholder="Stop trolling..."
				bind:value={goalDraft}
				class="w-full appearance-none border-none bg-transparent pl-0 text-left font-mono text-3xl font-light text-stone-800 shadow-none ring-0 outline-none placeholder:text-stone-300 focus:border-transparent focus:ring-0 focus:outline-none"
				autofocus
			/>
			<button type="submit" class="sr-only">Save goal</button>
		</form>
	</div>
</main>

<button
	type="button"
	class="fixed right-6 bottom-4 font-mono text-sm text-stone-400 hover:text-stone-500 focus:underline focus:outline-none"
	aria-label="Sign in"
	onclick={openAuthModal}
>
	Sign in →
</button>

{#if showAuthModal}
	<div
		in:fade={{ duration: 200 }}
		class="fixed inset-0 z-[120] flex items-center justify-center bg-stone-50/80"
		role="dialog"
		aria-modal="true"
		aria-label="Sign in"
		tabindex="-1"
		onclick={(e) => {
			if (!authLoading && e.target === e.currentTarget) closeAuthModal();
		}}
		onkeydown={(e) => {
			if (!authLoading && e.key === 'Escape') closeAuthModal();
		}}
	>
		<!-- Card -->
		<div
			in:scale={{ start: 0.96, duration: 180 }}
			class="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-6 text-stone-800 shadow-[0_12px_32px_rgba(15,15,15,0.12)]"
			role="document"
		>
			<div class="flex items-center justify-between">
				<div class="text-sm font-semibold tracking-tight text-stone-900">Sign in</div>
				<button
					type="button"
					class="rounded-full p-1 text-stone-500 hover:text-stone-800"
					onclick={closeAuthModal}
					aria-label="Close sign in"
					{...{ disabled: authLoading } as any}
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

			<p class="mt-2 text-xs text-stone-500">Continue to save logs and track your progress.</p>

			<button
				type="button"
				onclick={signInWithGoogle}
				disabled={authLoading}
				class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
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
				<span>{authLoading ? 'Redirecting…' : 'Continue with X'}</span>
			</button>

			{#if authError}
				<p class="mt-3 text-xs text-rose-600">{authError}</p>
			{/if}
		</div>
	</div>
{/if}
