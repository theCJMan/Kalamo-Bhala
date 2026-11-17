// Settings: storage (phone / Google Drive), the OpenRouter key, prompts, model collections, look, updates.
// Prompts and collections are the library's own (.kalamo/ai): edited here, they change on the desktop too.
import { h, icon, toast, ask, sheet, button, confirmSheet, go, setLeave, varHints } from './util.js';
import * as ai from './ai.js';
import * as drive from './drive.js';
import * as sync from './sync.js';
import { CONFIG } from './config.js';
import { kvSet, kvGet, storageMode, driveFolder, getKey, setKey, clearKey, keyHow, theme, textSize, applyLook, googleClientId, importModel, pictureModel, IMPORT_MODEL, PICTURE_MODEL } from './settings.js';
import { startSignIn } from './oauth.js';
import { chooseDriveFolder, useDriveFolder } from './setup.js';
import { checkForUpdate } from './update.js';
import { pickModel } from './modelpick.js';

function page(root, titleText, back, ...content) {
  root.replaceChildren(h('div', { class: 'screen' },
    h('header', { class: 'bar' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back', onclick: () => go(back) }, icon('back')), h('h1', {}, titleText)),
    h('main', { class: 'content' }, ...content)));
}
// Prompts and collections save by themselves (owner: no Save buttons): a moment after typing stops, when a field is
// left or a choice changes, and when the page is left (the Back arrow or the phone's Back). A line under the title
// says Saved, or what is missing (then nothing is saved until it is fixed). Lists wait for the last save.
let saving = Promise.resolve();
function autosave(run, line) {
  let timer = 0, pending = false;
  const now = () => {
    clearTimeout(timer);
    if (!pending) return saving;
    pending = false;
    saving = saving.then(async () => {
      try { await run(); line.textContent = 'Saved.'; line.classList.remove('bad'); }
      catch (e) { line.textContent = `Not saved: ${e.message}`; line.classList.add('bad'); }
    });
    return saving;
  };
  const soon = () => { pending = true; clearTimeout(timer); timer = setTimeout(now, 700); };
  const watch = (...els) => els.forEach((el) => {
    el.addEventListener('input', soon);
    el.addEventListener('change', () => { soon(); now(); });
    el.addEventListener('blur', now);
  });
  setLeave(now);
  return { soon, now, watch };
}
const saveLine = (text) => h('p', { class: 'save-line', role: 'status', 'aria-live': 'polite' }, text);

const item = (label, sub, onclick, right) => h('button', { type: 'button', class: 'item', onclick },
  h('div', { class: 't' }, h('b', {}, label), sub ? h('span', {}, sub) : null), right === undefined ? icon('chevron') : right);
const seg = (options, value, onPick) => {
  const el = h('div', { class: 'seg', role: 'radiogroup' });
  const paint = (v) => el.replaceChildren(...options.map(([k, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === v), class: k === v ? 'on' : '', onclick: () => { onPick(k); paint(k); } }, label)));
  paint(value);
  return el;
};

// The prompt library could not be loaded: say why on the page (it used to stay on Settings without a word).
async function libraryOrSay(root) {
  try { await ai.loadLibrary(); return true; } catch (e) {
    page(root, 'Prompts', '#/settings', h('div', { class: 'empty' }, h('b', {}, 'The prompts could not be loaded'), h('p', { class: 'muted small' }, e.message)));
    return false;
  }
}

// ---------- the main settings page ----------
export function mountSettings(root) {
  const mode = storageMode();
  const f = driveFolder();
  const st = sync.getStatus();
  const storage = h('div', { class: 'list' },
    item('Storage', mode === 'drive' ? `Google Drive · ${f?.path || f?.name || ''}` : 'On this phone', () => storageSheet()),
    ...(mode === 'drive' ? [
      item('Sync now', drive.signedIn() ? (st.last ? `Last sync ${new Date(st.last).toLocaleTimeString()}${st.message ? ' · ' + st.message : ''}` : 'Not synced yet') : 'Signed out of Google: tap to sign in', async () => {
        try { if (!drive.signedIn()) await drive.signIn(); } catch (e) { toast(e.message, 'error'); return; }
        await sync.syncNow();
        const s = sync.getStatus();
        toast(s.state === 'done' ? 'Synced.' : s.message || s.state, s.state === 'done' ? '' : 'error');
        mountSettings(root);
      }, icon('sync')),
      item('Google account', drive.account() || (drive.signedIn() ? 'Signed in' : 'Not signed in'), async () => {
        if (drive.signedIn()) {
          if (await confirmSheet('Sign out of Google?', 'Your writing stays on this phone. Changes go up again after you sign in.', { ok: 'Sign out' })) { await drive.signOut(); mountSettings(root); }
        } else { try { await drive.signIn(); mountSettings(root); } catch (e) { toast(e.message, 'error'); } }
      }, null),
    ] : []));
  const k = getKey();
  const key = h('div', { class: 'list' }, item('OpenRouter key', k ? `${keyHow() === 'signed-in' ? 'Signed in' : 'Pasted'} · …${k.slice(-4)}` : 'No key yet', () => keySheet(root)));
  const lib = h('div', { class: 'list' },
    item('Prompts', 'The prompts in your / list and ✦ AI', () => go('#/settings/prompts')),
    item('Model collections', 'Which models your prompts use', () => go('#/settings/collections')),
    item('Reading photos and scans', importModel(), () => modelSetting(root, 'import_model', 'Reading photos and scans', IMPORT_MODEL,
      'The model that writes out photos of notes and PDF pages without text. Only models that read pictures are offered.', (m) => m.reads_pictures)),
    item('Picture model', pictureModel(), () => modelSetting(root, 'picture_model', 'Picture model', PICTURE_MODEL,
      'The model that makes pictures with /image (Nano Banana 2 by default, as on the desktop). Only models that make pictures are offered.', (m) => m.makes_pictures)));
  const look = h('div', {},
    h('label', { class: 'field-label' }, 'Theme'),
    seg([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], theme(), async (v) => { await kvSet('theme', v); applyLook(); }),
    h('label', { class: 'field-label' }, 'Text size'),
    seg([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], textSize(), async (v) => { await kvSet('text_size', v); applyLook(); }));
  const upd = h('div', { class: 'list' }, item('Check for updates', `Version ${CONFIG.VERSION}`, () => checkForUpdate(true), icon('sync')));
  page(root, 'Settings', '#/',
    h('p', { class: 'group' }, 'Library'), storage,
    h('p', { class: 'group' }, 'AI'), key, h('div', { style: { height: '10px' } }), lib,
    h('p', { class: 'group' }, 'Look'), look,
    h('p', { class: 'group' }, 'App'), upd,
    h('p', { class: 'note', style: { marginTop: '18px' } }, 'Kalamo Bhala mobile. Your writing is plain Markdown files, the same as on the desktop. The OpenRouter key and Google sign-in stay on this phone.'));

  function storageSheet() {
    const s = sheet({
      title: 'Storage',
      body: h('div', {},
        h('button', { type: 'button', class: `choice${mode === 'phone' ? ' picked' : ''}`, onclick: async () => {
          if (mode === 'phone') { s.close('done'); return; }
          const ok = await confirmSheet('Keep the library on this phone only?', 'The phone keeps its copy of every project it has. Nothing is deleted from Google Drive; changes stop going there.', { ok: 'Phone only' });
          if (!ok) return;
          await kvSet('storage', 'phone'); s.close('done'); mountSettings(root);
        } }, icon('phone'), h('div', {}, h('b', {}, 'On this phone'), h('span', {}, 'Private to this phone.'))),
        h('button', { type: 'button', class: `choice${mode === 'drive' ? ' picked' : ''}`, onclick: async () => {
          try {
            if (!drive.signedIn()) await drive.signIn();
            const nf = await chooseDriveFolder();
            if (!nf) return;
            s.close('done');
            await useDriveFolder(nf);
            mountSettings(root);
          } catch (e) { toast(e.message, 'error'); }
        } }, icon('cloud'), h('div', {}, h('b', {}, mode === 'drive' ? 'Google Drive: choose another folder' : 'Google Drive'), h('span', {}, 'Shared with your desktop. What is on this phone is added to the folder; nothing is deleted.'))),
        h('label', { class: 'field-label' }, 'Google client ID'),
        h('input', { class: 'field-input', type: 'text', value: kvGet('google_client_id', ''), placeholder: CONFIG.GOOGLE_CLIENT_ID || '…apps.googleusercontent.com', 'aria-label': 'Google client ID', autocomplete: 'off',
          onchange: (e) => kvSet('google_client_id', e.target.value.trim()) }),
        h('p', { class: 'note' }, googleClientId() ? 'Set.' : 'Needed once for Google Drive (see the set-up steps).')),
    });
  }
}

function keySheet(root) {
  const k = getKey();
  const s = sheet({
    title: 'OpenRouter key',
    body: h('div', {}, h('p', { class: 'muted' }, k ? 'A key is saved on this phone.' : 'Prompts need an OpenRouter key. It stays on this phone.')),
    actions: [
      ...(k ? [button('Remove', async () => { if (await confirmSheet('Remove the key?', 'Prompts stop working until you add one again.', { ok: 'Remove', danger: true })) { await clearKey(); s.close('done'); mountSettings(root); } }, 'ghost')] : []),
      button('Paste a key', async () => {
        const v = await ask('OpenRouter key', { label: 'API key', placeholder: 'sk-or-…', ok: 'Save' });
        if (!v) return;
        const t = await ai.testKey(v.trim());
        if (!t.ok) { toast(t.message, 'error'); return; }
        await setKey(v.trim(), 'pasted'); toast('Key saved.'); s.close('done'); mountSettings(root);
      }),
      button('Sign in', () => startSignIn('#/settings'), 'primary'),
    ],
  });
}

// ---------- prompts ----------
export async function mountPrompts(root) {
  await saving;
  if (!(await libraryOrSay(root))) return;
  const rows = ai.lib.prompts.map((p) => item(p.name, `${ai.runSettings(p).model}${p.fixed ? ' · standard' : p.locked ? ' · locked' : ''}`, () => go(`#/settings/prompt/${p.id}`)));
  page(root, 'Prompts', '#/settings',
    h('p', { class: 'note' }, 'The same prompt library as the desktop. Type / at the start of a line, or select text and tap ✦ AI, to run one.'),
    h('div', { class: 'list' }, rows),
    h('div', { style: { height: '14px' } }),
    button([icon('plus'), 'New prompt'], () => go('#/settings/prompt/new'), 'primary wide'));
}

export async function mountPrompt(root, id) {
  if (!(await libraryOrSay(root))) return;
  const p = id === 'new' ? { name: '', template: '{{selected_text}}\n\n', system: '', collection_id: (ai.lib.collections.find((c) => c.standard === 'default') || ai.lib.collections[0])?.id || null, model: '' }
    : ai.lib.prompts.find((x) => x.id === id);
  if (!p) { go('#/settings/prompts'); return; }
  const settingsOnly = !!p.fixed;
  const locked = !!p.locked && !p.fixed;
  const name = h('input', { class: 'field-input', value: p.name || '', 'aria-label': 'Name', disabled: settingsOnly || locked });
  const coll = h('select', { class: 'field-input', 'aria-label': 'Model collection', disabled: locked },
    h('option', { value: '' }, '(none: OpenRouter free router)'),
    ai.lib.collections.map((c) => h('option', { value: c.id, selected: c.id === p.collection_id }, c.name)));
  const model = h('select', { class: 'field-input', 'aria-label': 'Model', disabled: locked });
  const fillModels = () => {
    const c = ai.lib.collections.find((x) => x.id === coll.value);
    const ids = (c?.models || []).map((m) => m.id);
    if (p.model && !ids.includes(p.model)) ids.push(p.model);
    model.replaceChildren(h('option', { value: '' }, `Collection's default${c?.default_model ? ` (${c.default_model})` : ''}`), ...ids.map((m) => h('option', { value: m, selected: m === p.model }, m)));
  };
  coll.onchange = fillModels; fillModels();
  const template = h('textarea', { class: 'field-area', 'aria-label': 'Prompt text', disabled: settingsOnly || locked }, p.template || '');
  const system = h('textarea', { class: 'field-area', style: { minHeight: '90px' }, 'aria-label': 'System message', disabled: settingsOnly || locked }, p.system || '');
  const temp = h('input', { class: 'field-input', type: 'number', step: '0.1', min: '0', max: '2', inputmode: 'decimal', value: p.temperature ?? '', placeholder: 'collection', 'aria-label': 'Temperature', disabled: locked });
  const maxT = h('input', { class: 'field-input', type: 'number', min: '1', inputmode: 'numeric', value: p.max_tokens ?? '', placeholder: 'collection', 'aria-label': 'Max output tokens', disabled: locked });
  const line = saveLine(locked ? '' : 'Changes save by themselves.');
  const auto = autosave(async () => {
    const saved = await ai.savePrompt({ id: p.id, name: name.value, template: template.value, system: system.value, collection_id: coll.value || null, model: model.value,
      temperature: temp.value, max_tokens: maxT.value, reasoning_effort: p.reasoning_effort || '' });
    p.id = saved.id;   // a new prompt: later changes go to the same one
  }, line);
  if (!locked) auto.watch(name, coll, model, template, system, temp, maxT);
  if (!settingsOnly && !locked) { varHints(template, ai.VARIABLES); varHints(system, ai.VARIABLES); }
  page(root, id === 'new' ? 'New prompt' : p.name, '#/settings/prompts',
    settingsOnly ? h('p', { class: 'note' }, 'A standard prompt: its text is fixed, its model settings can change.') : null,
    locked ? h('p', { class: 'note' }, 'Locked on the desktop. Unlock it there to change it.') : null,
    line,
    h('label', { class: 'field-label' }, 'Name'), name,
    h('label', { class: 'field-label' }, 'Model collection'), coll,
    h('label', { class: 'field-label' }, 'Model'), model,
    h('div', { class: 'row2' }, h('div', {}, h('label', { class: 'field-label' }, 'Temperature'), temp), h('div', {}, h('label', { class: 'field-label' }, 'Max output tokens'), maxT)),
    h('label', { class: 'field-label' }, 'Prompt text'), template,
    h('p', { class: 'note' }, 'Type {{ to put in a variable: {{before}} {{after}} {{selected_text}} {{selected_documents}} {{user_input}}'),
    h('label', { class: 'field-label' }, 'System message (optional)'), system,
    h('div', { style: { height: '16px' } }),
    !p.fixed && !locked && id !== 'new' ? h('div', { style: { marginTop: '10px' } }, button('Delete prompt', async () => {
      if (!(await confirmSheet(`Delete "${p.name}"?`, 'It is removed from the library on the desktop too.', { ok: 'Delete', danger: true }))) return;
      setLeave(null);
      try { await ai.deletePrompt(p.id); go('#/settings/prompts'); } catch (e) { toast(e.message, 'error'); }
    }, 'ghost wide')) : null);
}

// ---------- model collections ----------
export async function mountCollections(root) {
  await saving;
  if (!(await libraryOrSay(root))) return;
  const rows = ai.lib.collections.map((c) => item(c.name, `${c.models.length} model${c.models.length === 1 ? '' : 's'} · default ${c.default_model || '—'}`, () => go(`#/settings/collection/${c.id}`),
    c.standard ? h('span', { class: 'tag' }, 'standard') : icon('chevron')));
  page(root, 'Model collections', '#/settings',
    h('p', { class: 'note' }, 'Groups of models your prompts choose from. Shared with the desktop.'),
    rows.length ? h('div', { class: 'list' }, rows) : h('div', { class: 'empty' }, h('b', {}, 'No collections yet'),
      button('Make the standard collections', async () => { const made = await ai.ensureStandardCollections(); toast(made.length ? 'Made Default, Free and Top Weekly.' : 'Could not reach OpenRouter.'); mountCollections(root); }, 'primary')),
    h('div', { style: { height: '14px' } }),
    button([icon('plus'), 'New collection'], () => go('#/settings/collection/new'), 'wide'));
}

export async function mountCollection(root, id) {
  if (!(await libraryOrSay(root))) return;
  const c = id === 'new' ? { name: '', description: '', models: [{ id: ai.FREE_MODEL }], default_model: ai.FREE_MODEL, temperature: 0.7, max_tokens: null }
    : JSON.parse(JSON.stringify(ai.lib.collections.find((x) => x.id === id) || null));
  if (!c) { go('#/settings/collections'); return; }
  const name = h('input', { class: 'field-input', value: c.name, 'aria-label': 'Name' });
  const desc = h('textarea', { class: 'field-input', rows: '2', style: { minHeight: '70px' }, 'aria-label': 'Description' }, c.description || '');
  const temp = h('input', { class: 'field-input', type: 'number', step: '0.1', min: '0', max: '2', inputmode: 'decimal', value: c.temperature ?? '', 'aria-label': 'Temperature' });
  const maxT = h('input', { class: 'field-input', type: 'number', min: '1', inputmode: 'numeric', value: c.max_tokens ?? '', placeholder: "model's maximum", 'aria-label': 'Max output tokens' });
  const modelsEl = h('div', {});
  let paintModels = () => modelsEl.replaceChildren(...(c.models.length ? c.models.map((m) => h('div', { class: 'model-row' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Make ${m.id} the default`, onclick: () => { c.default_model = m.id; paintModels(); } }, icon(c.default_model === m.id ? 'check' : 'spark')),
    h('div', { class: 't' }, h('b', {}, m.name || m.id), h('span', {}, `${m.id} · in ${ai.perMillion(m.prompt_price)} / out ${ai.perMillion(m.completion_price)} per M`), c.default_model === m.id ? h('div', { class: 'def' }, 'DEFAULT') : null),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${m.id}`, onclick: () => { c.models = c.models.filter((x) => x.id !== m.id); if (c.default_model === m.id) c.default_model = c.models[0]?.id || ''; paintModels(); } }, icon('close'))))
    : [h('p', { class: 'note' }, 'No models yet.')]));
  const line = saveLine('Changes save by themselves.');
  const auto = autosave(async () => {
    const saved = await ai.saveCollection({ ...c, name: name.value, description: desc.value, temperature: temp.value, max_tokens: maxT.value });
    c.id = saved.id;   // a new collection: later changes go to the same one
  }, line);
  auto.watch(name, desc, temp, maxT);
  const repaint = paintModels;
  paintModels = () => { repaint(); auto.soon(); };   // adding, removing or choosing the default model saves too
  repaint();
  const add = () => addModelSheet((m) => { if (!c.models.some((x) => x.id === m.id)) c.models.push(m); if (!c.default_model) c.default_model = m.id; paintModels(); });
  page(root, id === 'new' ? 'New collection' : c.name, '#/settings/collections',
    c.standard === 'top-weekly' ? h('p', { class: 'note' }, 'The desktop refreshes Top Weekly once a week and replaces changes to its models.') : null,
    line,
    h('label', { class: 'field-label' }, 'Name'), name,
    h('label', { class: 'field-label' }, 'Description'), desc,
    h('p', { class: 'group' }, 'Models'), h('div', { class: 'list', style: { padding: '0 8px' } }, modelsEl),
    h('div', { style: { height: '10px' } }), button([icon('plus'), 'Add a model'], add, 'wide'),
    h('div', { class: 'row2' }, h('div', {}, h('label', { class: 'field-label' }, 'Temperature'), temp), h('div', {}, h('label', { class: 'field-label' }, 'Max output tokens'), maxT)),
    h('div', { style: { height: '16px' } }),
    id !== 'new' ? h('div', { style: { marginTop: '10px' } }, button('Delete collection', async () => {
      if (!(await confirmSheet(`Delete "${c.name}"?`, 'It is removed on the desktop too.', { ok: 'Delete', danger: true }))) return;
      setLeave(null);
      try { await ai.deleteCollection(c.id); go('#/settings/collections'); } catch (e) { toast(e.message, 'error'); }
    }, 'ghost wide')) : null);
}

