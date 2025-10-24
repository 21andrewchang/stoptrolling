import type { SupabaseClient } from '@supabase/supabase-js';

export function makeRatingService(client: SupabaseClient, fetchFn: typeof fetch) {
	async function rateLog(log: string, goal: string) {
		console.log('log: ', log);
		const r = await fetchFn('/api/openai/rate-log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ log, goal })
		});
		if (!r.ok) throw new Error(await r.text());
		const data = await r.json();
		console.log('data', data);
		return !!data?.ok;
	}

	async function rateAndPersist(day_id: string, start_hour: number, body: string, goal: string) {
		const aligned = await rateLog(body, goal);
		const { error } = await client
			.from('day_hours')
			.upsert({ day_id, start_hour, body, aligned }, { onConflict: 'day_id,start_hour' });
		if (error) throw error;
		return aligned;
	}

	return { rateLog, rateAndPersist };
}
