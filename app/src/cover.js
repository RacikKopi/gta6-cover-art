// Vice City Cover Studio — the renderer.
// Draws any set of photos into a multi-panel GTA 6-style poster cover:
// a per-panel crop, a Vice City grade (gradient tint + grain + vignette),
// and a big bold title with a script subtitle on top. Pure canvas 2D,
// no network, no libraries. The same function paints the on-screen
// preview and the exported PNGs — only the canvas size changes.

export const LAYOUTS = {
  hero3: { label: 'Hero + 3', cells: 4 },
  grid4: { label: 'Grid 4', cells: 4 },
  full: { label: 'Full bleed', cells: 1 },
  tilted: { label: 'Tilted snapshots', cells: 3 },
  strip9: { label: 'Strip 9', cells: 9 },
  grid6: { label: 'Grid 6', cells: 6 },
};

export const GRADES = {
  sunset: {
    label: 'Vice City sunset',
    top: 'rgba(255,170,90,0.10)',
    bottom: 'rgba(214,48,120,0.42)',
    mid: 'rgba(255,110,60,0.20)',
    filter: 'saturate(1.25) contrast(1.08)',
    grain: 0.05,
    vignette: 0.32,
    bg: '#1c0f2e',
  },
  neon: {
    label: 'Neon nights',
    top: 'rgba(0,229,255,0.20)',
    bottom: 'rgba(255,0,128,0.38)',
    mid: 'rgba(120,40,255,0.18)',
    filter: 'saturate(1.45) contrast(1.12) brightness(1.02)',
    grain: 0.06,
    vignette: 0.38,
    bg: '#0a0618',
  },
  noir: {
    label: 'Palm noir',
    top: 'rgba(0,0,0,0.10)',
    bottom: 'rgba(0,0,0,0.55)',
    mid: 'rgba(20,20,40,0.20)',
    filter: 'grayscale(0.75) contrast(1.22) brightness(0.92)',
    grain: 0.09,
    vignette: 0.5,
    bg: '#0b0b0e',
  },
  pink: {
    label: 'Vice pink',
    top: 'rgba(255,150,210,0.22)',
    bottom: 'rgba(255,60,160,0.34)',
    mid: 'rgba(255,110,190,0.16)',
    filter: 'saturate(1.35) contrast(1.05) brightness(1.05)',
    grain: 0.04,
    vignette: 0.28,
    bg: '#2a0a24',
  },
};

/** CSS mirror of a grade for the DOM preview: image filter, overlay
 *  gradient + vignette (one background stack), and grain opacity. */
export function gradeCss(gradeName) {
  const g = GRADES[gradeName] || GRADES.sunset;
  return {
    filter: g.filter || 'none',
    overlay:
      `linear-gradient(180deg, ${g.top} 0%, ${g.mid} 55%, ${g.bottom} 100%), ` +
      `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${g.vignette}) 100%)`,
    grain: g.grain,
    bg: g.bg,
  };
}

/** Cell rectangles (fractions of the cover) for a layout, in draw order. */
export function layoutRects(layout, w, h) {
  const g = 0.008; // gutter, as a fraction of the short side
  const gw = g * Math.min(w, h);
  const gh = g * Math.min(w, h);
  const inset = (r) => ({ x: r.x + gw / 2, y: r.y + gh / 2, w: r.w - gw, h: r.h - gh, rot: r.rot || 0 });
  switch (layout) {
    case 'hero3': {
      const third = w / 3;
      return [
        { x: 0, y: 0, w, h: h * 0.58 },
        { x: 0, y: h * 0.58, w: third, h: h * 0.42 },
        { x: third, y: h * 0.58, w: third, h: h * 0.42 },
        { x: third * 2, y: h * 0.58, w: third, h: h * 0.42 },
      ].map(inset);
    }
    case 'grid4':
      return [
        { x: 0, y: 0, w: w / 2, h: h / 2 },
        { x: w / 2, y: 0, w: w / 2, h: h / 2 },
        { x: 0, y: h / 2, w: w / 2, h: h / 2 },
        { x: w / 2, y: h / 2, w: w / 2, h: h / 2 },
      ].map(inset);
    case 'full':
      return [{ x: 0, y: 0, w, h }].map(inset);
    case 'tilted': {
      const pw = w * 0.44;
      const ph = h * 0.62;
      return [
        { x: w * 0.04, y: h * 0.08, w: pw, h: ph, rot: -0.1 },
        { x: w * 0.52, y: h * 0.05, w: pw, h: ph, rot: 0.07 },
        { x: w * 0.28, y: h * 0.34, w: pw, h: ph, rot: -0.03 },
      ];
    }
    case 'strip9': {
      const cells = [];
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
          cells.push({ x: (c * w) / 3, y: (r * h) / 3, w: w / 3, h: h / 3 });
      return cells.map(inset);
    }
    case 'grid6': {
      const cells = [];
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < 3; c++)
          cells.push({ x: (c * w) / 3, y: (r * h) / 2, w: w / 3, h: h / 2 });
      return cells.map(inset);
    }
    default:
      return layoutRects('hero3', w, h);
  }
}

