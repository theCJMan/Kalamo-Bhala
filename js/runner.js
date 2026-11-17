// Running a prompt from the writing screen: the reply streams into a sheet, never straight into the document.
// Insert puts it at the cursor (or in place of the selection for prompts that work on the selection); Discard and
// Back throw it away only after asking once a reply is there. Stop aborts the request at once.
import { h, icon, sheet, button, toast, confirmSheet, varHints } from './util.js';
import * as ai from './ai.js';
import * as fs from './vfs.js';
import { getKey } from './settings.js';
import { markdownToElement } from '../vendor/kalamo-editor.js';

/** Ask for {{user_input}}: a few lines of text. */
function askInput(p) {
  return new Promise((resolve) => {
    const ta = h('textarea', { class: 'field-input', rows: '4', style: { minHeight: '120px', resize: 'vertical' }, 'aria-label': 'Your input', placeholder: 'What should the model do?' });
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); s.close('done'); };
    const s = sheet({ title: p.name, body: h('div', {}, h('p', { class: 'muted small' }, 'Your input for this prompt:'), ta),
      onClose: () => { if (!done) { done = true; resolve(null); } },
      actions: [button('Cancel', () => finish(null), 'ghost'), button('Run', () => finish(ta.value), 'primary')] });
    varHints(ta, ai.VARIABLES.filter(([n]) => n !== 'user_input'));   // your input may use the document's text too
    setTimeout(() => ta.focus(), 80);
  });
}

/** The documents switched on for AI in the project (the desktop's binder switches, .kalamo/toggles.json). */
export function selectedDocs(pid) {
  let files = [];
  try { files = JSON.parse(fs.read(`${pid}/.kalamo/toggles.json`) || '{}').files || []; } catch (e) { files = []; }
  return files.filter((r) => fs.get(`${pid}/${r}`)?.kind === 'file');
}
export async function setSelected(pid, rel, on) {
  const s = new Set(selectedDocs(pid));
  if (on) s.add(rel); else s.delete(rel);
  await fs.write(`${pid}/.kalamo/toggles.json`, JSON.stringify({ files: [...s].sort() }, null, 2));
}

let busy = false;
/**
 * ctx: { pid, rel, editor, currentText() }
 * Runs `p` on the open document. Resolves when the sheet is closed.
 */
