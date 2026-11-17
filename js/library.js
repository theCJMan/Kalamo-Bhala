// Projects, the binder tree and its operations: a port of kalamo/store.py Library onto the phone's copy (vfs.js).
// Same files, same .kalamo/project.json, order.json and trash layout, so the desktop sees exactly what it would write.
import * as fs from './vfs.js';
import { cleanName, fileName, isDoc, natural, countWords, nowIso, stamp, NameError, appData } from './util.js';

const META = '.kalamo';
const TRASH_INFO = '.trashinfo.json';
const HIDDEN_ROOT = ['images', 'originals'];   // shown only while they hold documents (as on the desktop)

const readJson = (p, dflt) => { try { const t = fs.read(p); return t == null ? dflt : JSON.parse(t); } catch (e) { return dflt; } };
const writeJson = (p, obj) => fs.write(p, JSON.stringify(obj, null, 2));

export class LibError extends Error {}
const fail = (m) => { throw new LibError(m); };

// ---------- projects ----------
function meta(pid) {
  const m = readJson(`${pid}/${META}/project.json`, {});
  return { title: m.title || pid, description: m.description || '', created: m.created || '', example: m.example || '', ...m };
}

/** Projects in the library: newest first. `local` = its documents are on this phone. */
export function listProjects(remoteOnly = []) {
  const out = [];
  for (const e of fs.list('')) {
    if (e.kind !== 'folder' || e.name.startsWith('.')) continue;
    const m = meta(e.name);
    const t = tree(e.name);
    out.push({ id: e.name, title: m.title, description: m.description, created: m.created, words: t.words, files: t.files, local: true });
  }
  for (const r of remoteOnly) {
    if (out.some((p) => p.id === r.id)) continue;
    out.push({ id: r.id, title: r.title || r.id, description: '', created: r.created || '', words: null, files: null, local: false });
  }
  out.sort((a, b) => natural(a.title, b.title));
  out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return out;
}

export async function createProject(title, description = '') {
  const name = cleanName(title);
  if (fs.exists(name)) fail(`A project called '${name}' already exists.`);
  await fs.mkdirp(name);
  await writeJson(`${name}/${META}/project.json`, { title: name, description, created: nowIso() });
  return name;
}

export async function renameProject(pid, title) {
  const n = cleanName(title);
  if (n !== pid) {
    if (fs.exists(n)) fail(`A project called '${n}' already exists.`);
    await fs.move(pid, n);
  }
  const m = readJson(`${n}/${META}/project.json`, {});
  await writeJson(`${n}/${META}/project.json`, { ...m, title: n });
  return n;
}

/** Like the desktop: the project folder moves to <library>/.trash/<when> - <name>. */
export async function deleteProject(pid) {
  await fs.mkdirp('.trash');
  await fs.move(pid, `.trash/${stamp()} - ${pid}`);
}

// ---------- tree ----------
const order = (pid) => readJson(`${pid}/${META}/order.json`, {});
const saveOrder = (pid, o) => writeJson(`${pid}/${META}/order.json`, o);

function visibleNames(dir) {
  const names = {};
  for (const e of fs.list(dir)) {
    if (e.name.startsWith('.')) continue;
    if (e.kind === 'folder') names[e.name] = 'folder';
    else if (isDoc(e.name)) names[e.name] = 'file';
  }
  return names;
}
function ordered(pid, rel, o) {
  const names = visibleNames(rel ? `${pid}/${rel}` : pid);
  const saved = (o[rel] || []).filter((n) => n in names);
  const rest = Object.keys(names).filter((n) => !saved.includes(n))
    .sort((a, b) => ((names[a] !== 'folder') - (names[b] !== 'folder')) || natural(a, b));
  return { list: [...saved, ...rest], names };
}
function walk(pid, rel, o) {
  const kids = [];
  let words = 0, files = 0;
  const { list, names } = ordered(pid, rel, o);
  for (const n of list) {
    const crel = rel ? `${rel}/${n}` : n;
    if (names[n] === 'folder') {
      const w = walk(pid, crel, o);
      if (!rel && HIDDEN_ROOT.includes(n.toLowerCase()) && w.files === 0) continue;
      kids.push({ name: n, path: crel, type: 'folder', words: w.words, files: w.files, children: w.kids });
      words += w.words; files += w.files;
    } else {
      const w = countWords(fs.read(`${pid}/${crel}`) || '');
      kids.push({ name: n, path: crel, type: 'file', words: w });
      words += w; files += 1;
    }
  }
  return { kids, words, files };
}
export function tree(pid) {
  const w = walk(pid, '', order(pid));
  return { title: meta(pid).title, words: w.words, files: w.files, children: w.kids };
}
/** Every document in binder order (for opening the first one). */
export function docsInOrder(pid) {
  const out = [];
  const go = (kids) => kids.forEach((k) => (k.type === 'file' ? out.push(k.path) : go(k.children)));
  go(tree(pid).children);
  return out;
}

