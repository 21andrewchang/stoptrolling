import type { SupabaseClient } from '@supabase/supabase-js';
import type { HourEntry } from '$lib/stores/day-log';
import { ymd } from '$lib/utils/time';
import { defaultHours } from '$lib/stores/day-log';

export function makeDayService(client: SupabaseClient) {
	async function ensureToday(user_id: string) {
		const date = ymd(new Date());
		const { data, error } = await client
			.from('days')
			.upsert({ user_id, date }, { onConflict: 'user_id,date' })
			.select('id, goal')
			.single();
		if (error) throw error;
		return { id: data.id as string, date, goal: (data.goal ?? '') as string };
	}

	async function loadDayHours(day_id: string): Promise<HourEntry[]> {
		const { data, error } = await client
			.from('day_hours')
			.select('start_hour, body, aligned')
			.eq('day_id', day_id)
			.order('start_hour', { ascending: true });
		if (error) throw error;

		const map = new Map<number, { body: string | null; aligned: boolean | null }>();
		for (const row of data ?? []) {
			const startHour = Number(row.start_hour);
			if (Number.isNaN(startHour)) continue;
			map.set(startHour, { body: row.body, aligned: row.aligned });
		}

		return defaultHours().map((slot) => {
			const remote = map.get(slot.startHour);
			return remote
				? {
						startHour: slot.startHour,
						body: remote.body ?? '',
						aligned: remote.aligned ?? undefined
					}
				: { ...slot };
		});
	}

	async function upsertGoal(day_id: string, goal: string) {
		const { error } = await client.from('days').update({ goal }).eq('id', day_id);
		if (error) throw error;
	}

	async function upsertHour(day_id: string, start_hour: number, body: string) {
		const { error } = await client
			.from('day_hours')
			.upsert({ day_id, start_hour, body }, { onConflict: 'day_id,start_hour' });
		if (error) throw error;
	}

	return { ensureToday, loadDayHours, upsertGoal, upsertHour };
}
