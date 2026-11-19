// Vice City Cover Studio — the editor.
// Owns the page state (up to 4 photos, per-photo crop, layout, grade,
// caption), wires every control, drag-pans the selected panel, and
// exports the cover as PNG at 1080x1080, 1080x1350 or 1920x1080.
//
// The on-screen preview is DOM, not canvas: each panel is an <img> with
// CSS crop/filter/grade overlays, because the headless renderer used for
// screenshots cannot rasterise images into a canvas (its drawImage is a
// no-op for every source). The export still paints the same state onto an
// offscreen canvas with drawCover() — the standard path that works in any
// real browser. A `?shot=` query sets up a fixed scene for a screenshot
// instead (./shots.js).
import { drawCover, layoutRects, gradeCss, LAYOUTS, GRADES } from './cover.js';
import { runShot } from './shots.js';

// Headless-check hooks: collect page errors, and a ?selftest=export query
// runs one export after the shot scene is ready and records its result.
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.type)));

const coverEl = document.getElementById('cover');
const panelsEl = document.getElementById('panels');
const captionLayer = document.getElementById('captionLayer');
const titleEl = document.getElementById('coverTitle');
const subtitleEl = document.getElementById('coverSubtitle');
const status = document.getElementById('status');
const $ = (id) => document.getElementById(id);

export const EXPORT_SIZES = {
  square: { w: 1080, h: 1080, label: '1080 × 1080' },
  portrait: { w: 1080, h: 1350, label: '1080 × 1350' },
  landscape: { w: 1920, h: 1080, label: '1920 × 1080' },
};

const state = {
  photos: [], // HTMLImageElement, up to 4 slots
  srcs: [], // URL for each photo's <img> (sample path or object URL)
  names: [],
  slots: [], // { ox, oy, zoom, fit } per photo slot
  layout: 'hero3',
  grade: 'sunset',
  title: 'Sunset Heist',
  subtitle: 'welcome to Vice City',
  titleFont: 'anton',
  titleSize: 0.11,
  captionPos: 'bottom',
  outline: true,
  aspect: 'landscape',
};
let selected = 0; // selected photo slot (0..3)
let lastSig = '';
window.__state = state; // headless-check handle (photo count, sizes, layout)

function setStatus(msg) {
  status.textContent = msg;
}

/** Loads an image from a URL, resolving once it can be drawn. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${url}`));
    img.src = url;
  });
}

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load('40px "Anton"'),
      document.fonts.load('40px "Bebas Neue"'),
      document.fonts.load('40px "Pacifico"'),
    ]);
    await document.fonts.ready;
  } catch { /* fall back to system fonts; the cover still draws */ }
}

function defaultSlot() {
  return { ox: 0, oy: 0, zoom: 1, fit: 'fill' };
}

// ---- DOM preview ----
function coverPx() {
  const s = EXPORT_SIZES[state.aspect] || EXPORT_SIZES.landscape;
  const shot = document.body.classList.contains('shot-cover');
  const availW = shot ? window.innerWidth : Math.max(320, document.querySelector('.stage').clientWidth - 56);
  const availH = shot ? window.innerHeight : Math.max(320, window.innerHeight - 56);
  const scale = Math.min(availW / s.w, availH / s.h);
  return { w: Math.round(s.w * scale), h: Math.round(s.h * scale) };
}

function imgStyle(slot) {
  // Pan via object-position (50% = centred), zoom via scale. object-fit
  // cover/fill matches the canvas fill/fit crop closely enough to preview.
  return {
    objectPosition: `${Math.round((0.5 + (slot.ox || 0)) * 100)}% ${Math.round((0.5 + (slot.oy || 0)) * 100)}%`,
    transform: `scale(${slot.zoom || 1})`,
  };
}

