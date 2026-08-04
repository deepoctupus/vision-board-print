import { gaussian, range } from '../core/rng.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Pinboard collage: overlapping, slightly rotated pieces sized from each photo's
 * own aspect ratio. Unlike the tiling engines this one consumes the image list
 * directly, so cell i always belongs to item i.
 */
export function scatterLayout({ count, rect, rng, aspects, variety = 0.55, overlap = 0.22 }) {
  if (count <= 0) return [];

  const coverage = 1.02 + overlap * 0.9;
  const areaPer = (rect.w * rect.h * coverage) / count;

  const pieces = [];
  for (let i = 0; i < count; i++) {
    const aspect = clamp(aspects?.[i] ?? 1, 0.42, 2.4);
    const scale = Math.exp(gaussian(rng) * (0.14 + 0.28 * variety));
    const side = Math.sqrt(areaPer * scale);
    let w = side * Math.sqrt(aspect);
    let h = side / Math.sqrt(aspect);

    const maxW = rect.w * 0.66;
    const maxH = rect.h * 0.66;
    const fit = Math.min(1, maxW / w, maxH / h);
    w *= fit;
    h *= fit;

    pieces.push({ w, h, cx: 0, cy: 0, rot: 0, z: 0 });
  }

  seedPositions(pieces, rect, rng);
  relax(pieces, rect, overlap);

  const maxTilt = 2 + 7 * variety;
  pieces.forEach((p, i) => {
    p.rot = clamp(gaussian(rng) * maxTilt * 0.6, -maxTilt, maxTilt);
    // Larger pieces sit behind so small ones stay readable on top.
    p.z = -p.w * p.h + range(rng, 0, areaPer * 0.35) + i * 1e-6;
  });

  return pieces.map((p) => ({
    x: p.cx - p.w / 2,
    y: p.cy - p.h / 2,
    w: p.w,
    h: p.h,
    rot: p.rot,
    z: p.z,
  }));
}

/** A jittered grid spreads pieces over the whole board before relaxation. */
function seedPositions(pieces, rect, rng) {
  const n = pieces.length;
  const cols = Math.max(1, Math.round(Math.sqrt((n * rect.w) / rect.h)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = rect.w / cols;
  const cellH = rect.h / rows;

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rowCount = Math.min(cols, n - row * cols);
    const rowOffset = ((cols - rowCount) * cellW) / 2;
    pieces[i].cx = rect.x + rowOffset + (col + 0.5) * cellW + gaussian(rng) * cellW * 0.24;
    pieces[i].cy = rect.y + (row + 0.5) * cellH + gaussian(rng) * cellH * 0.24;
  }
}

function relax(pieces, rect, overlap) {
  const allow = clamp(overlap, 0, 0.6);
  const n = pieces.length;

  for (let iter = 0; iter < 90; iter++) {
    const strength = 0.5 * (1 - iter / 120);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pieces[i];
        const b = pieces[j];
        const penX = (a.w + b.w) / 2 - Math.abs(a.cx - b.cx);
        const penY = (a.h + b.h) / 2 - Math.abs(a.cy - b.cy);
        if (penX <= 0 || penY <= 0) continue;

        const allowX = Math.min(a.w, b.w) * allow;
        const allowY = Math.min(a.h, b.h) * allow;
        if (penX <= allowX && penY <= allowY) continue;

        // Separate along whichever axis needs the least movement.
        const needX = penX - allowX;
        const needY = penY - allowY;
        if (needX < needY) {
          const push = (needX / 2) * strength * (a.cx <= b.cx ? -1 : 1);
          a.cx += push;
          b.cx -= push;
        } else {
          const push = (needY / 2) * strength * (a.cy <= b.cy ? -1 : 1);
          a.cy += push;
          b.cy -= push;
        }
      }
    }

    for (const p of pieces) {
      p.cx = clamp(p.cx, rect.x + p.w / 2, rect.x + rect.w - p.w / 2);
      p.cy = clamp(p.cy, rect.y + p.h / 2, rect.y + rect.h - p.h / 2);
    }
  }
}
