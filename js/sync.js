// Offline-first sync between the phone's copy (vfs.js) and the library folder in Google Drive.
// Rules (owner, 13 Nov 2026):
//   * The phone keeps working without internet; changes go up when it is back online.
//   * Nothing is overwritten: when a document changed on the phone AND in Drive since the last sync, Drive's version
//     stays at its place and the phone's version becomes "<name> (phone copy <date time>).md" next to it.
//   * Renames, moves and deletes made on the phone are replayed on the same Drive files (queued operations).
//   * A project's documents are on the phone once it was opened here; the list of projects always comes from Drive.
//   * The desktop's own folders (.kalamo safety copies, history, trash, chats...) are never downloaded.
// A listing that fails part-way never deletes anything on the phone.
import * as fs from './vfs.js';
import * as drive from './drive.js';
import { driveFolder, storageMode } from './settings.js';
import { isDoc, docTitle } from './util.js';

const PROJECT_META = ['project.json', 'order.json', 'toggles.json', 'pictures.json', 'imports.json'];
const AI_FILES = ['prompts.json', 'collections.json', 'standard.json'];
const PICTURE = /\.(png|jpe?g|gif|webp|svg)$/i;
const MAX_BYTES = 15 * 1024 * 1024;

const status = { state: 'idle', message: '', last: 0, conflicts: [] };
const listeners = new Set();
export const getStatus = () => ({ ...status });
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setStatus(state, message = '') {
  status.state = state; status.message = message;
  if (state === 'done') status.last = Date.now();
  for (const fn of listeners) { try { fn(getStatus()); } catch (e) { console.error(e); } }
}

/** Which paths inside a project take part in the sync (relative to the project). */
function syncableInProject(rel) {
  const parts = rel.split('/');
  if (parts[0] === '.kalamo') return parts.length === 2 && PROJECT_META.includes(parts[1]);
  if (parts.some((p) => p.startsWith('.'))) return false;
  return true;
}
function syncablePath(path) {
  if (path.startsWith('.kalamo/')) return /^\.kalamo\/ai\/[^/]+$/.test(path) && AI_FILES.includes(fs.baseName(path));
  if (path.startsWith('.')) return false;
  const i = path.indexOf('/');
  return i < 0 ? true : syncableInProject(path.slice(i + 1));
}
const wantedFile = (name, size) => (isDoc(name) || PICTURE.test(name) || name.endsWith('.json')) && !(Number(size) > MAX_BYTES);

/** Projects that are on Drive but not (yet) on this phone, from the last sync: [{id, title}] */
export const remoteProjects = () => fs.kvGet('remote_projects', []);

let running = null;
let again = false;
/** Run a sync now (or once more after the running one). Resolves when done. */
export function syncNow(opts = {}) {
  if (storageMode() !== 'drive') return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      let first = true;
      do { again = false; await syncOnce({ ...opts, keepConflicts: !first }); first = false; } while (again);
    } finally { running = null; }
  })();
  return running;
}
export const isRunning = () => !!running;

/** Make sure the documents of a project that is only on Drive come to the phone. */
export async function fetchProject(pid) {
  const want = new Set(fs.kvGet('deep', []));
  want.add(pid);
  await fs.kvSet('deep', [...want]);
  await syncNow();
}

