import { writable } from 'svelte/store';

export type HistoryDay = {
	id: string;
	date: string;
	dots: (boolean | null)[];
	score: number;
};

export const historyStore = writable<HistoryDay[]>([]);
export const historyLoading = writable(false);
export const historyLoaded = writable(false);
export const historyError = writable<string | null>(null);
