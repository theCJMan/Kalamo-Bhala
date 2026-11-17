// The writing screen: a bare page. A small bar appears under selected text (B, I, H, ✦ AI); typing "/" at the start
// of a line opens the list of formatting and prompts; the binder comes in from the left (swipe, ☰, or Back).
// Everything saves by itself to the phone's copy; the sync takes it to Google Drive when there is one.
import { createEditor } from '../vendor/kalamo-editor.js';
import { h, icon, toast, fmtWords, countWords, docTitle, debounce, actionSheet, ask, go, closeAllSheets, setScreenBack } from './util.js';
import * as L from './library.js';
import * as fs from './vfs.js';
import * as ai from './ai.js';
import { createBinder } from './binder.js';
import { runPrompt, pickPrompt } from './runner.js';
import { syncChip } from './projects.js';
import { requestSync } from './main.js';
import { openChat, closeChat, putInDocument, pictureStyleSheet } from './chat.js';
import { openCamera, pickImages } from './camera.js';
import { savePicture, shrinkPhoto, stampStem } from './pictures.js';
import { startImport, onImported } from './imports.js';

// Kalamo's own commands in the "/" list (DECISIONS 55.6, 55.7, 55.10)
const ACTIONS = [
  { key: 'chat', name: 'Chat', k: '', icon: 'chat', words: 'chat talk ask', online: true },
  { key: 'image', name: 'Image: make a picture', icon: 'image', words: 'image picture draw', online: true },
  { key: 'camera', name: 'Camera: insert photos', icon: 'camera', words: 'camera photo take' },
  { key: 'photo', name: 'Photo from the gallery', icon: 'image', words: 'photo gallery picture' },
];
const FORMATS = [
  { key: 'h1', name: 'Heading 1', k: 'H1', words: 'title heading' },
  { key: 'h2', name: 'Heading 2', k: 'H2', words: 'heading subtitle' },
  { key: 'h3', name: 'Heading 3', k: 'H3', words: 'heading' },
  { key: 'paragraph', name: 'Text', k: '¶', words: 'paragraph normal plain' },
  { key: 'bullet', name: 'Bullet list', k: '•', words: 'list ul' },
  { key: 'ordered', name: 'Numbered list', k: '1.', words: 'list ol number' },
  { key: 'quote', name: 'Quote', k: '❝', words: 'blockquote' },
  { key: 'hr', name: 'Scene break', k: '⁂', words: 'divider rule separator' },
];

let current = null;   // the mounted screen (for flush before sync / leaving)
export const flushWrite = () => (current ? current.flush() : Promise.resolve());
export function unmountWrite() { if (current) { current.destroy(); current = null; } }

