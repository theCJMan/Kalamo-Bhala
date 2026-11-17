// "Check for updates": the app is cached on the phone by a service worker so it runs offline. A new version is
// noticed when the phone is online (at start, every few hours, or from Settings) and offered with a Reload button;
// nothing changes while you write until you tap it.
import { h, toast } from './util.js';
import { CONFIG } from './config.js';

let reg = null;
let shown = false;

function offer(version) {
  if (shown) return;
  shown = true;
  const bar = h('div', { class: 'banner', role: 'status' },
    h('span', {}, `A new version of Kalamo Bhala${version ? ` (${version})` : ''} is ready.`),
    h('button', { type: 'button', class: 'btn', onclick: () => apply() }, 'Reload'));
  document.body.append(bar);
}

async function apply() {
  if (window.kalamoFlush) { try { await window.kalamoFlush(); } catch (e) { /* saved as far as possible */ } }
  const w = reg && reg.waiting;
  if (w) w.postMessage({ type: 'SKIP_WAITING' });
  else location.reload();
}

export async function startUpdates() {
  if (!('serviceWorker' in navigator)) return;
  try {
    reg = await navigator.serviceWorker.register('sw.js');
  } catch (e) { console.warn('No offline copy:', e); return; }
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  const watch = (w) => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(); });
  if (reg.waiting && navigator.serviceWorker.controller) offer();
  watch(reg.installing);
  reg.addEventListener('updatefound', () => watch(reg.installing));
  setInterval(() => checkForUpdate(false), 4 * 3600 * 1000);
  // the offline copy can be dropped by the phone while Kalamo runs: check it at start and when back online
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'REPAIRED') return;
    offlineCopy = e.data;
    if (e.data.still && !warned) { warned = true; toast("Part of Kalamo's offline copy is missing on this phone. Open Kalamo once with internet to fetch it again.", 'error'); }
  });
  const repair = () => navigator.serviceWorker.ready.then((r) => r.active && r.active.postMessage({ type: 'REPAIR' })).catch(() => {});
  repair();
  addEventListener('online', repair);
}
let warned = false;
/** The last check of the offline copy: {version, missing, still} (missing: files that were gone, still: not fetched again). */
export let offlineCopy = null;

/** Ask the site for the newest version. loud: say so when there is nothing new (Settings button). */
export async function checkForUpdate(loud) {
  if (!navigator.onLine) { if (loud) toast('You are offline. Try again when you are online.'); return; }
  let latest = null;
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) latest = (await r.json()).version;
  } catch (e) { /* offline or blocked */ }
  try { if (reg) await reg.update(); } catch (e) { /* ignore */ }
  if (latest && latest !== CONFIG.VERSION) { offer(latest); return; }
  if (loud) toast(latest ? `You have the newest version (${CONFIG.VERSION}).` : 'Could not check for updates right now.');
}
