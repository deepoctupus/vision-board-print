import { makeRng, range, gaussian } from '../core/rng.js';
import { tornOutline, pathFromPoints } from './torn.js';
import { buildShape } from './shapes.js';
import { buildDecor } from './decor/index.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const DEG = Math.PI / 180;

export { CUT_STYLES, CUT_LABELS } from './shapes.js';

/** Colour treatments, applied through the canvas filter so export matches preview. */
export const TINTS = {
  bw: 'grayscale(1) contrast(1.06)',
  noir: 'grayscale(1) contrast(1.4) brightness(0.94)',
  sepia: 'sepia(0.6) contrast(1.05) saturate(0.92)',
  warm: 'saturate(1.14) sepia(0.16) brightness(1.02)',
  cool: 'saturate(1.06) hue-rotate(-12deg) brightness(1.02)',
  fade: 'contrast(0.84) saturate(0.76) brightness(1.09)',
  vivid: 'saturate(1.45) contrast(1.12)',
};

export const TINT_LABELS = {
  none: 'Original',
  bw: 'P&B',
  noir: 'Noir',
  sepia: 'Sépia',
  warm: 'Quente',
  cool: 'Frio',
  fade: 'Desbotado',
  vivid: 'Vivo',
};

/**
 * Draws a complete board. The only difference between the on-screen preview and
 * a 300 DPI print file is `pxPerMm` and which bitmap each asset resolves to, so
 * what the user sees really is what they get.
 */
export function renderBoard(ctx, options) {
  const {
    state,
    layout,
    pxPerMm,
    resolveSource,
    mode = 'preview',
    bleedMm = 0,
    cropMarks = false,
    selectedId = null,
    dragId = null,
  } = options;

  const { board, cells } = layout;
  const W = board.widthMm;
  const H = board.heightMm;

  ctx.save();
  ctx.translate(bleedMm * pxPerMm, bleedMm * pxPerMm);

  drawSurface(ctx, state, W, H, pxPerMm, resolveSource, bleedMm);

  for (const cell of cells) {
    const source = resolveSource(cell.assetId);
    drawCell(ctx, cell, state, pxPerMm, source, {
      selected: mode === 'preview' && cell.itemId === selectedId,
      dragging: cell.itemId === dragId,
    });
  }

  if (state.caption?.enabled && state.caption.text.trim()) {
    drawCaption(ctx, state, W, H, pxPerMm);
  }

  ctx.restore();

  if (cropMarks && bleedMm > 0) drawCropMarks(ctx, W, H, pxPerMm, bleedMm);
}

/**
 * How far a piece is rotated on the board. Exported because hit testing has to
 * use the exact number the draw used, or clicks land next to the photo.
 */
export function cellTilt(cell, state) {
  const manual = cell.item?.tiltDeg;
  if (manual !== null && manual !== undefined) return clamp(manual, -180, 180);
  if (cell.rot) return clamp(cell.rot, -22, 22);
  if (state.layout.engine === 'scatter') return 0;
  const spread = gaussian(makeRng(cell.seed ^ 0x51ed270b)) * state.style.tilt * 4.5 * 0.6;
  return clamp(spread, -22, 22);
}

/* ---------------------------------------------------------------- surface -- */

