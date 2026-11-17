// Phone-only settings: kept in the phone's own storage (IndexedDB "kv"), never in the library, so the OpenRouter key
// and the Google sign-in never reach Google Drive, the desktop or any export.
import { kvGet, kvSet, kvDel } from './vfs.js';
import { CONFIG } from './config.js';

export const getKey = () => kvGet('openrouter_key', '');
export const setKey = (k, how = 'pasted') => Promise.all([kvSet('openrouter_key', String(k || '').trim()), kvSet('openrouter_key_how', how)]);
export const clearKey = () => Promise.all([kvDel('openrouter_key'), kvDel('openrouter_key_how')]);
export const keyHow = () => kvGet('openrouter_key_how', '');

/** 'phone' | 'drive' | null (setup not done) */
export const storageMode = () => kvGet('storage', null);
export const driveFolder = () => kvGet('drive_folder', null);   // {id, name, path}
export const googleClientId = () => kvGet('google_client_id', '') || CONFIG.GOOGLE_CLIENT_ID;

export const theme = () => kvGet('theme', 'system');            // system | light | dark
export const textSize = () => kvGet('text_size', 'medium');     // small | medium | large
export function applyLook() {
  const t = theme();
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.size = textSize();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#1d1712' : '#f4ede1';
}
export { kvGet, kvSet };

// The models for reading photos and scanned pages, and for making pictures (the desktop's defaults, DECISIONS 33, 40)
export const IMPORT_MODEL = 'google/gemini-3.1-flash-lite';
export const PICTURE_MODEL = 'google/gemini-3.1-flash-image';   // Nano Banana 2
export const importModel = () => kvGet('import_model', '') || IMPORT_MODEL;
export const pictureModel = () => kvGet('picture_model', '') || PICTURE_MODEL;
export const chatModel = () => kvGet('chat_model', '');
