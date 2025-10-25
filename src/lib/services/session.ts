import type { SupabaseClient } from '@supabase/supabase-js';

export function makeSessionService(client: SupabaseClient, fetchFn: typeof fetch) {
	async function getAuthedUser() {
		const { data, error } = await client.auth.getUser();
		return { user: data?.user ?? null, error };
	}

	async function syncServerSession() {
		const {
			data: { session },
			error
		} = await client.auth.getSession();
		if (error || !session) return false;

		const res = await fetchFn('/api/auth/session', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({
				access_token: session.access_token,
				refresh_token: session.refresh_token
			})
		});

		return res.ok;
	}

	return { getAuthedUser, syncServerSession };
}
