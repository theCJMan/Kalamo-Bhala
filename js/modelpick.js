// Choosing a model (owner, 14 Nov 2026): the library's model collections as groups that open and close (the one with
// the current model starts open), and a search over every OpenRouter model ("Other"); typing an exact model id that
// is not in the list offers it as it is. Used by the chat's model button and the model settings.
import { h, icon, sheet } from './util.js';
import * as ai from './ai.js';

/**
 * opts: { title, current (model id), onPick(id), collections (true: show the collections), filter(model) -> bool
 *         (which models the search offers), dflt: {id, label} (a "use the default" row), note }
 */
export function pickModel(opts) {
  const { title, current, onPick, collections = true, filter = () => true, dflt = null, note = '' } = opts;
  const q = h('input', { class: 'field-input', type: 'search', placeholder: 'Search all OpenRouter models, e.g. claude, gemini, free', 'aria-label': 'Search models', autocomplete: 'off' });
  const list = h('div', { class: 'pick-list' });
  let s = null;
  const choose = (id) => { s.close('done'); onPick(id); };
  const row = (id, sub) => h('button', { type: 'button', class: `action pick-row${id === current ? ' picked' : ''}`, onclick: () => choose(id) },
    icon(id === current ? 'check' : 'spark'), h('span', { class: 'pick-t' }, h('b', {}, id), sub ? h('small', {}, sub) : null));
  const price = (m) => (m && m.prompt_price != null ? `in ${ai.perMillion(m.prompt_price)} / out ${ai.perMillion(m.completion_price)} per M` : '');

  function groups() {
    const out = [];
    if (dflt) out.push(row(dflt.id, dflt.label));
    if (collections) {
      for (const c of ai.lib.collections) {
        if (!c.models.length) continue;
        const has = c.models.some((m) => m.id === current);
        out.push(h('details', { class: 'pick-group', open: has || null },
          h('summary', {}, icon('chevron', 'ic chev'), h('b', {}, c.name), h('small', {}, `${c.models.length} model${c.models.length === 1 ? '' : 's'}`)),
          c.models.map((m) => row(m.id, `${m.name && m.name !== m.id ? m.name + ' · ' : ''}${price(m)}`))));
      }
      const inAny = ai.lib.collections.some((c) => c.models.some((m) => m.id === current));
      if (current && !inAny && (!dflt || dflt.id !== current)) out.unshift(row(current, 'in use now'));
    } else if (current && (!dflt || dflt.id !== current)) out.push(row(current, 'in use now'));
    out.push(h('p', { class: 'note' }, collections ? 'Other models: search above.' : 'Search above for another model.'));
    return out;
  }
  let t = 0, seq = 0;
  async function search() {
    const text = q.value.trim();
    if (!text) { list.replaceChildren(...groups()); return; }
    const my = ++seq;
    list.replaceChildren(h('p', { class: 'note' }, 'Searching…'));
    let hits = [];
    try { hits = (await ai.searchModels(text, 200)).filter(filter).slice(0, 40); } catch (e) {
      if (my === seq) list.replaceChildren(h('p', { class: 'note' }, e.message), ...(text.includes('/') ? [row(text, 'use this id as it is')] : []));
      return;
    }
    if (my !== seq) return;
    const exact = hits.some((m) => m.id === text);
    list.replaceChildren(...hits.map((m) => row(m.id, `${m.name && m.name !== m.id ? m.name + ' · ' : ''}${price(m)}`)),
      ...(!exact && text.includes('/') ? [row(text, 'use this id as it is')] : []),
      ...(!hits.length && !text.includes('/') ? [h('p', { class: 'note' }, 'No models match.')] : []));
  }
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 200); });
  s = sheet({ title, tall: true, cls: 'pick-sheet', body: h('div', {}, note ? h('p', { class: 'muted small' }, note) : null, q, h('div', { style: { height: '8px' } }), list) });
  search();
}
