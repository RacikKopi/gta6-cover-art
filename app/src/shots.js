// Fixed scenes for screenshots: ?shot=editor shows the editor with a
// sample photo loaded; ?shot=cover (or ?shot=panels) shows the cover
// alone, controls hidden. Query params: photo / photo2 pick the samples
// (samples/<name>.jpg), caption + subtitle set the words, layout, grade
// and aspect pick the look. window.__shotReady is set once painted, and
// window.__coverRect reports the canvas box for cropping the shot.
export async function runShot(shot, query, ctx) {
  const { state, loadSample, redraw, ensureFonts } = ctx;
  const coverOnly = shot === 'cover' || shot === 'panels';
  if (coverOnly) document.body.classList.add('shot-cover');

  const names = [query.get('photo') ?? 'pier'];
  if (query.get('photo2')) names.push(query.get('photo2'));
  const loaded = [];
  for (const name of names) {
    try {
      // eslint-disable-next-line no-await-in-loop
      loaded.push(await loadSample(name));
    } catch { /* skip a missing sample; the cover still draws */ }
  }
  state.photos = loaded;
  state.names = names.map((n) => `${n}.jpg (sample)`);
  if (ctx.setSrcs) ctx.setSrcs(names.map((n) => `samples/${n}.jpg`));
  state.slots = loaded.map(() => ({ ox: 0, oy: 0, zoom: 1, fit: 'fill' }));
  // Optional hero crop for the shot: &oy shifts the first photo up/down.
  const oy = parseFloat(query.get('oy') ?? 'NaN');
  if (!Number.isNaN(oy) && state.slots[0]) state.slots[0].oy = Math.max(-0.6, Math.min(0.6, oy));
  if (query.get('caption') !== null) state.title = query.get('caption');
  if (query.get('subtitle') !== null) state.subtitle = query.get('subtitle');
  if (query.get('layout')) state.layout = query.get('layout');
  if (query.get('grade')) state.grade = query.get('grade');
  if (query.get('aspect')) state.aspect = query.get('aspect');
  if (query.get('titleFont')) state.titleFont = query.get('titleFont');
  if (query.get('pos')) state.captionPos = query.get('pos');

  // Keep the editor inputs in sync so the editor shot shows real values.
  const titleInput = document.getElementById('title');
  if (titleInput) titleInput.value = state.title;
  const subInput = document.getElementById('subtitle');
  if (subInput) subInput.value = state.subtitle;

  await ensureFonts();
  redraw();
  const cover = document.getElementById('cover');
  const r = cover.getBoundingClientRect();
  window.__coverRect = { x: r.x, y: r.y, width: r.width, height: r.height };
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}
