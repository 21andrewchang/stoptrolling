// import { browser } from '$app/environment';
// import { writable, get } from 'svelte/store';
// import type { User } from '@supabase/supabase-js';
// import { supabase } from '$lib/supabase';
//
// type AuthState = {
// 	user: User | null;
// 	loading: boolean;
// 	error: string | null;
// 	firstName: string | null;
// };
// const initial: AuthState = { user: null, loading: true, error: null, firstName: null };
//
// function firstNameFromUser(u: User | null) {
// 	if (!u) return null;
// 	const m = (u.user_metadata ?? {}) as Record<string, any>;
// 	const raw = m.name ?? m.full_name ?? m.user_name ?? (u.email ? u.email.split('@')[0] : '');
// 	const first = String(raw ?? '').trim().split(/\s+/)[0];
// 	return first || null;
// }
//
// const _auth = writable<AuthState>(initial);
// let _started = false;
//
// export async function startAuth() {
// 	if (_started || !browser) return;
// 	_started = true;
//
// 	// Initial fetch
// 	try {
// 		const { data } = await supabase.auth.getUser();
// 		const user = data?.user ?? null;
// 		_auth.set({
// 			user,
// 			loading: false,
// 			error: null,
// 			firstName: firstNameFromUser(user)
// 		});
// 	} catch (e) {
// 		_auth.set({ ...get(_auth), loading: false, error: 'Failed to load user' });
// 	}
//
// 	// Live updates
// 	supabase.auth.onAuthStateChange((_event, session) => {
// 		const user = session?.user ?? null;
// 		_auth.set({
// 			user,
// 			loading: false,
// 			error: null,
// 			firstName: firstNameFromUser(user)
// 		});
// 	});
// }
//
// export const auth = {
// 	subscribe: _auth.subscribe
// };
//
// export async function signInWithGoogle() {
// 	await supabase.auth.signInWithOAuth({
// 		provider: 'google',
// 		options: { redirectTo: browser ? window.location.origin : undefined }
// 	});
// }
//
// export async function signOut() {
// 	await supabase.auth.signOut();
// }
