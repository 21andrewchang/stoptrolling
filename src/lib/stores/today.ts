import { writable, derived } from 'svelte/store';
import { dayLog, endHourOf } from '$lib/stores/day-log';
import { ymd, slotRange, minutesUntil } from '$lib/utils/time';

export const todayKey = ymd(new Date());
export const now = writable(new Date());

export const goalStore = derived(dayLog, (log) => log[todayKey]?.goal ?? '');
export const entriesStore = derived(dayLog, (log) => log[todayKey]?.hours ?? []);

export const isQuietHoursStore = derived(now, (currentNow) => currentNow.getHours() < 8);

export const currentIndexStore = derived([entriesStore, now], ([entries, currentNow]) => {
	if (!entries.length) return null;
	if (ymd(currentNow) !== todayKey) return null;
	const startHour = entries[0].startHour;
	const index = currentNow.getHours() - startHour;
	return index >= 0 && index < 16 ? index : null;
});

export const currentEntryStore = derived(
	[entriesStore, currentIndexStore],
	([entries, index]) => (index === null ? undefined : entries[index])
);

export const hasCurrentLogStore = derived(currentEntryStore, (entry) => !!entry?.body?.trim());

export const shouldShowInputStore = derived(
	[isQuietHoursStore, currentEntryStore, hasCurrentLogStore],
	([isQuietHours, currentEntry, hasCurrentLog]) => !isQuietHours && !!currentEntry && !hasCurrentLog
);

export const slotLabelStore = derived(
	[currentEntryStore, shouldShowInputStore],
	([currentEntry, shouldShowInput]) => {
		if (!currentEntry || !shouldShowInput) return '';
		const { start, end } = slotRange(todayKey, currentEntry.startHour, endHourOf);
		const format = (instant: Date) => instant.toLocaleTimeString([], { hour: 'numeric' });
		return `${format(start)}–${format(end)}`;
	}
);

export const countdownStore = derived([isQuietHoursStore, now], ([isQuietHours, currentNow]) => {
	if (!isQuietHours) return { hours: 0, minutes: 0 };
	const eightAM = new Date(
		currentNow.getFullYear(),
		currentNow.getMonth(),
		currentNow.getDate(),
		8,
		0,
		0,
		0
	);
	const remainingMs = Math.max(0, eightAM.getTime() - currentNow.getTime());
	const totalMinutes = Math.ceil(remainingMs / 60000);
	return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
});

export const statusTextStore = derived(
	[isQuietHoursStore, countdownStore, currentEntryStore, now],
	([isQuietHours, countdown, currentEntry, currentNow]) => {
		if (isQuietHours) {
			const parts: string[] = [];
			if (countdown.hours) {
				parts.push(`${countdown.hours} hour${countdown.hours === 1 ? '' : 's'}`);
			}
			if (countdown.minutes) {
				parts.push(`${countdown.minutes} minute${countdown.minutes === 1 ? '' : 's'}`);
			}
			const suffix = parts.length ? `Come back in ${parts.join(' and ')}.` : 'Come back soon.';
			return `Goodnight. ${suffix}`;
		}
		if (!currentEntry) return '';
		const { start, end } = slotRange(todayKey, currentEntry.startHour, endHourOf);
		const millisNow = currentNow.getTime();
		const startMinutes = minutesUntil(start, currentNow);
		const endMinutes = minutesUntil(end, currentNow);
		const labelForMinutes = (minutes: number) =>
			minutes <= 0 ? 'Almost time…' : `Come back in ${minutes} minute${minutes === 1 ? '' : 's'}...`;
		if (millisNow < start.getTime()) return labelForMinutes(startMinutes);
		if (millisNow >= end.getTime()) return 'This hour has passed';
		return labelForMinutes(endMinutes);
	}
);

export type RatingStatus = 'idle' | 'pending' | 'settling';
export const ratingStatusStore = writable<Record<number, RatingStatus>>({});

export function setRatingStatus(startHour: number, status: RatingStatus) {
	ratingStatusStore.update((state) => ({ ...state, [startHour]: status }));
}

export function clearRatingStatus(startHour: number) {
	ratingStatusStore.update((state) => {
		const next = { ...state };
		delete next[startHour];
		return next;
	});
}
