// "Sign in with OpenRouter" (OAuth PKCE, openrouter.ai/docs/use-cases/oauth-pkce): the phone goes to OpenRouter,
// the writer approves, OpenRouter sends the phone back here with a one-time code, and the code (with the secret kept
// in this tab) becomes a new API key. The key is stored on this phone only.
import { CONFIG } from './config.js';
import { setKey } from './settings.js';

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function startSignIn(returnTo) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
  sessionStorage.setItem('kalamo.oauth', JSON.stringify({ verifier, state, returnTo: returnTo || '', at: Date.now() }));
  // OpenRouter adds "?code=…" to the callback, so the callback itself carries no query
  const q = new URLSearchParams({ callback_url: CONFIG.APP_URL, code_challenge: challenge, code_challenge_method: 'S256', state });
  location.href = `${CONFIG.OPENROUTER_AUTH}?${q}`;
}

/** Called at start-up. Returns null (no sign-in going on), {ok: true, returnTo} or {ok: false, message, returnTo}. */
export async function finishSignIn() {
  const u = new URL(location.href);
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('kalamo.oauth') || 'null'); } catch (e) { saved = null; }
  if (!saved && !code) return null;
  if (!code && !u.searchParams.has('error')) return null;   // a sign-in that was started but never came back
  sessionStorage.removeItem('kalamo.oauth');
  history.replaceState(null, '', CONFIG.APP_URL + (saved?.returnTo || ''));
  const returnTo = saved?.returnTo || '';
  // the state is checked when OpenRouter sends it back (the code alone is useless without this tab's secret)
  if (!saved || (state && state !== saved.state) || Date.now() - saved.at > 15 * 60000) {
    return { ok: false, returnTo, message: 'This sign-in is old or was not started here. Please start it again.' };
  }
  if (!code) return { ok: false, returnTo, message: 'OpenRouter did not send a sign-in code (was it declined?). You can try again.' };
  try {
    const r = await fetch(`${CONFIG.OPENROUTER}/auth/keys`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: saved.verifier, code_challenge_method: 'S256' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.key) throw new Error(`OpenRouter answered HTTP ${r.status}`);
    await setKey(j.key, 'signed-in');
    return { ok: true, returnTo };
  } catch (e) {
    return { ok: false, returnTo, message: `Could not get a key from OpenRouter (${e.message}). Try again, or paste a key instead.` };
  }
}
