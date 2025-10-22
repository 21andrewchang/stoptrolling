/** YYYY-MM-DD from a Date */
export function ymd(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

export function slotRange(
	dateISO: string,
	startHour: number,
	endHourOf: (startHour: number) => number
): { start: Date; end: Date } {
	const [y, m, d] = dateISO.split('-').map((n) => parseInt(n, 10));
	const start = new Date(y, m - 1, d, startHour, 0, 0, 0);
	const end = new Date(y, m - 1, d, endHourOf(startHour), 0, 0, 0);
	return { start, end };
}

/** Minutes (>= 0) until a given start Date from now */
export function minutesUntil(start: Date, now: Date): number {
	const ms = start.getTime() - now.getTime();
	return Math.max(0, Math.ceil(ms / 60000));
}

/** 24→12 hr formatting */
export function formatHour(h: number): { hour12: number; meridiem: 'AM' | 'PM' } {
	const hour12 = ((h + 11) % 12) + 1; // 0→12, 13→1, etc.
	const meridiem = h < 12 ? 'AM' : 'PM';
	return { hour12, meridiem };
}

/** Label like `8–9AM` or `11AM–12PM` given the slot start and endHourOf() */
export function rangeLabel(startHour: number, endHourOf: (startHour: number) => number): string {
	const end = endHourOf(startHour);
	const { hour12: sH, meridiem: sM } = formatHour(startHour);
	const { hour12: eH, meridiem: eM } = formatHour(end % 24);
	return sM === eM ? `${sH}–${eH}${eM}` : `${sH}${sM}–${eH}${eM}`;
}
