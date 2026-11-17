// Reading Word (.docx), PowerPoint (.pptx) and Excel (.xlsx) files on the phone (DECISIONS 55.5): ports of the
// desktop's Python readers (kalamo/docimport.py docx_to_md and pptx_to_md, kalamo/moreimport.py xlsx_to_md), so a
// file comes out as the same Markdown on both. They are ZIP files of XML: the ZIP is read with the browser's own
// unzip (DecompressionStream) and the XML with DOMParser. Nothing is fetched and nothing runs.

// ---------- ZIP ----------
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Open a ZIP (ArrayBuffer or Uint8Array): {names, has(n), bytes(n), text(n)}. */
export function openZip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65536); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('this is not a Word, Excel or PowerPoint file (it is not a ZIP file)');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('the file is damaged (its table of contents cannot be read)');
    const method = u16(b, p + 10), size = u32(b, p + 20), nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  async function bytes(name) {
    const e = entries.get(name);
    if (!e) throw new Error(`${name} is missing in the file`);
    const start = e.local + 30 + u16(b, e.local + 26) + u16(b, e.local + 28);
    const raw = b.subarray(start, start + e.size);
    if (e.method === 0) return raw;
    if (e.method !== 8) throw new Error('the file is packed in a way Kalamo cannot read');
    const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return {
    names: [...entries.keys()],
    has: (n) => entries.has(n),
    bytes,
    text: async (n) => new TextDecoder().decode(await bytes(n)),
  };
}

async function xml(z, name) {
  const doc = new DOMParser().parseFromString(await z.text(name), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`${name} in the file cannot be read`);
  return doc.documentElement;
}

// ---------- XML helpers (ElementTree's find / iter, by namespace) ----------
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const kids = (el, ns, name) => (el ? [...el.children].filter((c) => c.namespaceURI === ns && c.localName === name) : []);
/** A direct child path: child(el, W, 'pPr', 'pStyle'). */
function child(el, ns, ...names) {
  let cur = el;
  for (const n of names) { cur = kids(cur, ns, n)[0]; if (!cur) return null; }
  return cur;
}
const all = (el, ns, name) => (el ? [...el.getElementsByTagNameNS(ns, name)] : []);
const wval = (el) => (el ? el.getAttributeNS(W, 'val') ?? el.getAttribute('w:val') : null);