async function syncOnce(opts) {
  const root = driveFolder();
  if (!root) return;
  if (!navigator.onLine) { setStatus('offline', 'Offline: changes are kept on this phone and go up when you are online.'); return; }
  if (!drive.signedIn()) { setStatus('signin', 'Tap to sign in to Google Drive again.'); return; }
  setStatus('syncing');
  if (!opts.keepConflicts) status.conflicts = [];
  const ids = new Map([['', root.id]]);   // library path -> Drive folder id
  try {
    if (opts.beforeSync) await opts.beforeSync();
    await replayOps(root.id, ids);
    const top = await drive.children(root.id);
    const projects = top.filter((f) => f.mimeType === drive.FOLDER && !f.name.startsWith('.'));
    const kalamo = top.find((f) => f.mimeType === drive.FOLDER && f.name === '.kalamo');
    // shared prompt library and collections
    await syncAi(kalamo, root.id, ids);
    // projects: those on the phone are synced in full; the others are only listed
    const deep = new Set(fs.kvGet('deep', []));
    const local = fs.list('').filter((e) => e.kind === 'folder' && !e.name.startsWith('.')).map((e) => e.name);
    const remoteOnly = [];
    for (const p of projects) {
      ids.set(p.name, p.id);
      if (local.includes(p.name) || deep.has(p.name)) await syncTree(p.name, p.id, ids);
      else remoteOnly.push({ id: p.name, title: p.name, created: p.modifiedTime ? '' : '' });
    }
    for (const name of local) {
      if (projects.some((p) => p.name === name)) continue;
      const e = fs.get(name);
      const dirty = fs.under(name).some((x) => x.dirty && syncablePath(x.path));
      if (e.base && e.base.id && !dirty) {        // deleted (or moved away) on the desktop and not changed here
        await fs.remove(name, { fromDrive: true });
        status.conflicts.push({ kind: 'gone', path: name });
      } else {
        if (e.base) for (const x of fs.under(name)) if (x.base) await fs.markSynced(x.path, null, -1);   // made again on Drive
        await syncTree(name, null, ids);
      }
    }
    await pushExtras(ids);
    await fs.kvSet('remote_projects', remoteOnly);
    await fs.kvSet('deep', [...deep].filter((d) => projects.some((p) => p.name === d) || fs.exists(d)));
    setStatus('done', status.conflicts.length ? `${status.conflicts.length} item(s) need a look.` : '');
  } catch (e) {
    if (e instanceof drive.NeedSignIn) setStatus('signin', e.message);
    else if (!navigator.onLine || (e instanceof drive.DriveError && e.status === 0)) setStatus('offline', 'Offline: changes are kept on this phone.');
    else { console.error(e); setStatus('error', e.message || String(e)); }
  }
}

// ---------- folders on Drive by library path ----------
async function folderId(path, ids, create) {
  if (ids.has(path)) return ids.get(path);
  const parent = fs.parent(path);
  const pid = await folderId(parent, ids, create);
  if (!pid) return null;
  const name = fs.baseName(path);
  const kids = await drive.children(pid, true);
  let f = kids.find((k) => k.name === name);
  if (!f && create) f = await drive.createFolder(name, pid);
  if (!f) return null;
  ids.set(path, f.id);
  const le = fs.get(path);
  if (le && le.kind === 'folder' && (!le.base || le.base.id !== f.id)) await fs.markSynced(path, { id: f.id }, le.rev);
  return f.id;
}

// ---------- renames, moves and deletes made on the phone ----------
async function replayOps(rootId, ids) {
  let list = fs.ops();
  while (list.length) {
    const op = list[0];
    try {
      if (op.type === 'trash') {
        await drive.trash(op.id);
      } else if (op.type === 'move') {
        const m = await drive.meta(op.id);
        const parent = await folderId(fs.parent(op.to), ids, true);
        const same = (m.parents || []).includes(parent);
        await drive.moveTo(op.id, fs.baseName(op.to), same ? null : parent, same ? null : m.parents);
        // the folder's old place is no longer valid in the cache
        for (const k of [...ids.keys()]) if (k === op.from || k.startsWith(op.from + '/')) ids.delete(k);
      }
    } catch (e) {
      if (!(e instanceof drive.DriveError && e.status === 404)) throw e;   // gone on Drive already: nothing to do
    }
    await fs.dropOp(0);
    list = fs.ops();
  }
}

/** Files the phone makes in places that are never downloaded: a project's trash (sent up once) and the phone's chats
 * with their pictures (<library>/.kalamo/chats/, DECISIONS 55.9: sent up again when they change; the desktop's chats are
 * never downloaded). */
const TRASH_FILE = /^[^/.][^/]*\/\.kalamo\/trash\//;
const CHAT_FILE = /^\.kalamo\/chats\/(?:[0-9]{8}-[0-9]{6}-[0-9a-f]{4}\.md|pictures\/[0-9]{8}-[0-9]{6}-[0-9a-f]{6}\.(?:png|jpg|webp))$/;
async function pushExtras(ids) {
  for (const e of fs.all()) {
    if (e.kind !== 'file' || !e.dirty) continue;
    if (TRASH_FILE.test(e.path) && !e.base) await push(e.path, e, null, ids);
    else if (CHAT_FILE.test(e.path)) {
      try { await push(e.path, e, e.base && e.base.id ? { id: e.base.id } : null, ids); } catch (err) {
        if (!(err instanceof drive.DriveError && err.status === 404)) throw err;
        await push(e.path, e, null, ids);   // gone on Drive (deleted on the desktop): a new copy
      }
    }
  }
}

