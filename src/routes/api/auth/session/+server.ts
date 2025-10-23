import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { access_token: accessToken, refresh_token: refreshToken } = await request.json();

		if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
			return json({ error: 'missing_tokens' }, { status: 400 });
		}

		const { error } = await locals.supabase.auth.setSession({
			access_token: accessToken,
			refresh_token: refreshToken
		});

		if (error) {
			return json({ error: error.message }, { status: 401 });
		}

		return json({ ok: true });
	} catch (error) {
		console.error('Failed to sync Supabase session', error);
		return json({ error: 'invalid_payload' }, { status: 400 });
	}
};