export async function runPrompt(ctx, p) {
  if (busy) return;
  if (!getKey()) { toast('Add your OpenRouter key first: Settings → OpenRouter.', 'error'); return; }
  const st = ai.runSettings(p);
  let userInput = '';
  if (ai.usesVar(p, 'user_input')) { userInput = await askInput(p); if (userInput == null) return; }
  const ed = ctx.editor;
  const { before, after } = ed.getBeforeAfter();
  const selected = ed.getSelectedMarkdown();
  const replaces = ai.usesVar(p, 'selected_text') && !!selected;
  const docs = [];
  for (const r of selectedDocs(ctx.pid)) {
    docs.push({ name: r.replace(/\.(md|txt)$/i, ''), text: r === ctx.rel ? ctx.currentText() : (fs.read(`${ctx.pid}/${r}`) || '') });
  }
  const messages = ai.buildMessages(p, { before, after, selected_text: selected, selected_documents: ai.documentsBlock(docs), user_input: userInput });
  const info = st.info?.prompt_price != null ? st.info : await ai.infoFor(st.model);
  const est = ai.estimate(messages, info, st.max_tokens);
  if (est.tooLong) { toast(`The prompt is too long for ${st.model} (about ${est.promptTokens.toLocaleString('en')} tokens). Switch off some documents or pick a model with a longer context.`, 'error'); return; }

  busy = true;
  let reply = '', finished = false, run = null, closing = false;
  const textEl = h('div', { class: 'reply-text waiting', 'aria-live': 'polite' });
  const provEl = h('span', {});
  const warnEl = h('p', { class: 'reply-warn hidden' });
  const costEl = h('p', { class: 'reply-cost' }, est.known ? `Estimated: up to ${ai.money(est.max)}` : 'Price unknown for this model: the cost is shown after the reply.');
  const meta = h('div', { class: 'reply-meta' }, h('b', {}, p.name), h('span', {}, st.model), provEl);
  const stopBtn = button([icon('stop'), 'Stop'], () => { if (run) run.stop(); }, 'danger');
  const discardBtn = button('Discard', () => close(), 'ghost');
  const copyBtn = button('Copy', async () => { try { await navigator.clipboard.writeText(reply); toast('Copied.'); } catch (e) { toast('Could not copy.', 'error'); } }, 'ghost');
  const insertBtn = button(replaces ? 'Replace' : 'Insert', () => {
    if (!reply.trim()) return;
    ed.insertMarkdown(reply);
    finished = true;
    close(true);
    setTimeout(() => ed.focus(), 250);   // back to writing, right after the inserted text
    toast(replaces ? 'Replaced. Undo with the keyboard if needed.' : 'Inserted.');
  }, 'primary');
  [discardBtn, copyBtn, insertBtn].forEach((b) => b.classList.add('hidden'));

  const s = sheet({ title: '', cls: 'reply', body: h('div', {}, meta, textEl, warnEl, costEl),
    actions: [stopBtn, discardBtn, copyBtn, insertBtn],
    guard: () => { if (finished || !reply.trim()) return true; close(); return false; },
    onClose: () => { if (run && !finished) run.stop(); busy = false; } });
  // Back or the shade: ask before throwing a finished reply away
  async function close(force) {
    if (closing) return;
    if (!force && reply.trim() && !finished) {
      closing = true;
      const ok = await confirmSheet('Discard this reply?', 'The reply is not in your document. It cannot be brought back.', { ok: 'Discard', danger: true });
      closing = false;
      if (!ok) return;
    }
    finished = true;
    s.close('done');
  }

  // the reply as it will look in the document (the editor's own Markdown reader: text only, nothing runs)
  let paintT = 0;
  function paint(now) {
    if (!now && paintT) return;
    paintT = setTimeout(() => {
      paintT = 0;
      try { textEl.replaceChildren(...markdownToElement(reply).childNodes); } catch (e) { textEl.textContent = reply; }
    }, now ? 0 : 120);
  }
  run = ai.startRun({ model: st.model, messages, temperature: st.temperature, max_tokens: st.max_tokens, reasoning_effort: st.reasoning_effort, use_thinking: st.use_thinking }, info, (ev) => {
    if (ev.type === 'delta') { reply += ev.text; paint(); }
    else if (ev.type === 'thinking') { if (!reply) textEl.textContent = 'Thinking…'; }
    else if (ev.type === 'provider') {
      provEl.textContent = `via ${ev.provider}`;
      if (ev.billing_stops === false) { warnEl.textContent = `${ev.provider} bills the whole reply even if you press Stop.`; warnEl.classList.remove('hidden'); }
    } else if (ev.type === 'error') {
      warnEl.textContent = ev.message; warnEl.classList.remove('hidden');
    } else if (ev.type === 'done') {
      textEl.classList.remove('waiting');
      if (reply) { clearTimeout(paintT); paintT = 0; paint(true); }
      if (!reply && !warnEl.textContent) textEl.textContent = '(The model sent no text.)';
      const bits = [];
      bits.push(ev.cost != null ? `Cost: ${ai.money(ev.cost)}` : 'Cost: not known yet (see your OpenRouter activity)');
      if (ev.stopped) bits.push('stopped');
      if (ev.finish_reason === 'length') bits.push('cut off at the maximum length');
      if (ev.seconds != null) bits.push(`${ev.seconds} s`);
      costEl.textContent = bits.join(' · ');
      stopBtn.classList.add('hidden');
      discardBtn.classList.remove('hidden');
      if (reply.trim()) { copyBtn.classList.remove('hidden'); insertBtn.classList.remove('hidden'); }
    }
  });
  await run.done;
}

/** A sheet listing prompts (for the selection bar's ✦ AI). */
export function pickPrompt(title, prompts, onPick) {
  const s = sheet({
    title,
    body: h('div', { class: 'action-list' }, prompts.length ? prompts.map((p) => h('button', { type: 'button', class: 'action', onclick: () => { s.close('done'); onPick(p); } },
      icon('spark'), h('span', { style: { flex: '1' } }, p.name, h('small', { class: 'muted', style: { display: 'block', fontSize: '.75rem' } }, ai.runSettings(p).model))))
      : h('p', { class: 'muted' }, 'No prompts yet. Add one in Settings → Prompts.')),
  });
}