// ---------- .kalamo/ai (prompts, collections) ----------
async function syncAi(kalamo, rootId, ids) {
  let remote = new Map();
  if (kalamo) {
    ids.set('.kalamo', kalamo.id);
    const ai = (await drive.children(kalamo.id)).find((f) => f.name === 'ai' && f.mimeType === drive.FOLDER);
    if (ai) {
      ids.set('.kalamo/ai', ai.id);
      for (const f of await drive.children(ai.id)) if (AI_FILES.includes(f.name)) remote.set(`.kalamo/ai/${f.name}`, f);
    }
  }
  const local = fs.under('.kalamo/ai').filter((e) => e.kind === 'file' && syncablePath(e.path));
  const paths = new Set([...remote.keys(), ...local.map((e) => e.path)]);
  for (const p of paths) await syncFile(p, remote.get(p) || null, ids, true);
}

// ---------- one project ----------
async function listRemote(pid, folder) {
  const out = new Map();   // rel -> drive file
  const queue = [['', folder]];
  while (queue.length) {
    const [rel, id] = queue.shift();
    for (const f of await drive.children(id)) {
      const crel = rel ? `${rel}/${f.name}` : f.name;
      if (f.mimeType === drive.FOLDER) {
        if (crel === '.kalamo') { out.set(crel, f); queue.push([crel, f.id]); continue; }
        if (!syncableInProject(crel)) continue;
        if (out.has(crel)) continue;   // two folders with the same name: the first one is used
        out.set(crel, f);
        queue.push([crel, f.id]);
      } else if (f.mimeType.startsWith('application/vnd.google-apps')) {
        continue;   // Google Docs, Sheets...: not Kalamo files
      } else if (syncableInProject(crel) && wantedFile(f.name, f.size) && !out.has(crel)) {
        out.set(crel, f);
      }
    }
  }
  return out;
}

async function syncTree(pid, folder, ids) {
  if (!folder) folder = await folderId(pid, ids, true);
  ids.set(pid, folder);
  const remote = await listRemote(pid, folder);
  const top = fs.get(pid);
  if (!top) await fs.mkdirp(pid, { synced: true });
  if (!fs.get(pid).base) await fs.markSynced(pid, { id: folder }, fs.get(pid).rev);
  // folders first, parents before children
  const localFolders = fs.under(pid).filter((e) => e.kind === 'folder' && e.path !== pid && syncableInProject(e.path.slice(pid.length + 1)));
  const folderRels = new Set([...[...remote].filter(([, f]) => f.mimeType === drive.FOLDER).map(([r]) => r),
    ...localFolders.map((e) => e.path.slice(pid.length + 1))]);
  for (const rel of [...folderRels].sort((a, b) => a.split('/').length - b.split('/').length)) {
    const path = `${pid}/${rel}`;
    const r = remote.get(rel);
    const l = fs.get(path);
    if (r && r.mimeType === drive.FOLDER) {
      ids.set(path, r.id);
      if (!l) await fs.mkdirp(path, { synced: true });
      const now = fs.get(path);
      if (now && (!now.base || now.base.id !== r.id)) await fs.markSynced(path, { id: r.id }, now.rev);
    } else if (l && l.kind === 'folder') {
      const dirty = fs.under(path).some((x) => x.dirty);
      if (l.base && l.base.id && !dirty) {
        await fs.remove(path, { fromDrive: true });   // deleted on the desktop
      } else {
        const parent = await folderId(fs.parent(path), ids, true);
        const f = await drive.createFolder(fs.baseName(path), parent);
        ids.set(path, f.id);
        await fs.markSynced(path, { id: f.id }, fs.get(path).rev);
      }
    }
  }
  // files
  const localFiles = fs.under(pid).filter((e) => e.kind === 'file' && syncableInProject(e.path.slice(pid.length + 1)));
  const fileRels = new Set([...[...remote].filter(([, f]) => f.mimeType !== drive.FOLDER).map(([r]) => r),
    ...localFiles.map((e) => e.path.slice(pid.length + 1))]);
  for (const rel of fileRels) {
    const r = remote.get(rel);
    await syncFile(`${pid}/${rel}`, r && r.mimeType !== drive.FOLDER ? r : null, ids, false);
  }
}

