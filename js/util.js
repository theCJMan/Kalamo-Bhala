// Small helpers shared by every screen: building elements, sheets (bottom panels), dialogs, toasts, names, word counts.
// Mirrors the rules of the desktop's kalamo/store.py so a library written here opens unchanged on the desktop.

/** h('div', {class: 'x', onclick}, child, ...) -> element. Strings become text (never HTML). */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---------- icons (inline SVG, stroke = currentColor) ----------
const ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h10',
  more: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
  back: 'M15 5l-7 7 7 7',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  gear: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 13a7.6 7.6 0 000-2l2-1.6-2-3.4-2.4 1a7.7 7.7 0 00-1.7-1L15 3.5h-4l-.4 2.5a7.7 7.7 0 00-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 000 2l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 001.7 1l.4 2.5h4l.4-2.5a7.7 7.7 0 001.7-1l2.4 1 2-3.4z',
  doc: 'M7 3.5h7l4 4V20.5H7zM14 3.5V8h4',
  folder: 'M3.5 6.5h6l2 2h9v10h-17z',
  chevron: 'M9 6l6 6-6 6',
  cloud: 'M7 18.5h10a4 4 0 00.6-8 6 6 0 00-11.4 1.6A3.3 3.3 0 007 18.5z',
  phone: 'M8 3h8v18H8zM11 18h2',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  sync: 'M19 8a7.5 7.5 0 00-13.4 1M5 16a7.5 7.5 0 0013.4-1M19 3.5V8h-4.5M5 20.5V16h4.5',
  stop: 'M7 7h10v10H7z',
  key: 'M14.5 9.5a4 4 0 11-1.2-2.8M13.3 10.7L21 18.5V21h-2.5v-2H16v-2.5h-2',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6v.01M4.5 12v.01M4.5 18v.01',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  book: 'M5 4.5h10a3 3 0 013 3v12H8a3 3 0 01-3-3zM5 16.5a3 3 0 013-3h10',
  chat: 'M4.5 5.5h15v10h-9l-4.5 4v-4h-1.5z',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 4 4 3-3L20 16.5M15.5 9.5v.01',
  camera: 'M3.5 8h4l1.5-2.5h6L16.5 8h4v11h-17zM12 16.5a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z',
  flash: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  grid: 'M4 4h16v16H4zM9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16',
  'cloud-off': 'M7 18.5h10.5a3.5 3.5 0 00.6-6.95A5.5 5.5 0 007.6 9.3 4.6 4.6 0 007 18.5zM4 4l16 16',
  send: 'M4 12l16-7-6 15-2.5-6.5z',
  insert: 'M12 4v10M7.5 9.5L12 14l4.5-4.5M5 19h14',
};
export function icon(name, cls = 'ic') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || '');
  svg.append(p);
  return svg;
}

// ---------- toasts ----------
/** One message at a time: a new one replaces the one on screen (errors stay a little longer). */
let toastTimers = [];
export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  toastTimers.forEach(clearTimeout);
  const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, msg);
  box.replaceChildren(t);
  toastTimers = [setTimeout(() => t.classList.add('out'), kind === 'error' ? 6000 : 2600), setTimeout(() => t.remove(), kind === 'error' ? 6500 : 3100)];
}

// ---------- Back (Android's Back button and edge swipe) ----------
// The browser history holds exactly as many Back steps as the app needs right now: one per open panel, plus the steps
// of the screen (the writing screen: open the binder, then the projects; a settings page: its parent pages). Each
// Back uses up one step and the app does what that step means; on the Projects screen there are no steps left, so
// Back leaves the app. Steps are only ADDED while the person taps or types: Chrome skips history entries a page adds
// without a tap ("history manipulation intervention"), which used to make a second Back in a row close the app.
// Screens change with navigate(), which replaces the address of the current entry.
const layers = [];   // open panels, newest last: [{id, close(reason)}]
let layerSeq = 0;
export function pushLayer(close) { const id = ++layerSeq; layers.push({ id, close }); backChanged(); return id; }
export function popLayer(id) { const i = layers.findIndex((l) => l.id === id); if (i >= 0) layers.splice(i, 1); backChanged(); }
const dropLayer = popLayer;

let leaveFn = null;      // runs once when the current screen is left (settings pages save their last change)
export function setLeave(fn) { leaveFn = fn; }
export function runLeave() { const f = leaveFn; leaveFn = null; if (f) { try { f(); } catch (e) { console.error(e); } } }

