import { shuffled } from '../core/rng.js';

const SHAPES = [
  { w: 2, h: 2, gain: 3 },
  { w: 3, h: 2, gain: 5 },
  { w: 2, h: 3, gain: 5 },
  { w: 3, h: 1, gain: 2 },
  { w: 1, h: 3, gain: 2 },
  { w: 2, h: 1, gain: 1 },
  { w: 1, h: 2, gain: 1 },
];

/**
 * Starts from a uniform grid of unit cells and merges neighbours into larger
 * rectangles until exactly `count` regions remain. Merging can only ever remove
 * boundaries, so full coverage is structural rather than something to verify.
 *
 * Returns null when the target count is unreachable for the chosen grid; the
 * caller falls back to the mosaic engine.
 */
export function bentoLayout({ count, rect, rng, variety = 0.55 }) {
  if (count <= 0) return [];
  if (count === 1) return [{ ...rect }];

  const grid = chooseGrid(count, rect.w / rect.h, variety);
  if (!grid) return null;

  const regions = mergeDown(grid.cols, grid.rows, count, rng, variety);
  if (!regions) return null;

  const cellW = rect.w / grid.cols;
  const cellH = rect.h / grid.rows;
  return regions
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((r) => ({
      x: rect.x + r.x * cellW,
      y: rect.y + r.y * cellH,
      w: r.w * cellW,
      h: r.h * cellH,
    }));
}

function chooseGrid(count, boardAr, variety) {
  const targetTotal = count * (1.18 + 0.75 * variety);
  let best = null;
  for (let cols = 2; cols <= 9; cols++) {
    for (let rows = 2; rows <= 14; rows++) {
      const total = cols * rows;
      if (total < count || total > count * 2.6 + 3) continue;
      const unitAr = (boardAr * rows) / cols;
      const cost = Math.abs(Math.log(unitAr)) * 1.7 + Math.abs(Math.log(total / targetTotal));
      if (!best || cost < best.cost) best = { cols, rows, cost };
    }
  }
  return best;
}

function mergeDown(cols, rows, count, rng, variety) {
  const used = new Uint8Array(cols * rows);
  const merged = [];
  let deficit = cols * rows - count;

  const fits = (x, y, w, h) => {
    if (x < 0 || y < 0 || x + w > cols || y + h > rows) return false;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (used[(y + dy) * cols + (x + dx)]) return false;
      }
    }
    return true;
  };

  const occupy = (x, y, w, h) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) used[(y + dy) * cols + (x + dx)] = 1;
    }
  };

  let guard = cols * rows * 6;
  while (deficit > 0 && guard-- > 0) {
    const viable = SHAPES.filter((s) => s.gain <= deficit && s.w <= cols && s.h <= rows);
    if (!viable.length) break;

    // Larger merges first while there is plenty of deficit left, so boards get a
    // few hero cells instead of a uniform field of dominoes. Scores are drawn
    // before sorting: an rng() call inside a comparator is not order-stable.
    const weight = 0.35 + 0.5 * variety;
    const order = viable
      .map((shape) => ({ shape, score: shape.gain * weight + rng() * 3 * (1 - weight) }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.shape);

    let placed = false;
    for (const shape of order) {
      const spots = [];
      for (let y = 0; y + shape.h <= rows; y++) {
        for (let x = 0; x + shape.w <= cols; x++) spots.push([x, y]);
      }
      for (const [x, y] of shuffled(rng, spots)) {
        if (!fits(x, y, shape.w, shape.h)) continue;
        occupy(x, y, shape.w, shape.h);
        merged.push({ x, y, w: shape.w, h: shape.h });
        deficit -= shape.gain;
        placed = true;
        break;
      }
      if (placed) break;
    }

    if (!placed && !growExisting(merged, used, cols, rows, () => deficit, (d) => (deficit = d), rng)) {
      break;
    }
  }

  if (deficit !== 0) return null;

  const regions = merged.slice();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!used[y * cols + x]) regions.push({ x, y, w: 1, h: 1 });
    }
  }
  return regions.length === count ? regions : null;
}

/**
 * When no fresh block fits, an existing region can still swallow an adjacent
 * strip of untouched cells and stay rectangular.
 */
function growExisting(merged, used, cols, rows, getDeficit, setDeficit, rng) {
  for (const region of shuffled(rng, merged)) {
    const sides = shuffled(rng, [
      { x: region.x, y: region.y - 1, w: region.w, h: 1, dx: 0, dy: -1, dw: 0, dh: 1 },
      { x: region.x, y: region.y + region.h, w: region.w, h: 1, dx: 0, dy: 0, dw: 0, dh: 1 },
      { x: region.x - 1, y: region.y, w: 1, h: region.h, dx: -1, dy: 0, dw: 1, dh: 0 },
      { x: region.x + region.w, y: region.y, w: 1, h: region.h, dx: 0, dy: 0, dw: 1, dh: 0 },
    ]);
    for (const strip of sides) {
      const gain = strip.w * strip.h;
      if (gain > getDeficit()) continue;
      if (strip.x < 0 || strip.y < 0 || strip.x + strip.w > cols || strip.y + strip.h > rows) continue;
      let free = true;
      for (let dy = 0; dy < strip.h && free; dy++) {
        for (let dx = 0; dx < strip.w; dx++) {
          if (used[(strip.y + dy) * cols + (strip.x + dx)]) {
            free = false;
            break;
          }
        }
      }
      if (!free) continue;
      for (let dy = 0; dy < strip.h; dy++) {
        for (let dx = 0; dx < strip.w; dx++) used[(strip.y + dy) * cols + (strip.x + dx)] = 1;
      }
      region.x += strip.dx;
      region.y += strip.dy;
      region.w += strip.dw;
      region.h += strip.dh;
      setDeficit(getDeficit() - gain);
      return true;
    }
  }
  return false;
}
