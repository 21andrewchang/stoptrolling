// import type { RequestHandler } from './$types';
// import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, CRON_SECRET } from '$env/static/private';
// import { createClient } from '@supabase/supabase-js';
// import { postDailyRecordForUser } from '$lib/server/x-poster';
//
// const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
//
// export const GET: RequestHandler = async ({ request, url }) => {
// 	// Allow: Vercel Cron header OR local/manual with ?key=CRON_SECRET
// 	const isVercelCron = request.headers.get('x-vercel-cron') === '1';
// 	const okByKey = url.searchParams.get('key') === CRON_SECRET;
// 	if (!isVercelCron && !okByKey) {
// 		return new Response('forbidden', { status: 403 });
// 	}
//
// 	// Small batch to respect X write caps; tune as you upgrade tiers
// 	const nowUTC = new Date();
// 	const BATCH_SIZE = 5;
//
// 	// Find users due now (implement this helper in your repo)
// 	const candidates = await findUsersDueNow(supabase, nowUTC, BATCH_SIZE);
//
// 	let posted = 0, skipped = 0, failed = 0;
// 	for (const u of candidates) {
// 		try {
// 			const res = await postDailyRecordForUser(supabase, u.id, nowUTC);
// 			if (res === 'posted') posted++; else skipped++;
// 		} catch (e) {
// 			failed++;
// 			await backoffJobForUser(supabase, u.id, e); // optional retry queue
// 			// Stop early on rate limit to protect the app-wide quota
// 			if (String(e).includes('rate_limited')) break;
// 		}
// 	}
//
// 	return new Response(JSON.stringify({ posted, skipped, failed }), {
// 		headers: { 'content-type': 'application/json' }
// 	});
// };
//
// // Implement findUsersDueNow() to match local hour/minute in each user's tz
