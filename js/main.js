// Start-up and screens. Routes: #/ projects · #/write/<project> · #/settings[/prompts|/prompt/<id>|/collections|
// /collection/<id>] · #/setup[/<step>]
import * as fs from './vfs.js';
import { closeAllSheets, toast, debounce, setScreenBack, startHistory, navigate, runLeave } from './util.js';
import { applyLook, storageMode, kvGet } from './settings.js';
import { finishSignIn } from './oauth.js';
import * as sync from './sync.js';
import * as drive from './drive.js';
import { mountProjects } from './projects.js';
import { mountWrite, unmountWrite, flushWrite } from './write.js';
import { mountSetup } from './setup.js';
import { mountSettings, mountPrompts, mountPrompt, mountCollections, mountCollection } from './settingsui.js';
import { startUpdates } from './update.js';
import * as ai from './ai.js';

const app = document.getElementById('app');

/** Sync soon after a change (a burst of typing is one sync). */
const syncSoon = debounce(() => runSync(), 15000);
export function requestSync() { if (storageMode() === 'drive') syncSoon(); }
function runSync() { return sync.syncNow({ beforeSync: flushWrite }); }
window.kalamoFlush = flushWrite;

function route(hash) {
  const parts = hash.slice(2).split('/').map(decodeURIComponent);
  const setupDone = kvGet('setup_step') === 'done' && storageMode();
  runLeave();
  unmountWrite();
  setScreenBack(null);
  closeAllSheets();
  window.scrollTo(0, 0);
  if (!setupDone && parts[0] !== 'setup') { navigate('#/setup'); return; }
  switch (parts[0]) {
    case 'setup': return mountSetup(app, parts[1]);
    case 'write': return mountWrite(app, parts[1]);
    case 'settings':
      if (parts[1] === 'prompts') return mountPrompts(app);
      if (parts[1] === 'prompt') return mountPrompt(app, parts[2]);
      if (parts[1] === 'collections') return mountCollections(app);
      if (parts[1] === 'collection') return mountCollection(app, parts[2]);
      return mountSettings(app);
    default: return mountProjects(app);
  }
}

async function boot() {
  try { await fs.open(); } catch (e) {
    app.textContent = `This browser does not let Kalamo keep files on the phone (${e.message}). A private window cannot be used.`;
    return;
  }
  applyLook();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyLook);
  ai.loadData().catch(() => {});
  const signin = await finishSignIn();
  if (signin) toast(signin.ok ? 'Signed in to OpenRouter. The key is saved on this phone.' : signin.message, signin.ok ? '' : 'error');
  startHistory(route);
  startUpdates();
  // sync: at start, when back online, when the app comes back to the front, every few minutes, and before it hides
  if (storageMode() === 'drive') runSync();
  addEventListener('online', () => runSync());
  document.addEventListener('visibilitychange', () => {
    if (storageMode() !== 'drive') return;
    if (document.visibilityState === 'visible') runSync();
    else flushWrite().then(() => runSync());
  });
  setInterval(() => { if (storageMode() === 'drive' && document.visibilityState === 'visible') runSync(); }, 3 * 60000);
  // Google's pass lasts about an hour and a web app cannot renew it without the person (that needs a server). So it is
  // renewed on the next tap once it has run out or has less than 10 minutes left: Google's window flashes up and
  // closes by itself, then the sync goes on, without "Sign in again".
  if (storageMode() === 'drive') drive.preload();
  let renewing = false, failedAt = 0;   // after a failed renewal (cancelled, offline) wait a minute before trying again
  addEventListener('pointerup', () => {
    if (storageMode() !== 'drive' || renewing || !navigator.onLine || !drive.needsRenewal() || Date.now() - failedAt < 60000) return;
    renewing = true;
    drive.signIn().then(() => { runSync(); }).catch(() => { failedAt = Date.now(); }).finally(() => { renewing = false; });
  }, true);
}

boot();