let screenBack = null;    // the screen's own Back: returns true when it handled it (the writing screen opens the binder)
let screenSteps = null;   // () -> how many Back steps the screen's own Back still has (the writing screen: 1 or 0)
export function setScreenBack(fn, steps = null) { screenBack = fn; screenSteps = fn ? steps : null; backChanged(); }

let routeFn = null;
let current = '#/';
let popping = false;
let pos = 0;              // index of the current history entry above the app's first one
let trimTo = null;        // our own history.go() down to this index is under way: its popstate is not a Back
export const currentRoute = () => current;
/** The screen above another one, for Back. null: leave the app. */
function parentOf(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'settings') {
    if (parts[1] === 'prompt') return '#/settings/prompts';
    if (parts[1] === 'collection') return '#/settings/collections';
    if (parts[1]) return '#/settings';
    return '#/';
  }
  if (parts[0] === 'setup') return { storage: '#/setup/welcome', ai: '#/setup/storage' }[parts[1]] || null;
  if (parts[0] === 'write') return '#/';
  return null;
}
/** How many Back steps the app needs now. */
function stepsNeeded() {
  let n = layers.length + (screenSteps ? screenSteps() : 0);
  for (let h = parentOf(current), guard = 0; h != null && guard < 10; h = parentOf(h), guard++) n++;
  return n;
}
const tapping = () => !navigator.userActivation || navigator.userActivation.isActive;
/** Bring the history to the number of steps needed: add them (only during a tap), or take away extras. */
export function backChanged() {
  if (!routeFn || trimTo != null) return;
  const need = stepsNeeded();
  if (pos < need && tapping()) {
    while (pos < need) { pos++; history.pushState({ kalamo: pos }, '', current); }
  } else if (pos > need) {
    trimTo = need;
    popping = true;
    history.go(need - pos);
  }
}
export function startHistory(route) {
  routeFn = route;
  current = location.hash || '#/';
  pos = 0;
  history.replaceState({ kalamo: 0 }, '', current);
  addEventListener('popstate', (e) => {
    const st = e.state;
    if (!st || typeof st.kalamo !== 'number') {                // the address was changed from outside (typed, a link)
      current = location.hash || '#/';
      pos = 0;
      history.replaceState({ kalamo: 0 }, '', current);
      routeFn(current);
      return;
    }
    if (trimTo != null) {                                      // the end of our own trim, not a Back
      pos = st.kalamo;
      history.replaceState(st, '', current);
      if (pos <= trimTo) { trimTo = null; setTimeout(() => { popping = false; }, 50); backChanged(); }
      return;
    }
    if (st.kalamo >= pos) { pos = st.kalamo; history.replaceState(st, '', current); return; }   // Forward: ignore
    pos = st.kalamo;
    popping = true;
    setTimeout(() => { popping = false; }, 50);
    const top = layers.pop();
    if (top) top.close('back');
    else if (screenBack && screenBack()) { /* handled by the screen */ }
    else {
      const up = parentOf(current);
      if (up != null) navigate(up, true);
    }
    history.replaceState(history.state, '', current);
    backChanged();   // takes away extra steps now; missing ones come back with the next tap
  });
  // steps that could not be added without a tap are added with the next one
  for (const ev of ['pointerup', 'keydown', 'click']) addEventListener(ev, () => setTimeout(backChanged, 0), true);
  // an address typed or changed from outside (rare): show it
  addEventListener('hashchange', () => { if (popping) return; if (location.hash !== current) { current = location.hash || '#/'; routeFn(current); } });
  routeFn(current);
  backChanged();
}
/** Show a screen. */
export function navigate(hash, fromBack) {
  current = hash || '#/';
  history.replaceState(history.state, '', current);
  routeFn(current);
  if (!fromBack) backChanged();
}
export const go = (hash) => navigate(hash);

