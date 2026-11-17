// The chat on the phone (DECISIONS 55.7-55.10): `/chat` in a document opens a NEW chat, full screen over the document
// (the document stays open underneath). Close: the × button, `/close` or Back.
//   * Select text in the chat → "Insert in doc" puts it at the cursor in the document; the chat stays open.
//   * `/insert` the whole chat at the cursor, `/insert N` the last N turns; `/append`, `/append N` at the end.
//     Both sides go in, labelled **Me:** and **AI:**. A turn is one question plus its answer.
//   * `/image <description>` makes a picture (the picture model, the project's picture style); Reject throws it away;
//     `/insert image` / `/append image` put the last picture that was not rejected in the document.
//   * The chat is saved in <library>/.kalamo/chats/ in the desktop's format (kalamo/chat.py), so the desktop lists it.
// Spending rules as everywhere: one request per message, never retried, Stop aborts at once, the cost is shown.
import { pickModel as choose } from './modelpick.js';
import { h, icon, toast, sheet, button, ask, pushLayer, popLayer, nowIso, varHints } from './util.js';
import * as fs from './vfs.js';
import * as ai from './ai.js';
import { getKey, chatModel, pictureModel, kvSet } from './settings.js';
import { savePicture } from './pictures.js';
import { selectedDocs } from './runner.js';
import { markdownToElement, markdownToDoc } from '../vendor/kalamo-editor.js';
import { requestSync } from './main.js';

const CONTEXT_TURNS = 6;   // the desktop's default (CHAT_CONTEXT)
const COMMANDS = [
  { cmd: '/insert', hint: 'the whole chat at the cursor' },
  { cmd: '/insert 1', hint: 'the last turns at the cursor: change the number, then send', number: true },
  { cmd: '/append', hint: 'the whole chat at the end of the document' },
  { cmd: '/append 1', hint: 'the last turns at the end: change the number, then send', number: true },
  { cmd: '/image ', hint: 'make a picture: describe it after /image' },
  { cmd: '/insert image', hint: 'the last picture at the cursor' },
  { cmd: '/append image', hint: 'the last picture at the end' },
  { cmd: '/close', hint: 'close the chat' },
];

// ---------- putting Markdown into the document ----------
/** Insert Markdown at the cursor (after the selection, never replacing it) or at the end of the document. */
export function putInDocument(ed, md, atEnd) {
  const v = ed.view;
  const st = v.state;
  const frag = markdownToDoc(String(md || '').replace(/\s+$/, '')).content;
  if (!frag.childCount) return false;
  if (atEnd) {
    v.dispatch(st.tr.insert(st.doc.content.size, frag).scrollIntoView());
    return true;
  }
  const Slice = st.doc.slice(0, 0).constructor;   // ProseMirror's Slice (the bundle does not export it)
  const openStart = frag.firstChild.type.name === 'paragraph' ? 1 : 0;
  const openEnd = frag.lastChild.type.name === 'paragraph' ? 1 : 0;
  const pos = st.selection.to;
  v.dispatch(st.tr.replaceRange(pos, pos, new Slice(frag, openStart, openEnd)).scrollIntoView());
  return true;
}

