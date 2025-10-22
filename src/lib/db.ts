// import { supabase } from '$lib/supabase';
// import type { DayRecord, HourEntry } from '$lib/stores/day-log';
//
// export async function ensureDay(userId: string, ymd: string): Promise<string> {
// 	// Insert if missing; no-op update if present.
// 	const { data, error } = await supabase
// 		.from('days')
// 		.upsert(
// 			{ user_id: userId, date: ymd, goal: '' },
// 			{ onConflict: 'user_id,date' }
// 		)
// 		.select('id')
// 		.single();
//
// 	if (error) throw error;
// 	return data!.id as string;
// }
//
// /** Set/overwrite the goal for a given day (creates the day if missing). */
// export async function setGoal(userId: string, ymd: string, goal: string): Promise<void> {
// 	// Ensure the day exists first to guarantee hours are pre-created by your trigger.
// 	await ensureDay(userId, ymd);
//
// 	const { error } = await supabase
// 		.from('days')
// 		.update({ goal })
// 		.eq('user_id', userId)
// 		.eq('date', ymd);
//
// 	if (error) throw error;
// }
//
// /**
//  * Upsert a single hour slot. With composite PK (day_id, start_hour), this is straightforward.
//  * If the day exists, the slot already exists due to the AFTER INSERT trigger on days;
//  * we still use upsert to be idempotent and resilient.
//  */
// export async function upsertHour(
// 	userId: string,
// 	ymd: string,
// 	startHour: number,
// 	patch: { body?: string; aligned?: boolean | null }
// ): Promise<void> {
// 	// Resolve the day_id (ensure creation if missing)
// 	const dayId = await ensureDay(userId, ymd);
//
// 	const { error } = await supabase.from('day_hours').upsert(
// 		{
// 			day_id: dayId,
// 			start_hour: startHour,
// 			body: patch.body ?? '',
// 			aligned: patch.aligned ?? null,
// 		},
// 		{ onConflict: 'day_id,start_hour' }
// 	);
//
// 	if (error) throw error;
// }
//
// /** Clear a slot: body -> '', aligned -> null. (Keeps the row; it’s part of the day’s 16-slot skeleton.) */
// export async function clearHour(userId: string, ymd: string, startHour: number): Promise<void> {
// 	const dayId = await ensureDay(userId, ymd);
//
// 	const { error } = await supabase
// 		.from('day_hours')
// 		.update({ body: '', aligned: null })
// 		.eq('day_id', dayId)
// 		.eq('start_hour', startHour);
//
// 	if (error) throw error;
// }
//
// /** Load a full day (goal + hours) from DB into your DayRecord shape. Returns null if no day exists. */
// export async function loadDay(userId: string, ymd: string): Promise<DayRecord | null> {
// 	// Fetch the day first
// 	const { data: day, error: dayErr } = await supabase
// 		.from('days')
// 		.select('id, goal')
// 		.eq('user_id', userId)
// 		.eq('date', ymd)
// 		.single();
//
// 	if (dayErr) {
// 		// If it's a true 'no rows' situation, return null; otherwise surface the error.
// 		if ((dayErr as any).code === 'PGRST116') return null; // PostgREST no rows
// 		throw dayErr;
// 	}
//
// 	// Then fetch hours, ordered
// 	const { data: hours, error: hrsErr } = await supabase
// 		.from('day_hours')
// 		.select('start_hour, body, aligned')
// 		.eq('day_id', day.id)
// 		.order('start_hour', { ascending: true });
//
// 	if (hrsErr) throw hrsErr;
//
// 	const entries: HourEntry[] =
// 		(hours ?? []).map(h => ({
// 			startHour: h.start_hour as number,
// 			body: (h.body ?? '') as string,
// 			aligned: h.aligned as boolean | null | undefined,
// 		})) as HourEntry[];
//
// 	return { goal: day.goal ?? '', hours: entries };
// }
