import { gaussian } from '../core/rng.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Recursive guillotine subdivision. Because every cut splits a rectangle into two
 * rectangles that are themselves subdivided, the result covers the board exactly:
 * no gaps, no overlaps, and precisely `count` leaves.
 */
export function mosaicLayout({ count, rect, rng, variety = 0.55 }) {
  if (count <= 0) return [];
  const minEdge = Math.min(rect.w, rect.h) / (Math.sqrt(count) * 3.4);
  const cells = [];
  subdivide(rect, count, cells, rng, variety, minEdge);
  return cells;
}

function subdivide(rect, count, out, rng, variety, minEdge) {
  if (count <= 1) {
    out.push({ ...rect });
    return;
  }

  const k = chooseK(count, rng, variety);
  let vertical = chooseDirection(rect, rng);

  // A cut along the short axis of an already-thin rectangle produces slivers.
  if (vertical && rect.w < minEdge * 2) vertical = false;
  else if (!vertical && rect.h < minEdge * 2) vertical = true;

  const span = vertical ? rect.w : rect.h;
  const target = k / count;
  const jitter = gaussian(rng) * 0.11 * variety;
  let ratio = clamp(target + jitter, 0.18, 0.82);

  // Keep both sides large enough to hold their share of the leaves.
  const minRatio = clamp((minEdge * Math.sqrt(k)) / span, 0.05, 0.45);
  const maxRatio = 1 - clamp((minEdge * Math.sqrt(count - k)) / span, 0.05, 0.45);
  ratio = clamp(ratio, Math.min(minRatio, 0.5), Math.max(maxRatio, 0.5));

  const cut = span * ratio;

  const a = vertical
    ? { x: rect.x, y: rect.y, w: cut, h: rect.h }
    : { x: rect.x, y: rect.y, w: rect.w, h: cut };
  const b = vertical
    ? { x: rect.x + cut, y: rect.y, w: rect.w - cut, h: rect.h }
    : { x: rect.x, y: rect.y + cut, w: rect.w, h: rect.h - cut };

  subdivide(a, k, out, rng, variety, minEdge);
  subdivide(b, count - k, out, rng, variety, minEdge);
}

function chooseK(count, rng, variety) {
  if (count === 2) return 1;
  const mid = count / 2;
  const spread = (count / 2 - 0.5) * (0.3 + 0.7 * variety);
  return clamp(Math.round(mid + gaussian(rng) * spread * 0.62), 1, count - 1);
}

/** Cutting across the long axis keeps leaves closer to square. */
function chooseDirection(rect, rng) {
  const ar = rect.w / rect.h;
  const bias = ar >= 1 ? 0.5 + 0.5 * Math.min(1, ar - 1) : 0.5 - 0.5 * Math.min(1, 1 / ar - 1);
  return rng() < clamp(bias, 0.1, 0.9);
}
