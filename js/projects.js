// The projects screen: every project in the library, newest first. New project: empty or from an example.
// Projects that are on Google Drive but not yet on this phone are shown dashed; opening one downloads it.
import { h, icon, toast, ask, sheet, actionSheet, confirmSheet, fmtWords, go } from './util.js';
import * as L from './library.js';
import * as sync from './sync.js';
import * as drive from './drive.js';
import { storageMode } from './settings.js';
import { longPress } from './binder.js';

const AGO = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

/** The small status chip: phone only, synced, syncing, offline, sign in again. Tap: sync now / sign in. */
export function syncChip() {
  const label = h('span', {});
  const chip = h('button', { type: 'button', class: 'sync', 'aria-label': 'Sync status' }, h('i', { class: 'dot' }), label);
  let off = () => {}, timer = 0;
  const paint = (st) => {
    if (chip.dataset.seen && !chip.isConnected) { off(); clearInterval(timer); return; }
    if (chip.isConnected) chip.dataset.seen = '1';
    if (storageMode() !== 'drive') { chip.dataset.state = 'phone'; label.textContent = ''; chip.classList.add('hidden'); return; }
    chip.classList.remove('hidden');
    chip.dataset.state = st.state === 'done' || st.state === 'idle' ? 'ok' : st.state;
    label.textContent = { syncing: 'Syncing…', offline: 'Offline', signin: 'Sign in', error: 'Sync problem' }[st.state]
      || (st.last ? `Synced ${AGO(st.last)}` : 'Drive');
    chip.title = st.message || '';
  };
  off = sync.onStatus(paint);
  paint(sync.getStatus());
  timer = setInterval(() => paint(sync.getStatus()), 30000);
  chip.addEventListener('click', async () => {
    const st = sync.getStatus();
    if (st.state === 'signin') { try { await drive.signIn(); } catch (e) { toast(e.message, 'error'); return; } }
    if (st.state === 'error' && st.message) toast(st.message, 'error');
    sync.syncNow();
  });
  return chip;
}

export function mountProjects(root) {
  const list = h('div', { class: 'cards' });
  const screen = h('div', { class: 'screen' },
    h('header', { class: 'bar' }, h('span', { style: { flex: '1' } }), syncChip(),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', onclick: () => go('#/settings') }, icon('gear'))),
    h('div', { class: 'brand' }, h('h1', {}, 'Projects'), h('p', {}, storageMode() === 'drive' ? 'Shared with your desktop through Google Drive.' : 'Kept on this phone.')),
    h('main', { class: 'content' }, list),
    h('button', { type: 'button', class: 'fab', 'aria-label': 'New project', onclick: () => newProject() }, icon('plus')));
  root.replaceChildren(screen);

  function render() {
    const projects = L.listProjects(storageMode() === 'drive' ? sync.remoteProjects() : []);
    if (!projects.length) {
      list.replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'No projects yet'), 'Tap + to start one, or add an example to look around.'));
      return;
    }
    list.replaceChildren(...projects.map((p) => {
      const card = h('button', { type: 'button', class: `card${p.local ? '' : ' remote'}`, dataset: { project: p.id } },
        icon(p.local ? 'book' : 'cloud'),
        h('div', { class: 't' }, h('b', {}, p.title), h('span', {}, p.local ? `${fmtWords(p.words)} · ${p.files} document${p.files === 1 ? '' : 's'}` : 'On Google Drive · tap to bring it to this phone')),
        icon('chevron'));
      longPress(card, () => (p.local ? menu(p) : null), () => open(p));
      return card;
    }));
  }

  async function open(p) {
    if (!p.local) {
      if (!navigator.onLine) { toast('You are offline. This project comes to the phone when you are online.', 'error'); return; }
      toast(`Bringing "${p.title}" to this phone…`);
      await sync.fetchProject(p.id);
      if (!L.listProjects().some((x) => x.id === p.id)) { toast(sync.getStatus().message || 'Could not download it.', 'error'); render(); return; }
    }
    go(`#/write/${encodeURIComponent(p.id)}`);
  }

  async function newProject() {
    actionSheet('New project', [
      { label: 'Empty project', icon: 'plus', run: async () => {
        const name = await ask('New project', { label: 'Name', ok: 'Create' });
        if (name == null) return;
        try { const id = await L.createProject(name); go(`#/write/${encodeURIComponent(id)}`); } catch (e) { toast(e.message, 'error'); }
      } },
      { label: 'From an example', icon: 'book', run: () => examples() },
    ]);
  }

  async function examples() {
    let ex = [];
    try { ex = await L.examples(); } catch (e) { toast(`The examples could not be loaded: ${e.message}`, 'error'); return; }
    const s = sheet({
      title: 'Examples',
      body: h('div', {}, h('p', { class: 'muted small' }, 'A ready-made project to look around in. Change it or delete it; the example itself stays.'),
        ...ex.map((x) => h('button', { type: 'button', class: 'choice', onclick: async () => {
          s.close('done');
          try { const id = await L.addExample(x.key); toast(`Added "${id}".`); render(); } catch (e) { toast(e.message, 'error'); }
        } }, icon('book'), h('div', {}, h('b', {}, x.title), h('span', {}, x.description))))),
    });
  }

  function menu(p) {
    actionSheet(p.title, [
      { label: 'Rename', icon: 'edit', run: async () => {
        const n = await ask('Rename project', { value: p.title, ok: 'Rename' });
        if (n == null) return;
        try { await L.renameProject(p.id, n); render(); } catch (e) { toast(e.message, 'error'); }
      } },
      { label: 'Delete', icon: 'trash', danger: true, run: async () => {
        const ok = await confirmSheet(`Delete "${p.title}"?`, storageMode() === 'drive'
          ? "It moves to the library's .trash folder (in Google Drive too), as on the desktop."
          : "It moves to the library's trash on this phone.", { ok: 'Delete', danger: true });
        if (!ok) return;
        try { await L.deleteProject(p.id); render(); toast('Project deleted.'); } catch (e) { toast(e.message, 'error'); }
      } },
    ]);
  }

  render();
  const off = sync.onStatus((st) => { if (!list.isConnected) { off(); return; } if (st.state === 'done') render(); });
}
