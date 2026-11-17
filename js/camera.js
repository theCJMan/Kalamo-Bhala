// Kalamo's own camera (DECISIONS 55.4, 59): full screen, the picture fills the screen with the controls laid over it
// (like the phone's camera app), several pictures in a row, Done. Zoom (pinch or 1× 2× 3×; the camera's own zoom where
// it has one, else a crop of the full photo), tap to focus, the light next to the shutter, a page guide (grid, and a
// level when the phone lies flat over a page), the last picture next to the shutter: tap it to look at every picture
// big, take one out or move it earlier / later. The keyboard is put away and the screen stays on while it is open.
// Where the phone refuses the camera (no permission, no camera), the phone's own camera app is offered instead, one
// picture per trip. Photos taken here are not saved to the gallery.
// Also: picking files (the gallery, documents) with the phone's own picker.
import { h, icon, toast, pushLayer, popLayer } from './util.js';
import { shrinkPhoto } from './pictures.js';

const DIGITAL_MAX = 4;            // zoom by cropping, when the camera has no zoom of its own
const GUIDE_KEY = 'kalamo.camera.guide';

/** The phone's own file picker. Resolves to [File] ([] when cancelled). */
export function pickFiles(accept, { multiple = true, capture = null } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple: multiple || null, capture, class: 'hidden', 'aria-hidden': 'true' });
    let done = false;
    const finish = (files) => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish([...(input.files || [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.append(input);
    input.click();
  });
}

export const pickImages = () => pickFiles('image/*', { multiple: true });

function readGuide() { try { return localStorage.getItem(GUIDE_KEY) !== 'off'; } catch (e) { return true; } }
function saveGuide(on) { try { localStorage.setItem(GUIDE_KEY, on ? 'on' : 'off'); } catch (e) { /* not kept */ } }

/** The middle 1/z of a picture (digital zoom), as a JPEG. */
async function cropMiddle(blob, z) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const w = Math.max(1, Math.round(bmp.width / z)), hgt = Math.max(1, Math.round(bmp.height / z));
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  c.getContext('2d').drawImage(bmp, (bmp.width - w) / 2, (bmp.height - hgt) / 2, w, hgt, 0, 0, w, hgt);
  bmp.close?.();
  return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be made'))), 'image/jpeg', 0.92));
}

/**
 * Open the camera. opts.title: shown at the top ("Photos of notes"); opts.single: Done after one picture.
 * Resolves to [{blob (JPEG, at most 2,000 px), name}] in the order taken, or null when cancelled.
 */
