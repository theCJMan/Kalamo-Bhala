// First start: where the library lives (this phone or a Google Drive folder), then the OpenRouter key.
// The Drive folder chooser is shared with Settings.
import { h, icon, toast, sheet, button, ask, go } from './util.js';
import * as fs from './vfs.js';
import * as drive from './drive.js';
import * as sync from './sync.js';
import * as L from './library.js';
import * as ai from './ai.js';
import { kvSet, kvGet, storageMode, googleClientId, getKey, setKey } from './settings.js';
import { startSignIn } from './oauth.js';
import { CONFIG } from './config.js';

const STEPS = ['welcome', 'storage', 'ai'];

export function mountSetup(root, step) {
  step = STEPS.includes(step) ? step : (kvGet('setup_step') || 'welcome');
  kvSet('setup_step', step);
  const dots = h('div', { class: 'steps', 'aria-hidden': 'true' }, STEPS.map((s, i) => h('i', { class: i <= STEPS.indexOf(step) ? 'on' : '' })));
  const body = h('div', { class: 'grow' });
  const foot = h('div', { class: 'foot' });
  root.replaceChildren(h('div', { class: 'setup' }, dots, body, foot));

  if (step === 'welcome') {
    body.append(h('img', { class: 'logo', src: 'icons/kalamo-256.png', alt: '', style: { marginTop: '28px' } }),
      h('h1', {}, 'Write anywhere.'),
      h('p', { class: 'lead' }, 'Kalamo Bhala on your phone: a quiet page, your binder one swipe away, and your prompts when you want them.'));
    foot.append(button('Get started', () => go('#/setup/storage'), 'primary wide'));
  }

  if (step === 'storage') {
    let pick = storageMode() || 'drive';
    const phone = h('button', { type: 'button', class: 'choice' }, icon('phone'), h('div', {}, h('b', {}, 'On this phone'), h('span', {}, 'Private to this phone. Nothing leaves it except what you send to AI.')));
    const cloud = h('button', { type: 'button', class: 'choice' }, icon('cloud'), h('div', {}, h('b', {}, 'Google Drive'), h('span', {}, 'The same library as your desktop: keep the desktop library in the Google Drive folder on your PC.')));
    const idBox = h('div', { class: 'hidden' },
      h('label', { class: 'field-label' }, 'Google client ID'),
      h('input', { class: 'field-input', type: 'text', value: googleClientId(), placeholder: '…apps.googleusercontent.com', autocomplete: 'off', 'aria-label': 'Google client ID',
        onchange: (e) => kvSet('google_client_id', e.target.value.trim()) }),
      h('p', { class: 'note' }, 'Made once in Google Cloud (see "Google Drive set-up" in the guide). Already built in when this box is filled.'));
    const paint = () => { phone.classList.toggle('picked', pick === 'phone'); cloud.classList.toggle('picked', pick === 'drive'); idBox.classList.toggle('hidden', pick !== 'drive' || !!googleClientIdBuiltIn()); };
    phone.onclick = () => { pick = 'phone'; paint(); };
    cloud.onclick = () => { pick = 'drive'; paint(); };
    body.append(h('h1', {}, 'Where should your writing live?'), h('p', { class: 'lead' }, 'Either way, the phone keeps working without internet.'), phone, cloud, idBox);
    paint();
    foot.append(button('Continue', async () => {
      if (pick === 'phone') {
        await kvSet('storage', 'phone');
        await firstLibrary();
        go('#/setup/ai');
      } else {
        try {
          if (!drive.signedIn()) await drive.signIn();
          const f = await chooseDriveFolder();
          if (!f) return;
          await useDriveFolder(f);
          go('#/setup/ai');
        } catch (e) { toast(e.message, 'error'); }
      }
    }, 'primary wide'), button('Back', () => go('#/setup/welcome'), 'ghost wide'));
  }

  if (step === 'ai') {
    const has = !!getKey();
    body.append(h('h1', {}, 'Your AI key'),
      h('p', { class: 'lead' }, 'Prompts run on OpenRouter with your own account. The key stays on this phone; it is never put in the library or in Google Drive.'),
      has ? h('p', { class: 'choice picked' }, icon('check'), h('div', {}, h('b', {}, 'Key saved'), h('span', {}, 'You can change it in Settings.'))) : null);
    if (!has) {
      foot.append(button('Sign in with OpenRouter', () => startSignIn('#/setup/ai'), 'primary wide'),
        button('Paste a key', async () => {
          const k = await ask('OpenRouter key', { label: 'API key', placeholder: 'sk-or-…', ok: 'Save' });
          if (!k) return;
          const t = await ai.testKey(k.trim());
          if (!t.ok) { toast(t.message, 'error'); return; }
          await setKey(k.trim(), 'pasted');
          toast('Key saved.');
          mountSetup(root, 'ai');
        }, 'wide'),
        button('Skip for now', () => finish(), 'ghost wide'));
    } else foot.append(button('Start writing', () => finish(), 'primary wide'));
  }

  async function finish() {
    await kvSet('setup_step', 'done');
    ai.ensureStandardCollections().catch(() => {});
    go('#/');
  }
}

