// Importing on the phone (DECISIONS 55.1-55.5, 55.12): press and hold a folder → Import… → Images (the gallery),
// Photos (Kalamo's camera) or Documents (files on the phone). Imports run one by one in the background: a small card
// at the top shows how far each one is, with Stop; the writer goes on writing meanwhile.
//   * Photos of notes → ONE document for all the photos chosen together, read by the import model (the desktop's
//     prompt for printed or handwritten notes); the cost is estimated first; Stop keeps what was read.
//   * Photos taken in Kalamo are kept in <project>/originals; gallery photos are not copied (the gallery has them).
//   * Documents: PDF (own text free; pages without text read by the import model when ticked), .docx, .xlsx, .pptx,
//     .txt, .md → one document per file; pictures in them go to <project>/images.
import { h, icon, toast, sheet, button, actionSheet, cleanName, fmtWords, countWords } from './util.js';
import * as fs from './vfs.js';
import * as L from './library.js';
import * as ai from './ai.js';
import { getKey, importModel } from './settings.js';
import { shrinkPhoto, dataUrl, saveOriginal } from './pictures.js';
import { openCamera, pickImages, pickFiles } from './camera.js';
import { requestSync } from './main.js';

export const PHOTO_PROMPT = 'This is a photo of notes (printed or handwritten; a page of class notes, a whiteboard or a slide). Write out ' +
  'all the text in it exactly as it is, as Markdown: headings with #, lists, tables as Markdown tables. Keep every ' +
  'word; do not summarise, translate or add anything, and correct nothing. Where a word cannot be read, write [?]. ' +
  'Where there is a drawing, diagram or chart, write [Drawing: a few words saying what it shows]. Ignore what is ' +
  'only around the paper (the desk, fingers, shadows). If there is no text, reply with nothing.';
export const PAGE_PROMPT = 'This is page {page} of a document. Write out all its text exactly as it is, as Markdown: headings with #, ' +
  'lists, tables as Markdown tables, bold and italics where the page shows them. Keep every word; do not summarise, ' +
  'translate, correct or add anything. Leave out page numbers and running headers or footers. If the page has a ' +
  'picture, chart or diagram, write [Picture] where it is. If the page has no text, reply with nothing.';
export const DOC_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOC_EXT = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'markdown'];
const extOf = (name) => (String(name).match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// ---------- listeners (the writing screen refreshes its binder) ----------
const doneListeners = new Set();
export function onImported(fn) { doneListeners.add(fn); return () => doneListeners.delete(fn); }

// ---------- the queue and its cards ----------
const queue = [];
let active = null;
let tray = null;
function cardTray() {
  if (!tray || !tray.isConnected) {
    tray = h('div', { class: 'bg-tasks', role: 'region', 'aria-label': 'Imports running in the background' });
    document.body.append(tray);
  }
  return tray;
}

function task(name) {
  const msg = h('div', { class: 'bg-msg' }, 'Waiting for the import before it…');
  const bar = h('progress', { max: 100, value: 0 });
  const stopBtn = h('button', { type: 'button', class: 'bg-stop', 'aria-label': `Stop importing ${name}` }, icon('stop'), 'Stop');
  const card = h('div', { class: 'bg-task' }, h('div', { class: 'bg-row' }, h('b', { class: 'bg-name' }, name), stopBtn), msg, bar);
  const T = {
    name, stopped: false, run: null, stopNote: 'Stopping…',
    set(m, pct) { msg.textContent = m; if (pct != null) bar.value = pct; },
    close() { card.remove(); if (tray && !tray.children.length) { tray.remove(); tray = null; } },
  };
  stopBtn.addEventListener('click', () => {
    if (T.stopped) return;
    T.stopped = true;
    stopBtn.disabled = true;
    const i = queue.findIndex((j) => j.T === T);
    if (i >= 0) { queue.splice(i, 1); T.close(); toast(`${name}: not imported.`); return; }
    T.set(T.stopNote);
    if (T.run) T.run.stop();
  });
  cardTray().append(card);
  return T;
}

function enqueue(name, fn) {
  const T = task(name);
  queue.push({ T, fn });
  pump();
}
async function pump() {
  if (active || !queue.length) return;
  active = queue.shift();
  const { T, fn } = active;
  try { await fn(T); } catch (e) { console.error(e); toast(`${T.name}: ${e.message}`, 'error'); }
  finally { T.close(); active = null; pump(); }
}
export const busy = () => !!active || queue.length > 0;

// ---------- one AI reading (a photo or a page) ----------
async function aiRead(T, img, prompt, model, info) {
  let text = '', error = null, cost = 0, finished = false;
  const run = ai.startRun({ model, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: img } }] }] },
    info, (e) => {
      if (e.type === 'delta') text += e.text;
      else if (e.type === 'error') error = e.message;
      else if (e.type === 'done') { cost = e.cost || 0; finished = !e.stopped && e.finish_reason !== 'error'; }
    });
  T.run = run;
  await run.done;
  T.run = null;
  return { text: text.replace(/^```(?:markdown)?\s*|\s*```$/g, '').trim(), cost, finished, error };
}