function addModelSheet(onPick) {
  const q = h('input', { class: 'field-input', type: 'search', placeholder: 'Search models, e.g. claude, free, gemini', 'aria-label': 'Search models', autocomplete: 'off' });
  const results = h('div', {});
  let t = 0;
  const run = async () => {
    try {
      const hits = await ai.searchModels(q.value, 40);
      results.replaceChildren(...(hits.length ? hits.map((m) => h('button', { type: 'button', class: 'model-row', style: { width: '100%', border: '0', background: 'none', textAlign: 'left' },
        onclick: () => { onPick({ ...m }); s.close('done'); toast(`Added ${m.name}.`); } },
      h('div', { class: 't' }, h('b', {}, m.name), h('span', {}, `${m.id} · in ${ai.perMillion(m.prompt_price)} / out ${ai.perMillion(m.completion_price)} per M`)), icon('plus')))
        : [h('p', { class: 'note' }, 'No models match.')]));
    } catch (e) { results.replaceChildren(h('p', { class: 'note' }, e.message)); }
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 200); });
  const s = sheet({ title: 'Add a model', tall: true, body: h('div', {}, q, h('div', { style: { height: '8px' } }), results) });
  run();
  setTimeout(() => q.focus(), 80);
}

/** One model setting (an OpenRouter model id), with its default: search the models that can do the job. */
function modelSetting(root, key, title, dflt, note, filter) {
  pickModel({ title, current: kvGet(key, '') || dflt, collections: false, filter, note, dflt: { id: dflt, label: 'the default' },
    onPick: async (id) => { await kvSet(key, id === dflt ? '' : id); toast(`${title}: ${id}`); mountSettings(root); } });
}
