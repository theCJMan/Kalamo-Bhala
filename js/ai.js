// AI on the phone: the shared prompt library and model collections (<library>/.kalamo/ai/*.json, the same files the
// desktop uses), filling {{variables}}, cost estimates, the OpenRouter model list and one streamed run.
// Spending rules (DECISIONS 7): one request per run, never retried, no fallback model, Stop aborts the connection at
// once, the estimate is shown before and the real cost after. The key lives only on this phone (settings.js).
import * as fs from './vfs.js';
import { CONFIG } from './config.js';
import { newId, nowIso, natural, appData } from './util.js';
import { getKey } from './settings.js';

const AI_DIR = '.kalamo/ai';
let DATA = null;   // ai-data.json, made by tools/build_mobile.py from kalamo/ai.py (standard prompts, billing lists)
export async function loadData() {
  if (!DATA) DATA = await appData('ai-data.json');
  return DATA;
}
export const FREE_MODEL = 'openrouter/free';
const FIXED_SLOTS = ['continue', 'revise', 'go'];
const RW_STANDARD = { continue: 'continue', revise: 'revise selection', go: 'go' };
const EFFORTS = ['', 'disabled', 'minimal', 'low', 'medium', 'high'];

const loadList = (name) => { try { const v = JSON.parse(fs.read(`${AI_DIR}/${name}.json`) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const saveList = (name, items) => fs.write(`${AI_DIR}/${name}.json`, JSON.stringify(items, null, 2));

// ---------- the library ----------
export const lib = { collections: [], prompts: [] };

/** Load prompts and collections; adds the standard prompts when they are missing (as the desktop does). */
export async function loadLibrary() {
  await loadData();
  let prompts = loadList('prompts');
  let changed = false;
  for (const [slot, name] of Object.entries(RW_STANDARD)) {
    if (prompts.some((p) => p.fixed === slot && p.source !== 'Kalamo')) continue;
    const rw = prompts.find((p) => p.source === 'Raptor Write' && p.locked && !p.fixed && (p.name || '').trim().toLowerCase() === name);
    if (rw) {
      const gone = prompts.find((p) => p.fixed === slot);
      prompts = prompts.filter((p) => p.fixed !== slot);
      rw.fixed = slot; rw.locked = true;
      if (gone && 'shortcut' in gone) rw.shortcut = gone.shortcut;
      changed = true;
    }
  }
  const colls = loadList('collections');
  const home = colls.find((c) => c.standard === 'default') || colls[0] || null;
  for (const slot of FIXED_SLOTS) {
    const [name, text, system] = DATA.fixed[slot];
    const mine = prompts.find((p) => p.fixed === slot);
    if (mine) {
      if (mine.source === 'Kalamo' && (mine.template !== text || (mine.system || '') !== system)) {
        Object.assign(mine, { template: text, system, updated: nowIso() });
        changed = true;
      }
      continue;
    }
    const n = FIXED_SLOTS.indexOf(slot);
    prompts.push({ id: newId(), name, collection_id: home ? home.id : null, model: '', template: text, system,
      temperature: null, max_tokens: null, reasoning_effort: null, locked: true, order: 0, updated: nowIso(),
      source: 'Kalamo', fixed: slot, ...(prompts.some((p) => p.shortcut === n) ? {} : { shortcut: n }) });
    changed = true;
  }
  if (changed) await saveList('prompts', prompts);
  prompts.sort((a, b) => ((FIXED_SLOTS.includes(a.fixed) ? FIXED_SLOTS.indexOf(a.fixed) : 9) - (FIXED_SLOTS.includes(b.fixed) ? FIXED_SLOTS.indexOf(b.fixed) : 9))
    || ((a.order || 0) - (b.order || 0)) || natural(a.name || '', b.name || ''));
  lib.prompts = prompts;
  lib.collections = colls;
  return lib;
}

export class AiError extends Error {}
const fail = (m) => { throw new AiError(m); };
const text = (v, field, limit, required) => {
  const s = v == null ? '' : String(v);
  const t = limit <= 200 ? s.trim() : s;
  if (required && !t.trim()) fail(`${field} cannot be empty.`);
  if (t.length > limit) fail(`${field} is too long (at most ${limit.toLocaleString('en')} characters).`);
  return t;
};
const num = (v, field, lo, hi, integer) => {
  if (v == null || v === '') return null;
  const x = integer ? parseInt(v, 10) : parseFloat(v);
  if (Number.isNaN(x) || x < lo || x > hi) fail(`${field} must be between ${lo} and ${hi}.`);
  return x;
};

/** Save a prompt (new or changed). Standard prompts: only their model settings change. */
export async function savePrompt(p) {
  const items = loadList('prompts');
  const colls = loadList('collections');
  const old = p.id ? items.find((x) => x.id === p.id) : null;
  const cid = p.collection_id || null;
  if (cid && !colls.some((c) => c.id === cid)) fail('That model collection no longer exists.');
  const effort = p.reasoning_effort;
  if (effort && !EFFORTS.includes(effort)) fail('Unknown reasoning effort.');
  const settingsOnly = old && old.fixed;
  if (old && old.locked && !old.fixed) fail('This prompt is locked on the desktop. Unlock it there to change it.');
  const clean = {
    ...(old || {}),
    id: old ? old.id : newId(),
    name: settingsOnly ? old.name : text(p.name, 'Name', 120, true),
    template: settingsOnly ? old.template : text(p.template, 'Prompt text', 200000, true),
    system: settingsOnly ? (old.system || '') : text(p.system, 'System message', 100000),
    collection_id: cid, model: text(p.model, 'Model', 200),
    temperature: num(p.temperature, 'Temperature', 0, 2), max_tokens: num(p.max_tokens, 'Max output tokens', 1, 2000000, true),
    reasoning_effort: effort || null, updated: nowIso(),
  };
  if (!old) {
    clean.locked = false;
    clean.order = Math.max(0, ...items.map((x) => x.order || 0)) + 1;
    const used = new Set(items.map((x) => x.shortcut));
    clean.shortcut = [...Array(16).keys()].map((i) => i + 3).concat([0, 1, 2]).find((n) => !used.has(n)) ?? null;
    clean.source = 'Kalamo Mobile';
  }
  const out = old ? items.map((x) => (x.id === clean.id ? clean : x)) : [...items, clean];
  await saveList('prompts', out);
  await loadLibrary();
  return clean;
}

export async function deletePrompt(id) {
  const items = loadList('prompts');
  const p = items.find((x) => x.id === id);
  if (p && p.fixed) fail('Standard prompts cannot be deleted.');
  if (p && p.locked) fail('This prompt is locked on the desktop. Unlock it there to delete it.');
  await saveList('prompts', items.filter((x) => x.id !== id));
  await loadLibrary();
}

/** Collection fields exactly as the desktop's _clean_collection keeps them. */
function cleanCollection(c, catalog) {
  const models = [];
  const seen = new Set();
  for (const m of c.models || []) {
    const mid = String(typeof m === 'object' ? m.id : m || '').trim();
    if (!mid || seen.has(mid)) continue;
    seen.add(mid);
    const info = catalog ? catalog.find((x) => x.id === mid) : null;
    const base = { id: mid, name: mid, context_length: null, max_completion: null, prompt_price: null, completion_price: null, reasoning: false, temperature: true };
    if (typeof m === 'object') for (const k of Object.keys(base)) if (m[k] != null) base[k] = m[k];
    if (info) for (const k of Object.keys(base)) if (k in info) base[k] = info[k];
    models.push(base);
  }
  let def = String(c.default_model || '').trim();
  if (models.length && !seen.has(def)) def = models[0].id;
  return {
    id: c.id || newId(), name: text(c.name, 'Name', 100, true), description: text(c.description, 'Description', 2000),
    purpose: c.purpose || 'general', genre: text(c.genre, 'Genre', 100), models, default_model: def,
    temperature: num(c.temperature, 'Temperature', 0, 2), max_tokens: num(c.max_tokens, 'Max output tokens', 1, 2000000, true),
    use_thinking: !!c.use_thinking, reasoning_effort: c.reasoning_effort || '', updated: nowIso(),
    ...(['default', 'free', 'top-weekly'].includes(c.standard) ? { standard: c.standard } : {}),
  };
}

export async function saveCollection(c) {
  const items = loadList('collections');
  const old = items.find((x) => x.id === c.id);
  if (old && old.standard && !c.standard) c = { ...c, standard: old.standard };
  let catalog = null;
  try { catalog = await models(); } catch (e) { /* offline: the saved model details stay */ }
  const clean = cleanCollection({ ...(old || {}), ...c }, catalog);
  if (items.some((x) => x.name.toLowerCase() === clean.name.toLowerCase() && x.id !== clean.id)) fail(`A collection named "${clean.name}" already exists.`);
  const out = old ? items.map((x) => (x.id === clean.id ? clean : x)) : [...items, clean];
  await saveList('collections', out);
  await loadLibrary();
  return clean;
}

export async function deleteCollection(id) {
  const used = loadList('prompts').filter((p) => p.collection_id === id);
  if (used.length) fail(`${used.length} prompt(s) use this collection (for example "${used[0].name}"). Give them another collection first.`);
  await saveList('collections', loadList('collections').filter((x) => x.id !== id));
  await loadLibrary();
}

export const collectionOf = (p) => lib.collections.find((c) => c.id === p.collection_id) || null;

/** Settings for one run: the prompt's own values win over its collection's. */
export function runSettings(p) {
  const coll = collectionOf(p);
  const model = p.model || coll?.default_model || FREE_MODEL;
  return {
    model, info: coll?.models.find((m) => m.id === model) || null,
    temperature: p.temperature ?? coll?.temperature ?? null,
    max_tokens: p.max_tokens ?? coll?.max_tokens ?? null,
    reasoning_effort: p.reasoning_effort ?? coll?.reasoning_effort ?? '',
    use_thinking: !!coll?.use_thinking,
  };
}

// ---------- variables (DECISIONS 4.4: raw content, no wrapper tags) ----------
export const VARIABLES = [   // as on the desktop (kalamo/static/js/ai.js)
  ['before', 'Text before the cursor (or before the selection) in the open document'],
  ['after', 'Text after the cursor (or after the selection)'],
  ['selected_text', 'The selected text'],
  ['selected_documents', 'The documents switched on in the binder, each in a <document name="…"> element'],
  ['user_input', 'What you type when you run the prompt'],
];
const VAR_RE = /\{\{\s*(before|after|selected_documents|selected_text|user_input)\s*\}\}/g;
export const usesVar = (p, name) => [p.template, p.system].some((t) => new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(t || ''));
export const fill = (t, vars) => (t || '').replace(VAR_RE, (_, n) => vars[n] ?? '');
export const documentsBlock = (docs) => docs.map((d) => `<document name="${d.name.replace(/"/g, "'")}">\n${d.text.replace(/\s+$/, '')}\n</document>`).join('\n\n');
export function buildMessages(p, vars) {
  // what the person typed for {{user_input}} may itself use {{before}}, {{selected_text}}... (chosen by me, 14 Nov 2026)
  if (vars.user_input) vars = { ...vars, user_input: fill(vars.user_input, { ...vars, user_input: '' }) };
  const msgs = [];
  const sys = fill(p.system, vars).trim();
  if (sys) msgs.push({ role: 'system', content: sys });
  msgs.push({ role: 'user', content: fill(p.template, vars) });
  return msgs;
}

/** Rough cost before running: 4 characters per token; the reply priced at its maximum length. */
export function estimate(messages, info, maxTokens) {
  const promptTokens = Math.ceil(messages.map((m) => m.content).join('\n').length / 4) + 4 * messages.length;
  const outMax = Math.min(maxTokens || info?.max_completion || 4096, info?.max_completion || Infinity);
  const known = info?.prompt_price != null && info?.completion_price != null;
  return { promptTokens, outMax, known, max: known ? promptTokens * info.prompt_price + outMax * info.completion_price : null,
    tooLong: info?.context_length ? promptTokens + Math.min(outMax, 1024) > info.context_length : false };
}
export function money(x) {
  if (x == null || Number.isNaN(x)) return 'unknown';
  if (x === 0) return '$0.00';
  if (x < 0.0001) return '<$0.0001';
  if (x < 0.01) return '$' + x.toFixed(4);
  if (x < 1) return '$' + x.toFixed(3);
  return '$' + x.toFixed(2);
}
export const perMillion = (p) => (p == null ? '?' : p === 0 ? 'free' : '$' + (p * 1e6).toFixed(p * 1e6 < 1 ? 3 : 2));

/** true: Stop also stops billing; false: the provider bills the whole reply; null: not known. */
export function billingStops(provider) {
  const p = String(provider || '').toLowerCase().replace(/[-_]/g, '');
  if (!p || !DATA) return null;
  if (DATA.no_cancel.some((x) => p.includes(x.replace(/-/g, '')))) return false;
  if (DATA.cancel_ok.some((x) => p.includes(x))) return true;
  return null;
}

// ---------- OpenRouter's public model list (no key needed), kept for 12 hours ----------
const CATALOG_TTL = 12 * 3600 * 1000;
function modelInfo(m) {
  const tp = m.top_provider || {}, pr = m.pricing || {}, arch = m.architecture || {};
  const price = (k) => { const v = parseFloat(pr[k]); return Number.isNaN(v) ? null : v; };
  const params = m.supported_parameters || [];
  return { id: m.id, name: m.name || m.id, slug: m.canonical_slug || m.id, created: typeof m.created === 'number' ? m.created : 0,
    text_only: (arch.input_modalities || ['text']).includes('text') && JSON.stringify(arch.output_modalities || ['text']) === '["text"]',
    context_length: m.context_length || tp.context_length || null, max_completion: tp.max_completion_tokens || null,
    prompt_price: price('prompt'), completion_price: price('completion'),
    reasoning: params.includes('reasoning'), temperature: params.length ? params.includes('temperature') : true,
    makes_pictures: (arch.output_modalities || []).includes('image') && !String(m.id).startsWith('openrouter/'),
    reads_pictures: (arch.input_modalities || []).includes('image'), picture_price: price('image_output') };
}
export async function models(refresh = false) {
  const cache = fs.kvGet('catalog');
  if (cache && !refresh && Date.now() - cache.at < CATALOG_TTL) return cache.models;
  try {
    const r = await fetch(`${CONFIG.OPENROUTER}/models`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const list = (j.data || []).filter((m) => m.id).map(modelInfo).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    await fs.kvSet('catalog', { at: Date.now(), models: list });
    return list;
  } catch (e) {
    if (cache) return cache.models;
    throw new AiError(`Could not load the model list from OpenRouter (${e.message}). Check the internet connection.`);
  }
}
export async function searchModels(q, limit = 40) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const all = await models();
  return all.filter((m) => words.every((w) => `${m.id} ${m.name}`.toLowerCase().includes(w))).slice(0, limit);
}
export async function infoFor(id) {
  for (const c of lib.collections) { const m = c.models.find((x) => x.id === id); if (m && m.prompt_price != null) return m; }
  try { return (await models()).find((m) => m.id === id) || null; } catch (e) { return null; }
}

// ---------- the standard collections (kalamo/standard.py), made once per library ----------
const family = (id) => (id.includes('/') ? id.split('/')[0] : '');
const SKIP = ['openrouter', 'stealth', ''];
const usable = (m) => m.text_only !== false && !m.id.includes(':') && !SKIP.includes(family(m.id)) && !m.id.startsWith('~');
const isFree = (m) => m.prompt_price === 0 && m.completion_price === 0 && m.text_only !== false && !SKIP.includes(family(m.id)) && !m.id.startsWith('~');
const newestFirst = (a, b) => (b.created || 0) - (a.created || 0);
/**
 * A phone cannot read OpenRouter's rankings page (browsers block reading another site's page), so the phone always
 * uses the desktop's fallback: the newest model of each family, and says so in the description. When the library
 * is shared with the desktop, the desktop's own collections are used and nothing is made here.
 */
export async function ensureStandardCollections() {
  const path = `${AI_DIR}/standard.json`;
  let st = {};
  try { st = JSON.parse(fs.read(path) || '{}'); } catch (e) { st = {}; }
  st.made = st.made || {};
  const todo = ['default', 'free', 'top-weekly'].filter((k) => !st.made[k]);
  if (!todo.length) return [];
  let catalog;
  try { catalog = await models(); } catch (e) { return []; }
  const use = catalog.filter(usable).sort(newestFirst);
  const picks = {
    default: () => [FREE_MODEL, ...['x-ai', 'anthropic', 'google'].map((f) => use.find((m) => family(m.id) === f)?.id).filter(Boolean)],
    free: () => {
      const out = [FREE_MODEL], fams = new Set();
      for (const m of catalog.filter(isFree).sort(newestFirst)) {
        if (fams.has(family(m.id))) continue;
        out.push(m.id); fams.add(family(m.id));
        if (out.length === 4) break;
      }
      return out;
    },
    'top-weekly': () => ['anthropic', 'openai', 'google', 'x-ai', 'deepseek'].map((f) => use.find((m) => family(m.id) === f)?.id).filter(Boolean).slice(0, 5),
  };
  const NAMES = { default: 'Default', free: 'Free', 'top-weekly': 'Top Weekly' };
  const ABOUT = {
    default: "Kalamo's starting collection: OpenRouter's free router plus the top Grok, Claude and Google models.",
    free: 'Models that cost nothing: OpenRouter\'s free router plus free models from different families. Free models may be slow, limited per day, or log what you send.',
    'top-weekly': 'The five most used models on OpenRouter this week, one per family. Kalamo refreshes it once a week and replaces your changes to its models.',
  };
  const when = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const colls = loadList('collections');
  const names = new Set(colls.map((c) => c.name.toLowerCase()));
  for (const kind of todo) {
    const ids = picks[kind]();
    let name = NAMES[kind];
    if (names.has(name.toLowerCase())) name += ' (Kalamo)';
    colls.push(cleanCollection({ name, standard: kind, purpose: 'general', genre: '',
      description: `${ABOUT[kind]} Picked ${when} (OpenRouter's rankings could not be read, so the newest models were used).`,
      models: ids.map((id) => ({ id })), default_model: ids[0] || '', temperature: 0.7, max_tokens: null, use_thinking: false, reasoning_effort: '' }, catalog));
    st.made[kind] = nowIso();
    if (kind === 'top-weekly') st.top_weekly_at = Date.now() / 1000;
  }
  await saveList('collections', colls);
  await fs.write(path, JSON.stringify(st, null, 2));
  // standard prompts made before there were collections get the Default collection
  const prompts = loadList('prompts');
  const home = colls.find((c) => c.standard === 'default');
  let fix = false;
  for (const p of prompts) if (p.fixed && !p.collection_id && home) { p.collection_id = home.id; fix = true; }
  if (fix) await saveList('prompts', prompts);
  await loadLibrary();
  return todo;
}

// ---------- one run ----------
function explain(status, msg) {
  const d = msg ? ` (${msg})` : '';
  return ({
    401: `OpenRouter rejected the API key. Check it in Settings → OpenRouter.${d}`,
    402: `Your OpenRouter account does not have enough credit for this request.${d}`,
    403: `OpenRouter refused this request (moderation or no access to this model).${d}`,
    404: `OpenRouter does not know this model any more. Pick another model.${d}`,
    408: `The model took too long to answer.${d}`,
    413: `The prompt is too long for this model.${d}`,
    429: `OpenRouter's rate limit was reached. Wait a moment before running again.${d}`,
    502: `The model's provider is unavailable right now.${d}`,
    503: `No provider can serve this model right now.${d}`,
  })[status] || (status ? `OpenRouter returned an error (HTTP ${status})${d}.` : (msg || 'Could not reach OpenRouter.'));
}

export function buildPayload(body, info) {
  const payload = { model: body.model, messages: body.messages, stream: true, usage: { include: true } };
  if (body.temperature != null && (!info || info.temperature !== false)) payload.temperature = body.temperature;
  if (body.max_tokens != null) payload.max_tokens = info?.max_completion ? Math.min(body.max_tokens, info.max_completion) : body.max_tokens;
  const e = body.reasoning_effort || '';
  if (e === 'disabled') { if (info?.reasoning) payload.reasoning = { enabled: false }; }
  else if (['minimal', 'low', 'medium', 'high'].includes(e)) payload.reasoning = { effort: e };
  else if (body.use_thinking && info?.reasoning) payload.reasoning = { enabled: true };
  if (body.extra) Object.assign(payload, body.extra);   // a picture model's modalities / image_config
  return payload;
}

/**
 * Send one request and pass the reply on as events (start, provider, delta, thinking, error, done).
 * Returns {stop()}. Nothing is retried.
 */
export function startRun(body, info, onEvent) {
  const ctrl = new AbortController();
  let stopped = false;
  const key = getKey();
  const run = (async () => {
    if (!key) { onEvent({ type: 'error', message: 'Add your OpenRouter key (Settings → OpenRouter) before running a prompt.' }); onEvent({ type: 'done', cost: null }); return; }
    const payload = buildPayload(body, info);
    let usage = null, genId = null, provider = null, finish = null, chars = 0, pictures = 0;
    const t0 = Date.now();
    onEvent({ type: 'start', model: payload.model, max_tokens: payload.max_tokens });
    try {
      const r = await fetch(`${CONFIG.OPENROUTER}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream',
          'HTTP-Referer': CONFIG.APP_URL, 'X-Title': 'Kalamo Bhala' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        let msg = '';
        try { const j = await r.json(); msg = j?.error?.message || j?.message || ''; } catch (e) { /* not JSON */ }
        onEvent({ type: 'error', status: r.status, message: explain(r.status, msg) });
        finish = 'error';
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        outer: for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') break outer;
            let j;
            try { j = JSON.parse(data); } catch (e) { continue; }
            if (j.error) {
              const code = typeof j.error.code === 'number' ? j.error.code : 0;
              onEvent({ type: 'error', status: code, message: explain(code, j.error.message) });
              finish = 'error';
              break outer;
            }
            if (!genId && j.id) genId = j.id;
            if (j.provider && j.provider !== provider) { provider = j.provider; onEvent({ type: 'provider', provider, billing_stops: billingStops(provider) }); }
            for (const ch of j.choices || []) {
              const d = ch.delta || {};
              if (d.content) { chars += d.content.length; onEvent({ type: 'delta', text: d.content }); }
              for (const im of d.images || []) {   // a picture model's picture: only real PNG / JPEG / WebP pictures
                const pic = pictureFromUrl(im?.image_url?.url);
                if (pic && pictures < 4) { pictures++; onEvent({ type: 'image', ...pic }); }
              }
              if (d.reasoning || d.reasoning_content) onEvent({ type: 'thinking' });
              if (ch.finish_reason) finish = ch.finish_reason;
            }
            if (j.usage) usage = j.usage;
          }
        }
      }
    } catch (e) {
      if (!stopped) { onEvent({ type: 'error', message: `The connection to OpenRouter broke (${e.message}). Nothing was retried.` }); finish = 'error'; }
    }
    let cost = usage ? usage.cost ?? null : null;
    if (genId && cost == null) {   // only when the stream did not say what it cost (e.g. after Stop)
      const s = await generationStats(key, genId);
      if (cost == null) cost = s.total_cost ?? null;
      provider = provider || s.provider_name || null;
    }
    onEvent({ type: 'done', stopped, finish_reason: finish, provider, billing_stops: billingStops(provider), cost,
      prompt_tokens: usage?.prompt_tokens, completion_tokens: usage?.completion_tokens, seconds: Math.round((Date.now() - t0) / 100) / 10, chars });
  })();
  return { done: run, stop() { stopped = true; ctrl.abort(); } };
}

/** A picture in a reply ("data:image/png;base64,...") -> {mime, blob}, or null when it is not really a PNG, JPEG or
 * WebP picture (as the desktop's picture_event: pictures are only ever shown and saved as pictures). */
export function pictureFromUrl(url) {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,/.exec(url || '');
  if (!m || url.length > 28_000_000) return null;
  let bytes;
  try {
    const bin = atob(url.slice(m[0].length));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (e) { return null; }
  const kind = m[1] === 'jpg' ? 'jpeg' : m[1];
  const head = (a) => a.every((x, i) => bytes[i] === x);
  const ok = { png: head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), jpeg: head([0xff, 0xd8, 0xff]),
    webp: head([0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' }[kind];
  return ok ? { mime: `image/${kind}`, blob: new Blob([bytes], { type: `image/${kind}` }) } : null;
}

/** OpenRouter's record of one generation; after Stop it appears a few seconds later, so ask up to four times. */
async function generationStats(key, id) {
  for (const wait of [1000, 2500, 4000, 8000]) {
    await new Promise((r) => setTimeout(r, wait));
    try {
      const r = await fetch(`${CONFIG.OPENROUTER}/generation?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
      if (r.ok) { const j = await r.json(); if (j && j.data) return j.data; }
    } catch (e) { /* try again */ }
  }
  return {};
}

/** Check a key: OpenRouter's /key answers who it belongs to (free). */
export async function testKey(key) {
  try {
    const r = await fetch(`${CONFIG.OPENROUTER}/key`, { headers: { Authorization: `Bearer ${key}` } });
    if (r.ok) { const j = await r.json(); return { ok: true, label: j?.data?.label || '', limit: j?.data?.limit ?? null, usage: j?.data?.usage ?? null }; }
    return { ok: false, message: explain(r.status, '') };
  } catch (e) {
    return { ok: false, message: `Could not reach OpenRouter (${e.message}).` };
  }
}