// ---------- Markdown helpers (kalamo/docimport.py) ----------
export const esc = (t) => t.replace(/([\\`*_[\]<>|])/g, '\\$1');
const SCENE_BREAKS = new Set(['\\* \\* \\*', '\\*\\*\\*', '#', '* * *', '***', '~', '---']);
export function escLineStart(line) {
  if (SCENE_BREAKS.has(line.trim())) return '* * *';
  return line.replace(/^(\s*)(#{1,6}\s|>|[-+*]\s|\d+[.)]\s)/, (m, a, b) => a + '\\' + b);
}
/** [[text, bold, italic, strike]] -> Markdown, merging neighbours with the same marks, spaces kept outside the marks. */
export function runsToMd(runs) {
  const merged = [];
  for (const [t, b, i, s] of runs) {
    if (!t) continue;
    const last = merged[merged.length - 1];
    if (last && last[1] === b && last[2] === i && last[3] === s) last[0] += t;
    else merged.push([t, b, i, s]);
  }
  const out = [];
  for (const [t, b, i, s] of merged) {
    const [, lead, core0, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(t);
    if (!core0) { out.push(t); continue; }
    let core = esc(core0);
    if (s) core = `~~${core}~~`;
    if (i) core = `*${core}*`;
    if (b) core = `**${core}**`;
    out.push(lead + core + trail);
  }
  return out.join('').replace(/[ \t]+/g, ' ').trim();
}
export function tableMd(rows0) {
  const rows = rows0.filter((r) => r.some((c) => c.trim()));
  if (!rows.length) return '';
  const n = Math.max(...rows.map((r) => r.length));
  const full = rows.map((r) => [...r, ...Array(n - r.length).fill('')]);
  const line = (r) => '| ' + r.map((c) => c.replace(/\n/g, ' ').trim() || ' ').join(' | ') + ' |';
  return [line(full[0]), '| ' + Array(n).fill('---').join(' | ') + ' |', ...full.slice(1).map(line)].join('\n');
}
/** Blocks -> Markdown; the items of one list stay together. */
function joinBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    const item = /^\s*(- |1\. )/.test(b);
    if (out.length && item && out[out.length - 1][1]) out[out.length - 1][0] += '\n' + b;
    else out.push([b, item]);
  }
  return out.map(([b]) => b).join('\n\n').trim() + '\n';
}
const stripBold = (t) => t.replace(/\*\*(.*)\*\*/, '$1');

// ---------- pictures found in a file ----------
const PIC_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
function looksRight(ext, b) {
  const head = (a) => a.every((x, i) => b[i] === x);
  if (ext === 'png') return head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === 'jpg') return head([0xff, 0xd8, 0xff]);
  if (ext === 'gif') return head([0x47, 0x49, 0x46, 0x38]);
  if (ext === 'webp') return head([0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...b.slice(8, 12)) === 'WEBP';
  if (ext === 'svg') return new TextDecoder().decode(b.slice(0, 4096)).toLowerCase().includes('<svg');
  return false;
}
/**
 * The pictures of one file: add() gives the Markdown at once ("images/<stem>-<n>.png", relative to the project) and
 * keeps the picture; the importer saves them afterwards. taken(path) says whether a name is in use in the project.
 */
export class Pictures {
  constructor(stem, taken) {
    this.stem = String(stem).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'file';
    this.taken = taken; this.n = 0; this.list = [];
  }
  add(bytes, ext0, alt = '') {
    let ext = String(ext0 || '').toLowerCase().replace(/^\./, '');
    if (ext === 'jpeg') ext = 'jpg';
    if (!PIC_TYPES[ext] || !looksRight(ext, bytes)) return '';   // an EMF/WMF drawing or something unknown: left out
    let name;
    do { this.n++; name = `${this.stem}-${this.n}.${ext}`; } while (this.taken(`images/${name}`) || this.list.some((p) => p.name === name));
    this.list.push({ name, blob: new Blob([bytes], { type: PIC_TYPES[ext] }) });
    return `![${esc(alt)}](images/${name})\n\n`;
  }
}
const extOf = (path) => (path.match(/\.([^./]+)$/) || [, ''])[1];

// ---------- Word (.docx) ----------
function on(el, name) {
  const x = child(el, W, name);
  return !!x && !['0', 'false', 'none'].includes(wval(x) ?? 'true');
}

export async function docxToMd(buf, pics) {
  const z = openZip(buf);
  const doc = await xml(z, 'word/document.xml');
  const rels = {};
  if (z.has('word/_rels/document.xml.rels')) for (const r of all(await xml(z, 'word/_rels/document.xml.rels'), REL, 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target') || '';
  const styles = {};
  if (z.has('word/styles.xml')) {
    for (const s of all(await xml(z, 'word/styles.xml'), W, 'style')) {
      const name = (wval(child(s, W, 'name')) || '').toLowerCase();
      const lvl = child(s, W, 'pPr', 'outlineLvl');
      styles[s.getAttributeNS(W, 'styleId')] = [name, lvl ? parseInt(wval(lvl), 10) + 1 : null];
    }
  }
  const numfmt = {};
  if (z.has('word/numbering.xml')) {
    const nx = await xml(z, 'word/numbering.xml');
    const abstract = {};
    for (const a of all(nx, W, 'abstractNum')) {
      const lv = {};
      for (const l of all(a, W, 'lvl')) lv[l.getAttributeNS(W, 'ilvl')] = child(l, W, 'numFmt') ? wval(child(l, W, 'numFmt')) : 'bullet';
      abstract[a.getAttributeNS(W, 'abstractNumId')] = lv;
    }
    for (const num of kids(nx, W, 'num')) {
      const an = child(num, W, 'abstractNumId');
      numfmt[num.getAttributeNS(W, 'numId')] = abstract[an ? wval(an) : ''] || {};
    }
  }
  async function pic(rid) {
    const target = rels[rid || ''] || '';
    if (!target) return '';
    const path = ('word/' + target).replace('word/../', '');
    if (!z.has(path)) return '';
    return pics.add(await z.bytes(path), extOf(path));
  }
  async function picture(el) {
    let out = '';
    for (const b of all(el, A, 'blip')) out += await pic(b.getAttributeNS(R, 'embed'));
    for (const im of all(el, V, 'imagedata')) out += await pic(im.getAttributeNS(R, 'id'));
    return out;
  }
  async function paraRuns(p) {
    const runs = [];
    let extra = '';
    for (const r of all(p, W, 'r')) {
      const rp = child(r, W, 'rPr');
      const b = !!rp && on(rp, 'b'), i = !!rp && on(rp, 'i'), s = !!rp && (on(rp, 'strike') || on(rp, 'dstrike'));
      for (const c of r.children) {
        if (c.namespaceURI !== W) continue;
        if (c.localName === 't') runs.push([c.textContent || '', b, i, s]);
        else if (c.localName === 'tab') runs.push([' ', b, i, s]);
        else if (c.localName === 'br' && c.getAttributeNS(W, 'type') !== 'page') runs.push([' ', b, i, s]);
      }
      extra += await picture(r);
    }
    return [runs, extra];
  }
  const isTitle = (p) => {
    const ps = child(p, W, 'pPr', 'pStyle');
    return !!ps && ((styles[wval(ps)] || [''])[0] === 'title' || (wval(ps) || '').toLowerCase() === 'title');
  };
  const body = child(doc, W, 'body');
  const items = body ? [...body.children] : [];
  const shift = items.some((p) => p.namespaceURI === W && p.localName === 'p' && isTitle(p)) ? 1 : 0;
  function headingLevel(p) {
    if (isTitle(p)) return 1;
    const ps = child(p, W, 'pPr', 'pStyle');
    if (!ps) {
      const ol = child(p, W, 'pPr', 'outlineLvl');
      return ol && parseInt(wval(ol), 10) < 6 ? Math.min(parseInt(wval(ol), 10) + 1 + shift, 6) : null;
    }
    const [name, lvl] = styles[wval(ps)] || ['', null];
    const m = /^heading\s*(\d)/.exec(name) || /^heading(\d)/.exec((wval(ps) || '').toLowerCase());
    if (m) return Math.min(parseInt(m[1], 10) + shift, 6);
    return lvl && lvl <= 6 ? Math.min(lvl + shift, 6) : null;
  }
  const blocks = [];
  for (const el of items) {
    if (el.namespaceURI !== W) continue;
    if (el.localName === 'tbl') {
      const rows = [];
      for (const tr of all(el, W, 'tr')) {
        const row = [];
        for (const tc of kids(tr, W, 'tc')) {
          const runs = [];
          for (const p of all(tc, W, 'p')) runs.push(...(await paraRuns(p))[0], [' ', false, false, false]);
          row.push(runsToMd(runs));
        }
        rows.push(row);
      }
      const t = tableMd(rows);
      if (t) blocks.push(t);
      continue;
    }
    if (el.localName !== 'p') continue;
    const [runs, pc] = await paraRuns(el);
    const text = runsToMd(runs);
    const lvl = headingLevel(el);
    const num = child(el, W, 'pPr', 'numPr');
    if (text && lvl) blocks.push('#'.repeat(lvl) + ' ' + stripBold(text));
    else if (text && num) {
      const il = child(num, W, 'ilvl');
      const ilvl = il ? wval(il) : '0';
      const nid = child(num, W, 'numId');
      const fmt = (numfmt[nid ? wval(nid) : ''] || {})[ilvl] || 'bullet';
      blocks.push('   '.repeat(parseInt(ilvl || '0', 10)) + (fmt === 'bullet' || fmt === 'none' ? '- ' : '1. ') + text);
    } else if (text) blocks.push(escLineStart(text));
    if (pc) blocks.push(pc.trim());
  }
  return { md: joinBlocks(blocks), warnings: [] };
}

// ---------- PowerPoint (.pptx) ----------
async function relsOf(z, path) {
  const i = path.lastIndexOf('/');
  const folder = path.slice(0, i), name = path.slice(i + 1);
  const rp = `${folder}/_rels/${name}.rels`;
  const out = {};
  if (!z.has(rp)) return out;
  for (const r of all(await xml(z, rp), REL, 'Relationship')) {
    if (r.getAttribute('TargetMode') === 'External') continue;
    const t = r.getAttribute('Target') || '';
    const full = t.startsWith('/') ? t.replace(/^\/+/, '') : `${folder}/${t}`;
    const parts = [];
    for (const seg of full.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
    out[r.getAttribute('Id')] = [parts.join('/'), (r.getAttribute('Type') || '').split('/').pop()];
  }
  return out;
}
function pptxParas(tx) {
  const out = [];
  for (const p of kids(tx, A, 'p')) {
    const runs = [];
    for (const el of p.children) {
      if (el.namespaceURI !== A) continue;
      if (el.localName === 'r' || el.localName === 'fld') {
        const rp = child(el, A, 'rPr');
        const b = !!rp && ['1', 'true'].includes(rp.getAttribute('b'));
        const i = !!rp && ['1', 'true'].includes(rp.getAttribute('i'));
        const s = !!rp && rp.getAttribute('strike') != null && rp.getAttribute('strike') !== 'noStrike';
        const t = child(el, A, 't');
        runs.push([t ? t.textContent || '' : '', b, i, s]);
      } else if (el.localName === 'br') runs.push([' ', false, false, false]);
    }
    const text = runsToMd(runs);
    if (text) {
      const ppr = child(p, A, 'pPr');
      out.push([ppr ? parseInt(ppr.getAttribute('lvl') || '0', 10) : 0, text, !!ppr && !!child(ppr, A, 'buNone')]);
    }
  }
  return out;
}

export async function pptxToMd(buf, pics) {
  const z = openZip(buf);
  const pres = await xml(z, 'ppt/presentation.xml');
  const prels = await relsOf(z, 'ppt/presentation.xml');
  const slides = all(pres, P, 'sldId').map((s) => s.getAttributeNS(R, 'id')).filter((id) => prels[id]).map((id) => prels[id][0]);
  const blocks = [];
  let n = 0;
  for (const path of slides) {
    n++;
    if (!z.has(path)) continue;
    const sl = await xml(z, path);
    const rels = await relsOf(z, path);
    let title = '';
    const body = [];
    const tree = child(sl, P, 'cSld', 'spTree');
    for (const el of tree ? tree.getElementsByTagName('*') : []) {
      if (el.namespaceURI === P && el.localName === 'sp') {
        const ph = child(el, P, 'nvSpPr', 'nvPr', 'ph');
        const kind = ph ? ph.getAttribute('type') || 'body' : null;
        const tx = child(el, P, 'txBody');
        if (!tx || ['sldNum', 'dt', 'ftr', 'hdr'].includes(kind)) continue;
        const paras = pptxParas(tx);
        if ((kind === 'title' || kind === 'ctrTitle') && !title) { title = paras.map((x) => x[1]).join(' '); continue; }
        const bulleted = kind === 'body' || kind === 'obj' || (!!ph && kind !== 'subTitle');
        for (const [lvl, t, noBullet] of paras) body.push(bulleted && !noBullet ? '   '.repeat(Math.min(lvl, 4)) + '- ' + t : escLineStart(t));
      } else if (el.namespaceURI === P && el.localName === 'pic') {
        const blip = all(el, A, 'blip')[0];
        const rid = blip ? blip.getAttributeNS(R, 'embed') : null;
        if (rid && rels[rid] && z.has(rels[rid][0])) {
          const md = pics.add(await z.bytes(rels[rid][0]), extOf(rels[rid][0]));
          if (md) body.push(md.trim());
        }
      } else if (el.namespaceURI === A && el.localName === 'tbl') {
        const rows = kids(el, A, 'tr').map((tr) => kids(tr, A, 'tc').map((tc) => {
          const tb = child(tc, A, 'txBody');
          return runsToMd([[tb ? pptxParas(tb).map((x) => x[1]).join(' ') : '', false, false, false]]);
        }));
        const t = tableMd(rows);
        if (t) body.push(t);
      }
    }
    const hidden = sl.getAttribute('show') === '0' ? ' (hidden slide)' : '';
    blocks.push('# ' + (title ? stripBold(title) : `Slide ${n}`) + hidden, ...body);
    const notes = Object.values(rels).find(([, k]) => k === 'notesSlide')?.[0];
    if (notes && z.has(notes)) {
      const said = [];
      for (const sp of all(await xml(z, notes), P, 'sp')) {
        const ph = child(sp, P, 'nvSpPr', 'nvPr', 'ph');
        const tx = child(sp, P, 'txBody');
        if (ph && ph.getAttribute('type') === 'body' && tx) said.push(...pptxParas(tx).map((x) => x[1]));
      }
      if (said.length) blocks.push('*Speaker notes:*', ...said.map(escLineStart));
    }
  }
  return { md: joinBlocks(blocks), warnings: [] };
}

// ---------- Excel (.xlsx) ----------
const MAX_ROWS = 2000, MAX_COLS = 50;
const BUILTIN_DATES = { 14: 'date', 15: 'date', 16: 'date', 17: 'date', 18: 'time', 19: 'time', 20: 'time', 21: 'time', 22: 'datetime', 45: 'time', 46: 'time', 47: 'time' };
const BUILTIN_CODES = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 37: '#,##0', 38: '#,##0', 39: '#,##0.00', 40: '#,##0.00', 49: '@' };
const colOf = (ref) => [...(/^[A-Z]+/.exec(ref) || [''])[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
function kindOf(code) {
  const bare = String(code || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').toLowerCase();
  const d = /[dy]|m{3,}/.test(bare) || (/(^|[^h:])m{1,2}([^:s]|$)/.test(bare) && bare.includes('d'));
  const t = /[hs]/.test(bare);
  return d && t ? 'datetime' : d ? 'date' : t ? 'time' : 'number';
}
function numberText(v0, code0) {
  let v = v0;
  const code = String(code0 || 'General').split(';')[0];
  if (['General', '@', ''].includes(code)) return Math.abs(v) < 1e15 ? String(Number(v.toPrecision(10))) : String(v);
  const pct = code.includes('%');
  if (pct) v *= 100;
  const m = /0(?:\.(0+))?/.exec(code.replace(/"[^"]*"|\[[^\]]*\]/g, ''));
  const places = m ? (m[1] || '').length : 0;
  const s = code.includes(',') ? v.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places }) : v.toFixed(places);
  let sign = ['$', '€', '£', '¥', 'R '].find((c) => code.includes(c)) || '';
  const cur = /\[\$([^\]-]+)/.exec(code);
  if (cur) sign = cur[1];
  if (sign && code.indexOf(sign.trim()) > code.indexOf('0')) return s + (sign.trim() !== sign ? ' ' : '') + sign.trim() + (pct ? '%' : '');
  return sign + s + (pct ? '%' : '');
}
function whenText(v, kind, date1904) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + Math.round(v * 86400000));
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (x) => String(x).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const hm = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  if (kind === 'date') return date;
  if (kind === 'time') return d.getUTCSeconds() ? `${hm}:${p(d.getUTCSeconds())}` : hm;
  return `${date} ${hm}`;
}
function tidy(grid) {
  let rows = grid.filter((r) => r.some((c) => c.trim()));
  if (!rows.length) return [[], ''];
  const width = Math.max(...rows.map((r) => r.length));
  rows = rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
  const keep = [...Array(width).keys()].filter((j) => rows.some((r) => r[j].trim()));
  rows = rows.map((r) => keep.map((j) => r[j]));
  const note = [];
  if (rows.length > MAX_ROWS) { note.push(`${rows.length.toLocaleString('en')} rows, of which the first ${MAX_ROWS.toLocaleString('en')} are here`); rows = rows.slice(0, MAX_ROWS); }
  if (keep.length > MAX_COLS) { note.push(`${keep.length} columns, of which the first ${MAX_COLS} are here`); rows = rows.map((r) => r.slice(0, MAX_COLS)); }
  return [rows, note.join('; ')];
}
function sheetsMd(sheets) {
  const parts = [], warnings = [];
  const many = sheets.length > 1;
  for (const [name, grid, hidden] of sheets) {
    const [rows, cut] = tidy(grid);
    const head = many ? `# ${esc(name)}\n\n` + (hidden ? '*(A hidden sheet in the spreadsheet.)*\n\n' : '') : '';
    if (!rows.length) { if (many) parts.push(head + '*(This sheet is empty.)*'); continue; }
    let body = tableMd(rows.map((r) => r.map(esc)));
    if (cut) { body += `\n\n*(This sheet is very large: ${cut}. Open the original for the rest.)*`; warnings.push(`Sheet "${name}" is very large: ${cut}.`); }
    parts.push(head + body);
  }
  return { md: parts.join('\n\n') + '\n', warnings };
}

export async function xlsxToMd(buf) {
  const z = openZip(buf);
  const shared = [];
  if (z.has('xl/sharedStrings.xml')) {
    for (const si of all(await xml(z, 'xl/sharedStrings.xml'), SS, 'si')) {
      const phonetic = new Set(all(si, SS, 'rPh').flatMap((r) => all(r, SS, 't')));   // Japanese reading hints: not shown
      shared.push(all(si, SS, 't').filter((x) => !phonetic.has(x)).map((x) => x.textContent || '').join(''));
    }
  }
  const formats = { ...BUILTIN_CODES };
  let xfFmt = [];
  if (z.has('xl/styles.xml')) {
    const st = await xml(z, 'xl/styles.xml');
    for (const nf of all(st, SS, 'numFmt')) formats[parseInt(nf.getAttribute('numFmtId'), 10)] = nf.getAttribute('formatCode') || '';
    const cx = child(st, SS, 'cellXfs');
    if (cx) xfFmt = kids(cx, SS, 'xf').map((xf) => parseInt(xf.getAttribute('numFmtId') || '0', 10));
  }
  const wb = await xml(z, 'xl/workbook.xml');
  const pr = child(wb, SS, 'workbookPr');
  const date1904 = !!pr && ['1', 'true'].includes(pr.getAttribute('date1904'));
  const rels = {};
  if (z.has('xl/_rels/workbook.xml.rels')) {
    for (const r of all(await xml(z, 'xl/_rels/workbook.xml.rels'), REL, 'Relationship')) {
      const t = r.getAttribute('Target') || '';
      rels[r.getAttribute('Id')] = t.startsWith('/') ? t.replace(/^\/+/, '') : 'xl/' + t;
    }
  }
  const sheets = [];
  for (const sh of all(wb, SS, 'sheet')) {
    const path = rels[sh.getAttributeNS(R, 'id')] || '';
    if (!z.has(path)) continue;
    const grid = new Map();
    for (const row of all(await xml(z, path), SS, 'row')) {
      for (const c of kids(row, SS, 'c')) {
        const ref = c.getAttribute('r') || '', t = c.getAttribute('t') || 'n';
        const v = child(c, SS, 'v');
        let val = v && v.textContent != null ? v.textContent : '';
        if (t === 's') val = /^\d+$/.test(val) && +val < shared.length ? shared[+val] : '';
        else if (t === 'inlineStr') val = all(c, SS, 't').map((x) => x.textContent || '').join('');
        else if (t === 'b') val = val === '1' ? 'TRUE' : 'FALSE';
        else if (t !== 'str' && t !== 'e' && val) {
          const s = parseInt(c.getAttribute('s') || '0', 10);
          const fid = s < xfFmt.length ? xfFmt[s] : 0;
          const code = formats[fid] ?? 'General';
          const kind = BUILTIN_DATES[fid] || (fid >= 164 ? kindOf(code) : 'number');
          const num = Number(val);
          if (val.trim() !== '' && !Number.isNaN(num)) val = kind !== 'number' ? whenText(num, kind, date1904) : numberText(num, code);
        }
        const m = /^([A-Z]+)(\d+)/.exec(ref);
        if (!val || !m) continue;
        const rn = parseInt(m[2], 10);
        if (!grid.has(rn)) grid.set(rn, new Map());
        grid.get(rn).set(colOf(m[1]), val);
      }
    }
    const rows = [...grid.keys()].sort((a, b) => a - b).map((rn) => {
      const r = grid.get(rn);
      const w = Math.max(...r.keys()) + 1;
      return [...Array(w).keys()].map((j) => r.get(j) || '');
    });
    sheets.push([sh.getAttribute('name') || 'Sheet', rows, ['hidden', 'veryHidden'].includes(sh.getAttribute('state'))]);
  }
  return sheetsMd(sheets);
}