const parentRel = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const abs = (pid, rel) => (rel ? `${pid}/${rel}` : pid);

async function setOrder(pid, rel, names) {
  const o = order(pid);
  o[rel] = names;
  await saveOrder(pid, o);
}

/** kind: 'file' | 'folder'. Returns the new path (relative to the project). */
export async function createNode(pid, parent, kind, name, text = '') {
  const n = kind === 'folder' ? cleanName(name) : fileName(name);
  const dir = abs(pid, parent);
  if (!fs.isFolder(dir)) fail('Parent folder not found.');
  if (fs.exists(`${dir}/${n}`)) fail(`'${n}' already exists here.`);
  const { list } = ordered(pid, parent, order(pid));
  if (kind === 'folder') await fs.mkdirp(`${dir}/${n}`); else await fs.write(`${dir}/${n}`, text);
  await setOrder(pid, parent, [...list, n]);
  return parent ? `${parent}/${n}` : n;
}

/** Point order entries and the AI switches (toggles.json) at the new path after a rename (new = null: remove them),
 * as the desktop's _rewrite does. */
async function rewrite(pid, oldRel, newRel) {
  const tp = `${pid}/${META}/toggles.json`;
  const tog = readJson(tp, null);
  if (tog && Array.isArray(tog.files)) {
    const files = [];
    for (const f of tog.files) {
      if (f === oldRel || f.startsWith(oldRel + '/')) { if (newRel != null) files.push(newRel + f.slice(oldRel.length)); }
      else files.push(f);
    }
    if (JSON.stringify(files) !== JSON.stringify(tog.files)) await writeJson(tp, { ...tog, files: files.sort() });
  }
  const o = order(pid);
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === oldRel || k.startsWith(oldRel + '/')) { if (newRel != null) out[newRel + k.slice(oldRel.length)] = v; }
    else out[k] = v;
  }
  await saveOrder(pid, out);
}

export async function renameNode(pid, rel, newName) {
  const e = fs.get(abs(pid, rel));
  if (!e) fail('Not found.');
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  let n = e.kind === 'folder' ? cleanName(newName) : fileName(newName);
  const ext = name.match(/\.[^.]+$/)?.[0];
  if (e.kind === 'file' && !String(newName).trim().includes('.') && ext) n = cleanName(newName) + ext;
  const pr = parentRel(rel);
  const newRel = pr ? `${pr}/${n}` : n;
  if (newRel === rel) return rel;
  if (fs.exists(abs(pid, newRel))) fail(`'${n}' already exists here.`);
  await fs.move(abs(pid, rel), abs(pid, newRel));
  await rewrite(pid, rel, newRel);
  const { list } = ordered(pid, pr, order(pid));
  await setOrder(pid, pr, list.map((x) => (x === name ? n : x)));
  return newRel;
}

/** Move up (-1) or down (+1) among its siblings. */
export async function shiftNode(pid, rel, delta) {
  const pr = parentRel(rel);
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  const { list } = ordered(pid, pr, order(pid));
  const i = list.indexOf(name);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  await setOrder(pid, pr, list);
  return true;
}

