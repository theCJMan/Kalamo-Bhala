// Reading a PDF on the phone (DECISIONS 55.5) with the desktop's own copy of pdf.js (free, on the phone): the PDF's
// own text becomes Markdown (headings from font sizes, paragraphs, lists; running headers and page numbers left out),
// the same code as the desktop's fileimport.js. Pages without text (scans) are given back as pictures, so the
// importer can have them read by the import model or keep them as pictures.
const V = new URL('../vendor/pdfjs/', import.meta.url).href;
let pdfjs = null;
async function load() {
  if (!pdfjs) {
    pdfjs = await import(V + 'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = V + 'pdf.worker.min.mjs';
  }
  return pdfjs;
}

// bullets, also the private bullet characters Word puts in PDFs; not – or — (dialogue in many novels starts with a dash)
const BULLET = /^(?:[•▪◦‣∙·●○■□]\s*|-\s+)(?=\S)/;
const esc = (t) => t.replace(/([\\`*_[\]<>|])/g, '\\$1');
const escStart = (t) => t.replace(/^(\s*)(#{1,6}\s|>|[-+*]\s|\d+[.)]\s)/, (m, a, b) => a + '\\' + b);

function pageLines(content, viewport) {
  const lines = [];
  let cur = null;
  for (const it of content.items) {
    if (typeof it.str !== 'string') continue;
    const [, , c, d, x, yPdf] = it.transform;
    const size = Math.hypot(c, d) || it.height || 10;
    const y = viewport.height - yPdf;
    if (!cur || Math.abs(y - cur.y) > size * 0.5) {
      if (cur && cur.text.trim()) lines.push(cur);
      cur = { text: '', size, y, x, end: x };
    } else if (it.str && !/\s$/.test(cur.text) && !/^\s/.test(it.str) && x - cur.end > size * 0.15) cur.text += ' ';
    cur.text += it.str;
    cur.size = Math.max(cur.size, it.str.trim() ? size : 0);
    cur.end = x + (it.width || 0);
    if (it.hasEOL) { if (cur.text.trim()) lines.push(cur); cur = null; }
  }
  if (cur && cur.text.trim()) lines.push(cur);
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }));
}

function repeatedLines(pages) {
  const count = new Map();
  const key = (t) => t.replace(/\d+/g, '#').toLowerCase();
  for (const p of pages) {
    const seen = new Set();
    for (const l of p.lines) {
      if (l.y > p.height * 0.1 && l.y < p.height * 0.9) continue;
      const k = key(l.text);
      if (!seen.has(k)) { seen.add(k); count.set(k, (count.get(k) || 0) + 1); }
    }
  }
  const min = Math.max(3, Math.ceil(pages.length * 0.4));
  return (l, p) => (l.y <= p.height * 0.1 || l.y >= p.height * 0.9) && (/^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(l.text) || (count.get(key(l.text)) || 0) >= min);
}

/** Pages into Markdown: the AI's text where it read a page (p.aiText), else the PDF's own; page pictures where kept. */
export function pagesToMarkdown(all, pages, pictures) {
  const sizes = [];
  for (const p of all) for (const l of p.lines) for (let i = 0; i < Math.min(l.text.length, 200); i += 10) sizes.push(Math.round(l.size * 2) / 2);
  sizes.sort((a, b) => a - b);
  const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10;
  const isRepeated = repeatedLines(all);
  const headingSizes = [...new Set(all.flatMap((p) => p.lines.filter((l) => l.size >= body * 1.15 && l.text.length < 140 && !isRepeated(l, p))
    .map((l) => Math.round(l.size))))].sort((a, b) => b - a).slice(0, 3);
  const level = (l) => { const i = headingSizes.indexOf(Math.round(l.size)); return i < 0 ? 0 : i + 1; };
  const out = [];
  for (const p of pages) {
    if (p.aiText != null) { out.push(p.aiText.trim()); if (pictures[p.n]) out.push(pictures[p.n]); continue; }
    let para = null, lastY = null, lastEnd = null;
    const gap = body * 1.6;
    const right = Math.max(0, ...p.lines.map((l) => l.end || 0));
    const flush = () => { if (para) { out.push(para.kind === 'li' ? para.text : escStart(para.text)); para = null; } };
    for (const l of p.lines) {
      if (isRepeated(l, p)) continue;
      const lv = level(l);
      const t = esc(l.text);
      if (lv && l.text.length < 140) { flush(); out.push('#'.repeat(lv) + ' ' + t.replace(/\\([*_])/g, '$1')); lastY = l.y; lastEnd = null; continue; }
      const bullet = BULLET.test(l.text);
      const shortBefore = lastEnd != null && right && lastEnd < right * 0.75;
      const newPara = !para || bullet || shortBefore || (lastY != null && l.y - lastY > Math.max(gap, l.size * 1.75));
      if (newPara) { flush(); para = { kind: bullet ? 'li' : 'p', text: bullet ? '- ' + esc(l.text.replace(BULLET, '')) : t }; }
      else if (/[A-Za-zÀ-ÿ]-$/.test(para.text) && /^[a-zà-ÿ]/.test(l.text)) para.text = para.text.slice(0, -1) + t;
      else para.text += ' ' + t;
      lastY = l.y; lastEnd = l.end;
    }
    flush();
    if (pictures[p.n]) out.push(pictures[p.n]);
  }
  return out.filter((x) => x && x.trim()).join('\n\n').replace(/(\n- [^\n]*)\n\n(?=- )/g, '$1\n') + '\n';
}

/** Open a PDF: {doc, pages: [{n, lines, height, hasImage, scanned}], picture(n) -> JPEG Blob}. stopped() ends early. */
export async function openPdf(buf, { onPage, stopped } = {}) {
  const lib = await load();
  let doc, task;
  try {
    task = lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true,
      cMapUrl: V + 'cmaps/', cMapPacked: true, standardFontDataUrl: V + 'standard_fonts/', useWasm: false });
    doc = await task.promise;
  } catch (e) {
    throw new Error(e?.name === 'PasswordException' ? 'this PDF is protected with a password; save a copy without the password and import that' : `it could not be read as a PDF (${e.message})`);
  }
  const IMG = new Set([lib.OPS.paintImageXObject, lib.OPS.paintInlineImageXObject, lib.OPS.paintImageXObjectRepeat].filter((x) => x != null));
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (stopped && stopped()) break;
    if (onPage) onPage(n, doc.numPages);
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const lines = pageLines(await page.getTextContent(), vp);
    const ops = await page.getOperatorList();
    const chars = lines.reduce((k, l) => k + l.text.length, 0);
    pages.push({ n, lines, height: vp.height, hasImage: ops.fnArray.some((f) => IMG.has(f)), scanned: chars < 25 });
    page.cleanup();
  }
  async function picture(n, maxWidth = 1400, quality = 0.85) {
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, maxWidth / v1.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    return await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  }
  return { doc, total: doc.numPages, pages, picture, close: () => { try { task.destroy(); } catch (e) { /* already closed */ } } };
}
