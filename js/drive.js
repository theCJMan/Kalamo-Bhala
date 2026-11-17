// Google Drive: sign-in (Google Identity Services token client) and the few Drive v3 calls the sync needs.
// Files are plain .md files in the library folder that Google Drive for desktop also syncs on the PC.
// The access token lasts about an hour and is kept on this phone only (never in the library).
import { CONFIG } from './config.js';
import { googleClientId, kvGet, kvSet } from './settings.js';

const SCOPE = 'https://www.googleapis.com/auth/drive';
export const FOLDER = 'application/vnd.google-apps.folder';
export class NeedSignIn extends Error {}
export class DriveError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

let gisLoaded = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoaded) {
    gisLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CONFIG.GIS_SCRIPT; s.async = true;
      s.onload = () => resolve(); s.onerror = () => { gisLoaded = null; reject(new DriveError('Could not load Google sign-in (offline?).')); };
      document.head.append(s);
    });
  }
  return gisLoaded;
}

const tokenOk = (t) => t && t.access_token && t.expires_at > Date.now() + 60000;
export const signedIn = () => tokenOk(kvGet('drive_token'));
export const account = () => kvGet('drive_account', '');
/** Signed in before, and Google's pass (about an hour) has run out or has less than 10 minutes left. */
export function needsRenewal() {
  if (!kvGet('drive_consented')) return false;
  const t = kvGet('drive_token');
  return !(t && t.access_token && t.expires_at > Date.now() + 10 * 60000);
}
/** Load Google's sign-in script early, so a renewal on a tap starts at once. */
export const preload = () => loadGis().catch(() => {});

/** Ask Google for a token. Must be called from a tap (Google opens its own window the first time). */
export async function signIn() {
  const id = googleClientId();
  if (!id) throw new DriveError('No Google client ID yet. Add it in Settings → Google Drive (see the setup steps).');
  await loadGis();
  const tok = await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: id, scope: SCOPE,
      callback: (r) => (r && r.access_token ? resolve(r) : reject(new DriveError(r?.error_description || r?.error || 'Google sign-in was cancelled.'))),
      error_callback: (e) => reject(new DriveError(e?.message || e?.type || 'Google sign-in was cancelled.')),
    });
    // the account signed in before is named, so Google does not ask which account (and can answer at once)
    client.requestAccessToken({ prompt: kvGet('drive_consented') ? '' : 'consent', ...(account().includes('@') ? { login_hint: account() } : {}) });
  });
  await kvSet('drive_token', { access_token: tok.access_token, expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000 });
  await kvSet('drive_consented', true);
  try {
    const about = await call('GET', '/about', { query: { fields: 'user(emailAddress,displayName)' } });
    await kvSet('drive_account', about?.user?.emailAddress || about?.user?.displayName || '');
  } catch (e) { /* the account name is only shown, not needed */ }
  return true;
}
export async function signOut() {
  const t = kvGet('drive_token');
  await kvSet('drive_token', null);
  await kvSet('drive_account', '');
  try { if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.access_token, () => {}); } catch (e) { /* ignore */ }
}

async function call(method, path, { query, body, headers, upload, raw } = {}) {
  const t = kvGet('drive_token');
  if (!tokenOk(t)) throw new NeedSignIn('Sign in to Google Drive again.');
  const base = upload ? CONFIG.DRIVE_UPLOAD : CONFIG.DRIVE;
  const q = query ? '?' + new URLSearchParams({ supportsAllDrives: 'true', ...query }) : '?supportsAllDrives=true';
  let r;
  try {
    r = await fetch(base + path + q, { method, headers: { Authorization: `Bearer ${t.access_token}`, ...(headers || {}) }, body });
  } catch (e) {
    throw new DriveError(`Could not reach Google Drive (${e.message}).`, 0);
  }
  if (r.status === 401) { await kvSet('drive_token', null); throw new NeedSignIn('Google sign-in expired. Tap to sign in again.'); }
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.json())?.error?.message || ''; } catch (e) { /* not JSON */ }
    throw new DriveError(`Google Drive answered HTTP ${r.status}${msg ? ` (${msg})` : ''}.`, r.status);
  }
  if (raw) return r;
  return r.status === 204 ? null : r.json();
}

const FIELDS = 'id,name,mimeType,md5Checksum,modifiedTime,size,parents,trashed';
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Children of a folder (not in Drive's bin). */
export async function children(folderId, onlyFolders = false) {
  const out = [];
  let pageToken;
  do {
    const query = { q: `'${esc(folderId)}' in parents and trashed = false${onlyFolders ? ` and mimeType = '${FOLDER}'` : ''}`,
      fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', includeItemsFromAllDrives: 'true' };
    if (pageToken) query.pageToken = pageToken;
    const r = await call('GET', '/files', { query });
    out.push(...(r.files || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}
export const meta = (id) => call('GET', `/files/${encodeURIComponent(id)}`, { query: { fields: FIELDS } });

export async function downloadText(id) {
  const r = await call('GET', `/files/${encodeURIComponent(id)}`, { query: { alt: 'media' }, raw: true });
  const buf = new Uint8Array(await r.arrayBuffer());
  const start = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;   // a BOM, as the desktop's decode()
  let t;
  try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(start)); } catch (e) { t = new TextDecoder('windows-1252').decode(buf.subarray(start)); }
  return t.replace(/\r\n/g, '\n');
}
export async function downloadBlob(id, mime) {
  const r = await call('GET', `/files/${encodeURIComponent(id)}`, { query: { alt: 'media' }, raw: true });
  const b = await r.blob();
  return mime && b.type !== mime ? new Blob([b], { type: mime }) : b;
}

export const createFolder = (name, parentId) => call('POST', '/files', {
  query: { fields: FIELDS }, headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
});

function multipart(metaObj, content, mime) {
  const boundary = 'kalamo' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metaObj)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, content, `\r\n--${boundary}--`,
  ]);
  return { body, type: `multipart/related; boundary=${boundary}` };
}
const mimeOf = (name, content) => (content instanceof Blob && content.type) || (/\.txt$/i.test(name) ? 'text/plain' : 'text/markdown');

/** A new file. content: text or Blob. Returns {id, md5Checksum, ...}. */
export function upload(name, parentId, content) {
  const mime = mimeOf(name, content);
  const m = multipart({ name, parents: [parentId] }, content, mime);
  return call('POST', '/files', { upload: true, query: { uploadType: 'multipart', fields: FIELDS }, headers: { 'Content-Type': m.type }, body: m.body });
}
/** New content for an existing file (keeps its id, name and place). */
export function update(id, name, content) {
  return call('PATCH', `/files/${encodeURIComponent(id)}`, { upload: true, query: { uploadType: 'media', fields: FIELDS },
    headers: { 'Content-Type': mimeOf(name, content) }, body: content });
}
/** Rename and/or move. */
export function moveTo(id, name, newParent, oldParents) {
  const query = { fields: FIELDS };
  if (newParent) { query.addParents = newParent; if (oldParents?.length) query.removeParents = oldParents.join(','); }
  return call('PATCH', `/files/${encodeURIComponent(id)}`, { query, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}
/** To Drive's bin (the writer can still restore it there for 30 days). */
export const trash = (id) => call('PATCH', `/files/${encodeURIComponent(id)}`, {
  query: { fields: 'id' }, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
});
