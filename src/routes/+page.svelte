<script lang="ts">
	import { goto } from '$app/navigation';
	import { dailyGoal } from '$lib/stores/goal';

	let goalDraft = $state('');

	$effect(() => {
		goalDraft = $dailyGoal;
	});

	const handleSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		const trimmed = goalDraft.trim();
		if (!trimmed) return;

		dailyGoal.set(trimmed);

		const now = new Date();
		const y = now.getFullYear();
		const m = String(now.getMonth() + 1).padStart(2, '0');
		const d = String(now.getDate()).padStart(2, '0');
		goto(`/d/${y}-${m}-${d}`);
	};
</script>

<main class="flex min-h-screen items-center justify-center bg-stone-50 px-6">
	<div class="mx-auto w-full max-w-2xl">
		<h1 class="text-left font-mono text-4xl font-semibold text-stone-900">
			What is your goal for today?
		</h1>

		<form class="mt-6" onsubmit={handleSubmit}>
			<label class="sr-only" for="daily-goal">Daily goal</label>
			<input
				id="daily-goal"
				type="text"
				placeholder="Type your goal..."
				bind:value={goalDraft}
				class="w-full appearance-none border-none bg-transparent pl-0 text-left font-mono text-3xl font-light text-stone-800 shadow-none ring-0 outline-none placeholder:text-stone-300 focus:border-transparent focus:ring-0 focus:outline-none"
				autofocus
			/>
			<button type="submit" class="sr-only">Save goal</button>
		</form>
	</div>
</main>