const isText = (name) => isDoc(name) || name.endsWith('.json');
async function pull(path, r) {
  const name = fs.baseName(path);
  const data = isText(name) ? await drive.downloadText(r.id) : { blob: await drive.downloadBlob(r.id, r.mimeType), mime: r.mimeType };
  await fs.write(path, data, { synced: true, base: { id: r.id, md5: r.md5Checksum || '' } });
}
async function push(path, e, r, ids) {
  const content = e.text != null ? e.text : e.blob;
  const rev = e.rev;
  let f;
  if (r) f = await drive.update(r.id, fs.baseName(path), content);
  else f = await drive.upload(fs.baseName(path), await folderId(fs.parent(path), ids, true), content);
  await fs.markSynced(path, { id: f.id, md5: f.md5Checksum || '' }, rev);
}

/** The heart of it: one file, phone (e) against Drive (r). */
async function syncFile(path, r, ids, meta) {
  const e = fs.get(path);
  if (!e && r) return pull(path, r);
  if (!e) return;
  if (e.kind !== 'file') return;
  if (!r) {
    if (e.base && e.base.id && !e.dirty) { await fs.remove(path, { fromDrive: true }); return; }   // deleted on the desktop
    return push(path, e, null, ids);                                                           // new here (or changed here and deleted there: kept)
  }
  const sameFile = e.base && e.base.id === r.id;
  if (sameFile && (r.md5Checksum || '') === (e.base.md5 || '')) {
    if (e.dirty) await push(path, e, r, ids);
    return;
  }
  if (!e.dirty && (sameFile || !e.base)) {
    if (e.base || e.text == null) return pull(path, r);
  }
  // changed on both sides (or new on both sides): compare the contents
  if (isText(fs.baseName(path))) {
    const theirs = await drive.downloadText(r.id);
    if (theirs === e.text) { await fs.markSynced(path, { id: r.id, md5: r.md5Checksum || '' }, e.rev); return; }
    const mine = e.text;
    await fs.write(path, theirs, { synced: true, base: { id: r.id, md5: r.md5Checksum || '' } });
    if (meta || path.includes('/.kalamo/')) {
      if (fs.baseName(path) === 'order.json' && await mergeOrder(path, theirs, mine)) again = true;
      status.conflicts.push({ kind: 'settings', path });
      return;
    }
    const copy = conflictName(path);
    await fs.write(copy, mine);
    await addToOrder(copy, fs.baseName(path));
    status.conflicts.push({ kind: 'copy', path, copy });
    again = true;   // the phone copy (and the binder order) go up in a second pass right away
  } else {
    await pull(path, r);   // pictures: Drive's version wins
  }
}

function conflictName(path) {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
  const name = fs.baseName(path);
  const ext = (name.match(/\.(md|txt)$/i) || ['.md'])[0];
  let out = `${fs.parent(path)}/${docTitle(name)} (phone copy ${when})${ext}`;
  for (let n = 2; fs.exists(out); n++) out = `${fs.parent(path)}/${docTitle(name)} (phone copy ${when} ${n})${ext}`;
  return out;
}

/** Put the phone copy right after the original in the binder. */
async function addToOrder(copyPath, afterName) {
  const pid = copyPath.split('/')[0];
  const rel = copyPath.slice(pid.length + 1);
  const dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const op = `${pid}/.kalamo/order.json`;
  let o = {};
  try { o = JSON.parse(fs.read(op) || '{}'); } catch (e) { o = {}; }
  const list = o[dirRel] || [];
  const i = list.indexOf(afterName);
  const name = fs.baseName(copyPath);
  if (i >= 0) list.splice(i + 1, 0, name); else list.push(name);
  o[dirRel] = list;
  await fs.write(op, JSON.stringify(o, null, 2));
}

/** Binder order changed on both sides: Drive's order, plus what only the phone had at the end. */
async function mergeOrder(path, theirs, mine) {
  let a = {}, b = {};
  try { a = JSON.parse(theirs); b = JSON.parse(mine); } catch (e) { return; }
  let changed = false;
  for (const [k, v] of Object.entries(b)) {
    const list = a[k] || [];
    for (const n of v) if (!list.includes(n)) { list.push(n); changed = true; }
    a[k] = list;
  }
  if (changed) await fs.write(path, JSON.stringify(a, null, 2));
  return changed;
}

/** Leaving Drive for a different folder: forget which Drive files the phone's copy matched (nothing is deleted). */
export async function forgetDrive() {
  await fs.forgetBase();
  await fs.kvSet('remote_projects', []);
  await fs.kvSet('deep', []);
}
