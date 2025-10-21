<script lang="ts">
	import { dailyGoal } from '$lib/stores/goal';

	let { data } = $props<{
		data: {
			date: string;
		};
	}>();

	const { date } = data;
</script>

<main class="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-6">
	<h1 class="text-center font-mono text-4xl font-semibold text-stone-900 md:text-5xl">
		Today is {date}
	</h1>
	<p class="mt-8 max-w-2xl text-center text-2xl font-light text-stone-700">
		{$dailyGoal ? `Your focus: ${$dailyGoal}` : 'You have not set a goal yet.'}
	</p>
</main>
