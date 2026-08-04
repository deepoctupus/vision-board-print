import { makeRng } from '../core/rng.js';
import { resolveBoardSize } from '../core/units.js';
import { mosaicLayout } from './mosaic.js';
import { bentoLayout } from './bento.js';
import { scatterLayout } from './scatter.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const ENGINES = ['mosaic', 'bento', 'scatter'];

/**
 * Turns state + assets into concrete cell rectangles in millimetres.
 * Pure: the same state always produces the same board, which is what lets the
 * screen preview and the print export agree.
 */
export function computeLayout(state, assetStore) {
  const board = resolveBoardSize(state.board);
  const items = state.items.filter((item) => assetStore.has(item.assetId));
  const count = items.length;

  const maxMargin = Math.min(board.widthMm, board.heightMm) * 0.34;
  const margin = clamp(state.layout.marginMm, 0, maxMargin);
  const gutter = clamp(state.layout.gutterMm, 0, Math.min(board.widthMm, board.heightMm) * 0.12);
  const variety = clamp(state.layout.variety, 0, 1);

  const content = {
    x: margin,
    y: margin,
    w: Math.max(10, board.widthMm - margin * 2),
    h: Math.max(10, board.heightMm - margin * 2),
  };

  if (count === 0) return { board, content, cells: [] };

  const rng = makeRng(state.layout.seed);
  const engine = ENGINES.includes(state.layout.engine) ? state.layout.engine : 'mosaic';

  if (engine === 'scatter') {
    const aspects = items.map((item) => assetStore.get(item.assetId).aspect);
    const raw = scatterLayout({ count, rect: content, rng, aspects, variety, overlap: 0.24 });
    const cells = raw
      .map((cell, i) => makeCell(cell, items[i], i, cell.rot, cell.z))
      .sort((a, b) => a.z - b.z);
    return { board, content, cells };
  }

  // Grow the working area by half a gutter so that insetting each cell afterwards
  // leaves the outer margin exactly where the user asked for it.
  const half = gutter / 2;
  const grown = {
    x: content.x - half,
    y: content.y - half,
    w: content.w + gutter,
    h: content.h + gutter,
  };

  let raw =
    engine === 'bento'
      ? bentoLayout({ count, rect: grown, rng, variety })
      : mosaicLayout({ count, rect: grown, rng, variety });

  if (!raw || raw.length !== count) {
    raw = mosaicLayout({ count, rect: grown, rng: makeRng(state.layout.seed ^ 0x9e3779b9), variety });
  }

  raw = sortReadingOrder(raw, grown).map((cell) => insetCell(cell, half));

  const cells = raw.map((cell, i) => makeCell(cell, items[i], i, 0, i));
  return { board, content, cells };
}

function makeCell(rect, item, index, rot, z) {
  return {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    // Where the engine put the piece before the user moved it. Kept so free
    // placement stays a delta and can be recomputed from scratch every frame.
    base: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    rot: rot ?? 0,
    z,
    index,
    itemId: item.id,
    assetId: item.assetId,
    seed: item.seed,
    item,
  };
}

/**
 * Lays the user's own moves over the computed arrangement. Rebuilding from
 * `cell.base` every time makes this idempotent, so it can run on a cached layout
 * as often as the pointer fires without the offsets compounding.
 */
export function applyPlacements(layout, items) {
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const cell of layout.cells) {
    const item = byId.get(cell.itemId);
    if (item) cell.item = item;

    const base = cell.base;
    const place = item?.place;
    const sw = clamp(place?.sw ?? 1, 0.15, 8);
    const sh = clamp(place?.sh ?? 1, 0.15, 8);

    cell.w = base.w * sw;
    cell.h = base.h * sh;
    // Scaling about the centre keeps a piece where the user parked it.
    cell.x = base.x + (base.w - cell.w) / 2 + (place?.dx || 0);
    cell.y = base.y + (base.h - cell.h) / 2 + (place?.dy || 0);
  }

  // Paint order is array order, so send-to-back has to be a real reordering.
  layout.cells.sort((a, b) => (a.item?.z || 0) - (b.item?.z || 0) || a.z - b.z);
  return layout;
}

function insetCell(cell, amount) {
  const inset = Math.min(amount, cell.w * 0.34, cell.h * 0.34);
  return {
    x: cell.x + inset,
    y: cell.y + inset,
    w: Math.max(1, cell.w - inset * 2),
    h: Math.max(1, cell.h - inset * 2),
  };
}

/** Left-to-right, top-to-bottom, tolerating cells that do not share exact tops. */
function sortReadingOrder(cells, rect) {
  const band = Math.max(1, rect.h * 0.035);
  return cells
    .slice()
    .sort((a, b) => Math.round(a.y / band) - Math.round(b.y / band) || a.x - b.x);
}

/**
 * Reorders items so each photo lands in the cell whose proportions waste the
 * least of it. Sorting both sides by aspect and pairing in order minimises the
 * total mismatch, so no assignment search is needed.
 */
export function arrangeItemsForCells(items, cells, assetStore) {
  if (items.length !== cells.length || items.length < 2) return items.slice();

  const byCellAspect = cells
    .map((cell, i) => ({ i, ar: Math.log(cell.w / cell.h) }))
    .sort((a, b) => a.ar - b.ar);
  const byItemAspect = items
    .map((item, i) => ({ i, ar: Math.log(assetStore.get(item.assetId)?.aspect ?? 1) }))
    .sort((a, b) => a.ar - b.ar);

  const out = new Array(items.length);
  byCellAspect.forEach((cell, k) => {
    out[cell.i] = items[byItemAspect[k].i];
  });
  return out;
}

/** How much of each photo survives the crop — surfaced in the UI as a warning. */
export function cropCoverage(cell, asset) {
  if (!asset) return 1;
  const cellAr = cell.w / cell.h;
  const imgAr = asset.aspect;
  return cellAr > imgAr ? imgAr / cellAr : cellAr / imgAr;
}