// ---------- sheets: panels that slide up from the bottom ----------
let sheetStack = [];
/** sheet({title, body, actions, onClose, tall}) -> {el, close()}. Tapping the shade or Back closes it. */
export function sheet({ title, body, actions, onClose, tall, cls, guard }) {
  const shade = h('div', { class: 'shade' });
  const panel = h('section', { class: `sheet${tall ? ' tall' : ''}${cls ? ' ' + cls : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Panel' },
    h('div', { class: 'grip', 'aria-hidden': 'true' }),
    title ? h('header', { class: 'sheet-head' }, h('h2', {}, title)) : null,
    h('div', { class: 'sheet-body' }, body),
    actions && actions.length ? h('footer', { class: 'sheet-foot' }, actions) : null);
  let closed = false;
  let layer = 0;
  const me = {
    el: panel,
    close(reason) {
      if (closed) return;
      // guard(reason) -> false keeps the panel open (e.g. to ask first); Back then needs its history entry again
      if (guard && reason !== 'done' && reason !== 'nav' && !guard(reason)) {
        if (reason === 'back') layer = pushLayer((r) => me.close(r));
        return;
      }
      closed = true;
      if (reason !== 'back') dropLayer(layer);
      sheetStack = sheetStack.filter((s) => s !== me);
      panel.classList.remove('in'); shade.classList.remove('in');
      setTimeout(() => { panel.remove(); shade.remove(); }, 220);
      if (onClose) onClose(reason);
    },
  };
  shade.addEventListener('click', () => me.close('shade'));
  document.body.append(shade, panel);
  requestAnimationFrame(() => { shade.classList.add('in'); panel.classList.add('in'); });
  sheetStack.push(me);
  layer = pushLayer((r) => me.close(r));
  return me;
}
export const topSheet = () => sheetStack[sheetStack.length - 1] || null;
export function closeAllSheets() { [...sheetStack].reverse().forEach((s) => s.close('nav')); }

/**
 * Typing {{ in a text box shows the variables that work there, just above it; tapping one puts {{name}} in.
 * vars: [[name, meaning]]. Returns a function that hides the list.
 */
export function varHints(field, vars) {
  const box = h('div', { class: 'var-hints hidden', role: 'listbox', 'aria-label': 'Variables' });
  document.body.append(box);
  let start = -1;
  const hide = () => { box.classList.add('hidden'); start = -1; };
  const put = (name) => {
    const end = field.selectionStart;
    const after = field.value.slice(end).replace(/^[a-z_]*\}{0,2}/, '');
    field.value = field.value.slice(0, start) + `{{${name}}}` + after;
    const at = start + name.length + 4;
    field.setSelectionRange(at, at);
    hide();
    field.focus();
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const check = () => {
    const upto = field.value.slice(0, field.selectionStart);
    const m = /\{\{\s*([a-z_]*)$/i.exec(upto);
    if (!m || document.activeElement !== field) { hide(); return; }
    const hits = vars.filter(([n]) => n.startsWith(m[1].toLowerCase()));
    if (!hits.length) { hide(); return; }
    start = m.index;
    box.replaceChildren(...hits.map(([n, meaning]) => h('button', { type: 'button', role: 'option',
      onpointerdown: (e) => e.preventDefault(),   // keeps the keyboard and the cursor in the text box
      onclick: () => put(n) }, h('b', {}, `{{${n}}}`), h('small', {}, meaning))));
    const r = field.getBoundingClientRect();
    box.style.left = `${Math.max(8, r.left)}px`;
    box.style.width = `${Math.min(r.width, innerWidth - 16)}px`;
    box.style.bottom = `${Math.max(8, innerHeight - r.top + 6)}px`;
    box.classList.remove('hidden');
  };
  field.addEventListener('input', check);
  field.addEventListener('click', check);
  // hide a moment after the box loses the cursor, unless it has it back by then (tap Send, then type {{ at once:
  // the late hide used to close the new list)
  field.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== field) hide(); }, 150));
  const gone = new MutationObserver(() => { if (!field.isConnected) { box.remove(); gone.disconnect(); } });
  gone.observe(document.body, { childList: true, subtree: true });
  return hide;
}

export function button(label, onclick, cls = '') {
  return h('button', { type: 'button', class: `btn ${cls}`.trim(), onclick }, label);
}

/** Ask for a line of text. Resolves to the text, or null when cancelled. */
export function ask(title, { value = '', label = '', placeholder = '', ok = 'OK', note = '' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', class: 'field-input', value, placeholder, 'aria-label': label || title, autocomplete: 'off' });
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); s.close('done'); };
    const form = h('form', { class: 'ask', onsubmit: (e) => { e.preventDefault(); finish(input.value); } },
      label ? h('label', { class: 'field-label' }, label) : null, input, note ? h('p', { class: 'muted small' }, note) : null);
    const s = sheet({ title, body: form, onClose: () => { if (!done) { done = true; resolve(null); } },
      actions: [button('Cancel', () => finish(null), 'ghost'), button(ok, () => finish(input.value), 'primary')] });
    setTimeout(() => { input.focus(); input.select(); }, 60);
  });
}

/** Yes/no question. Resolves true or false. */
export function confirmSheet(title, text, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); s.close('done'); };
    const s = sheet({ title, body: h('p', {}, text), onClose: () => { if (!done) { done = true; resolve(false); } },
      actions: [button('Cancel', () => finish(false), 'ghost'), button(ok, () => finish(true), danger ? 'danger' : 'primary')] });
  });
}

/** A list of choices in a sheet. items: [{label, icon, danger, run}] */
export function actionSheet(title, items) {
  const s = sheet({
    title,
    body: h('div', { class: 'action-list' }, items.map((it) => h('button', {
      type: 'button', class: `action${it.danger ? ' danger' : ''}`,
      onclick: () => { s.close('done'); it.run(); },
    }, it.icon ? icon(it.icon) : null, h('span', {}, it.label)))),
  });
  return s;
}

// ---------- names and words: the same rules as kalamo/store.py ----------
const RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((i) => [`COM${i}`, `LPT${i}`])]);
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
export const EXTS = ['.md', '.txt'];

export class NameError extends Error {}

export function cleanName(name) {
  const n = String(name || '').replace(BAD_CHARS, '').trim().replace(/[. ]+$/, '');
  if (!n) throw new NameError('Please enter a name. Characters Windows does not allow (< > : " / \\ | ? *) are removed.');
  if (n.startsWith('.')) throw new NameError('Names cannot start with a dot.');
  if (RESERVED.has(n.split('.')[0].toUpperCase())) throw new NameError(`'${n}' is a reserved Windows name. Please choose another.`);
  if (n.length > 120) throw new NameError('That name is too long (120 characters at most).');
  return n;
}
export function fileName(name) {
  const n = cleanName(name);
  return EXTS.some((e) => n.toLowerCase().endsWith(e)) ? n : n + '.md';
}
export const isDoc = (name) => EXTS.some((e) => name.toLowerCase().endsWith(e));
export const docTitle = (name) => name.replace(/\.(md|txt)$/i, '');

/** Natural sort key compare: "Chapter 2" before "Chapter 10". */
export function natural(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

const HTML_TAG = /(?<!\\)<\/?[A-Za-z][^<>]*>/g;
const MD_RULE = /^[ \t]*(?:\*[ \t]*){3,}$|^[ \t]*(?:-[ \t]*){3,}$|^[ \t]*(?:_[ \t]*){3,}$/gm;
const MD_LINE_MARKS = /^[ \t]*(?:#{1,6}|>+|[-+*]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]+/gm;
const MD_ONLY_MARKS = /^[*_~`#>|]+$/;
/** Words as a writer counts them (kalamo/store.py count_words). */
export function countWords(text) {
  const t = String(text || '').replace(HTML_TAG, ' ').replace(MD_RULE, ' ').replace(MD_LINE_MARKS, ' ').replace(/\\\n/g, ' ');
  let n = 0;
  for (const w of t.split(/\s+/)) if (w && !MD_ONLY_MARKS.test(w)) n++;
  return n;
}

export const fmtWords = (n) => `${(n || 0).toLocaleString('en')} word${n === 1 ? '' : 's'}`;

/** "20261113140501" like the desktop's stamp(). */
export function stamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
export function nowIso() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const p = (x) => String(Math.floor(Math.abs(x))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${p(off / 60)}:${p(off % 60)}`;
}
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  d.pending = () => t !== null;
  return d;
}

/**
 * One of Kalamo's own data files (ai-data.json, examples.json). A copy is kept in the browser's storage, so the prompts
 * and examples still work when the phone has dropped the offline copy and there is no connection (17 Nov 2026).
 */
export async function appData(file) {
  const key = `kalamo.appdata.${file}`;
  try {
    const r = await fetch(file);
    if (!r.ok) throw new Error(String(r.status));
    const text = await r.text();
    const data = JSON.parse(text);
    try { localStorage.setItem(key, text); } catch (e) { /* full or blocked: the copy is only a spare */ }
    return data;
  } catch (e) {
    let kept = null;
    try { kept = localStorage.getItem(key); } catch (e2) { /* blocked */ }
    if (kept) return JSON.parse(kept);
    throw new Error("Kalamo's own files are missing on this phone and there is no connection. Open Kalamo once with internet.");
  }
}
