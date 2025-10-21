<script lang="ts">
	import { goto } from '$app/navigation';
	import { dayLog } from '$lib/stores/day-log';

	// today (local)
	function todayYMD() {
		const n = new Date();
		const y = n.getFullYear();
		const m = String(n.getMonth() + 1).padStart(2, '0');
		const d = String(n.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}
	const today = todayYMD();

	// Ensure a record exists and mirror goal into local state
	let goalDraft = $state('');
	$effect(() => {
		dayLog.ensure(today); // creates { goal:'', hours:[...] } if missing
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
	<div class="mx-auto w-full max-w-2xl">
		<h1 class="text-left font-mono text-3xl font-semibold text-stone-900">
			What is your goal for today?
		</h1>

		<form class="mt-6" on:submit={handleSubmit}>
			<label class="sr-only" for="daily-goal">Daily goal</label>
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