export function mountWrite(root, pid) {
  if (!fs.isFolder(pid) || !fs.exists(pid)) { toast('That project is not on this phone.', 'error'); go('#/'); return; }
  const lastKey = `last_doc:${pid}`;
  const S = { rel: null, savedText: '', saving: null, typingTimer: null };

  // ---------- layout ----------
  const title = h('h1', {}, '');
  const chip = syncChip();
  const host = h('div', { class: 'page-host', style: { flex: '1', display: 'flex', flexDirection: 'column', position: 'relative' } });
  const noDoc = h('div', { class: 'no-doc hidden' }, h('p', {}, 'This project has no documents yet.'),
    h('button', { type: 'button', class: 'btn primary', onclick: () => newDoc() }, icon('plus'), 'New document'));
  const words = h('div', { class: 'wordcount', 'aria-live': 'off' });
  const screen = h('div', { class: 'screen write' },
    h('header', { class: 'bar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Open binder', onclick: () => binder.open() }, icon('menu')),
      title, chip,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'More', onclick: () => more() }, icon('more'))),
    h('main', { class: 'page' }, host, noDoc),
    words);
  root.replaceChildren(screen);

  // ---------- the editor ----------
  const pictureUrls = new Map();
  const ed = createEditor(host, {
    label: 'Document text',
    resolveImage: (src) => {
      const e = S.rel ? L.pictureEntry(pid, S.rel, src) : null;
      if (!e || !e.blob) return '';
      if (!pictureUrls.has(e.path)) pictureUrls.set(e.path, URL.createObjectURL(e.blob));
      return pictureUrls.get(e.path);
    },
    onChange: () => { scheduleSave(); typing(); updateWords(); checkSlash(); },
    onSelection: () => { updateSelbar(); checkSlash(); },
    onKeydown: (e) => slashKeys(e),
  });
  const pm = host.querySelector('.pm-surface');
  pm.setAttribute('autocapitalize', 'sentences');
  pm.setAttribute('autocorrect', 'on');
  pm.setAttribute('spellcheck', 'true');   // the phone's own spell checker

  function updateWords() { words.textContent = S.rel ? fmtWords(countWords(ed.getText())) : ''; }
  function typing() {
    document.body.classList.add('typing');
    clearTimeout(S.typingTimer);
    S.typingTimer = setTimeout(() => document.body.classList.remove('typing'), 2500);
  }
  addEventListener('scroll', () => document.body.classList.remove('typing'), { passive: true });

  // ---------- saving ----------
  const save = async () => {
    if (!S.rel) return;
    const md = ed.getMarkdown();
    if (md === S.savedText) return;
    try {
      await L.saveDoc(pid, S.rel, md);
      S.savedText = md;
      requestSync();
    } catch (e) { toast(`Not saved: ${e.message}`, 'error'); }
  };
  const saveSoon = debounce(() => { S.saving = save(); }, 700);
  function scheduleSave() { saveSoon(); }
  async function flush() { saveSoon.flush(); if (S.saving) await S.saving; await save(); }

  function openDoc(rel) {
    if (S.rel) { saveSoon.flush(); }
    hideSelbar(); hideSlash();
    const text = rel ? L.readDoc(pid, rel) : null;
    if (rel && text == null) { rel = null; }
    S.rel = rel;
    S.savedText = text || '';
    for (const u of pictureUrls.values()) URL.revokeObjectURL(u);
    pictureUrls.clear();
    ed.setMarkdown(text || '');
    title.textContent = rel ? docTitle(rel.split('/').pop()) : L.tree(pid).title;
    host.classList.toggle('hidden', !rel);
    noDoc.classList.toggle('hidden', !!rel || L.docsInOrder(pid).length > 0);
    if (rel) fs.kvSet(lastKey, rel);
    updateWords();
    window.scrollTo(0, 0);
  }
  async function newDoc() {
    const name = await ask('New document', { label: 'Name', ok: 'Create' });
    if (name == null) return;
    try { openDoc(await L.createNode(pid, '', 'file', name)); setTimeout(() => ed.focus(), 50); } catch (e) { toast(e.message, 'error'); }
  }

  // a document changed on Drive while open: show Drive's version when nothing here is waiting to be saved
  const offChange = fs.onChange((path, why) => {
    if (why !== 'pull') { if (why === 'remove' && S.rel && (path === `${pid}/${S.rel}` || `${pid}/${S.rel}`.startsWith(path + '/'))) openDoc(null); return; }
    if (!S.rel || path !== `${pid}/${S.rel}`) { if (binder.isOpen()) binder.refresh(); return; }
    if (saveSoon.pending() || ed.getMarkdown() !== S.savedText) return;
    const text = L.readDoc(pid, S.rel);
    if (text != null && text !== S.savedText) { S.savedText = text; ed.setMarkdown(text); updateWords(); toast('Updated from Google Drive.'); }
  });

  // ---------- binder ----------
  const binder = createBinder({
    pid, current: () => S.rel, open: (rel) => openDoc(rel),
    renamed: (o, n) => { if (S.rel === o) { S.rel = n; title.textContent = docTitle(n.split('/').pop()); fs.kvSet(lastKey, n); } else if (S.rel && S.rel.startsWith(o + '/')) { S.rel = n + S.rel.slice(o.length); fs.kvSet(lastKey, S.rel); } },
    deleted: (rel) => { if (S.rel && (S.rel === rel || S.rel.startsWith(rel + '/'))) { S.rel = null; openDoc(L.docsInOrder(pid)[0] || null); } },
    onOpen: () => { hideSelbar(); hideSlash(); flush(); },
  });
  document.body.append(binder.shade, binder.el);

  // Back on this screen opens the binder; Back with the binder open goes to the projects (owner: swipe from the left
  // opens the binder; on Android that swipe is the system's Back gesture).
  const onBack = () => {
    if (binder.isOpen()) { binder.close(); flush(); return false; }
    binder.open();
    return true;
  };
  setScreenBack(onBack, () => (binder.isOpen() ? 0 : 1));   // Back steps of this screen: open the binder, then up

  // a swipe that starts near the left edge drags the binder in
  let edge = null;
  const tStart = (e) => {
    const t = e.touches[0];
    if (binder.isOpen() || t.clientX > 44 || document.querySelector('.sheet, .chat-screen, .camera')) return;
    edge = { x: t.clientX, y: t.clientY, on: false };
  };
  const tMove = (e) => {
    if (!edge) return;
    const t = e.touches[0];
    if (!edge.on) {
      if (Math.abs(t.clientY - edge.y) > 24) { edge = null; return; }
      if (t.clientX - edge.x > 14) { edge.on = true; binder.dragStart(edge.x); }
    }
    if (edge && edge.on) binder.dragMove(t.clientX);
  };
  const tEnd = (e) => { if (edge && edge.on) binder.dragEnd(e.changedTouches[0].clientX); edge = null; };
  addEventListener('touchstart', tStart, { passive: true });
  addEventListener('touchmove', tMove, { passive: true });
  addEventListener('touchend', tEnd);

  // ---------- selection bar ----------
  const selbar = h('div', { class: 'selbar hidden', role: 'toolbar', 'aria-label': 'Selection' });
  const bB = h('button', { type: 'button', 'aria-label': 'Bold', onmousedown: (e) => e.preventDefault(), onclick: () => { ed.exec('bold'); updateSelbar(); } }, h('b', {}, 'B'));
  const bI = h('button', { type: 'button', 'aria-label': 'Italic', onmousedown: (e) => e.preventDefault(), onclick: () => { ed.exec('italic'); updateSelbar(); } }, h('i', {}, 'I'));
  const bH = h('button', { type: 'button', 'aria-label': 'Heading', onmousedown: (e) => e.preventDefault(), onclick: () => {
    const a = ed.active();
    ed.exec(a.h1 ? 'h2' : a.h2 ? 'h3' : a.h3 ? 'paragraph' : 'h1');
    updateSelbar();
  } }, 'H');
  const bAI = h('button', { type: 'button', class: 'ai', 'aria-label': 'AI prompts for the selection', onmousedown: (e) => e.preventDefault(), onclick: () => aiOnSelection() }, icon('spark'), 'AI');
  selbar.append(bB, bI, bH, bAI);
  const paintNet = () => bAI.classList.toggle('hidden', !navigator.onLine);   // AI needs the internet
  paintNet();
  addEventListener('online', paintNet);
  addEventListener('offline', paintNet);
  document.body.append(selbar);
  function hideSelbar() { selbar.classList.add('hidden'); }
  function updateSelbar() {
    if (!S.rel || !ed.hasSelection() || binder.isOpen() || document.body.classList.contains('chat-on')) { hideSelbar(); return; }
    const a = ed.active();
    bB.classList.toggle('on', a.bold); bI.classList.toggle('on', a.italic);
    bH.classList.toggle('on', a.h1 || a.h2 || a.h3);
    bH.textContent = a.h1 ? 'H1' : a.h2 ? 'H2' : a.h3 ? 'H3' : 'H';
    const v = ed.view;
    const { from, to } = v.state.selection;
    let end, start;
    try { end = v.coordsAtPos(to); start = v.coordsAtPos(from); } catch (e) { hideSelbar(); return; }
    selbar.classList.remove('hidden');
    const vv = window.visualViewport;
    const vh = vv ? vv.height + vv.offsetTop : innerHeight;
    const w = selbar.offsetWidth || 220;
    let top = end.bottom + 14;
    if (top + 52 > vh) top = Math.max(8, start.top - 60);
    const mid = Math.max(w / 2 + 8, Math.min(innerWidth - w / 2 - 8, (Math.min(start.left, end.left) + Math.max(start.left, end.left)) / 2));
    selbar.style.top = `${top}px`;
    selbar.style.left = `${mid}px`;
  }
  addEventListener('scroll', () => { if (!selbar.classList.contains('hidden')) updateSelbar(); }, { passive: true });
  window.visualViewport?.addEventListener('resize', () => { updateSelbar(); placeSlash(); });

  const ctx = () => ({ pid, rel: S.rel, editor: ed, currentText: () => ed.getMarkdown(), changed: () => saveSoon() });

  // ---------- chat, pictures and photos ----------
  function runAction(key) {
    if (key === 'chat') return openChat(ctx());
    if (key === 'image') return openChat(ctx(), { picture: true });
    if (key === 'camera') return cameraPhotos();
    if (key === 'photo') return galleryPhotos();
  }
  /** Pictures into the document at the cursor, one after the other (saved in the project's images folder). */
  async function insertPictures(blobs, stem) {
    if (!S.rel || !blobs.length) return;
    const links = [];
    for (const b of blobs) {
      try { links.push(`![](${(await savePicture(pid, S.rel, b, stem)).src})`); } catch (e) { toast(`A picture could not be saved: ${e.message}`, 'error'); }
    }
    if (!links.length) return;
    putInDocument(ed, links.join('\n\n'), false);
    saveSoon();
    toast(links.length === 1 ? 'Photo inserted.' : `${links.length} photos inserted.`);
  }
  async function cameraPhotos() {
    const shots = await openCamera({ title: 'Insert photos' });
    if (shots) await insertPictures(shots.map((x) => x.blob), stampStem('photo'));
  }
  async function galleryPhotos() {
    const files = await pickImages();
    if (!files.length) return;
    const blobs = [];
    for (const f of files) {
      try { blobs.push(await shrinkPhoto(f)); } catch (e) { toast(`${f.name}: this picture could not be opened.`, 'error'); }
    }
    await insertPictures(blobs, files.length === 1 ? files[0].name : stampStem('photo'));
  }
  async function aiOnSelection() {
    try { await ai.loadLibrary(); } catch (e) { toast(e.message, 'error'); return; }
    const sel = ai.lib.prompts.filter((p) => ai.usesVar(p, 'selected_text'));
    hideSelbar();
    pickPrompt('Prompts for the selection', sel.length ? sel : ai.lib.prompts, (p) => runPrompt(ctx(), p).then(() => saveSoon()));
  }

  // ---------- the "/" list ----------
  const slash = h('div', { class: 'slash hidden', role: 'listbox', 'aria-label': 'Commands and prompts' });
  document.body.append(slash);
  let slashState = null;   // {from, to, query, items, index}
  function hideSlash() { slash.classList.add('hidden'); slashState = null; }
  function placeSlash() {
    if (slash.classList.contains('hidden')) return;
    const vv = window.visualViewport;
    const bottomGap = vv ? Math.max(0, innerHeight - (vv.height + vv.offsetTop)) : 0;
    slash.style.bottom = `${bottomGap + 8}px`;
    slash.style.maxHeight = `${Math.min(innerHeight * 0.46, (vv ? vv.height : innerHeight) * 0.5)}px`;
  }
  function checkSlash() {
    if (!S.rel || document.body.classList.contains('chat-on')) return hideSlash();
    const st = ed.view.state;
    const { $from, empty } = st.selection;
    if (!empty || !$from.parent.isTextblock) return hideSlash();
    const before = $from.parent.textBetween(0, $from.parentOffset, null, '￼');
    const m = before.match(/^\/([^\s/]{0,40})$/);
    if (!m) return hideSlash();
    const q = m[1].toLowerCase();
    // no internet (owner): what needs it (prompts, Chat, Image) is left out and the list says so
    const online = navigator.onLine;
    const prompts = online ? ai.lib.prompts.map((p) => ({ type: 'prompt', p, name: p.name, hint: ai.runSettings(p).model })) : [];
    const fmts = FORMATS.map((f) => ({ type: 'format', f, name: f.name, k: f.k, words: f.words }));
    const acts = ACTIONS.filter((a) => online || !a.online).map((a) => ({ type: 'action', a, name: a.name, icon: a.icon, words: `${a.key} ${a.words}` }));
    const match = (it) => !q || it.name.toLowerCase().includes(q) || (it.words || '').includes(q);
    const items = [...acts.filter(match), ...prompts.filter(match), ...fmts.filter(match)];
    slashState = { from: $from.start(), to: $from.pos, query: q, items, index: 0, offline: !online };
    renderSlash();
  }
  function renderSlash() {
    const st = slashState;
    slash.replaceChildren();
    const as = st.items.filter((i) => i.type === 'action');
    const ps = st.items.filter((i) => i.type === 'prompt');
    const fs2 = st.items.filter((i) => i.type === 'format');
    let n = 0;
    const btn = (it) => {
      const i = n++;
      return h('button', { type: 'button', role: 'option', class: i === st.index ? 'active' : '', 'aria-selected': String(i === st.index),
        onmousedown: (e) => e.preventDefault(), onclick: () => pickSlash(it) },
      h('span', { class: 'k' }, it.type === 'prompt' ? icon('spark') : it.type === 'action' ? icon(it.icon) : it.k),
      h('span', {}, it.name, it.hint ? h('small', {}, it.hint) : null));
    };
    if (st.offline) slash.append(h('div', { class: 'no-signal' }, icon('cloud-off'), h('span', {}, 'No signal: AI prompts, Chat and Image come back when you are online.')));
    if (as.length) slash.append(h('h3', {}, 'Kalamo'), ...as.map(btn));
    if (ps.length) slash.append(h('h3', {}, 'Prompts'), ...ps.map(btn));
    if (fs2.length) slash.append(h('h3', {}, 'Format'), ...fs2.map(btn));
    if (!st.items.length) slash.append(h('div', { class: 'none' }, `Nothing called “${st.query}”. Keep typing to write it as text.`));
    slash.classList.remove('hidden');
    placeSlash();
  }
  function slashKeys(e) {
    if (!slashState) return false;
    const st = slashState;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!st.items.length) return false;
      st.index = (st.index + (e.key === 'ArrowDown' ? 1 : -1) + st.items.length) % st.items.length;
      renderSlash(); return true;
    }
    if (e.key === 'Enter' && st.items.length) { e.preventDefault(); pickSlash(st.items[st.index]); return true; }
    if (e.key === 'Escape') { hideSlash(); return true; }
    return false;
  }
  function pickSlash(it) {
    const st = slashState;
    if (!st) return;
    hideSlash();
    const v = ed.view;
    v.dispatch(v.state.tr.delete(st.from, st.to));
    if (it.type === 'format') ed.exec(it.f.key);
    else if (it.type === 'action') runAction(it.a.key);
    else runPrompt(ctx(), it.p).then(() => saveSoon());
  }

  // ---------- ⋯ menu ----------
  function more() {
    actionSheet(S.rel ? docTitle(S.rel.split('/').pop()) : 'Project', [
      { label: 'Binder', icon: 'list', run: () => binder.open() },
      ...(S.rel ? [{ label: 'Rename document', icon: 'edit', run: async () => {
        const n = await ask('Rename', { value: docTitle(S.rel.split('/').pop()), ok: 'Rename' });
        if (n == null) return;
        try { const nr = await L.renameNode(pid, S.rel, n); S.rel = nr; title.textContent = docTitle(nr.split('/').pop()); fs.kvSet(lastKey, nr); } catch (e) { toast(e.message, 'error'); }
      } }] : []),
      { label: 'New document', icon: 'plus', run: () => newDoc() },
      ...(S.rel ? [{ label: 'Chat', icon: 'chat', run: () => openChat(ctx()) }] : []),
      { label: 'Import into this project…', icon: 'down', run: () => startImport(pid, '') },
      { label: 'Picture style', icon: 'image', run: () => pictureStyleSheet(pid) },
      { label: 'All projects', icon: 'book', run: async () => { await flush(); go('#/'); } },
      { label: 'Settings', icon: 'gear', run: async () => { await flush(); go('#/settings'); } },
    ]);
  }

  // ---------- start ----------
  ai.loadLibrary().catch(() => {});
  const last = fs.kvGet(lastKey);
  const first = last && L.readDoc(pid, last) != null ? last : L.docsInOrder(pid)[0] || null;
  openDoc(first);

  const offImported = onImported((ipid) => { if (ipid === pid && binder.isOpen()) binder.refresh(); });

  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);

  current = {
    flush,
    destroy() {
      saveSoon.flush();
      offChange();
      offImported();
      closeChat();
      setScreenBack(null);
      removeEventListener('touchstart', tStart); removeEventListener('touchmove', tMove); removeEventListener('touchend', tEnd);
      document.removeEventListener('visibilitychange', onHide);
      binder.el.remove(); binder.shade.remove(); selbar.remove(); slash.remove();
      for (const u of pictureUrls.values()) URL.revokeObjectURL(u);
      ed.destroy();
      document.body.classList.remove('typing');
      closeAllSheets();
    },
  };
}