let noiseCanvas = null;
function noisePattern(ctx) {
  if (!noiseCanvas) {
    noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = 128;
    noiseCanvas.height = 128;
    const nctx = noiseCanvas.getContext('2d');
    const data = nctx.createImageData(128, 128);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = Math.floor(Math.random() * 255);
      data.data[i] = v;
      data.data[i + 1] = v;
      data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
    nctx.putImageData(data, 0, 0);
  }
  return ctx.createPattern(noiseCanvas, 'repeat');
}

/** Draw one photo into a rect, honouring its crop (offset + zoom + fit/fill). */
function drawPhoto(ctx, img, rect, slot) {
  const { ox = 0, oy = 0, zoom = 1, fit = 'fill' } = slot || {};
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  let scale;
  if (fit === 'fit') scale = Math.min(rect.w / iw, rect.h / ih) * zoom;
  else scale = Math.max(rect.w / iw, rect.h / ih) * zoom;
  const pw = iw * scale;
  const ph = ih * scale;
  const cx = rect.x + rect.w / 2 + ox * rect.w;
  const cy = rect.y + rect.h / 2 + oy * rect.h;
  ctx.drawImage(img, cx - pw / 2, cy - ph / 2, pw, ph);
}

/** Paint the whole cover. `state` holds photos, layout, grade and caption. */
export function drawCover(canvas, state) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const grade = GRADES[state.grade] || GRADES.sunset;
  const photos = state.photos || [];
  const slots = state.slots || photos.map(() => ({ ox: 0, oy: 0, zoom: 1, fit: 'fill' }));

  ctx.save();
  ctx.fillStyle = grade.bg;
  ctx.fillRect(0, 0, w, h);

  // Soft sunset backdrop so tilted snapshots sit on something, not void.
  if (state.layout === 'tilted') {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#ff9a56');
    bg.addColorStop(0.5, '#e84393');
    bg.addColorStop(1, '#2d1b69');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }

  const rects = layoutRects(state.layout || 'hero3', w, h);
  const grain = noisePattern(ctx);

  rects.forEach((rect, i) => {
    const slotIndex = i % Math.max(photos.length, 1);
    const img = photos[slotIndex];
    const slot = slots[slotIndex] || {};
    ctx.save();
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    if (rect.rot) ctx.rotate(rect.rot);
    ctx.translate(-rect.w / 2, -rect.h / 2);
    if (state.layout === 'tilted') {
      // Polaroid-style white frame around each tilted snapshot.
      ctx.fillStyle = '#fdf8ef';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = rect.w * 0.05;
      ctx.shadowOffsetY = rect.w * 0.02;
      ctx.fillRect(-rect.w * 0.03, -rect.h * 0.03, rect.w * 1.06, rect.h * 1.09);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.beginPath();
    ctx.rect(0, 0, rect.w, rect.h);
    ctx.clip();
    if (img) {
      ctx.filter = grade.filter || 'none';
      drawPhoto(ctx, img, { x: 0, y: 0, w: rect.w, h: rect.h }, slot);
      ctx.filter = 'none';
    } else {
      ctx.fillStyle = '#3a2350';
      ctx.fillRect(0, 0, rect.w, rect.h);
    }
    // Grade: vertical gradient tint + grain + vignette, per panel.
    const tint = ctx.createLinearGradient(0, 0, 0, rect.h);
    tint.addColorStop(0, grade.top);
    tint.addColorStop(0.55, grade.mid);
    tint.addColorStop(1, grade.bottom);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, rect.w, rect.h);
    ctx.globalAlpha = grade.grain;
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, rect.w, rect.h);
    ctx.globalAlpha = 1;
    const vig = ctx.createRadialGradient(
      rect.w / 2, rect.h / 2, Math.min(rect.w, rect.h) * 0.35,
      rect.w / 2, rect.h / 2, Math.max(rect.w, rect.h) * 0.75,
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, `rgba(0,0,0,${grade.vignette})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, rect.w, rect.h);
    ctx.restore();
  });

  drawCaption(ctx, w, h, state);
  ctx.restore();
}

function fitFont(ctx, text, family, maxWidth, startSize) {
  let size = startSize;
  // NOTE: no weight in the font string — the headless renderer this entry
  // is screenshotted with misparses "<weight> <size>px" (it reads the
  // weight as the size), so keep the string to "<size>px <family>".
  ctx.font = `${size}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && size > 10) {
    size -= 2;
    ctx.font = `${size}px ${family}`;
  }
  return size;
}