function drawSurface(ctx, state, W, H, pxPerMm, resolveSource, bleedMm) {
  const s = state.surface;
  const w = W * pxPerMm;
  const h = H * pxPerMm;
  const over = bleedMm * pxPerMm;

  ctx.save();
  ctx.beginPath();
  ctx.rect(-over, -over, w + over * 2, h + over * 2);
  ctx.clip();

  if (s.kind === 'gradient') {
    const a = (s.angle || 145) * DEG;
    const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
    const cx = w / 2;
    const cy = h / 2;
    const g = ctx.createLinearGradient(
      cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2,
      cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2
    );
    g.addColorStop(0, s.color);
    g.addColorStop(1, s.colorB);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = s.color;
  }
  ctx.fillRect(-over, -over, w + over * 2, h + over * 2);

  if (s.kind === 'image' && s.assetId) {
    const src = resolveSource(s.assetId);
    if (src) {
      drawCover(ctx, src, { x: -over, y: -over, w: w + over * 2, h: h + over * 2 }, { x: 0.5, y: 0.5 }, 1, { x: 0, y: 0 });
    }
  }

  if (s.grain > 0) {
    const pattern = grainPattern(ctx, pxPerMm, s.grain);
    if (pattern) {
      ctx.save();
      ctx.globalAlpha = clamp(s.grain, 0, 1) * 0.5;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = pattern;
      ctx.fillRect(-over, -over, w + over * 2, h + over * 2);
      ctx.restore();
    }
  }

  if (s.vignette > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(28,20,12,${clamp(s.vignette, 0, 1) * 0.5})`);
    ctx.fillStyle = g;
    ctx.fillRect(-over, -over, w + over * 2, h + over * 2);
  }

  ctx.restore();
}

/**
 * Paper grain is generated at whatever pixel density the current render needs so
 * that one tile always covers the same 24 mm of board. Scaling a fixed-size tile
 * instead would either vanish on screen or moire in print.
 */
const grainCache = new Map();
function grainPattern(ctx, pxPerMm, strength) {
  const tileMm = 24;
  const size = clamp(Math.round(tileMm * pxPerMm), 48, 640);
  const key = `${size}`;
  let tile = grainCache.get(key);

  if (!tile) {
    tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const tctx = tile.getContext('2d');
    const img = tctx.createImageData(size, size);
    const rng = makeRng(0xbeef);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 236 + Math.round(gaussian(rng) * 13);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(v, 200, 255);
      img.data[i + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    if (grainCache.size > 4) grainCache.delete(grainCache.keys().next().value);
    grainCache.set(key, tile);
  }

  return strength > 0 ? ctx.createPattern(tile, 'repeat') : null;
}

/* ------------------------------------------------------------------- cell -- */

function drawCell(ctx, cell, state, pxPerMm, source, flags) {
  const style = state.style;
  const item = cell.item;
  const cut = item?.cutOverride || style.cut;
  const cx = (cell.x + cell.w / 2) * pxPerMm;
  const cy = (cell.y + cell.h / 2) * pxPerMm;

  const rng = makeRng(cell.seed ^ 0x7c1a3f05);
  const tilt = cellTilt(cell, state);
  const tone = style.paperTone || '#fdfaf4';

  ctx.save();
  ctx.translate(cx, cy);
  if (tilt) ctx.rotate(tilt * DEG);
  if (flags.dragging) ctx.globalAlpha = 0.75;

  const geom = buildGeometry(cut, cell, style, pxPerMm);
  const elevation = clamp(style.shadow * (item?.elevation ?? 1), 0, 1.5);

  drawShadow(ctx, geom.silhouette || geom.paper, elevation, pxPerMm, flags.dragging);

  // The lower ply sits a fraction of a millimetre proud of the printed face and
  // reads as the thickness of the sheet.
  if (geom.silhouette) {
    ctx.fillStyle = paperShade(tone, 0.18, 1);
    ctx.fill(geom.silhouette);
  }

  ctx.fillStyle = tone;
  ctx.fill(geom.paper, geom.rule);

  ctx.save();
  ctx.clip(geom.photo, geom.rule);
  if (source) {
    const tint = TINTS[item?.tint];
    if (tint) ctx.filter = tint;
    drawCover(ctx, source, geom.photoBox, item?.focal || { x: 0.5, y: 0.5 },
      item?.zoom || 1, item?.offset || { x: 0, y: 0 }, item?.rotationDeg || 0);
    if (tint) ctx.filter = 'none';
  } else {
    ctx.fillStyle = '#d9d2c6';
    ctx.fillRect(geom.photoBox.x, geom.photoBox.y, geom.photoBox.w, geom.photoBox.h);
  }
  ctx.restore();

  // Whatever the category prints on the object: ticket numbers, a wax seal, the
  // dimension lines of a floor plan. After the photo, before the frame.
  if (geom.decorate) {
    ctx.save();
    geom.decorate(ctx, { pxPerMm, tone, seed: cell.seed, w: cell.w, h: cell.h, geom });
    ctx.restore();
  }

  if (item?.frameMm > 0) drawInnerFrame(ctx, geom, item, pxPerMm);

  if (cut === 'torn' && geom.outline) drawTornDetail(ctx, geom, tone, pxPerMm);
  else drawEdgeDepth(ctx, geom.photo, pxPerMm, geom.rule);

  if (style.tape > 0) drawTape(ctx, cell, style, pxPerMm, rng);

  if (flags.selected) {
    ctx.strokeStyle = 'rgba(230,92,45,0.95)';
    ctx.lineWidth = Math.max(1.5, 0.5 * pxPerMm);
    ctx.stroke(geom.paper);
  }

  ctx.restore();
}

/** All paths are built centred on the origin so rotation needs no extra offset. */
function buildGeometry(cut, cell, style, pxPerMm) {
  if (cut === 'torn') {
    const outline = tornOutline(cell.w, cell.h, cell.seed, {
      tear: style.tear,
      fringe: style.fringe,
      detail: pxPerMm > 6 ? 1.6 : 1,
    });
    return {
      silhouette: pathFromPoints(outline.back, pxPerMm),
      paper: pathFromPoints(outline.outer, pxPerMm),
      photo: pathFromPoints(outline.inner, pxPerMm),
      band: pathFromPoints(outline.band, pxPerMm),
      bandCore: pathFromPoints(outline.bandCore, pxPerMm),
      photoBox: { x: (-cell.w / 2) * pxPerMm, y: (-cell.h / 2) * pxPerMm, w: cell.w * pxPerMm, h: cell.h * pxPerMm },
      outline,
    };
  }

  const options = {
    w: cell.w,
    h: cell.h,
    pxPerMm,
    seed: cell.seed,
    radiusMm: style.radiusMm,
  };

  // A category style is just another cut id, so it gets first refusal before the
  // plain shapes. Unknown ids fall through and `buildShape` decides.
  return buildDecor(cut, options) || buildShape(cut, options);
}

/**
 * A printed border, drawn by stroking the silhouette from inside a clip of
 * itself. Half the stroke falls outside and is discarded, which lands the border
 * exactly on the edge whatever shape it is — including the torn one.
 */
function drawInnerFrame(ctx, geom, item, pxPerMm) {
  ctx.save();
  ctx.clip(geom.paper, geom.rule);
  ctx.strokeStyle = item.frameColor || '#ffffff';
  ctx.lineWidth = item.frameMm * 2 * pxPerMm;
  ctx.lineJoin = 'round';
  ctx.stroke(geom.paper);
  ctx.restore();
}

/**
 * Two passes: a tight dark contact shadow where paper meets board, and a wide
 * soft one for ambient occlusion. A single blurred shadow reads as a sticker.
 */
function drawShadow(ctx, path, strength, pxPerMm, lifted) {
  if (strength <= 0) return;
  const s = clamp(strength, 0, 1);
  const lift = lifted ? 2.4 : 1;

  ctx.save();
  ctx.shadowColor = `rgba(40,28,18,${0.16 * s * lift})`;
  ctx.shadowBlur = 3.2 * pxPerMm * lift;
  ctx.shadowOffsetY = 1.6 * pxPerMm * lift;
  ctx.fillStyle = '#000';
  ctx.fill(path);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = `rgba(38,26,16,${0.3 * s})`;
  ctx.shadowBlur = 0.85 * pxPerMm * lift;
  ctx.shadowOffsetY = 0.35 * pxPerMm * lift;
  ctx.fillStyle = '#000';
  ctx.fill(path);
  ctx.restore();
}

/**
 * What actually sells a tear, in the order paper presents it: the pale core the
 * print has been stripped off, the hairline of shade where the ink layer ends,
 * fibres bridging the boundary, and shed dust past it. The core is filled as a
 * band rather than stroked because its width has to vary along the edge — a
 * constant white outline is the single clearest sign of a fake tear.
 */
function drawTornDetail(ctx, geom, tone, pxPerMm) {
  const { outline } = geom;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.fillStyle = paperShade(tone, -0.42, 0.55);
  ctx.fill(geom.band);
  ctx.fillStyle = paperShade(tone, -0.62, 0.92);
  ctx.fill(geom.bandCore);

  ctx.strokeStyle = 'rgba(84,64,42,0.22)';
  ctx.lineWidth = Math.max(0.5, 0.16 * pxPerMm);
  ctx.stroke(geom.photo);

  const weights = [
    { color: 'rgba(255,255,252,0.70)', width: 0.075 },
    { color: 'rgba(168,148,120,0.38)', width: 0.06 },
    { color: 'rgba(255,252,244,0.45)', width: 0.11 },
  ];
  outline.fibers.forEach((bucket, i) => {
    if (!bucket.length) return;
    const w = weights[i % weights.length];
    ctx.strokeStyle = w.color;
    ctx.lineWidth = Math.max(0.4, w.width * pxPerMm);
    ctx.beginPath();
    for (const f of bucket) {
      ctx.moveTo(f.x0 * pxPerMm, f.y0 * pxPerMm);
      ctx.lineTo(f.x1 * pxPerMm, f.y1 * pxPerMm);
    }
    ctx.stroke();
  });

  outline.dust.forEach((bucket, i) => {
    if (!bucket.length) return;
    ctx.fillStyle = `rgba(255,252,243,${i === 0 ? 0.34 : 0.18})`;
    ctx.beginPath();
    for (const d of bucket) {
      const r = Math.max(0.3, d.r * pxPerMm);
      ctx.moveTo(d.x * pxPerMm + r, d.y * pxPerMm);
      ctx.arc(d.x * pxPerMm, d.y * pxPerMm, r, 0, Math.PI * 2);
    }
    ctx.fill();
  });

  ctx.restore();
}

/** A hairline of contact shading so clean-cut styles do not float. */
function drawEdgeDepth(ctx, path, pxPerMm, rule) {
  ctx.save();
  ctx.strokeStyle = 'rgba(60,44,30,0.13)';
  ctx.lineWidth = Math.max(0.5, 0.18 * pxPerMm);
  ctx.stroke(path, rule);
  ctx.restore();
}

const toneCache = new Map();

/** Negative amounts lift the tone toward white, positive ones toward black. */
function paperShade(hex, amount, alpha) {
  let rgb = toneCache.get(hex);
  if (!rgb) {
    rgb = parseHex(hex);
    if (toneCache.size > 32) toneCache.clear();
    toneCache.set(hex, rgb);
  }
  const target = amount < 0 ? 255 : 0;
  const k = Math.abs(amount);
  const c = rgb.map((v) => Math.round(v + (target - v) * k));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return [253, 250, 244];
  const s = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawTape(ctx, cell, style, pxPerMm, rng) {
  const amount = clamp(style.tape, 0, 1);
  const count = amount > 0.66 ? 2 : 1;
  const halfW = (cell.w / 2) * pxPerMm;
  const halfH = (cell.h / 2) * pxPerMm;
  const len = clamp(Math.min(cell.w, cell.h) * 0.34, 8, 34) * pxPerMm;
  const thick = clamp(Math.min(cell.w, cell.h) * 0.09, 4, 12) * pxPerMm;

  const corners = [
    { x: -halfW, y: -halfH, a: 45 },
    { x: halfW, y: -halfH, a: 135 },
    { x: halfW, y: halfH, a: 225 },
    { x: -halfW, y: halfH, a: 315 },
  ];
  const chosen = count === 1 ? [corners[Math.floor(rng() * 4)]] : [corners[0], corners[2]];

  for (const c of chosen) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((c.a + range(rng, -10, 10)) * DEG);
    ctx.globalAlpha = 0.62;
    const g = ctx.createLinearGradient(0, -thick / 2, 0, thick / 2);
    g.addColorStop(0, 'rgba(245,238,222,0.75)');
    g.addColorStop(0.5, 'rgba(252,247,235,0.92)');
    g.addColorStop(1, 'rgba(238,229,210,0.75)');
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(50,38,24,0.22)';
    ctx.shadowBlur = 0.9 * pxPerMm;
    ctx.shadowOffsetY = 0.35 * pxPerMm;
    ctx.fillRect(-len / 2, -thick / 2, len, thick);
    ctx.restore();
  }
}

function drawCover(ctx, source, box, focal, zoom, offset, spin = 0) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  if (!sw || !sh) return;

  // A quarter turn swaps which side of the box the photo has to cover.
  const quarter = (((Math.round(spin / 90) % 4) + 4) % 4);
  const upright = quarter % 2 === 0;
  const fitW = upright ? box.w : box.h;
  const fitH = upright ? box.h : box.w;

  const scale = Math.max(fitW / sw, fitH / sh) * clamp(zoom, 1, 4);
  const dw = sw * scale;
  const dh = sh * scale;

  let dx = -focal.x * dw + (offset.x || 0) * fitW;
  let dy = -focal.y * dh + (offset.y || 0) * fitH;
  dx = clamp(dx, fitW / 2 - dw, -fitW / 2);
  dy = clamp(dy, fitH / 2 - dh, -fitH / 2);

  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  if (quarter) ctx.rotate(quarter * 90 * DEG);
  ctx.drawImage(source, dx, dy, dw, dh);
  ctx.restore();
}

/* --------------------------------------------------------------- overlays -- */

function drawCaption(ctx, state, W, H, pxPerMm) {
  const c = state.caption;
  const size = clamp(Math.min(W, H) * 0.045 * c.size, 3, 40) * pxPerMm;
  const family = c.font === 'display' ? '"Fraunces", Georgia, serif' : '"Inter", system-ui, sans-serif';

  ctx.save();
  ctx.font = `${c.font === 'display' ? '600' : '500'} ${size}px ${family}`;
  ctx.fillStyle = c.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = c.position === 'top' ? 'top' : 'alphabetic';
  const margin = state.layout.marginMm * pxPerMm;
  const y = c.position === 'top' ? margin * 0.28 : H * pxPerMm - margin * 0.34;
  ctx.fillText(c.text, (W * pxPerMm) / 2, y);
  ctx.restore();
}

/** Standard trim marks: offset from the trim edge, sitting in the bleed area. */
function drawCropMarks(ctx, W, H, pxPerMm, bleedMm) {
  const b = bleedMm * pxPerMm;
  const w = W * pxPerMm;
  const h = H * pxPerMm;
  const len = Math.min(b * 0.7, 4 * pxPerMm);
  const gap = b * 0.25;

  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(0.5, 0.12 * pxPerMm);
  ctx.beginPath();
  const corners = [
    [b, b, -1, -1],
    [b + w, b, 1, -1],
    [b, b + h, -1, 1],
    [b + w, b + h, 1, 1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.moveTo(x + sx * gap, y);
    ctx.lineTo(x + sx * (gap + len), y);
    ctx.moveTo(x, y + sy * gap);
    ctx.lineTo(x, y + sy * (gap + len));
  }
  ctx.stroke();
  ctx.restore();
}
