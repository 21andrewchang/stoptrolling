import { writable, derived } from 'svelte/store';
import { ymd } from '$lib/utils/time';
import type { HourEntry } from '$lib/stores/day-log';

export const now = writable(new Date());
let t: any;
export function startClock() {
	stopClock();
	t = setInterval(() => now.set(new Date()), 60_000);
}
export function stopClock() {
	if (t) clearInterval(t);
	t = null;
}

// build a helper to derive currentIndex given entries
export function makeCurrentIndex(entriesStore: Readonly<import('svelte/store').Writable<HourEntry[]>>) {
	return derived([now, entriesStore], ([$now, $entries]) => {
		if (!$entries.length) return null;
		const today = ymd($now);
		const date = ymd(new Date()); // this component is "today"
		if (today !== date) return null;
		const start = $entries[0].startHour;
		const idx = $now.getHours() - start;
		return idx >= 0 && idx < 16 ? idx : null;
	});
}
