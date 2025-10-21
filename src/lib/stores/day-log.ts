// src/lib/stores/day-log.ts
import { writable, get, type Readable } from 'svelte/store';

export type HourEntry = {
	startHour: number; // 0–23
	body: string;
	aligned?: boolean; // <-- NEW (optional)
};

export type DayRecord = {
	goal: string;        // the day's goal
	hours: HourEntry[];  // 16 default slots (08:00 → 24:00)
};

type DayMap = Record<string, DayRecord>;

const PREFIX = 'stoptrolling:day:';
const keyFor = (date: string) => `${PREFIX}${date}`; // one key per date, e.g. stoptrolling:day:2025-10-21
const isYMD = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date);

// 08:00 → 24:00 (16 slots); last is 23→24
export function defaultHours(startHour = 8, slots = 16): HourEntry[] {
	return Array.from({ length: slots }, (_, i) => ({
		startHour: (startHour + i) % 24,
		body: ''
	}));
}

function loadDate(date: string): DayRecord | null {
	try {
		const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(keyFor(date)) : null;
		return raw ? (JSON.parse(raw) as DayRecord) : null;
	} catch {
		return null;
	}
}
function saveDate(date: string, rec: DayRecord) {
	try {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(keyFor(date), JSON.stringify(rec));
		}
	} catch {
		/* ignore */
	}
}
function removeDate(date: string) {
	try {
		if (typeof localStorage !== 'undefined') localStorage.removeItem(keyFor(date));
	} catch {
		/* ignore */
	}
}
export function endHourOf(startHour: number): number {
	return startHour === 23 ? 24 : startHour + 1;
}

function createDayLogStore(initial?: DayMap) {
	const store = writable<DayMap>(initial ?? {});
	const setMap = (fn: (s: DayMap) => DayMap) => store.update(fn);

	return {
		subscribe: store.subscribe as Readable<DayMap>['subscribe'],

		/** Get record (if loaded in memory) */
		get(date: string): DayRecord | undefined {
			if (!isYMD(date)) return undefined;
			return get(store)[date];
		},

		/** Ensure a record exists (loads from storage or creates defaults). Returns the record. */
		ensure(date: string, startHour = 8, slots = 16): DayRecord {
			if (!isYMD(date)) throw new Error('Invalid date (YYYY-MM-DD)');
			let state = get(store);
			let rec = state[date];

			if (!rec) {
				// try localStorage
				rec = loadDate(date) ?? { goal: '', hours: defaultHours(startHour, slots) };
				state = { ...state, [date]: rec };
				store.set(state);
			}
			// persist to ensure existence on first touch
			saveDate(date, rec);
			return rec;
		},

		/** Replace all hours for a date */
		replaceHours(date: string, hours: HourEntry[]) {
			if (!isYMD(date)) throw new Error('Invalid date (YYYY-MM-DD)');
			setMap((s) => {
				const rec = s[date] ?? { goal: '', hours: defaultHours() };
				const next = { ...s, [date]: { ...rec, hours } };
				saveDate(date, next[date]);
				return next;
			});
		},

		/** Set a specific hour entry */
		setHour(date: string, index: number, entry: HourEntry) {
			setMap((s) => {
				const rec = s[date] ?? { goal: '', hours: defaultHours() };
				const nextHours = rec.hours.slice();
				nextHours[index] = entry;
				const nextRec = { ...rec, hours: nextHours };
				const next = { ...s, [date]: nextRec };
				saveDate(date, nextRec);
				return next;
			});
		},

		/** Patch fields of a specific hour entry */
		patchHour(date: string, index: number, patch: Partial<HourEntry>) {
			setMap((s) => {
				const rec = s[date] ?? { goal: '', hours: defaultHours() };
				const cur = rec.hours[index] ?? { startHour: 0, body: '' };
				const nextHours = rec.hours.slice();
				nextHours[index] = { ...cur, ...patch };
				const nextRec = { ...rec, hours: nextHours };
				const next = { ...s, [date]: nextRec };
				saveDate(date, nextRec);
				return next;
			});
		},

		/** Set the day's goal (integrated; replaces separate dailyGoal store) */
		setGoal(date: string, goal: string) {
			setMap((s) => {
				const rec = s[date] ?? { goal: '', hours: defaultHours() };
				const nextRec = { ...rec, goal };
				const next = { ...s, [date]: nextRec };
				saveDate(date, nextRec);
				return next;
			});
		},

		/** Reset a date (memory + localStorage) */
		reset(date: string) {
			setMap((s) => {
				if (!(date in s)) return s;
				const { [date]: _omit, ...rest } = s;
				removeDate(date);
				return rest;
			});
		},

		/** Load every stored day record from localStorage into memory. Returns the loaded dates. */
		loadAll(): string[] {
			const loaded = new Set<string>();

			if (typeof localStorage === 'undefined') {
				const current = Object.keys(get(store));
				current.forEach((d) => loaded.add(d));
				return Array.from(loaded);
			}

			setMap((state) => {
				let next = { ...state };
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (!k || !k.startsWith(PREFIX)) continue;
					const date = k.slice(PREFIX.length);
					if (!isYMD(date)) continue;
					const rec = loadDate(date) ?? { goal: '', hours: defaultHours() };
					if (next[date]) {
						loaded.add(date);
						continue;
					}
					next = { ...next, [date]: rec };
					loaded.add(date);
				}
				return next;
			});

			return Array.from(loaded);
		},

		/** Danger: clears all loaded records from memory and removes all keys with PREFIX from localStorage */
		clearAll() {
			if (typeof localStorage !== 'undefined') {
				for (let i = localStorage.length - 1; i >= 0; i--) {
					const k = localStorage.key(i);
					if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
				}
			}
			store.set({});
		}
	};
}

export const dayLog = createDayLogStore();
