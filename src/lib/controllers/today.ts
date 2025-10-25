import { dayLog, defaultHours } from '$lib/stores/day-log';
import { ymd } from '$lib/utils/time';
import type { makeDayService } from '$lib/services/day';
import type { makeSessionService } from '$lib/services/session';

type DayService = ReturnType<typeof makeDayService>;
type SessionService = ReturnType<typeof makeSessionService>;

export function makeTodayController(dayService: DayService, sessionService: SessionService) {
	const todayKey = ymd(new Date());

	return {
		async init() {
			dayLog.ensure(todayKey);
			const { user, error } = await sessionService.getAuthedUser();
			if (error) {
				console.error('getAuthedUser failed:', error);
			}
			if (!user) return null;

			const todayRecord = await dayService.ensureToday(user.id);
			const hours = await dayService.loadDayHours(todayRecord.id);
			dayLog.replaceHours(todayKey, hours ?? defaultHours());
			dayLog.setGoal(todayKey, todayRecord.goal ?? '');
			return { user, todayRecord };
		},

		async saveGoal(dayId: string, newGoal: string) {
			await dayService.upsertGoal(dayId, newGoal);
			dayLog.setGoal(todayKey, newGoal);
		},

		async saveHour(dayId: string, startHour: number, body: string) {
			await dayService.upsertHour(dayId, startHour, body);
			const record = dayLog.ensure(todayKey);
			const hourIndex = record.hours.findIndex((hour) => hour.startHour === startHour);
			if (hourIndex !== -1) {
				dayLog.patchHour(todayKey, hourIndex, { body });
			}
		}
	};
}