function buildPanels() {
  const rects = layoutRects(state.layout || 'hero3', 100, 100);
  const g = gradeCss(state.grade);
  coverEl.classList.toggle('tilted-bg', state.layout === 'tilted');
  panelsEl.innerHTML = '';
  rects.forEach((rect, i) => {
    const slotIndex = i % Math.max(state.photos.length, 1);
    const slot = state.slots[slotIndex] || defaultSlot();
    const panel = document.createElement('div');
    panel.className = `panel${state.layout === 'tilted' ? ' tilted' : ''}${slotIndex === selected ? ' selected' : ''}`;
    panel.dataset.i = String(i);
    panel.style.left = `${rect.x}%`;
    panel.style.top = `${rect.y}%`;
    panel.style.width = `${rect.w}%`;
    panel.style.height = `${rect.h}%`;
    if (rect.rot) panel.style.transform = `rotate(${rect.rot}rad)`;
    const img = state.photos[slotIndex];
    const st = imgStyle(slot);
    panel.innerHTML = `
      <div class="panel-frame"><div class="panel-clip">
        ${img ? `<img src="${state.srcs[slotIndex]}" alt="" class="${slot.fit === 'fit' ? 'fit' : ''}" style="object-position:${st.objectPosition};transform:${st.transform};filter:${g.filter}">` : ''}
        <div class="grade-overlay" style="background:${g.overlay}"></div>
        <div class="grain-overlay" style="opacity:${g.grain}"></div>
      </div></div>`;
    panelsEl.appendChild(panel);
  });
}

/** Light update after a drag/zoom: only the affected <img> styles. */
function updateCrop() {
  panelsEl.querySelectorAll('.panel').forEach((panel) => {
    const slotIndex = Number(panel.dataset.i) % Math.max(state.photos.length, 1);
    const slot = state.slots[slotIndex];
    const img = panel.querySelector('img');
    if (!slot || !img) return;
    const st = imgStyle(slot);
    img.style.objectPosition = st.objectPosition;
    img.style.transform = st.transform;
    img.className = slot.fit === 'fit' ? 'fit' : '';
  });
  panelsEl.querySelectorAll('.panel').forEach((panel) => {
    const slotIndex = Number(panel.dataset.i) % Math.max(state.photos.length, 1);
    panel.classList.toggle('selected', slotIndex === selected);
  });
}

function renderCaption(sizePx) {
  const base = Math.min(sizePx.w, sizePx.h);
  titleEl.textContent = state.title.trim().toUpperCase();
  subtitleEl.textContent = state.subtitle.trim();
  titleEl.style.fontSize = `${Math.round(base * state.titleSize)}px`;
  subtitleEl.style.fontSize = `${Math.round(base * 0.045)}px`;
  titleEl.classList.toggle('bebas', state.titleFont === 'bebas');
  titleEl.classList.toggle('outline', state.outline !== false);
  captionLayer.classList.toggle('top', state.captionPos === 'top');
  titleEl.style.display = state.title.trim() ? '' : 'none';
  subtitleEl.style.display = state.subtitle.trim() ? '' : 'none';
}

function redraw() {
  const sizePx = coverPx();
  coverEl.style.width = `${sizePx.w}px`;
  coverEl.style.height = `${sizePx.h}px`;
  const sig = JSON.stringify([state.layout, state.grade, state.aspect, state.photos.length, state.names, state.slots.map((s) => s.fit)]);
  if (sig !== lastSig) {
    buildPanels();
    lastSig = sig;
  } else {
    updateCrop();
  }
  renderCaption(sizePx);
  renderSlots();
  renderPanelButtons();
}

async function addFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 4 - state.photos.length);
  if (!list.length) {
    setStatus(state.photos.length >= 4 ? 'Already 4 photos — remove one first.' : 'Pick an image file.');
    return;
  }
  for (const file of list) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      state.photos.push(img);
      state.srcs.push(url);
      state.names.push(file.name);
      state.slots.push(defaultSlot());
    } catch {
      URL.revokeObjectURL(url);
      setStatus(`Could not read ${file.name}.`);
    }
  }
  selected = state.photos.length - 1;
  lastSig = '';
  setStatus(`${state.photos.length} photo${state.photos.length > 1 ? 's' : ''} loaded. Click a panel to crop it.`);
  redraw();
}

async function loadSample(name) {
  const img = await loadImage(`samples/${name}.jpg`);
  return img;
}

async function useSample(name) {
  if (state.photos.length >= 4) {
    setStatus('Already 4 photos — remove one first.');
    return;
  }
  try {
    const img = await loadSample(name);
    state.photos.push(img);
    state.srcs.push(`samples/${name}.jpg`);
    state.names.push(`${name}.jpg (sample)`);
    state.slots.push(defaultSlot());
    selected = state.photos.length - 1;
    lastSig = '';
    setStatus(`Sample ${name}.jpg added to panel ${selected + 1}.`);
    redraw();
  } catch {
    setStatus(`Sample ${name}.jpg failed to load.`);
  }
}

