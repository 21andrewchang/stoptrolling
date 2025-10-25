import { browser } from '$app/environment';

const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export function assertBrowser() {
	if (!browser) throw new Error('browser-only module');
}

export function buildRandomString(length: number, alphabet = PKCE_CHARSET) {
	assertBrowser();
	const randomValues = new Uint8Array(length);
	crypto.getRandomValues(randomValues);
	let out = '';
	const chars = alphabet.length;
	for (let i = 0; i < length; i++) out += alphabet[randomValues[i] % chars];
	return out;
}

export async function createPkceChallenge(verifier: string) {
	assertBrowser();
	const data = new TextEncoder().encode(verifier);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

export function persistPkceState(verifier: string, stateValue: string) {
	assertBrowser();
	localStorage.setItem('stoptrolling:x:code_verifier', verifier);
	localStorage.setItem('stoptrolling:x:oauth_state', stateValue);
	const maxAge = 600;
	const secure = location.protocol === 'https:' ? '; Secure' : '';
	document.cookie = `x_pkce_verifier=${encodeURIComponent(verifier)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
	document.cookie = `x_oauth_state=${encodeURIComponent(stateValue)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}