const googleClientIdBuiltIn = () => !!CONFIG.GOOGLE_CLIENT_ID;

/** New phone library: the example projects, as on a brand-new desktop library (DECISIONS: examples on first run). */
async function firstLibrary() {
  if (kvGet('examples_added') || L.listProjects().length) return;
  try { for (const x of await L.examples()) await L.addExample(x.key); } catch (e) { /* examples are a nicety */ }
  await kvSet('examples_added', true);
}

/** Use a Drive folder as the library: the phone's copy is merged into it (nothing on either side is deleted). */
export async function useDriveFolder(f) {
  const old = kvGet('drive_folder');
  if (!old || old.id !== f.id) await sync.forgetDrive();
  await kvSet('drive_folder', f);
  await kvSet('storage', 'drive');
  toast('Connecting to Google Drive…');
  await sync.syncNow();
  const st = sync.getStatus();
  if (st.state === 'error') toast(st.message, 'error');
  await ai.loadLibrary().catch(() => {});
}

/** Browse My Drive's folders; resolves {id, name, path} or null. */
export function chooseDriveFolder() {
  return new Promise((resolve) => {
    const trail = [{ id: 'root', name: 'My Drive' }];
    const crumbs = h('p', { class: 'crumbs' });
    const listEl = h('div', { class: 'list' });
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); s.close('done'); };
    const here = () => trail[trail.length - 1];
    async function load() {
      crumbs.textContent = trail.map((t) => t.name).join(' › ');
      listEl.replaceChildren(h('p', { class: 'note', style: { padding: '12px 16px' } }, 'Loading…'));
      try {
        const kids = (await drive.children(here().id, true)).filter((f) => !f.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
        const rows = [];
        if (trail.length > 1) rows.push(h('button', { type: 'button', class: 'item', onclick: () => { trail.pop(); load(); } }, icon('back'), h('div', { class: 't' }, h('b', {}, 'Up'))));
        for (const f of kids) rows.push(h('button', { type: 'button', class: 'item', onclick: () => { trail.push({ id: f.id, name: f.name }); load(); } }, icon('folder'), h('div', { class: 't' }, h('b', {}, f.name)), icon('chevron')));
        if (!kids.length) rows.push(h('p', { class: 'note', style: { padding: '12px 16px' } }, 'No folders here.'));
        listEl.replaceChildren(...rows);
      } catch (e) {
        listEl.replaceChildren(h('p', { class: 'note', style: { padding: '12px 16px', color: 'var(--danger)' } }, e.message));
      }
    }
    const s = sheet({
      title: 'Choose the library folder', tall: true,
      body: h('div', {}, h('p', { class: 'note' }, 'Pick the folder that holds your project folders (the desktop\'s library folder inside Google Drive), or make a new one.'), crumbs, listEl),
      onClose: () => { if (!done) { done = true; resolve(null); } },
      actions: [
        button('New folder', async () => {
          const n = await ask('New folder', { label: 'Name', value: 'Kalamo Library', ok: 'Create' });
          if (!n) return;
          try { const f = await drive.createFolder(n.trim(), here().id); trail.push({ id: f.id, name: f.name }); load(); } catch (e) { toast(e.message, 'error'); }
        }, 'ghost'),
        button('Use this folder', () => {
          if (trail.length === 1) { toast('Please choose or make a folder inside My Drive.', 'error'); return; }
          finish({ id: here().id, name: here().name, path: trail.map((t) => t.name).join(' › ') });
        }, 'primary'),
      ],
    });
    load();
  });
}
