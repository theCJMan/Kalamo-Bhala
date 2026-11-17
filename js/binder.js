// The binder: a drawer from the left with the project's folders and documents.
// Tap a document to open it; press and hold any item for Rename, Move up/down, New here, Use in AI, Delete.
import { h, icon, ask, confirmSheet, actionSheet, toast, sheet, button, fmtWords, docTitle, go, backChanged } from './util.js';
import * as L from './library.js';
import * as fs from './vfs.js';
import { selectedDocs, setSelected } from './runner.js';
import { startImport } from './imports.js';

/**
 * opts: { pid, current() -> rel, open(rel), renamed(oldRel, newRel), deleted(rel) }
 * Returns { el, shade, open(), close(), isOpen(), refresh(), dragStart(x), dragMove(x), dragEnd(x) }
 */
export function createBinder(opts) {
  const { pid } = opts;
  const openKey = `binder_open:${pid}`;
  const tree = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Binder' });
  const titleB = h('b', {});
  const titleS = h('span', {});
  const shade = h('div', { class: 'drawer-shade' });
  const el = h('aside', { class: 'drawer', 'aria-label': 'Binder', 'aria-hidden': 'true' },
    h('div', { class: 'drawer-head' },
      h('button', { type: 'button', class: 'title', 'aria-label': 'All projects', onclick: () => { api.close(); go('#/'); } },
        h('span', { class: 'small' }, '‹ All projects'), titleB, titleS),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close binder', onclick: () => api.close() }, icon('close'))),
    tree,
    h('p', { class: 'drawer-hint' }, 'Press and hold an item for more.'),
    h('div', { class: 'drawer-foot' },
      button([icon('plus'), 'Document'], () => newItem('file', '')),
      button([icon('folder'), 'Folder'], () => newItem('folder', '')),
      // import photos or documents at the top of the project (a folder's own Import… is in its press-and-hold menu)
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Import into this project', title: 'Import', onclick: () => { api.close(); startImport(pid, ''); } }, icon('down')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Trash', onclick: () => showTrash() }, icon('trash'))));
  shade.addEventListener('click', () => api.close());

  let isOpen = false;
  const openFolders = new Set(fs.kvGet(openKey, []));
  const saveOpen = () => fs.kvSet(openKey, [...openFolders]);

  function row(node, depth) {
    const cur = opts.current();
    const isFile = node.type === 'file';
    const on = isFile && selectedDocs(pid).includes(node.path);
    const btn = h('button', {
      type: 'button', role: 'treeitem', class: `node${isFile && node.path === cur ? ' current' : ''}${!isFile && openFolders.has(node.path) ? ' open' : ''}`,
      'aria-expanded': isFile ? null : String(openFolders.has(node.path)), dataset: { path: node.path },
    },
    isFile ? icon('doc') : icon('chevron', 'ic chev'),
    isFile ? null : icon('folder'),
    h('span', { class: 'name' }, isFile ? docTitle(node.name) : node.name),
    on ? h('i', { class: 'on', title: 'Used by AI prompts' }) : null,
    h('span', { class: 'w' }, node.words ? node.words.toLocaleString('en') : ''));
    longPress(btn, () => menu(node), () => {
      if (isFile) { opts.open(node.path); api.close(); }
      else { if (openFolders.has(node.path)) openFolders.delete(node.path); else openFolders.add(node.path); saveOpen(); render(); }
    });
    const wrap = h('div', {}, btn);
    if (!isFile && openFolders.has(node.path)) wrap.append(h('div', { class: 'kids', role: 'group' }, node.children.map((c) => row(c, depth + 1))));
    return wrap;
  }

  function render() {
    const t = L.tree(pid);
    titleB.textContent = t.title;
    titleS.textContent = fmtWords(t.words);
    tree.replaceChildren(...(t.children.length ? t.children.map((n) => row(n, 0))
      : [h('p', { class: 'empty small' }, 'No documents yet. Add one below.')]));
    // the open document's folders stay open
    const cur = opts.current();
    if (cur && cur.includes('/')) {
      let changed = false;
      const parts = cur.split('/');
      for (let i = 1; i < parts.length; i++) { const f = parts.slice(0, i).join('/'); if (!openFolders.has(f)) { openFolders.add(f); changed = true; } }
      if (changed) { saveOpen(); render(); }
    }
  }

  async function newItem(kind, parent) {
    const name = await ask(kind === 'folder' ? 'New folder' : 'New document', { label: 'Name', ok: 'Create' });
    if (name == null) return;
    try {
      const rel = await L.createNode(pid, parent, kind, name);
      if (parent) { openFolders.add(parent); saveOpen(); }
      render();
      if (kind === 'file') { opts.open(rel); api.close(); }
    } catch (e) { toast(e.message, 'error'); }
  }

  function menu(node) {
    const isFile = node.type === 'file';
    const parent = isFile ? (node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '') : node.path;
    const on = isFile && selectedDocs(pid).includes(node.path);
    actionSheet(isFile ? docTitle(node.name) : node.name, [
      { label: 'Rename', icon: 'edit', run: async () => {
        const n = await ask('Rename', { value: isFile ? docTitle(node.name) : node.name, ok: 'Rename' });
        if (n == null) return;
        try { const nr = await L.renameNode(pid, node.path, n); opts.renamed(node.path, nr); render(); } catch (e) { toast(e.message, 'error'); }
      } },
      { label: isFile ? 'New document next to it' : 'New document in this folder', icon: 'plus', run: () => newItem('file', parent) },
      { label: isFile ? 'New folder next to it' : 'New folder in this folder', icon: 'folder', run: () => newItem('folder', parent) },
      ...(isFile ? [] : [{ label: 'Import…', icon: 'down', run: () => startImport(pid, node.path) }]),
      ...(isFile ? [{ label: on ? 'Stop using in AI prompts' : 'Use in AI prompts', icon: 'spark', run: async () => { await setSelected(pid, node.path, !on); render(); toast(on ? 'No longer sent with prompts.' : 'Sent with prompts that use {{selected_documents}}.'); } }] : []),
      { label: 'Move up', icon: 'up', run: async () => { await L.shiftNode(pid, node.path, -1); render(); } },
      { label: 'Move down', icon: 'down', run: async () => { await L.shiftNode(pid, node.path, 1); render(); } },
      { label: 'Delete', icon: 'trash', danger: true, run: async () => {
        const ok = await confirmSheet(`Delete "${isFile ? docTitle(node.name) : node.name}"?`, 'It goes to the project\'s trash; you can restore it from there.', { ok: 'Delete', danger: true });
        if (!ok) return;
        try { await L.deleteNode(pid, node.path); opts.deleted(node.path); render(); toast('Moved to the trash.'); } catch (e) { toast(e.message, 'error'); }
      } },
    ]);
  }

  function showTrash() {
    const items = L.trashList(pid);
    const s = sheet({
      title: 'Trash',
      body: items.length ? h('div', { class: 'list' }, items.map((t) => h('button', { type: 'button', class: 'item', onclick: async () => {
        s.close('done');
        try { const rel = await L.trashRestore(pid, t.id); render(); toast(`Restored as "${docTitle(rel.split('/').pop())}".`); } catch (e) { toast(e.message, 'error'); }
      } }, h('div', { class: 't' }, h('b', {}, docTitle(t.path.split('/').pop())), h('span', {}, `${t.path} · deleted ${t.deleted.slice(0, 16).replace('T', ' ')}`)), h('span', { class: 'tag' }, 'Restore'))))
        : h('p', { class: 'muted' }, 'The trash is empty.'),
    });
  }

  // ---------- opening, closing, dragging ----------
  let dragX0 = null, dragOpen0 = false;
  const W = () => el.getBoundingClientRect().width || 320;
  const api = {
    el, shade, refresh: render, isOpen: () => isOpen,
    open() {
      if (isOpen) return;
      render();
      isOpen = true;
      el.classList.add('open'); shade.classList.add('open'); el.setAttribute('aria-hidden', 'false');
      document.activeElement?.blur?.();
      if (opts.onOpen) opts.onOpen();
      backChanged();   // one Back step fewer while the binder is open
      // scroll only the binder's own list to the open document (scrollIntoView could also move the whole screen on a
      // phone while the keyboard closes, pushing the Document / Folder buttons out of sight)
      setTimeout(() => {
        const n = tree.querySelector('.node.current');
        if (!n) return;
        const t = tree.getBoundingClientRect(), r = n.getBoundingClientRect();
        tree.scrollTop += (r.top - t.top) - (t.height - r.height) / 2;
      }, 250);
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      el.classList.remove('open'); shade.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
      el.style.transform = ''; shade.style.opacity = '';
      if (opts.onClose) opts.onClose();
      backChanged();
    },
    dragStart(x) { dragX0 = x; dragOpen0 = isOpen; if (!isOpen) render(); el.classList.add('dragging'); shade.classList.add('dragging'); },
    dragMove(x) {
      if (dragX0 == null) return;
      const w = W();
      const off = Math.max(-w, Math.min(0, (dragOpen0 ? 0 : -w) + (x - dragX0)));
      el.style.transform = `translateX(${off}px)`;
      shade.style.opacity = String(1 + off / w);
      shade.style.pointerEvents = 'auto';
    },
    dragEnd(x) {
      if (dragX0 == null) return;
      const dx = x - dragX0;
      dragX0 = null;
      el.classList.remove('dragging'); shade.classList.remove('dragging');
      el.style.transform = ''; shade.style.opacity = ''; shade.style.pointerEvents = '';
      if (dragOpen0 ? dx > -60 : dx > 60) { isOpen = false; api.open(); } else { isOpen = true; api.close(); }
    },
  };
  // swipe left on the open drawer closes it
  let sx = null;
  el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (sx == null) return;
    const dx = e.touches[0].clientX - sx;
    if (dx < -12 && el.dataset.drag !== '1') { el.dataset.drag = '1'; api.dragStart(sx); }
    if (el.dataset.drag === '1') api.dragMove(e.touches[0].clientX);
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (el.dataset.drag === '1') { el.dataset.drag = ''; api.dragEnd(e.changedTouches[0].clientX); }
    sx = null;
  });
  return api;
}

/** Tap runs onTap; pressing ~0.5 s (without moving) runs onLong. Right-click also counts as a long press. */
export function longPress(el, onLong, onTap) {
  let t = null, fired = false, x0 = 0, y0 = 0;
  el.addEventListener('touchstart', (e) => {
    fired = false; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    t = setTimeout(() => { fired = true; t = null; navigator.vibrate?.(12); onLong(); }, 480);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (t && (Math.abs(e.touches[0].clientX - x0) > 10 || Math.abs(e.touches[0].clientY - y0) > 10)) { clearTimeout(t); t = null; }
  }, { passive: true });
  el.addEventListener('touchend', () => { if (t) { clearTimeout(t); t = null; } });
  el.addEventListener('click', (e) => { if (fired) { e.preventDefault(); fired = false; return; } onTap(); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired) onLong(); fired = false; });
}