export function openCamera(opts = {}) {
  return new Promise((resolve) => {
    const shots = [];
    let stream = null, track = null, closed = false, busy = false, wake = null;
    let zoom = 1, hwZoom = null, zoomTimer = 0;          // hwZoom: the camera's own {min, max, step}
    let canFocus = false, focusModes = [];
    let guide = readGuide();

    // keep the keyboard away: the camera may open from a document or a box that still has the cursor, and an open
    // keyboard also shrinks the whole camera screen
    const putKeyboardAway = () => { const a = document.activeElement; if (a && a !== document.body && !el.contains(a)) a.blur?.(); };
    const onFocusIn = (e) => { if (!closed && !el.contains(e.target)) e.target.blur?.(); };

    const video = h('video', { class: 'cam-video', autoplay: true, playsinline: true, muted: true, 'aria-label': 'Camera' });
    const msg = h('div', { class: 'cam-msg hidden', role: 'status' });
    const grid = h('div', { class: 'cam-grid', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
    const level = h('div', { class: 'cam-level hidden', 'aria-hidden': 'true' }, h('b'));
    const view = h('div', { class: 'cam-view' }, video, grid, level, msg);
    const count = h('span', { class: 'cam-count' }, '');
    const guideBtn = h('button', { type: 'button', class: 'icon-btn cam-guide', 'aria-label': 'Page guide', 'aria-pressed': String(guide), onclick: () => setGuide(!guide) }, icon('grid'));
    const doneBtn = h('button', { type: 'button', class: 'btn primary cam-done', disabled: true, onclick: () => close(true) }, icon('check'), 'Done');
    const shutter = h('button', { type: 'button', class: 'cam-shutter', 'aria-label': 'Take a picture', onclick: () => take() });
    const appBtn = h('button', { type: 'button', class: 'btn cam-app hidden', onclick: () => useCameraApp() }, "Use the phone's camera app");
    // the light (torch): shown only when the phone's camera has one; stays on while the camera is open
    let lightOn = false;
    const lightBtn = h('button', { type: 'button', class: 'icon-btn cam-light hidden', 'aria-label': 'Light', 'aria-pressed': 'false', onclick: () => toggleLight() }, icon('flash'));
    const thumb = h('button', { type: 'button', class: 'cam-thumb hidden', 'aria-label': 'Look at the pictures taken', onclick: () => review(shots.length - 1) },
      h('img', { alt: '' }), h('span', { class: 'cam-badge' }, ''));
    const zoomRow = h('div', { class: 'cam-zoom hidden', role: 'group', 'aria-label': 'Zoom' });
    const el = h('div', { class: 'camera', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Camera' },
      view,
      h('header', { class: 'cam-top' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cancel', onclick: () => cancel() }, icon('close')),
        h('b', {}, opts.title || 'Camera'), count, guideBtn),
      h('div', { class: 'cam-controls' },
        zoomRow,
        h('footer', { class: 'cam-bottom' },
          h('div', { class: 'cam-left' }, lightBtn, thumb, appBtn), shutter, h('div', { class: 'cam-right' }, doneBtn))));
    putKeyboardAway();
    document.addEventListener('focusin', onFocusIn, true);
    document.body.append(el);
    // a black status bar above the camera (the app's own colour comes back on closing)
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const themeWas = themeMeta ? themeMeta.content : null;
    if (themeMeta) themeMeta.content = '#000000';
    document.body.classList.add('camera-on');   // the "new version" banner waits until the camera closes
    shutter.focus({ preventScroll: true });
    setTimeout(putKeyboardAway, 150); setTimeout(putKeyboardAway, 450);   // a menu that closes may give the cursor back
    const layer = pushLayer((reason) => close(false, reason));
    setGuide(guide);

    function paint() {
      count.textContent = shots.length ? `${shots.length} taken` : '';
      doneBtn.disabled = !shots.length;
      doneBtn.lastChild.textContent = shots.length ? `Done (${shots.length})` : 'Done';
      const last = shots[shots.length - 1];
      thumb.classList.toggle('hidden', !last);
      if (last) { thumb.firstChild.src = last.url; thumb.lastChild.textContent = String(shots.length); }
    }
    async function add(blob) {
      const small = await shrinkPhoto(blob);
      const n = shots.length + 1;
      shots.push({ blob: small, url: URL.createObjectURL(small), name: `Photo ${n}` });
      paint();
      if (opts.single) close(true);
    }
    function frameBlob() {
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      if (!c.width) throw new Error('the camera is not ready yet');
      c.getContext('2d').drawImage(video, 0, 0);
      return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    }
    async function take() {
      if (busy || !stream) return;
      busy = true;
      shutter.classList.add('flash', 'busy');   // dimmed until the photo is saved: then it takes the next one
      setTimeout(() => shutter.classList.remove('flash'), 180);
      try {
        let blob = null;
        const hwZoomed = hwZoom && zoom > hwZoom.min + 1e-6;
        // the camera's full picture where the phone offers it; with the camera's own zoom: the picture as seen
        if (window.ImageCapture && track && !hwZoomed) {
          try { blob = await new ImageCapture(track).takePhoto(); } catch (e) { blob = null; }
        }
        if (!blob) blob = await frameBlob();
        if (!hwZoom && zoom > 1.01) blob = await cropMiddle(blob, zoom);
        navigator.vibrate?.(15);
        await add(blob);
        if (focusModes.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      } catch (e) { toast(`No picture: ${e.message}`, 'error'); }
      busy = false;
      shutter.classList.remove('busy');
    }

    // ---- zoom ----
    const zMin = () => (hwZoom ? hwZoom.min : 1);
    const zMax = () => (hwZoom ? hwZoom.max : DIGITAL_MAX);
    const shown = (z) => z / zMin();                    // what the buttons say: 1× is the camera's widest
    function setZoom(z) {
      z = Math.min(zMax(), Math.max(zMin(), z));
      if (hwZoom && hwZoom.step) z = zMin() + Math.round((z - zMin()) / hwZoom.step) * hwZoom.step;
      zoom = z;
      if (hwZoom) {
        clearTimeout(zoomTimer);   // a pinch sends many: only the last one in each 60 ms goes to the camera
        zoomTimer = setTimeout(() => track?.applyConstraints({ advanced: [{ zoom }] }).catch(() => {}), 60);
      } else {
        video.style.transform = zoom > 1.001 ? `scale(${zoom})` : '';
        fitGrid();
      }
      paintZoom();
    }
    function paintZoom() {
      const now = shown(zoom);
      let picked = null;
      for (const b of zoomRow.children) {
        const v = Number(b.dataset.z);
        if (Math.abs(v - now) < 0.05) picked = b;
      }
      // the button nearest below the zoom shows the exact value while pinching (1.6×)
      const below = [...zoomRow.children].filter((b) => Number(b.dataset.z) <= now + 0.05).pop();
      for (const b of zoomRow.children) {
        const v = Number(b.dataset.z);
        const on = b === (picked || below);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        b.textContent = on && !picked ? `${now.toFixed(1)}×` : `${v}×`;
      }
    }
    function makeZoomButtons() {
      const top = shown(zMax());
      const steps = [1, 2, 3].filter((v) => v <= top + 0.01);
      if (top >= 5) steps.push(5);
      if (steps.length < 2) return;
      zoomRow.replaceChildren(...steps.map((v) => h('button', { type: 'button', 'data-z': String(v), 'aria-label': `Zoom ${v} times`, onclick: () => setZoom(v * zMin()) }, `${v}×`)));
      zoomRow.classList.remove('hidden');
      paintZoom();
    }

    // ---- touch on the picture: pinch to zoom, tap to focus ----
    const pts = new Map();
    let pinch = null, tap = null;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    view.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { pinch = { d: dist(), z: zoom }; tap = null; } else if (pts.size === 1) tap = { x: e.clientX, y: e.clientY };
    });
    view.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) setZoom(pinch.z * dist() / pinch.d);
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) tap = null;
    });
    const lift = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (tap && pts.size === 0 && e.type === 'pointerup') focusAt(tap.x, tap.y);
      if (pts.size === 0) tap = null;
    };
    view.addEventListener('pointerup', lift);
    view.addEventListener('pointercancel', lift);

    async function focusAt(cx, cy) {
      if (!canFocus || !track || !video.videoWidth) return;
      // where the tap is in the camera's picture (0..1), through the black bars and the digital zoom
      const r = video.getBoundingClientRect();
      const s = Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
      const w = video.videoWidth * s, hgt = video.videoHeight * s;
      const x = Math.min(1, Math.max(0, (cx - r.left - (r.width - w) / 2) / w));
      const y = Math.min(1, Math.max(0, (cy - r.top - (r.height - hgt) / 2) / hgt));
      const c = { pointsOfInterest: [{ x, y }] };
      if (focusModes.includes('single-shot')) c.focusMode = 'single-shot';
      try { await track.applyConstraints({ advanced: [c] }); } catch (e) { return; }
      const vr = view.getBoundingClientRect();
      const ring = h('div', { class: 'cam-focus', 'aria-hidden': 'true', style: `left:${cx - vr.left}px;top:${cy - vr.top}px` });
      view.querySelectorAll('.cam-focus').forEach((n) => n.remove());
      view.append(ring);
      setTimeout(() => ring.remove(), 900);
    }

    // ---- page guide: a grid over the picture itself (not the black bars), and a level when the phone lies flat ----
    function fitGrid() {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      const W = view.clientWidth, H = view.clientHeight;
      const s = Math.min(W / vw, H / vh);
      const w = Math.min(W, vw * s * (hwZoom ? 1 : zoom)), hgt = Math.min(H, vh * s * (hwZoom ? 1 : zoom));
      Object.assign(grid.style, { left: `${(W - w) / 2}px`, top: `${(H - hgt) / 2}px`, width: `${w}px`, height: `${hgt}px`, right: 'auto', bottom: 'auto' });
    }
    video.addEventListener('loadedmetadata', fitGrid);
    video.addEventListener('resize', fitGrid);
    window.addEventListener('resize', fitGrid);
    function setGuide(on) {
      guide = on;
      saveGuide(on);
      guideBtn.setAttribute('aria-pressed', String(on));
      guideBtn.classList.toggle('on', on);
      grid.classList.toggle('hidden', !on);
      if (!on) level.classList.add('hidden');
    }
    function onTilt(e) {
      if (!guide || e.beta == null || e.gamma == null) return;
      const b = e.beta, g = e.gamma;
      const flatish = Math.abs(b) < 35 && Math.abs(g) < 35;   // pointing down at a desk, not up at a board
      level.classList.toggle('hidden', !flatish);
      if (!flatish) return;
      const k = 1.6, lim = 34;
      level.firstChild.style.transform = `translate(${Math.max(-lim, Math.min(lim, g * k))}px, ${Math.max(-lim, Math.min(lim, b * k))}px)`;
      level.classList.toggle('flat', Math.abs(b) < 3 && Math.abs(g) < 3);
    }
    window.addEventListener('deviceorientation', onTilt);

    // ---- look at the pictures taken: big, take one out, move it earlier or later ----
    function review(i) {
      if (!shots.length) return;
      let at = Math.min(Math.max(0, i), shots.length - 1);
      const img = h('img', { class: 'cam-review-img', alt: '' });
      const title = h('b', {}, '');
      const prev = h('button', { type: 'button', class: 'icon-btn cam-nav cam-prev', 'aria-label': 'Previous picture', onclick: () => { at--; show(); } }, icon('back'));
      const next = h('button', { type: 'button', class: 'icon-btn cam-nav cam-next', 'aria-label': 'Next picture', onclick: () => { at++; show(); } }, icon('chevron'));
      const earlier = h('button', { type: 'button', class: 'btn small cam-earlier', onclick: () => move(-1) }, 'Earlier');
      const later = h('button', { type: 'button', class: 'btn small cam-later', onclick: () => move(1) }, 'Later');
      const out = h('button', { type: 'button', class: 'btn small danger cam-out', onclick: () => takeOut() }, icon('trash'), 'Take out');
      const box = h('div', { class: 'cam-review', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pictures taken' },
        h('header', { class: 'cam-top' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back to the camera', onclick: () => shut() }, icon('close')), title),
        h('div', { class: 'cam-review-view' }, img, prev, next),
        h('footer', { class: 'cam-review-bar' }, earlier, out, later));
      el.append(box);
      const rl = pushLayer((reason) => shut(reason));
      let gone = false;
      function shut(reason) { if (gone) return; gone = true; if (reason !== 'back') popLayer(rl); box.remove(); shutter.focus({ preventScroll: true }); }
      function show() {
        if (!shots.length) { shut(); return; }
        at = Math.min(Math.max(0, at), shots.length - 1);
        img.src = shots[at].url;
        img.alt = `Picture ${at + 1}`;
        title.textContent = `Picture ${at + 1} of ${shots.length}`;
        prev.disabled = at === 0; next.disabled = at === shots.length - 1;
        earlier.disabled = at === 0; later.disabled = at === shots.length - 1;
      }
      function move(d) {
        const j = at + d;
        if (j < 0 || j >= shots.length) return;
        [shots[at], shots[j]] = [shots[j], shots[at]];
        at = j;
        shots.forEach((s, k) => { s.name = `Photo ${k + 1}`; });
        paint(); show();
      }
      function takeOut() {
        const [s] = shots.splice(at, 1);
        URL.revokeObjectURL(s.url);
        shots.forEach((x, k) => { x.name = `Photo ${k + 1}`; });
        paint(); show();
      }
      show();
    }

    async function toggleLight() {
      if (!track) return;
      try {
        await track.applyConstraints({ advanced: [{ torch: !lightOn }] });
        lightOn = !lightOn;
        lightBtn.setAttribute('aria-pressed', String(lightOn));
        lightBtn.classList.toggle('on', lightOn);
      } catch (e) { toast(`The light could not be switched: ${e.message || e.name}`, 'error'); }
    }
    // ✕ with pictures taken: a second tap within a few seconds throws them away (one tap lost a photo, 17 Nov 2026)
    let cancelArmed = 0;
    function cancel() {
      if (shots.length && Date.now() > cancelArmed) {
        cancelArmed = Date.now() + 4000;
        toast(`Tap ✕ again to throw away ${shots.length === 1 ? 'the picture' : `the ${shots.length} pictures`}, or tap Done to keep ${shots.length === 1 ? 'it' : 'them'}.`);
        return;
      }
      close(false);
    }
    // The phone's camera app: its photo can take several seconds to come back (14 s on the owner's phone), so the
    // screen says what is happening instead of looking stuck
    async function useCameraApp() {
      const before = msg.textContent;
      msg.textContent = 'Waiting for the photo from the camera app… After ✓ there, it can take a few seconds to show here.';
      appBtn.disabled = true;
      try {
        const files = await pickFiles('image/*', { multiple: false, capture: 'environment' });
        if (files.length) msg.textContent = 'Getting the photo ready…';
        for (const f of files) { try { await add(f); } catch (e) { toast(`${f.name}: ${e.message}`, 'error'); } }
        msg.textContent = shots.length && !closed
          ? `${shots.length === 1 ? 'The photo is' : `${shots.length} photos are`} ready: tap Done to use ${shots.length === 1 ? 'it' : 'them'}, or take another with the camera app.`
          : before;
      } finally { appBtn.disabled = false; }
    }
    function noCamera(text) {
      msg.textContent = text;
      msg.classList.remove('hidden');
      shutter.classList.add('hidden');
      zoomRow.classList.add('hidden');
      appBtn.classList.remove('hidden');
    }
    async function keepAwake() {
      try { wake = await navigator.wakeLock?.request('screen'); } catch (e) { wake = null; }
      if (closed && wake) { wake.release().catch(() => {}); wake = null; }
    }
    // the phone drops the wake lock when Kalamo goes to the background: ask again when it comes back
    const onVisible = () => { if (document.visibilityState === 'visible' && !closed && (!wake || wake.released)) keepAwake(); };
    document.addEventListener('visibilitychange', onVisible);
    function close(ok, reason) {
      if (closed) return;
      closed = true;
      if (reason !== 'back') popLayer(layer);
      clearTimeout(zoomTimer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('deviceorientation', onTilt);
      window.removeEventListener('resize', fitGrid);
      if (wake) { wake.release().catch(() => {}); wake = null; }
      if (themeMeta && themeWas != null) themeMeta.content = themeWas;
      document.body.classList.remove('camera-on');
      el.remove();
      for (const s of shots) URL.revokeObjectURL(s.url);
      resolve(ok && shots.length ? shots.map(({ blob, name }) => ({ blob, name })) : null);
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { noCamera('This browser cannot use the camera inside Kalamo.'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
        if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
        track = stream.getVideoTracks()[0] || null;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const caps = track?.getCapabilities?.() || {};
        if (caps.torch) lightBtn.classList.remove('hidden');
        if (caps.zoom && caps.zoom.max > caps.zoom.min) hwZoom = { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0 };
        zoom = zMin();
        makeZoomButtons();
        focusModes = Array.isArray(caps.focusMode) ? caps.focusMode : [];
        canFocus = !!navigator.mediaDevices.getSupportedConstraints?.().pointsOfInterest || focusModes.includes('single-shot');
        if (focusModes.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        keepAwake();
      } catch (e) {
        // Kalamo is a web app installed through Chrome, so its camera permission lives in Chrome, not in Android's app list
        noCamera(e && e.name === 'NotAllowedError'
          ? `Kalamo may not use the camera. To allow it: Chrome → ⋮ → Settings → Site settings → Camera → ${location.host} → Allow. Or use the phone's camera app.`
          : `The camera could not be opened (${e.message || e.name}).`);
      }
    })();
  });
}