// ---- panel editor (one row per photo slot) ----
function renderSlots() {
  const wrap = $('slots');
  wrap.innerHTML = '';
  state.photos.forEach((img, i) => {
    const row = document.createElement('div');
    row.className = `slot${i === selected ? ' selected' : ''}`;
    row.innerHTML = `
      <button type="button" class="slot-name" data-i="${i}">${i + 1}. ${escapeHtml(state.names[i] || 'photo')}</button>
      <button type="button" class="mini" data-act="fill" data-i="${i}">Fill</button>
      <button type="button" class="mini" data-act="fit" data-i="${i}">Fit</button>
      <button type="button" class="mini danger" data-act="remove" data-i="${i}">✕</button>`;
    wrap.appendChild(row);
  });
  if (!state.photos.length) {
    wrap.innerHTML = '<p class="hint">No photos yet — upload some or add a sample.</p>';
  }
  wrap.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      const act = btn.dataset.act;
      if (act === 'remove') {
        if (state.srcs[i] && state.srcs[i].startsWith('blob:')) URL.revokeObjectURL(state.srcs[i]);
        state.photos.splice(i, 1);
        state.srcs.splice(i, 1);
        state.names.splice(i, 1);
        state.slots.splice(i, 1);
        selected = Math.max(0, Math.min(selected, state.photos.length - 1));
        setStatus('Photo removed.');
      } else {
        state.slots[i].fit = act;
        setStatus(`Panel ${i + 1}: ${act === 'fill' ? 'fill the panel' : 'fit inside the panel'}.`);
      }
      lastSig = '';
      redraw();
    });
  });
  wrap.querySelectorAll('.slot-name').forEach((btn) => {
    btn.addEventListener('click', () => {
      selected = Number(btn.dataset.i);
      syncZoom();
      redraw();
    });
  });
  $('zoomVal').textContent = `${Math.round((state.slots[selected]?.zoom ?? 1) * 100)}%`;
}

function renderPanelButtons() {
  document.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout));
  document.querySelectorAll('[data-grade]').forEach((b) => b.classList.toggle('active', b.dataset.grade === state.grade));
  document.querySelectorAll('[data-aspect]').forEach((b) => b.classList.toggle('active', b.dataset.aspect === state.aspect));
}

function syncZoom() {
  const slot = state.slots[selected];
  if (!slot) return;
  $('zoomVal').textContent = `${Math.round(slot.zoom * 100)}%`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- cover interaction: click selects a panel, drag pans its photo ----
let drag = null;
panelsEl.addEventListener('pointerdown', (e) => {
  const panel = e.target.closest('.panel');
  if (!panel || !state.photos.length) return;
  const slotIndex = Number(panel.dataset.i) % state.photos.length;
  selected = slotIndex;
  syncZoom();
  const rect = panel.getBoundingClientRect();
  drag = { x: e.clientX, y: e.clientY, slot: state.slots[slotIndex], rect };
  panelsEl.setPointerCapture(e.pointerId);
  updateCrop();
  renderSlots();
});
panelsEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = (e.clientX - drag.x) / drag.rect.width;
  const dy = (e.clientY - drag.y) / drag.rect.height;
  drag.slot.ox = Math.max(-0.6, Math.min(0.6, drag.slot.ox + dx));
  drag.slot.oy = Math.max(-0.6, Math.min(0.6, drag.slot.oy + dy));
  drag.x = e.clientX;
  drag.y = e.clientY;
  updateCrop();
});
panelsEl.addEventListener('pointerup', () => { drag = null; });

// ---- controls ----
$('photo').addEventListener('change', (e) => addFiles(e.target.files));
const drop = $('drop');
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
drop.addEventListener('click', () => $('photo').click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('photo').click(); });

document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => useSample(b.dataset.sample)));

document.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => {
  state.layout = b.dataset.layout;
  setStatus(`Layout: ${LAYOUTS[state.layout].label}.`);
  redraw();
}));
document.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', () => {
  state.grade = b.dataset.grade;
  setStatus(`Grade: ${GRADES[state.grade].label}.`);
  redraw();
}));
document.querySelectorAll('[data-aspect]').forEach((b) => b.addEventListener('click', () => {
  state.aspect = b.dataset.aspect;
  setStatus(`Preview aspect: ${EXPORT_SIZES[state.aspect].label}.`);
  redraw();
}));