/** Big title + script subtitle, top or bottom, with outline + shadow. */
export function drawCaption(ctx, w, h, state) {
  const title = (state.title || '').trim();
  const subtitle = (state.subtitle || '').trim();
  if (!title && !subtitle) return;
  const pos = state.captionPos || 'bottom';
  const titleFamily = state.titleFont === 'bebas' ? '"Bebas Neue", sans-serif' : '"Anton", sans-serif';
  const base = Math.min(w, h);
  const titleSize = title
    ? fitFont(ctx, title.toUpperCase(), titleFamily, w * 0.92, base * (state.titleSize ?? 0.11))
    : 0;
  const subSize = base * 0.045;

  // Legibility scrim behind the caption band.
  const bandH = h * 0.26;
  const scrim = ctx.createLinearGradient(0, pos === 'top' ? 0 : h - bandH, 0, pos === 'top' ? bandH : h);
  if (pos === 'top') {
    scrim.addColorStop(0, 'rgba(0,0,0,0.55)');
    scrim.addColorStop(1, 'rgba(0,0,0,0)');
  } else {
    scrim.addColorStop(0, 'rgba(0,0,0,0)');
    scrim.addColorStop(1, 'rgba(0,0,0,0.6)');
  }
  ctx.fillStyle = scrim;
  ctx.fillRect(0, pos === 'top' ? 0 : h - bandH, w, bandH);

  // Manual centring (measure + left-aligned draw): the headless renderer
  // used for screenshots ignores ctx.textAlign, so never rely on it.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const cx = w / 2;
  let titleY;
  let subY;
  if (pos === 'top') {
    titleY = h * 0.05 + titleSize;
    subY = titleY + subSize * 1.5;
  } else if (subtitle) {
    subY = h - h * 0.045;
    titleY = subY - subSize * 1.4 - titleSize * 0.12;
  } else {
    titleY = h - h * 0.05;
    subY = titleY;
  }

  const drawCentred = (text, y, fill) => {
    const tw = ctx.measureText(text).width;
    const x = cx - tw / 2;
    if (fill) ctx.fillText(text, x, y);
    else ctx.strokeText(text, x, y);
  };

  if (subtitle) {
    ctx.font = `${subSize}px "Pacifico", cursive`;
    ctx.fillStyle = '#ffd166';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = subSize * 0.25;
    drawCentred(subtitle, subY, true);
    ctx.shadowBlur = 0;
  }
  if (title) {
    ctx.font = `${titleSize}px ${titleFamily}`;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = titleSize * 0.12;
    ctx.shadowOffsetY = titleSize * 0.04;
    const upper = title.toUpperCase();
    if (state.outline !== false) {
      ctx.lineWidth = Math.max(2, titleSize * 0.09);
      ctx.strokeStyle = '#12081f';
      ctx.lineJoin = 'round';
      drawCentred(upper, titleY, false);
    }
    ctx.fillStyle = '#ffffff';
    drawCentred(upper, titleY, true);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
}