// ---------- the desktop's chat file format (kalamo/chat.py to_markdown) ----------
const guard = (t) => String(t || '').replace(/<!-- kalamo-/g, '<!-- kalamo‑');
function whenText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function chatToMarkdown(chat) {
  const head = { id: chat.id, created: chat.created, updated: chat.updated, model: chat.model || '' };
  const out = [`# ${chat.title || 'Chat'}`, '', `<!-- kalamo-chat ${JSON.stringify(head)} -->`, ''];
  for (const m of chat.messages) {
    const meta = {};
    for (const k of ['role', 'time', 'model', 'cost', 'provider', 'vars', 'picture']) if (m[k] != null) meta[k] = m[k];
    let label;
    if (m.role === 'user') label = `**You** · ${whenText(m.time)}`;
    else label = `**Assistant**${m.model ? ` (${m.model})` : ''} · ${whenText(m.time)}${typeof m.cost === 'number' ? ` · $${m.cost.toFixed(4)}` : ''}`;
    out.push(`<!-- kalamo-msg ${JSON.stringify(meta)} -->`, label, '', guard(m.content).replace(/\s+$/, ''), '');
  }
  return out.join('\n').replace(/\s+$/, '') + '\n';
}
function stampId(withSeconds = true) {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${withSeconds ? p(d.getSeconds()) : ''}`;
}
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2))), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);

// ---------- which model ----------
function defaultChatModel() {
  const saved = chatModel();
  if (saved) return saved;
  const home = ai.lib.collections.find((c) => c.standard === 'default') || ai.lib.collections[0];
  return home?.default_model || ai.FREE_MODEL;
}

let openNow = null;
export const chatOpen = () => !!openNow;

/**
 * Open a new chat over the document. ctx: { pid, rel, editor, currentText(), changed() }.
 * opts.picture: start with "/image " typed (the editor's /image).
 */
export async function openChat(ctx, opts = {}) {
  if (openNow) return;
  await ai.loadLibrary().catch(() => {});
  const ed = ctx.editor;
  const chat = { id: `${stampId()}-${hex(4)}`, title: '', created: nowIso(), updated: nowIso(), model: '', messages: [] };
  const S = { model: defaultChatModel(), run: null, streaming: false, saved: false, pictureUrls: new Map() };

  // ---------- layout ----------
  const modelBtn = h('button', { type: 'button', class: 'chat-model', 'aria-label': 'Chat model', onclick: () => pickModel() });
  const list = h('div', { class: 'chat-list', 'aria-live': 'polite' });
  const status = h('p', { class: 'chat-status', role: 'status' });
  const cmds = h('div', { class: 'chat-cmds hidden', role: 'listbox', 'aria-label': 'Chat commands' });
  const input = h('textarea', { class: 'chat-input', rows: '1', 'aria-label': 'Message', placeholder: 'Message · / for commands', enterkeyhint: 'send' });
  varHints(input, ai.VARIABLES.filter(([n]) => n !== 'user_input'));   // {{ shows the document's variables
  const sendBtn = h('button', { type: 'button', class: 'chat-send', 'aria-label': 'Send', onclick: () => send() }, icon('send'));
  const stopBtn = h('button', { type: 'button', class: 'chat-send stop hidden', 'aria-label': 'Stop', onclick: () => S.run?.stop() }, icon('stop'));
  const insertPop = h('button', { type: 'button', class: 'chat-insert-pop hidden', onmousedown: (e) => e.preventDefault(), onclick: () => insertSelection() }, icon('insert'), 'Insert in doc');
  const el = h('div', { class: 'chat-screen', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Chat' },
    h('header', { class: 'bar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close chat', onclick: () => close() }, icon('close')),
      h('h1', {}, 'Chat'), modelBtn),
    list,
    h('footer', { class: 'chat-foot' }, cmds, status, h('div', { class: 'chat-row' }, input, sendBtn, stopBtn)));
  document.body.append(el, insertPop);
  document.body.classList.add('chat-on');
  const layer = pushLayer((reason) => close(reason));
  openNow = { close };
  paintModel();
  draw();
  if (opts.picture) { input.value = '/image '; setStatus('Describe the picture after /image, then send.'); }
  else setStatus(ctx.rel ? 'A new chat. The document stays open below; /insert and /append put the chat in it.' : 'A new chat.');
  setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 80);

  function setStatus(t, note) { status.textContent = t || ''; status.classList.toggle('note', !!note); }
  function paintModel() { modelBtn.replaceChildren(h('span', {}, S.model.split('/').pop()), icon('down', 'ic tiny')); }

  // ---------- drawing ----------
  function bodyOf(m) {
    const b = h('div', { class: 'chat-body' });
    try { b.replaceChildren(...markdownToElement(m.content || '').childNodes); } catch (e) { b.textContent = m.content; }
    return b;
  }
  function pictureUrl(m) {
    if (!S.pictureUrls.has(m)) S.pictureUrls.set(m, URL.createObjectURL(m.picture.blob));
    return S.pictureUrls.get(m);
  }
  function bubble(m, i) {
    const last = i === chat.messages.length - 1;
    if (m.picture) {
      return h('article', { class: 'chat-msg assistant' },
        h('div', { class: 'chat-meta' }, `${m.model || 'Picture'}${m.cost != null ? ' · ' + ai.money(m.cost) : ''}`),
        h('img', { class: 'chat-picture', src: pictureUrl(m), alt: m.picture.description }),
        h('div', { class: 'chat-actions' },
          button('Insert in doc', () => insertPicture(m, false), 'small'),
          last && !S.streaming ? button('Make again', () => makePicture(m.picture.description), 'small ghost') : null,
          !S.streaming ? button('Reject', () => rejectPicture(m), 'small ghost') : null));
    }
    return h('article', { class: `chat-msg ${m.role}` },
      h('div', { class: 'chat-meta' }, m.role === 'user' ? 'Me' : `${m.model || 'AI'}${m.cost != null ? ' · ' + ai.money(m.cost) : ''}${m.stopped ? ' · stopped' : ''}`),
      m.role === 'assistant' && m.waiting ? h('div', { class: 'chat-body muted' }, m.content || 'Writing…') : bodyOf(m));
  }
  function draw() {
    list.replaceChildren(...(chat.messages.length ? chat.messages.map(bubble)
      : [h('div', { class: 'chat-empty' }, h('b', {}, 'Ask anything.'), h('span', {}, '{{before}}, {{after}} and {{selected_text}} bring in text from the document. / lists the commands.'))]));
    list.scrollTop = list.scrollHeight;
  }

  // ---------- commands (the / list) ----------
  function showCmds() {
    const t = input.value;
    if (!t.startsWith('/') || t.includes('\n') || S.streaming) { cmds.classList.add('hidden'); return; }
    const q = t.toLowerCase();
    const items = COMMANDS.filter((c) => c.cmd.startsWith(q) || (q.length > 1 && c.cmd.includes(q.trim())));
    if (!items.length) { cmds.classList.add('hidden'); return; }
    cmds.replaceChildren(...items.map((c) => h('button', { type: 'button', role: 'option', onmousedown: (e) => e.preventDefault(), onclick: () => {
      input.value = c.cmd;
      if (c.cmd.endsWith(' ')) { showCmds(); input.focus(); return; }
      if (c.number) {   // owner: the number can be changed before it runs; it is selected, so typing replaces it
        cmds.classList.add('hidden');
        input.focus();
        input.setSelectionRange(c.cmd.length - 1, c.cmd.length);
        setStatus('How many turns (a question and its answer)? Change the number, then send.');
        return;
      }
      send();
    } }, h('b', {}, c.cmd.trim()), h('small', {}, c.hint))));
    cmds.classList.remove('hidden');
  }
  input.addEventListener('input', () => { grow(); showCmds(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(); } });
  function grow() { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; }

  // ---------- sending ----------
  async function send() {
    const text = input.value.trim();
    if (!text || S.streaming) return;
    cmds.classList.add('hidden');
    let m;
    if (/^\/close$/i.test(text)) { input.value = ''; close(); return; }
    if ((m = /^\/(insert|append)\s+(image|picture)$/i.exec(text))) { input.value = ''; grow(); lastPicture(m[1].toLowerCase() === 'append'); return; }
    if ((m = /^\/(insert|append)(?:\s+(\d+))?$/i.exec(text))) { input.value = ''; grow(); putChat(m[1].toLowerCase() === 'append', m[2] ? parseInt(m[2], 10) : null); return; }
    if ((m = /^\/(?:image|picture)\b\s*([\s\S]*)$/i.exec(text))) {
      const desc = m[1].trim();
      if (!desc) { setStatus('Type what you want to see after /image, then send.', true); input.value = '/image '; input.focus(); return; }
      input.value = ''; grow();
      chat.messages.push({ role: 'user', content: `/image ${desc}`, time: new Date().toISOString() });
      draw();
      await makePicture(desc);
      return;
    }
    if (!getKey()) { toast('Add your OpenRouter key first: Settings → OpenRouter key.', 'error'); return; }
    // {{before}}, {{after}}, {{selected_text}}, {{selected_documents}}: the document as it is now, kept with the message
    const vars = {};
    if (ed && /\{\{\s*(before|after|selected_text|selected_documents)\s*\}\}/.test(text)) {
      const ba = ed.getBeforeAfter();
      if (/\{\{\s*before\s*\}\}/.test(text)) vars.before = ba.before;
      if (/\{\{\s*after\s*\}\}/.test(text)) vars.after = ba.after;
      if (/\{\{\s*selected_text\s*\}\}/.test(text)) vars.selected_text = ed.getSelectedMarkdown();
      if (/\{\{\s*selected_documents\s*\}\}/.test(text)) {
        vars.selected_documents = ai.documentsBlock(selectedDocs(ctx.pid).map((r) => ({ name: r.replace(/\.(md|txt)$/i, ''), text: r === ctx.rel ? ctx.currentText() : (fs.read(`${ctx.pid}/${r}`) || '') })));
      }
      if (ctx.rel) vars.document = ctx.rel;
    }
    input.value = ''; grow();
    const user = { role: 'user', content: text, time: new Date().toISOString(), ...(Object.keys(vars).length ? { vars } : {}) };
    chat.messages.push(user);
    await reply();
  }

  /** The messages sent to the model: the last few turns (text only), each user message with its {{variables}} filled. */
  function apiMessages() {
    const msgs = chat.messages.filter((x) => !x.picture && !(x.role === 'user' && /^\/image\b/.test(x.content)) && !x.waiting);
    const users = msgs.map((x, i) => (x.role === 'user' ? i : -1)).filter((i) => i >= 0);
    const from = users.length > CONTEXT_TURNS + 1 ? users[users.length - CONTEXT_TURNS - 1] : 0;
    return msgs.slice(from).map((x) => ({ role: x.role, content: x.role === 'user' && x.vars ? ai.fill(x.content, x.vars) : x.content }));
  }

  async function reply() {
    const model = S.model;
    const info = await ai.infoFor(model);
    const messages = apiMessages();
    const est = ai.estimate(messages, info, null);
    if (est.tooLong) { setStatus(`The chat is too long for ${model}. Start a new chat or pick a model with a longer context.`, true); chat.messages.pop(); draw(); return; }
    const r = { role: 'assistant', content: '', time: new Date().toISOString(), model, waiting: true };
    chat.messages.push(r);
    busy(true);
    draw();
    setStatus(est.known ? `Writing… (at most ${ai.money(est.max)})` : 'Writing…');
    let error = null;
    let paintT = 0;
    S.run = ai.startRun({ model, messages }, info, (ev) => {
      if (ev.type === 'delta') {
        r.content += ev.text;
        if (!paintT) paintT = setTimeout(() => { paintT = 0; r.waiting = false; draw(); }, 120);
      } else if (ev.type === 'thinking') { if (!r.content) setStatus('Thinking…'); }
      else if (ev.type === 'provider') { r.provider = ev.provider; if (ev.billing_stops === false) setStatus(`Writing… (${ev.provider} bills the whole reply even after Stop)`); }
      else if (ev.type === 'error') error = ev.message;
      else if (ev.type === 'done') {
        clearTimeout(paintT); paintT = 0;
        r.waiting = false;
        r.cost = ev.cost ?? null;
        if (ev.stopped) r.stopped = true;
        const bits = [ev.cost != null ? `Cost: ${ai.money(ev.cost)}` : 'Cost: not known yet'];
        if (ev.stopped) bits.push('stopped');
        if (ev.finish_reason === 'length') bits.push('cut off at the maximum length');
        setStatus(error ? `${error} Nothing was retried.` : bits.join(' · '), !!error);
      }
    });
    await S.run.done;
    S.run = null;
    if (!r.content.trim()) chat.messages.pop();   // nothing came back: keep the question, drop the empty reply
    delete r.waiting;
    busy(false);
    draw();
    await save();
  }

  function busy(on) {
    S.streaming = on;
    sendBtn.classList.toggle('hidden', on);
    stopBtn.classList.toggle('hidden', !on);
  }

  // ---------- pictures ----------
  function projectStyle() {
    if (!ctx.pid) return '';
    try { return String(JSON.parse(fs.read(`${ctx.pid}/.kalamo/pictures.json`) || '{}').text || '').trim(); } catch (e) { return ''; }
  }
  async function makePicture(description) {
    if (S.streaming) return;
    if (!getKey()) { toast('Add your OpenRouter key first: Settings → OpenRouter key.', 'error'); return; }
    const model = pictureModel();
    const info = await ai.infoFor(model);
    const style = projectStyle();
    const est = info?.picture_price != null ? info.picture_price * 1120 + (info.prompt_price || 0) * 300 : null;
    const r = { role: 'assistant', content: 'A picture: ' + description, time: new Date().toISOString(), model, waiting: true };
    chat.messages.push(r);
    busy(true);
    draw();
    list.lastElementChild?.querySelector('.chat-body')?.replaceChildren('Drawing…');
    setStatus(`Making a picture with ${info?.name || model}${est != null ? ` (about ${ai.money(est)})` : ''}${style ? ", in this project's picture style" : ''}…`);
    const got = { pics: [], done: null, error: null };
    S.run = ai.startRun({ model, messages: [{ role: 'user', content: [{ type: 'text', text: description + (style ? `\n\nStyle: ${style}` : '') }] }],
      extra: { modalities: ['image', 'text'], image_config: { aspect_ratio: '1:1' } } }, info, (ev) => {
      if (ev.type === 'image') got.pics.push(ev);
      else if (ev.type === 'error') got.error = ev.message;
      else if (ev.type === 'done') got.done = ev;
    });
    await S.run.done;
    S.run = null;
    busy(false);
    delete r.waiting;
    const cost = got.done?.cost ?? null;
    r.cost = cost;
    if (got.pics.length) {
      r.picture = { blob: got.pics[0].blob, mime: got.pics[0].mime, description };
      setStatus(`Done. Cost: ${cost != null ? ai.money(cost) : 'not reported'}. /insert image or /append image puts it in the document.`);
    } else {
      chat.messages.pop();
      setStatus((got.done?.stopped ? 'Stopped. ' : got.error ? `No picture: ${got.error} ` : 'The model sent no picture (it may have refused the description). ') +
        `Cost: ${cost != null ? ai.money(cost) : 'not reported'}. Nothing was retried.`, true);
    }
    draw();
    await save();
  }
  function rejectPicture(m) {
    const i = chat.messages.indexOf(m);
    if (i < 0) return;
    chat.messages.splice(i, 1);
    if (S.pictureUrls.has(m)) { URL.revokeObjectURL(S.pictureUrls.get(m)); S.pictureUrls.delete(m); }
    setStatus('Picture rejected. /insert image now uses the picture before it (if there is one).');
    draw();
    save();
  }
  async function pictureMarkdown(m) {
    if (!ctx.pid) throw new Error('Open a document in a project first.');
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[m.picture.mime] || 'png';
    const nameHint = m.picture.description.split(/\s+/).slice(0, 6).join(' ') + '.' + ext;
    const saved = await savePicture(ctx.pid, ctx.rel, m.picture.blob, nameHint);
    m.picture.inDoc = saved.path;
    const alt = m.picture.description.slice(0, 120).replace(/[[\]\\]/g, '');
    return { md: `![${alt}](${saved.src})`, saved };
  }
  async function insertPicture(m, atEnd) {
    if (!ed || !ctx.rel) { toast('Open a document first.', 'error'); return; }
    try {
      const { md, saved } = await pictureMarkdown(m);
      putInDocument(ed, md, atEnd);
      ctx.changed();
      toast(`${atEnd ? 'Added at the end' : 'Inserted at the cursor'} (saved as ${saved.path}).`);
    } catch (e) { toast(e.message, 'error'); }
  }
  function lastPicture(atEnd) {
    const m = [...chat.messages].reverse().find((x) => x.picture);
    if (!m) { setStatus('There is no picture in this chat yet. Make one with /image and a description.', true); return; }
    insertPicture(m, atEnd);
  }

  // ---------- the chat into the document ----------
  const BLOCK_START = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|!\[)/;
  const labelled = (who, text) => (BLOCK_START.test(text) ? `**${who}:**\n\n${text}` : `**${who}:** ${text}`);
  async function putChat(atEnd, n) {
    if (!ed || !ctx.rel) { toast('Open a document first.', 'error'); return; }
    const users = chat.messages.map((x, i) => (x.role === 'user' ? i : -1)).filter((i) => i >= 0);
    if (!users.length) { setStatus('Nothing to put in the document yet: the chat is empty.', true); return; }
    const from = n && n < users.length ? users[users.length - n] : 0;
    const parts = [];
    try {
      for (const m of chat.messages.slice(from)) {
        if (m.waiting) continue;
        if (m.picture) { parts.push(labelled('AI', (await pictureMarkdown(m)).md)); continue; }
        parts.push(labelled(m.role === 'user' ? 'Me' : 'AI', m.content.trim()));
      }
    } catch (e) { toast(e.message, 'error'); return; }
    putInDocument(ed, parts.join('\n\n'), atEnd);
    ctx.changed();
    const turns = n && n < users.length ? n : users.length;
    toast(`${turns === users.length ? 'The whole chat' : `The last ${turns} turn${turns === 1 ? '' : 's'}`} ${atEnd ? 'added at the end of' : 'inserted at the cursor in'} the document.`);
  }

  // ---------- select text in the chat → Insert in doc ----------
  function chatSelection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!list.contains(r.commonAncestorContainer)) return null;
    const text = sel.toString().trim();
    return text ? { text, rect: r.getBoundingClientRect() } : null;
  }
  function onSelection() {
    const s = chatSelection();
    if (!s) { insertPop.classList.add('hidden'); return; }
    insertPop.classList.remove('hidden');
    const w = insertPop.offsetWidth || 150;
    const top = Math.min(innerHeight - 60, s.rect.bottom + 12);
    insertPop.style.top = `${top}px`;
    insertPop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, (s.rect.left + s.rect.right) / 2 - w / 2))}px`;
  }
  document.addEventListener('selectionchange', onSelection);
  function insertSelection() {
    const s = chatSelection();
    if (!s) return;
    if (!ed || !ctx.rel) { toast('Open a document first.', 'error'); return; }
    putInDocument(ed, s.text, false);
    ctx.changed();
    getSelection().removeAllRanges();
    insertPop.classList.add('hidden');
    toast('Inserted in the document. The chat stays open.');
  }

  // ---------- the model ----------
  function pickModel() {
    // the collections open and close; the search finds any other OpenRouter model (text models only)
    choose({ title: 'Chat model', current: S.model, onPick: setModel, filter: (m) => m.text_only !== false });
  }
  async function setModel(id) { S.model = id; await kvSet('chat_model', id); paintModel(); toast(`Chat model: ${id}`); }

  // ---------- saving (the desktop's format) ----------
  async function save() {
    const msgs = chat.messages.filter((m) => !m.waiting);
    if (!msgs.length) return;
    const out = [];
    for (const m of msgs) {
      const item = { role: m.role, content: m.content, time: m.time };
      if (m.model) item.model = m.model;
      if (m.cost != null) item.cost = m.cost;
      if (m.provider) item.provider = m.provider;
      if (m.vars) item.vars = m.vars;
      if (m.picture) {
        if (!m.picture.file) {
          const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[m.picture.mime] || 'png';
          m.picture.file = `${stampId()}-${hex(6)}.${ext}`;
          await fs.write(`.kalamo/chats/pictures/${m.picture.file}`, { blob: m.picture.blob, mime: m.picture.mime });
        }
        item.picture = { file: m.picture.file, mime: m.picture.mime, description: m.picture.description.slice(0, 8000) };
      }
      out.push(item);
    }
    const first = out.find((m) => m.role === 'user');
    chat.title = (first ? first.content : 'Chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Chat';
    chat.updated = nowIso();
    chat.model = S.model;
    try {
      await fs.write(`.kalamo/chats/${chat.id}.md`, chatToMarkdown({ ...chat, messages: out }));
      S.saved = true;
      requestSync();
    } catch (e) { toast(`The chat could not be saved: ${e.message}`, 'error'); }
  }

  // ---------- closing ----------
  function close(reason) {
    if (!openNow) return;
    if (S.run) S.run.stop();
    openNow = null;
    if (reason !== 'back') popLayer(layer);
    document.removeEventListener('selectionchange', onSelection);
    document.body.classList.remove('chat-on');
    el.remove(); insertPop.remove();
    for (const u of S.pictureUrls.values()) URL.revokeObjectURL(u);
    if (chat.messages.length) save();
    if (opts.onClose) opts.onClose();
  }
}

