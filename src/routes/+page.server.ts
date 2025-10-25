import { env as dyn } from '$env/dynamic/private';
import { PUBLIC_X_CLIENT_ID, PUBLIC_X_REDIRECT_URI } from '$env/static/public';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { makeDayService } from '$lib/services/day';

const TOKEN_URL = 'https://api.x.com/2/oauth2/token';

export const load: PageServerLoad = async (event) => {
	const { url, cookies, fetch, locals } = event;
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	if (code || state) {
		if (!code || !state) {
			return { user: null };
		}

		const expectedState = cookies.get('x_oauth_state') || '';
		const codeVerifier = cookies.get('x_pkce_verifier') || '';
		cookies.delete('x_oauth_state', { path: '/' });
		cookies.delete('x_pkce_verifier', { path: '/' });

		if (state !== expectedState || !codeVerifier) {
			throw redirect(302, '/?x=unexpected_state');
		}

		const CLIENT_SECRET = dyn.X_CLIENT_SECRET!;
		const basic = Buffer.from(`${PUBLIC_X_CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

		const body = new URLSearchParams({
			grant_type: 'authorization_code',
			redirect_uri: PUBLIC_X_REDIRECT_URI,
			code,
			code_verifier: codeVerifier
		});

		const r = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${basic}`
			},
			body
		});

		const tokens = await r.json();

		if (process.env.NODE_ENV !== 'production') {
			console.log(
				r.ok
					? {
							...tokens,
							access_token:
								typeof tokens.access_token === 'string'
									? `${tokens.access_token.slice(0, 8)}…${tokens.access_token.slice(-4)}`
									: tokens.access_token,
							refresh_token:
								typeof tokens.refresh_token === 'string'
									? `${tokens.refresh_token.slice(0, 8)}…${tokens.refresh_token.slice(-4)}`
									: tokens.refresh_token
						}
					: tokens
			);
		}

		if (!r.ok || typeof tokens.access_token !== 'string') {
			console.error('X OAuth token exchange failed', tokens);
			throw redirect(302, '/?x=oauth_error');
		}

		let userId = locals.session?.user.id ?? null;
		if (!userId) {
			const { data, error: userError } = await locals.supabase.auth.getUser();
			if (!userError) {
				userId = data.user?.id ?? null;
			}
		}

		if (!userId) {
			throw redirect(302, '/?x=login_required');
		}

		const expiresInSeconds =
			typeof tokens.expires_in === 'number'
				? tokens.expires_in
				: typeof tokens.expires_in === 'string'
					? Number.parseInt(tokens.expires_in, 10)
					: null;

		const expiresAt =
			typeof tokens.expires_at === 'string'
				? tokens.expires_at
				: typeof expiresInSeconds === 'number' && Number.isFinite(expiresInSeconds)
					? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
					: null;

		if (!expiresAt) {
			console.error('Missing expires_at information from X OAuth response');
			throw redirect(302, '/?x=oauth_error');
		}

		const { error } = await locals.supabase.from('x_tokens').upsert(
			{
				user_id: userId,
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token ?? null,
				expires_at: expiresAt,
				scope: tokens.scope ?? null,
				token_type: tokens.token_type ?? 'bearer'
			},
			{ onConflict: 'user_id' }
		);

		if (error) {
			console.error('Failed to persist X tokens', error);
			throw redirect(302, '/?x=token_store_failed');
		}

		throw redirect(302, '/');
	}

	const { data } = await locals.supabase.auth.getUser();
	const user = data?.user ?? null;
	if (!user) return { user: null };

	const daySvc = makeDayService(locals.supabase);
	const today = await daySvc.ensureToday(user.id);
	const hours = await daySvc.loadDayHours(today.id);

	return {
		user: { id: user.id, email: user.email },
		day: { id: today.id, date: today.date, goal: today.goal, hours }
	};
};
