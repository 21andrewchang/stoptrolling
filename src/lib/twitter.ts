import { createHash, randomBytes } from 'crypto';

const b64url = (b: Buffer) =>
	b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const code_verifier = b64url(randomBytes(32)); // save this for the token exchange step
const code_challenge = b64url(createHash('sha256').update(code_verifier).digest());
const state = randomBytes(16).toString('hex');

const client_id = 'M3oyNWstcVZwOEt4WUN6OTBzVG86MTpjaQ';
const redirect_uri = 'http://127.0.0.1:5173/api/x/callback';
const scopes = ['tweet.write', 'offline.access']; // add 'users.read' if you need it

const params = new URLSearchParams({
	response_type: 'code',
	client_id,
	redirect_uri,
	scope: scopes.join(' '),
	state,
	code_challenge,
	code_challenge_method: 'S256'
});

export const authURL = `https://x.com/i/oauth2/authorize?${params.toString()}`;
