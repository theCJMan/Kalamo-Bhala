// Pictures on the phone: photos made upright and at most 2,000 px (JPEG), kept in the project's "images" folder like
// the desktop's pictures (kalamo/images.py: safe names, never over another file, a link relative to the document), or
// in "originals" for photos of notes taken in Kalamo (DECISIONS 55.3).
import * as fs from './vfs.js';

export const MAX_SIDE = 2000;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

/** A photo (File or Blob), turned the right way up and made at most `max` pixels wide or high, as a JPEG Blob. */
export async function shrinkPhoto(file, max = MAX_SIDE, quality = 0.85) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be made'))), 'image/jpeg', quality));
}

/** A Blob as a data: address (for sending a picture to a model). */
export function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('could not read the picture'));
    r.readAsDataURL(blob);
  });
}

/** "My Holiday Photo!.JPG" -> "my-holiday-photo" (kalamo/images.py safe_name, without the extension). */
export function safeStem(name) {
  const stem = String(name || '').replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return stem || 'picture';
}

/** "photo 2026-11-13 1405" style stem for a picture that has no name of its own. */
export function stampStem(prefix = 'photo') {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function freePath(dir, stem, ext, sep = '-') {
  let path = `${dir}/${stem}.${ext}`;
  for (let n = 2; fs.exists(path); n++) path = `${dir}/${stem}${sep}${n}.${ext}`;
  return path;
}

/** Save a picture in <project>/images/; returns {name, path (in the project), src (the link from document docRel)}. */
export async function savePicture(pid, docRel, blob, nameHint) {
  const ext = TYPES[blob.type] || 'jpg';
  const path = freePath(`${pid}/images`, safeStem(nameHint), ext);
  await fs.write(path, { blob, mime: blob.type || 'image/jpeg' });
  const rel = path.slice(pid.length + 1);
  return { name: rel.slice('images/'.length), path: rel, src: linkFrom(docRel, rel) };
}

/** Keep a photo of notes in <project>/originals/ (never over another file, " (2)" like the desktop's keep_original). */
export async function saveOriginal(pid, blob, nameHint) {
  const ext = TYPES[blob.type] || 'jpg';
  const stem = String(nameHint || 'photo').replace(/\.[^.]*$/, '').replace(/[<>:"/\|?*\x00-\x1f]/g, '').trim().slice(0, 80) || 'photo';
  let p = `${pid}/originals/${stem}.${ext}`;
  for (let n = 2; fs.exists(p); n++) p = `${pid}/originals/${stem} (${n}).${ext}`;
  await fs.write(p, { blob, mime: blob.type || 'image/jpeg' });
  return p.slice(pid.length + 1);
}

/** A link from a document to a file in the project ("images/x.png" from "Notes/Week 1.md" -> "../images/x.png"). */
export function linkFrom(docRel, rel) {
  const depth = Math.max(0, String(docRel || '').split('/').filter(Boolean).length - 1);
  return '../'.repeat(depth) + rel.split('/').map(encodeURIComponent).join('/');
}

/** A small preview picture (a data: address) for lists of chosen photos. */
export async function thumb(blob, size = 144) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const k = size / Math.max(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.7);
}