/** To the project's trash, like the desktop: <project>/.kalamo/trash/<when>/<path> plus .trashinfo.json. */
export async function deleteNode(pid, rel) {
  if (!rel || !fs.exists(abs(pid, rel))) fail('Not found.');
  const when = stamp();
  let batch = `${pid}/${META}/trash/${when}`;
  for (let n = 2; fs.exists(batch); n++) batch = `${pid}/${META}/trash/${when}-${n}`;
  await fs.move(abs(pid, rel), `${batch}/${rel}`);
  await fs.write(`${batch}/${TRASH_INFO}`, JSON.stringify({ path: rel, deleted: nowIso() }, null, 2));
  await rewrite(pid, rel, null);
  const pr = parentRel(rel);
  const o = order(pid);
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  if (o[pr]) { o[pr] = o[pr].filter((x) => x !== name); await saveOrder(pid, o); }
}

/** The project's trash: [{id, path, deleted}] newest first. */
export function trashList(pid) {
  const out = [];
  for (const e of fs.list(`${pid}/${META}/trash`)) {
    if (e.kind !== 'folder') continue;
    const info = readJson(`${e.path}/${TRASH_INFO}`, null);
    if (info && info.path && fs.exists(`${e.path}/${info.path}`)) out.push({ id: e.name, path: info.path, deleted: info.deleted || '' });
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

/** Restore never overwrites: a name that is taken gets " (from trash <when>)". */
export async function trashRestore(pid, tid) {
  const t = trashList(pid).find((x) => x.id === tid);
  if (!t) fail('Not in the trash any more.');
  const src = `${pid}/${META}/trash/${tid}/${t.path}`;
  let rel = t.path;
  if (fs.exists(abs(pid, rel))) {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    const m = name.match(/^(.*?)(\.[^.]+)?$/);
    const w = tid.slice(0, 8);
    const nn = `${m[1]} (from trash ${w.slice(0, 4)}-${w.slice(4, 6)}-${w.slice(6, 8)})${fs.get(src).kind === 'file' ? (m[2] || '') : ''}`;
    rel = parentRel(rel) ? `${parentRel(rel)}/${nn}` : nn;
  }
  const pr = parentRel(rel);
  if (pr && !fs.isFolder(abs(pid, pr))) await fs.mkdirp(abs(pid, pr));
  const { list } = ordered(pid, pr, order(pid));
  await fs.move(src, abs(pid, rel));
  await fs.remove(`${pid}/${META}/trash/${tid}`);
  await setOrder(pid, pr, [...list, rel.slice(rel.lastIndexOf('/') + 1)]);
  return rel;
}

// ---------- documents ----------
export const readDoc = (pid, rel) => fs.read(abs(pid, rel));
export async function saveDoc(pid, rel, text) {
  if (!fs.get(abs(pid, rel))) fail('This document is gone (deleted or renamed elsewhere).');
  await fs.write(abs(pid, rel), text);
}

/** A picture referenced from a document ("../images/map.png", relative to the document). */
export function pictureEntry(pid, docRel, src) {
  if (!src || /^[a-z]+:/i.test(src)) return null;
  const parts = parentRel(docRel).split('/').filter(Boolean);
  for (const seg of decodeURIComponent(src).split('/')) {
    if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
  }
  return fs.get(`${pid}/${parts.join('/')}`);
}

// ---------- example projects (copied from the built examples.json, kalamo/examples) ----------
let examplesCache = null;
export async function examples() {
  if (!examplesCache) {
    const list = await appData('examples.json');
    if (!Array.isArray(list) || !list.length) throw new Error('The examples are missing from this copy of Kalamo.');
    examplesCache = list;
  }
  return examplesCache;
}
export async function addExample(key) {
  const ex = (await examples()).find((x) => x.key === key);
  if (!ex) fail('That example is not available.');
  let name = cleanName(ex.title);
  for (let n = 2; fs.exists(name); n++) name = `${cleanName(ex.title)} (${n})`;
  await fs.mkdirp(name);
  for (const f of ex.files) {
    if (f.svg) await fs.write(`${name}/${f.path}`, { blob: new Blob([f.text], { type: 'image/svg+xml' }), mime: 'image/svg+xml' });
    else await fs.write(`${name}/${f.path}`, f.text);
  }
  if (ex.order) await writeJson(`${name}/${META}/order.json`, ex.order);
  await writeJson(`${name}/${META}/project.json`, { title: name, description: ex.description || '', created: nowIso(), example: key });
  return name;
}

export { NameError };
