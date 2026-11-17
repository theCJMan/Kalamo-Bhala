// The phone's copy of the library: a mirror of the desktop's folder layout, kept in IndexedDB.
//   paths:  "<project>/<folder>/<doc>.md", "<project>/.kalamo/order.json", ".kalamo/ai/prompts.json"
// Every entry remembers what it was when it last matched Google Drive (base = {id, md5}) and whether it changed here
// since (dirty). A rename or move keeps the Drive id, and is queued as an operation so Drive renames the same file
// (never a delete plus a new upload). Everything is held in memory as well; writes go to IndexedDB at once.

const DB_NAME = 'kalamo-mobile';
const DB_VER = 1;
let db = null;
const mem = new Map();      // path -> entry
const kvMem = new Map();    // key -> value (settings, sync state, queued operations)
const listeners = new Set();

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function tx(stores, mode = 'readonly') { return db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
/** Run one write and resolve only when it is committed to disk (a phone may close the app at any moment). */
function commit(store, fn) {
  return new Promise((resolve, reject) => {
    const t = tx([store], 'readwrite');
    fn(t.objectStore(store));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('The phone refused to save (storage full?).'));
  });
}

export async function open() {
  if (db) return;
  db = await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'path' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const t = tx(['entries', 'kv']);
  const all = await req(t.objectStore('entries').getAll());
  for (const e of all) mem.set(e.path, e);
  const keys = await req(t.objectStore('kv').getAllKeys());
  const vals = await req(t.objectStore('kv').getAll());
  keys.forEach((k, i) => kvMem.set(k, vals[i]));
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* not offered */ }
}

// ---------- key/value (settings, sync bookkeeping) ----------
export const kvGet = (k, dflt = null) => (kvMem.has(k) ? kvMem.get(k) : dflt);
export async function kvSet(k, v) {
  kvMem.set(k, v);
  await commit('kv', (st) => st.put(v, k));
}
export async function kvDel(k) {
  kvMem.delete(k);
  await commit('kv', (st) => st.delete(k));
}

// ---------- entries ----------
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
export const join = (a, b) => (a ? `${a}/${b}` : b);

async function put(e) {
  mem.set(e.path, e);
  await commit('entries', (st) => st.put(e));
}
async function del(path) {
  mem.delete(path);
  await commit('entries', (st) => st.delete(path));
}
function changed(path, why) { for (const fn of listeners) { try { fn(path, why); } catch (e) { console.error(e); } } }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const get = (path) => mem.get(path) || null;
export const exists = (path) => mem.has(path);
export const isFolder = (path) => path === '' || mem.get(path)?.kind === 'folder';

/** Direct children of a folder ('' = the library): [{name, path, kind}] */
export function list(dir) {
  const pre = dir ? dir + '/' : '';
  const out = [];
  for (const [p, e] of mem) {
    if (!p.startsWith(pre)) continue;
    const rest = p.slice(pre.length);
    if (!rest || rest.includes('/')) continue;
    out.push({ name: rest, path: p, kind: e.kind });
  }
  return out;
}
/** Every entry at or under a path. */
export function under(path) {
  const pre = path ? path + '/' : '';
  return [...mem.values()].filter((e) => !path || e.path === path || e.path.startsWith(pre));
}
export const all = () => [...mem.values()];

export async function mkdirp(path, opts = {}) {
  if (!path) return;
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join('/');
    const e = mem.get(p);
    if (e && e.kind === 'folder') continue;
    if (e) throw new Error(`'${p}' is a document, not a folder.`);
    await put({ path: p, kind: 'folder', mtime: Date.now(), rev: 1, dirty: !opts.synced, base: null });
  }
}

export function read(path) {
  const e = mem.get(path);
  if (!e || e.kind !== 'file') return null;
  return e.text != null ? e.text : null;
}

/**
 * Write a file. data: a string (text) or {blob, mime} (a picture).
 * opts.synced: the content is what Drive has (base given) -> not dirty. Otherwise the entry becomes dirty.
 */
export async function write(path, data, opts = {}) {
  await mkdirp(parentOf(path), { synced: opts.synced });
  const old = mem.get(path);
  if (old && old.kind === 'folder') throw new Error(`'${baseName(path)}' is a folder.`);
  const e = { path, kind: 'file', mtime: Date.now(), rev: (old?.rev || 0) + 1, base: old?.base || null, dirty: true };
  if (typeof data === 'string') e.text = data; else { e.blob = data.blob; e.mime = data.mime || data.blob.type; }
  if (opts.synced) { e.base = opts.base; e.dirty = false; }
  await put(e);
  changed(path, opts.synced ? 'pull' : 'write');
  return e;
}

/** Mark an entry as matching Drive (after an upload or a download), unless it changed again meanwhile. */
export async function markSynced(path, base, rev) {
  const e = mem.get(path);
  if (!e) return;
  const n = { ...e, base };
  if (rev == null || e.rev === rev) n.dirty = false;
  await put(n);
}

// ---------- queued operations for Drive (renames, moves, deletes of things Drive already has) ----------
export const ops = () => kvGet('ops', []);
async function queue(op) { await kvSet('ops', [...ops(), op]); }
export async function dropOp(i) { const o = ops().slice(); o.splice(i, 1); await kvSet('ops', o); }
export async function setOps(list) { await kvSet('ops', list); }

/** Move or rename (recursive). Drive ids are kept; Drive gets the same move later. */
export async function move(from, to) {
  if (from === to) return;
  if (mem.has(to)) throw new Error(`'${baseName(to)}' already exists there.`);
  if (to.startsWith(from + '/')) throw new Error('A folder cannot be moved into itself.');
  const top = mem.get(from);
  if (!top) throw new Error('Not found.');
  await mkdirp(parentOf(to));
  const items = under(from);
  for (const e of items) {
    const np = to + e.path.slice(from.length);
    await del(e.path);
    await put({ ...e, path: np });
  }
  if (top.base && top.base.id) await queue({ type: 'move', id: top.base.id, from, to });
  changed(to, 'move');
}

/**
 * Remove for good (recursive). Things Drive has go to Drive's own bin (recoverable there for 30 days).
 * opts.fromDrive: Drive no longer has it (a pull) -> nothing is queued.
 */
export async function remove(path, opts = {}) {
  const top = mem.get(path);
  if (!top) return;
  for (const e of under(path)) await del(e.path);
  if (!opts.fromDrive && top.base && top.base.id) await queue({ type: 'trash', id: top.base.id, path });
  changed(path, 'remove');
}

/** Forget which Drive files the entries matched: everything counts as new here (nothing is deleted). */
export async function forgetBase() {
  for (const e of [...mem.values()]) await put({ ...e, base: null, dirty: true });
  await kvSet('ops', []);
}

/** Forget everything (switching storage). */
export async function clearAll() {
  mem.clear();
  await commit('entries', (st) => st.clear());
  await kvSet('ops', []);
}

export const parent = parentOf;