/** What one picture costs to read, roughly (the desktop's estimate: 1,500 tokens in, 900 out). */
async function perPicture(model) {
  const info = await ai.infoFor(model).catch(() => null);
  return { info, each: info?.prompt_price != null && info?.completion_price != null ? info.prompt_price * 1500 + info.completion_price * 900 : null };
}

// ---------- writing the result ----------
const plain = (title) => { try { return cleanName(String(title).replace(/[\\*_`~[\]]/g, '')).slice(0, 80); } catch (e) { return 'Imported'; } };
/** A new document in folder `parent`, never over another one: "Name", "Name (2)"… Returns its path in the project. */
async function newDoc(pid, parent, stem, text, ext = '.md') {
  const base = plain(stem) || 'Imported';
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} (${n})`;
    const path = (parent ? `${pid}/${parent}/` : `${pid}/`) + name + ext;
    if (fs.exists(path)) continue;
    return L.createNode(pid, parent, 'file', name + ext, text);
  }
}
/** Picture links were written relative to the project; make them right for a document in folder `parent`. */
const relink = (md, parent) => {
  const depth = String(parent || '').split('/').filter(Boolean).length;
  return depth ? md.replace(/\]\(images\//g, '](' + '../'.repeat(depth) + 'images/') : md;
};
async function noteOriginals(pid, top, originals) {
  const p = `${pid}/.kalamo/imports.json`;
  let m = {};
  try { m = JSON.parse(fs.read(p) || '{}'); } catch (e) { m = {}; }
  m[top] = { original: originals[0], originals, split: false };
  await fs.write(p, JSON.stringify(m, null, 2));
}
function finished(pid, rel, message) {
  for (const fn of doneListeners) { try { fn(pid, rel); } catch (e) { console.error(e); } }
  requestSync();
  toast(message);
}

// ---------- "Import what?" ----------
/** Ask what to import into folder `parent` ('' = the top of the project), then start it. */
export function startImport(pid, parent) {
  actionSheet('Import what?', [
    { label: 'Images from the gallery', icon: 'image', run: () => importImages(pid, parent) },
    { label: 'Photos with the camera', icon: 'camera', run: () => importCameraPhotos(pid, parent) },
    { label: 'Documents (PDF, Word, Excel, PowerPoint, text)', icon: 'doc', run: () => importDocuments(pid, parent) },
  ]);
}

function needKey() {
  if (getKey()) return false;
  toast('Reading photos needs your OpenRouter key: Settings → OpenRouter key.', 'error');
  return true;
}

export async function importImages(pid, parent) {
  if (needKey()) return;
  const files = await pickImages();
  if (!files.length) return;
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const base = sorted[0].name.replace(/\.[^.]+$/, '');
  const photos = sorted.map((f) => ({ blob: f, name: f.name, fromGallery: true }));
  const choice = await confirmPhotos(photos, sorted.length > 1 ? `${base} and ${sorted.length - 1} more` : base);
  if (choice) enqueue(choice.name, (T) => readPhotos(T, pid, parent, photos, choice.name, false));
}

export async function importCameraPhotos(pid, parent) {
  if (needKey()) return;
  const shots = await openCamera({ title: 'Photos of notes' });
  if (!shots || !shots.length) return;
  const d = new Date();
  const name = `Notes ${today()} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const photos = shots.map((s, i) => ({ blob: s.blob, name: `${name} ${i + 1}.jpg` }));
  const choice = await confirmPhotos(photos, name);
  if (choice) enqueue(choice.name, (T) => readPhotos(T, pid, parent, photos.map((p, i) => ({ ...p, name: `${choice.name} ${i + 1}.jpg` })), choice.name, true));
}

/** The photos chosen, the name of the document, and the cost; resolves {name} or null. */
async function confirmPhotos(photos, defaultName) {
  const model = importModel();
  const { info, each } = await perPicture(model);
  return new Promise((resolve) => {
    const urls = photos.slice(0, 12).map((p) => URL.createObjectURL(p.blob));
    const name = h('input', { type: 'text', class: 'field-input', value: defaultName, maxlength: '80', 'aria-label': 'Name of the document' });
    let out = null;
    const s = sheet({
      title: 'Import photos of notes',
      body: h('div', {},
        h('p', {}, `${photos.length} photo(s). The AI writes out the text in each (printed or handwritten), in this order, into one document.`),
        h('div', { class: 'thumbs' }, urls.map((u, i) => h('img', { src: u, alt: `Photo ${i + 1}` })), photos.length > 12 ? h('span', { class: 'muted' }, `+${photos.length - 12}`) : null),
        h('p', { class: 'cost-line' }, h('b', {}, `${info?.name || model}: `), each != null ? `about ${ai.money(each * photos.length)} for all of them.` : 'the cost is shown when it is done.'),
        h('label', { class: 'field-label' }, 'Name'), name,
        h('p', { class: 'muted small' }, 'It runs in the background: you can go on writing. Stop keeps the photos already read.')),
      onClose: () => { urls.forEach((u) => URL.revokeObjectURL(u)); resolve(out); },
      actions: [button('Cancel', () => s.close('done'), 'ghost'), button('Import', () => { out = { name: name.value.trim() || defaultName }; s.close('done'); }, 'primary')],
    });
  });
}

async function readPhotos(T, pid, parent, photos, docName, keep) {
  const model = importModel();
  const { info } = await perPicture(model);
  T.stopNote = 'Stopping… the photos already read are kept.';
  let cost = 0, sentNotDone = null;
  const parts = [];
  for (const [i, p] of photos.entries()) {
    if (T.stopped) break;
    T.set(`Reading photo ${i + 1} of ${photos.length}…${cost ? ' ' + ai.money(cost) + ' so far' : ''}`, 5 + 85 * i / photos.length);
    let img;
    try { img = await dataUrl(p.fromGallery ? await shrinkPhoto(p.blob) : p.blob); } catch (e) {
      if (/hei[cf]$/i.test(p.name) && model.startsWith('google/') && p.blob.size < 14e6) img = (await dataUrl(p.blob)).replace(/^data:[^;]*;/, `data:image/${extOf(p.name)};`);
      else { toast(`${p.name}: this picture could not be opened; it is left out.`, 'error'); continue; }
    }
    const r = await aiRead(T, img, PHOTO_PROMPT, model, info);
    cost += r.cost;
    if (r.error || (T.stopped && !r.finished)) {
      if (r.error) toast(`${p.name}: ${r.error} Nothing was retried; the photos read so far are kept.`, 'error');
      sentNotDone = i + 1;
      break;
    }
    parts.push({ p, text: r.text || `*(No text was found on photo ${i + 1}.)*` });
  }
  if (!parts.length) { toast(`${docName}: nothing was imported${cost ? ` (${ai.money(cost)} spent)` : ''}.`); return; }
  T.set('Writing the document…', 95);
  const originals = [];
  if (keep) for (const { p } of parts) originals.push(await saveOriginal(pid, p.blob, p.name));
  const label = `${parts.length} photo${parts.length === 1 ? '' : 's'}`;
  const md = `*Imported from ${label} on ${today()}.*\n\n` + parts.map((x) => x.text).join('\n\n') + '\n' +
    (parts.length < photos.length ? `\n*(Stopped after photo ${parts.length} of ${photos.length}; import the other photos again to add them.)*\n` : '');
  const rel = await newDoc(pid, parent, docName, md);
  if (originals.length) await noteOriginals(pid, rel, originals);
  finished(pid, rel, `Imported "${docName}": ${parts.length} of ${photos.length} photo(s), ${ai.money(cost)}.` +
    (sentNotDone ? ` Photo ${sentNotDone} was sent but not finished (not kept, may still be billed).` : '') +
    (originals.length ? ' The photos are kept in "originals".' : ''));
}

// ---------- documents ----------
export async function importDocuments(pid, parent) {
  const files = (await pickFiles(DOC_ACCEPT, { multiple: true })).filter((f) => {
    if (DOC_EXT.includes(extOf(f.name))) return true;
    toast(`${f.name}: the phone imports PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), text and Markdown files.`, 'error');
    return false;
  });
  if (!files.length) return;
  const hasPdf = files.some((f) => extOf(f.name) === 'pdf');
  const model = importModel();
  const { info, each } = hasPdf ? await perPicture(model) : { info: null, each: null };
  const choice = await new Promise((resolve) => {
    const aiBox = h('input', { type: 'checkbox', checked: !!getKey(), disabled: !getKey() });
    let out = null;
    const s = sheet({
      title: 'Import documents',
      body: h('div', {},
        h('p', {}, files.length === 1 ? 'Each file becomes one document in this folder:' : `${files.length} files; each becomes one document in this folder:`),
        h('ul', { class: 'file-list' }, files.map((f) => h('li', {}, f.name, h('small', { class: 'muted' }, ` · ${Math.max(1, Math.round(f.size / 1024)).toLocaleString('en')} KB`)))),
        hasPdf ? h('label', { class: 'check' }, aiBox, h('span', {}, 'PDF pages without text (scans): let the AI read them',
          h('small', { class: 'muted' }, getKey() ? `${info?.name || model}, ${each != null ? 'about ' + ai.money(each) + ' a page' : 'the cost is shown when it is done'}. Unticked, such pages come in as pictures.`
            : 'Needs your OpenRouter key (Settings). Such pages come in as pictures.'))) : null,
        h('p', { class: 'muted small' }, 'It runs in the background: you can go on writing.')),
      onClose: () => resolve(out),
      actions: [button('Cancel', () => s.close('done'), 'ghost'), button('Import', () => { out = { ai: aiBox.checked }; s.close('done'); }, 'primary')],
    });
  });
  if (!choice) return;
  for (const f of files) enqueue(f.name, (T) => readDocument(T, pid, parent, f, choice.ai));
}

async function readDocument(T, pid, parent, file, useAi) {
  const ext = extOf(file.name);
  const stem = file.name.replace(/\.[^.]+$/, '');
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    T.set('Reading…', 50);
    const text = await file.text();
    const rel = await newDoc(pid, parent, stem, text, ext === 'txt' ? '.txt' : '.md');
    finished(pid, rel, `Imported "${file.name}" (${fmtWords(countWords(text))}).`);
    return;
  }
  const off = await import('./office.js');
  const pics = new off.Pictures(stem, (rel) => fs.exists(`${pid}/${rel}`));
  let md, warnings = [], extra = '';
  if (ext === 'pdf') {
    ({ md, extra } = await readPdf(T, pid, file, pics, useAi));
    if (md == null) return;
  } else {
    T.set(ext === 'pptx' ? 'Reading the slides, their notes, tables and pictures…' : ext === 'xlsx' ? 'Reading the sheets…' : 'Reading the text, headings, lists, tables and pictures…', 40);
    const buf = await file.arrayBuffer();
    if (T.stopped) { toast(`${file.name}: stopped; nothing was imported.`); return; }
    const r = await (ext === 'docx' ? off.docxToMd(buf, pics) : ext === 'pptx' ? off.pptxToMd(buf, pics) : off.xlsxToMd(buf));
    md = r.md; warnings = r.warnings;
  }
  T.set('Saving the document and its pictures…', 92);
  for (const p of pics.list) await fs.write(`${pid}/images/${p.name}`, { blob: p.blob, mime: p.blob.type });
  const body = md.trim() ? md : '(This file had no text that could be read.)\n';
  const rel = await newDoc(pid, parent, stem, `*Imported from ${file.name} on ${today()}.*\n\n` + relink(body, parent));
  finished(pid, rel, `Imported "${file.name}"${extra}.${warnings.length ? ' ' + warnings.join(' ') : ''}`);
}

async function readPdf(T, pid, file, pics, useAi) {
  const { openPdf, pagesToMarkdown } = await import('./pdfread.js');
  T.stopNote = 'Stopping… nothing is imported yet.';
  const pdf = await openPdf(await file.arrayBuffer(), { onPage: (n, total) => T.set(`Reading page ${n} of ${total}…`, 2 + 40 * n / total), stopped: () => T.stopped });
  try {
    if (T.stopped) { toast(`${file.name}: stopped before anything was read. Nothing was imported.`); return { md: null }; }
    const model = importModel();
    const { info } = await perPicture(model);
    const scans = useAi && getKey() ? pdf.pages.filter((p) => p.scanned) : [];
    T.stopNote = 'Stopping… the pages already read are kept.';
    let cost = 0, cut = pdf.total, done = 0;
    for (const [i, p] of scans.entries()) {
      if (T.stopped) { cut = p.n - 1; break; }
      T.set(`AI is reading page ${p.n} (${i + 1} of ${scans.length})…${cost ? ' ' + ai.money(cost) + ' so far' : ''}`, 45 + 40 * i / scans.length);
      const r = await aiRead(T, await dataUrl(await pdf.picture(p.n, 1600, 0.8)), PAGE_PROMPT.replace('{page}', p.n), model, info);
      cost += r.cost;
      if (r.error || (T.stopped && !r.finished)) {
        if (r.error) toast(`${file.name}, page ${p.n}: ${r.error} Nothing was retried; the pages read so far are kept.`, 'error');
        cut = p.n - 1; break;
      }
      p.aiText = r.text;
      p.aiPicture = /\[Picture\]/i.test(r.text);
      done++;
    }
    const keep = pdf.pages.filter((p) => p.n <= cut);
    if (!keep.length) { toast(`${file.name}: stopped before the first page was read${cost ? ` (${ai.money(cost)} spent)` : ''}. Nothing was imported.`); return { md: null }; }
    // page pictures: pages with a figure, and pages without text that the AI did not read
    const pictures = {};
    const wanted = keep.filter((p) => (p.hasImage && (p.aiText == null ? !p.scanned : p.aiPicture)) || (p.scanned && p.aiText == null && p.hasImage));
    for (const [i, p] of wanted.entries()) {
      T.set(`Saving a picture of page ${p.n} (${i + 1} of ${wanted.length})…`, 85 + 7 * i / Math.max(1, wanted.length));
      const blob = await pdf.picture(p.n);
      const md = pics.add(new Uint8Array(await blob.arrayBuffer()), 'jpg', `Page ${p.n} of ${file.name}${p.scanned && p.aiText == null ? ' (no text on this page)' : ''}`);
      if (md) pictures[p.n] = md.trim();
      if (p.aiText) p.aiText = p.aiText.replace(/\[Picture\]/gi, '');
    }
    let md = pagesToMarkdown(pdf.pages, keep, pictures);
    if (cut < pdf.total) md += `\n*(Stopped after page ${cut} of ${pdf.total}. Import the PDF again for the rest.)*\n`;
    const extra = ` (${keep.length} of ${pdf.total} page(s)${scans.length ? `; the AI read ${done} page(s) for ${ai.money(cost)}` : ''})`;
    return { md, extra };
  } finally { pdf.close(); }
}
