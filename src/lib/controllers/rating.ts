import { dayLog } from '$lib/stores/day-log';
import { setRatingStatus, clearRatingStatus } from '$lib/stores/today';
import type { makeRatingService } from '$lib/services/rating';

type RatingService = ReturnType<typeof makeRatingService>;

export function makeRatingController(ratingService: RatingService) {
	const settleTimers = new Map<number, ReturnType<typeof setTimeout>>();

	function scheduleSettleCleanup(startHour: number, durationMs = 600) {
		const existingTimer = settleTimers.get(startHour);
		if (existingTimer) clearTimeout(existingTimer);
		const timer = setTimeout(() => {
			clearRatingStatus(startHour);
			settleTimers.delete(startHour);
		}, durationMs);
		settleTimers.set(startHour, timer);
	}

	return {
		async rateAndPatch(dayId: string, dayKey: string, startHour: number, body: string, goal: string) {
			setRatingStatus(startHour, 'pending');
			try {
				const aligned = await ratingService.rateAndPersist(dayId, startHour, body, goal);
				const record = dayLog.ensure(dayKey);
				const hourIndex = record.hours.findIndex((hour) => hour.startHour === startHour);
				if (hourIndex !== -1) {
					dayLog.patchHour(dayKey, hourIndex, { aligned });
				}
				setRatingStatus(startHour, 'settling');
				scheduleSettleCleanup(startHour);
				return aligned;
			} catch (error) {
				clearRatingStatus(startHour);
				throw error;
			}
		}
	};
}
