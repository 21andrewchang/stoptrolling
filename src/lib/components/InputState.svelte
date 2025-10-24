<script lang="ts">
	import { fly } from 'svelte/transition';

	let {
		slotLabel = '',
		inputPlaceholder = '',
		showInput = false,
		currentBody = '',
		currentEntry = null,
		onInput = (e: Event) => {},
		onSubmit = (e: Event) => {}
	} = $props<{
		slotLabel?: string;
		inputPlaceholder?: string;
		showInput: boolean;
		currentBody?: string;
		currentEntry?: unknown;
		onInput?: (e: Event) => void;
		onSubmit?: (e: SubmitEvent) => Promise<void>;
	}>();
</script>

{#if showInput}
	<div class="flex items-center justify-between gap-4 text-stone-600">
		<div class="flex items-center justify-between text-stone-600">
			<div
				class="flex min-w-0 items-center gap-2"
				in:fly|global={{ y: 4, delay: 300, duration: 200 }}
			>
				<span class="font-mono text-lg tracking-widest">{slotLabel}</span>
			</div>
		</div>
	</div>

	<form onsubmit={onSubmit} class="flex flex-row">
		<input
			type="text"
			placeholder={inputPlaceholder}
			value={currentBody}
			oninput={onInput}
			disabled={!currentEntry}
			class="h-14 w-full border-none bg-transparent pr-2 pl-0 font-mono text-3xl font-light text-stone-900 ring-0 outline-none placeholder:text-stone-300 focus:border-transparent focus:ring-0 focus:outline-none"
			autofocus
			aria-label="Current hour note"
		/>
	</form>
{/if}