export function closeChat() { if (openNow) openNow.close(); }

// ---------- the project's picture style (kalamo/picturegen.py STYLES; .kalamo/pictures.json, shared with the desktop) ----------
const STYLES = [
  ['watercolour', 'Watercolour', 'Soft watercolour painting on textured paper, gentle washes, muted colours, visible brush edges.'],
  ['pencil', 'Pencil sketch', 'Graphite pencil sketch on cream paper, fine hatching and shading, no colour.'],
  ['ink', 'Ink and wash', 'Pen-and-ink drawing with grey ink washes, confident lines, a little loose and sketchy.'],
  ['oil', 'Oil painting', 'Classic oil painting, rich colours, visible brushstrokes, soft natural light.'],
  ['photo', 'Photo', 'Realistic photograph, natural light, shallow depth of field, true-to-life colours.'],
  ['digital', 'Digital painting', 'Detailed digital painting, cinematic lighting, rich atmosphere, book-illustration quality.'],
  ['comic', 'Comic / graphic novel', 'Graphic-novel illustration, bold ink outlines, flat colours with simple shading.'],
  ['children', "Children's book", "Warm children's picture-book illustration, rounded shapes, bright friendly colours, simple backgrounds."],
  ['diagram', 'Flat diagram', 'Clean flat vector diagram, simple shapes, clear labels, white background, a few calm colours.'],
  ['map', 'Old map', 'Hand-drawn old map on aged parchment, ink lines, small labels, compass rose, muted earth colours.'],
];
export function pictureStyleSheet(pid) {
  const path = `${pid}/.kalamo/pictures.json`;
  let cur = {};
  try { cur = JSON.parse(fs.read(path) || '{}'); } catch (e) { cur = {}; }
  const text = h('textarea', { class: 'field-input', rows: '3', style: { minHeight: '90px' }, 'aria-label': 'Style description', placeholder: 'No style: the picture model decides.' });
  text.value = String(cur.text || '');
  let preset = STYLES.some(([k]) => k === cur.preset) || cur.preset === 'own' ? cur.preset : '';
  const chips = h('div', { class: 'chips' });
  const paint = () => chips.replaceChildren(
    h('button', { type: 'button', class: `chip${!preset ? ' on' : ''}`, onclick: () => { preset = ''; text.value = ''; paint(); } }, 'None'),
    ...STYLES.map(([k, name, t]) => h('button', { type: 'button', class: `chip${preset === k ? ' on' : ''}`, onclick: () => { preset = k; text.value = t; paint(); } }, name)));
  text.addEventListener('input', () => { preset = text.value.trim() ? 'own' : ''; paint(); });
  paint();
  const s = sheet({
    title: 'Picture style',
    body: h('div', {}, h('p', { class: 'muted small' }, 'Every picture made in this project (/image) uses this style. The desktop uses the same setting.'), chips,
      h('label', { class: 'field-label' }, 'Style description'), text),
    actions: [button('Cancel', () => s.close('done'), 'ghost'), button('Save', async () => {
      const t = text.value.replace(/\s+/g, ' ').trim().slice(0, 1000);
      try {
        await fs.write(path, JSON.stringify({ preset: t ? preset || 'own' : '', text: t }, null, 2));
        requestSync();
        toast(t ? 'Picture style saved.' : 'No picture style: the picture model decides.');
        s.close('done');
      } catch (e) { toast(e.message, 'error'); }
    }, 'primary')],
  });
}
