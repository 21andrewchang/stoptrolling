// src/lib/stores/day-log.ts
import { writable, get, type Readable } from 'svelte/store';

export type HourEntry = {
	startHour: number; // 0–23
	body: string;
};

type DayLogMap = Record<string, HourEntry[]>;
const KEY = 'stoptrolling:daylog:v1';

function load(): DayLogMap {
	try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
function save(state: DayLogMap) {
	try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { }
}
function isYMD(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date); }

export function endHourOf(startHour: number): number {
	// 23 -> 24 (midnight), else start+1
	return startHour === 23 ? 24 : startHour + 1;
}

// Defaults: 16 slots from 08:00 → 24:00 (last is 23→24)
export function defaultHours(startHour = 8, slots = 16): HourEntry[] {
	return Array.from({ length: slots }, (_, i) => ({
		startHour: (startHour + i) % 24,
		body: ''
	}));
}

function createDayLogStore(initial?: DayLogMap) {
	const store = writable<DayLogMap>(initial ?? load());
	store.subscribe(save);

	return {
		subscribe: store.subscribe as Readable<DayLogMap>['subscribe'],

		get(date: string): HourEntry[] | undefined {
			if (!isYMD(date)) return undefined;
			return get(store)[date];
		},

		ensure(date: string, startHour = 8, slots = 16): HourEntry[] {
			if (!isYMD(date)) throw new Error('Invalid date (YYYY-MM-DD)');
			let state = get(store);
			if (!state[date]) {
				state = { ...state, [date]: defaultHours(startHour, slots) };
				store.set(state);
			}
			return state[date];
		},

		replace(date: string, hours: HourEntry[]) {
			if (!isYMD(date)) throw new Error('Invalid date (YYYY-MM-DD)');
			store.update((s) => ({ ...s, [date]: hours }));
		},

		setHour(date: string, index: number, entry: HourEntry) {
			store.update((s) => {
				const day = s[date] ?? [];
				const next = day.slice();
				next[index] = entry;
				return { ...s, [date]: next };
			});
		},

		patchHour(date: string, index: number, patch: Partial<HourEntry>) {
			store.update((s) => {
				const day = s[date] ?? [];
				const cur = day[index] ?? { startHour: 0, body: '' };
				const next = day.slice();
				next[index] = { ...cur, ...patch };
				return { ...s, [date]: next };
			});
		},

		setBody(date: string, index: number, body: string) {
			return this.patchHour(date, index, { body });
		},

		reset(date: string) {
			store.update((s) => {
				if (!(date in s)) return s;
				const { [date]: _omit, ...rest } = s;
				return rest;
			});
		},

		clearAll() { store.set({}); }
	};
}

export const dayLog = createDayLogStore();
