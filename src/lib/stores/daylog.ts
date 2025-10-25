import { writable, derived } from 'svelte/store';
import type { HourEntry } from '$lib/stores/day-log';

export const goal = writable('');
export const entries = writable<HourEntry[]>([]);
export const hasCurrentLog = (currentIndexStore: any) => derived(
	[entries, currentIndexStore],
	([$entries, $idx]) => $idx !== null && !!$entries[$idx]?.body?.trim()
);