function bumpZoom(delta) {
  const slot = state.slots[selected];
  if (!slot) return;
  slot.zoom = Math.max(0.5, Math.min(3, Math.round((slot.zoom + delta) * 100) / 100));
  syncZoom();
  updateCrop();
}
$('zoomIn').addEventListener('click', () => bumpZoom(0.1));
$('zoomOut').addEventListener('click', () => bumpZoom(-0.1));
$('fitBtn').addEventListener('click', () => { if (state.slots[selected]) { state.slots[selected].fit = 'fit'; lastSig = ''; redraw(); } });
$('fillBtn').addEventListener('click', () => { if (state.slots[selected]) { state.slots[selected].fit = 'fill'; lastSig = ''; redraw(); } });
$('resetCrop').addEventListener('click', () => {
  if (state.slots[selected]) { state.slots[selected] = defaultSlot(); syncZoom(); updateCrop(); setStatus('Crop reset.'); }
});

$('title').addEventListener('input', (e) => { state.title = e.target.value; redraw(); });
$('subtitle').addEventListener('input', (e) => { state.subtitle = e.target.value; redraw(); });
$('titleFont').addEventListener('change', (e) => { state.titleFont = e.target.value; redraw(); });
function bumpTitleSize(delta) {
  state.titleSize = Math.max(0.06, Math.min(0.2, Math.round((state.titleSize + delta) * 1000) / 1000));
  $('titleSizeVal').textContent = `${Math.round(state.titleSize * 100)}%`;
  redraw();
}
$('titleSizeIn').addEventListener('click', () => bumpTitleSize(0.01));
$('titleSizeOut').addEventListener('click', () => bumpTitleSize(-0.01));
$('captionPos').addEventListener('change', (e) => { state.captionPos = e.target.value; redraw(); });
$('outline').addEventListener('change', (e) => { state.outline = e.target.checked; redraw(); });

window.addEventListener('resize', () => redraw());

// ---- export (offscreen canvas; works in any real browser) ----
function exportSize(key) {
  return new Promise((resolve) => {
    const s = EXPORT_SIZES[key];
    const off = document.createElement('canvas');
    off.width = s.w;
    off.height = s.h;
    drawCover(off, state);
    off.toBlob((blob) => {
      if (!blob) { setStatus('Export failed — canvas is empty.'); resolve(false); return; }
      window.__lastExport = { key, bytes: blob.size, w: s.w, h: s.h };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `vice-city-cover-${s.w}x${s.h}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setStatus(`Saved vice-city-cover-${s.w}x${s.h}.png`);
      resolve(true);
    }, 'image/png');
  });
}
window.__exportSize = exportSize; // headless check hook
document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportSize(b.dataset.export)));
$('exportAll').addEventListener('click', async () => {
  for (const key of Object.keys(EXPORT_SIZES)) {
    // eslint-disable-next-line no-await-in-loop
    await exportSize(key);
    await new Promise((r) => setTimeout(r, 250));
  }
  setStatus('All 3 sizes exported.');
});

// ---- boot ----
const query = new URLSearchParams(location.search);
const shot = query.get('shot');
if (query.get('selftest') === 'export') {
  const poll = setInterval(async () => {
    if (window.__shotReady) {
      clearInterval(poll);
      const ok = await window.__exportSize('square');
      window.__selftest = { ok, lastExport: window.__lastExport || null };
    }
  }, 100);
  setTimeout(() => clearInterval(poll), 10000);
}
if (shot) {
  runShot(shot, query, {
    state,
    loadSample,
    redraw,
    ensureFonts,
    setStatus,
    setSelected: (i) => { selected = i; },
    setSrcs: (srcs) => { state.srcs = srcs; },
  });
} else {
  (async () => {
    await ensureFonts();
    // Start with both samples so the studio is never an empty frame.
    try {
      const [pier, boulevard] = await Promise.all([loadSample('pier'), loadSample('boulevard')]);
      state.photos = [pier, boulevard];
      state.srcs = ['samples/pier.jpg', 'samples/boulevard.jpg'];
      state.names = ['pier.jpg (sample)', 'boulevard.jpg (sample)'];
      state.slots = [defaultSlot(), defaultSlot()];
    } catch { /* samples missing: editor still works with uploads */ }
    redraw();
    setStatus('Ready — drag a photo on the cover to reposition it.');
  })();
}
