import { computeLayout, applyPlacements } from '../layout/index.js';
import { renderBoard, cellTilt } from '../render/renderer.js';
import { pxPerMmAt, CSS_DPI, resolveBoardSize } from '../core/units.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const FIT_PADDING = 28;
const DRAG_THRESHOLD = 4;
const MAX_SCALE = pxPerMmAt(CSS_DPI) * 6;
const MIN_SCALE = 0.05;

/** Handle geometry, in screen pixels — a grip has to stay grabbable at any zoom. */
const GRIP = 9;
const GRIP_HIT = 13;
const ROTATE_GAP = 26;

const CORNERS = [
  { id: 'nw', sx: -1, sy: -1 }, { id: 'ne', sx: 1, sy: -1 },
  { id: 'se', sx: 1, sy: 1 }, { id: 'sw', sx: -1, sy: 1 },
];
const EDGES = [
  { id: 'n', sx: 0, sy: -1 }, { id: 's', sx: 0, sy: 1 },
  { id: 'w', sx: -1, sy: 0 }, { id: 'e', sx: 1, sy: 0 },
];
const CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize', rotate: 'grab',
};

/**
 * The canvas is the viewport, not the sheet. Zoom and pan live in the render
 * transform, which means the preview goes through exactly the same `renderBoard`
 * call as the print file — only `pxPerMm` differs.
 */
export function createStage({ canvas, viewport, store, assetStore, onZoomChange, onSelect }) {
  const ctx = canvas.getContext('2d');

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let fitMode = true;
  let vw = 1;
  let vh = 1;
  let dpr = 1;

  let layout = null;
  let layoutSig = '';
  let frame = 0;
  let gesture = null;
  let dropTargetId = null;
  let spaceHeld = false;
  let lastZoom = -1;

  const resolveSource = (id) => assetStore.get(id)?.preview || null;

  new ResizeObserver(resize).observe(viewport);
  resize();

  store.subscribe(() => {
    if (fitMode) applyFit();
    requestRender();
  });

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => canvas.classList.remove('is-cell'));
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDoubleClick);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    requestRender,
    getLayout: () => ensureLayout(store.get()),
    zoomIn: () => zoomAt(vw / 2, vh / 2, 1.25),
    zoomOut: () => zoomAt(vw / 2, vh / 2, 1 / 1.25),
    zoomFit: () => {
      fitMode = true;
      applyFit();
      requestRender();
    },
  };

  /* ------------------------------------------------------------------ view */

  function resize() {
    const rect = viewport.getBoundingClientRect();
    // Capping the ratio keeps a 4K screen from quadrupling the cost of a repaint
    // for a difference nobody can see on a photo collage.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = Math.max(1, Math.round(rect.width));
    vh = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    if (fitMode) applyFit();
    requestRender();
  }

  function applyFit() {
    const board = resolveBoardSize(store.get().board);
    const fit = Math.min(
      (vw - FIT_PADDING * 2) / board.widthMm,
      (vh - FIT_PADDING * 2) / board.heightMm
    );
    setScale(fit);
    tx = (vw - board.widthMm * scale) / 2;
    ty = (vh - board.heightMm * scale) / 2;
  }

  function setScale(next) {
    scale = clamp(next, MIN_SCALE, MAX_SCALE);
    const percent = Math.round((scale / pxPerMmAt(CSS_DPI)) * 100);
    if (percent !== lastZoom) {
      lastZoom = percent;
      onZoomChange?.(percent);
    }
  }

  function zoomAt(px, py, factor) {
    const mx = (px - tx) / scale;
    const my = (py - ty) / scale;
    setScale(scale * factor);
    tx = px - mx * scale;
    ty = py - my * scale;
    fitMode = false;
    requestRender();
  }

  /* ----------------------------------------------------------------- paint */

  function requestRender() {
    if (frame) return;
    frame = requestAnimationFrame(draw);
  }

  /**
   * Layout is pure, so it only needs recomputing when something it depends on
   * changes. Item objects are re-bound afterwards because cropping and zooming
   * mutate them every pointer move without changing the arrangement.
   */
  function ensureLayout(state) {
    const sig = JSON.stringify([state.board, state.layout, state.items.map((i) => i.assetId)]);
    if (!layout || sig !== layoutSig) {
      layout = computeLayout(state, assetStore);
      layoutSig = sig;
    }
    return applyPlacements(layout, state.items);
  }

  function draw() {
    frame = 0;
    const state = store.get();
    const current = ensureLayout(state);
    const w = current.board.widthMm * scale;
    const h = current.board.heightMm * scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    ctx.translate(Math.round(tx), Math.round(ty));

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    renderBoard(ctx, {
      state,
      layout: current,
      pxPerMm: scale,
      resolveSource,
      mode: 'preview',
      selectedId: state.selectedId,
      dragId: gesture?.mode === 'swap' ? gesture.itemId : null,
    });

    if (dropTargetId) drawDropTarget(current);
    else if (gesture?.mode !== 'swap') drawHandles(state, current);
    ctx.restore();
  }

  /**
   * The grips live on the stage, not in `renderBoard` — they are chrome, and the
   * export path calls the same renderer, so anything drawn there would print.
   */
  function drawHandles(state, current) {
    const cell = current.cells.find((c) => c.itemId === state.selectedId);
    if (!cell) return;

    const grips = handlesOf(cell, state);
    const angle = cellTilt(cell, state) * DEG;

    ctx.save();
    ctx.translate((cell.x + cell.w / 2) * scale, (cell.y + cell.h / 2) * scale);
    ctx.rotate(angle);

    ctx.strokeStyle = 'rgba(226,101,58,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect((-cell.w / 2) * scale, (-cell.h / 2) * scale, cell.w * scale, cell.h * scale);
    ctx.beginPath();
    ctx.moveTo(0, (-cell.h / 2) * scale);
    ctx.lineTo(0, (-cell.h / 2) * scale - ROTATE_GAP);
    ctx.stroke();
    ctx.restore();

    for (const grip of grips) {
      const x = grip.x * scale;
      const y = grip.y * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(226,101,58,0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (grip.id === 'rotate') ctx.arc(0, 0, GRIP / 2 + 1, 0, Math.PI * 2);
      else {
        ctx.rotate(angle);
        ctx.rect(-GRIP / 2, -GRIP / 2, GRIP, GRIP);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Grip centres in board millimetres, already carrying the piece's rotation. */
  function handlesOf(cell, state) {
    const angle = cellTilt(cell, state) * DEG;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;
    const toBoardPt = (lx, ly) => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });

    const out = [];
    for (const h of [...CORNERS, ...EDGES]) {
      const p = toBoardPt((h.sx * cell.w) / 2, (h.sy * cell.h) / 2);
      out.push({ id: h.id, sx: h.sx, sy: h.sy, x: p.x, y: p.y });
    }
    const r = toBoardPt(0, -cell.h / 2 - ROTATE_GAP / scale);
    out.push({ id: 'rotate', x: r.x, y: r.y });
    return out;
  }

  function hitHandle(pt) {
    const state = store.get();
    if (!state.selectedId) return null;
    const cell = layout?.cells.find((c) => c.itemId === state.selectedId);
    if (!cell) return null;
    for (const grip of handlesOf(cell, state)) {
      if (Math.hypot((grip.x - pt.x) * scale, (grip.y - pt.y) * scale) <= GRIP_HIT) {
        return { grip, cell };
      }
    }
    return null;
  }

  function drawDropTarget(current) {
    const cell = current.cells.find((c) => c.itemId === dropTargetId);
    if (!cell) return;
    const state = store.get();
    ctx.save();
    ctx.translate((cell.x + cell.w / 2) * scale, (cell.y + cell.h / 2) * scale);
    ctx.rotate(cellTilt(cell, state) * DEG);
    ctx.strokeStyle = 'rgba(226,101,58,0.95)';
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 6]);
    ctx.strokeRect((-cell.w / 2) * scale, (-cell.h / 2) * scale, cell.w * scale, cell.h * scale);
    ctx.restore();
  }

  /* --------------------------------------------------------------- pointer */

  function toBoard(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return { px, py, x: (px - tx) / scale, y: (py - ty) / scale };
  }

  /** Topmost first, un-rotating the point about each piece before testing it. */
  function hitTest(pt) {
    const state = store.get();
    const cells = layout?.cells || [];
    for (let i = cells.length - 1; i >= 0; i--) {
      const cell = cells[i];
      const a = -cellTilt(cell, state) * DEG;
      const dx = pt.x - (cell.x + cell.w / 2);
      const dy = pt.y - (cell.y + cell.h / 2);
      const rx = dx * Math.cos(a) - dy * Math.sin(a);
      const ry = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(rx) <= cell.w / 2 && Math.abs(ry) <= cell.h / 2) return cell;
    }
    return null;
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return;
    canvas.setPointerCapture(e.pointerId);
    const pt = toBoard(e);
    const forcePan = e.button === 1 || spaceHeld;

    const grab = forcePan ? null : hitHandle(pt);
    if (grab) {
      startHandleGesture(grab, pt);
      return;
    }

    const cell = forcePan || e.shiftKey ? null : hitTest(pt);

    if (!cell) {
      gesture = { mode: 'pan', px: pt.px, py: pt.py, tx, ty };
      canvas.classList.add('is-panning');
      if (!forcePan && store.get().selectedId) select(null);
      return;
    }

    const wasSelected = store.get().selectedId === cell.itemId;
    if (!wasSelected) select(cell.itemId);

    const quarter = quarterOf(cell.item?.rotationDeg || 0);
    const upright = quarter % 2 === 0;
    gesture = {
      mode: 'press',
      itemId: cell.itemId,
      px: pt.px,
      py: pt.py,
      wasSelected,
      crop: e.altKey,
      quarter,
      fitW: upright ? cell.w : cell.h,
      fitH: upright ? cell.h : cell.w,
      base: { ...(cell.item?.offset || { x: 0, y: 0 }) },
      place: placeOf(cell.item),
    };
  }

  function startHandleGesture({ grip, cell }, pt) {
    const state = store.get();
    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;

    gesture =
      grip.id === 'rotate'
        ? {
            mode: 'rotate',
            itemId: cell.itemId,
            cx,
            cy,
            startAngle: Math.atan2(pt.y - cy, pt.x - cx),
            baseTilt: cellTilt(cell, state),
          }
        : {
            mode: 'resize',
            itemId: cell.itemId,
            grip,
            cx,
            cy,
            angle: cellTilt(cell, state) * DEG,
            halfW: cell.w / 2,
            halfH: cell.h / 2,
            place: placeOf(cell.item),
          };
    canvas.style.cursor = CURSORS[grip.id] || 'default';
  }

  function onPointerMove(e) {
    const pt = toBoard(e);

    if (!gesture) {
      const grip = spaceHeld ? null : hitHandle(pt);
      canvas.style.cursor = grip ? CURSORS[grip.grip.id] || '' : '';
      canvas.classList.toggle('is-cell', !spaceHeld && !grip && !!hitTest(pt));
      canvas.classList.toggle('is-grab', spaceHeld);
      return;
    }

    if (gesture.mode === 'resize') {
      resizeTo(pt);
      return;
    }

    if (gesture.mode === 'rotate') {
      const angle = Math.atan2(pt.y - gesture.cy, pt.x - gesture.cx);
      let deg = gesture.baseTilt + (angle - gesture.startAngle) / DEG;
      deg = ((deg + 180) % 360 + 360) % 360 - 180;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else if (Math.abs(deg) < 1.5) deg = 0;
      patchItem(gesture.itemId, (item) => {
        item.tiltDeg = Math.round(deg * 10) / 10;
      }, `rotate:${gesture.itemId}`, 'rotate');
      return;
    }

    if (gesture.mode === 'pan') {
      tx = gesture.tx + (pt.px - gesture.px);
      ty = gesture.ty + (pt.py - gesture.py);
      fitMode = false;
      requestRender();
      return;
    }

    const dx = pt.px - gesture.px;
    const dy = pt.py - gesture.py;

    if (gesture.mode === 'press') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      // A photo that is not selected yet is being picked up to trade places; one
      // that is already selected is being moved. Alt reaches past both to slide
      // the image around inside its own frame.
      if (!gesture.wasSelected) gesture.mode = 'swap';
      else gesture.mode = gesture.crop ? 'crop' : 'move';
    }

    if (gesture.mode === 'move') {
      const start = gesture.place;
      patchItem(gesture.itemId, (item) => {
        item.place = { ...start, dx: start.dx + dx / scale, dy: start.dy + dy / scale };
      }, `move:${gesture.itemId}`, 'move');
      return;
    }

    if (gesture.mode === 'crop') {
      const [mx, my] = unrotate(dx / scale, dy / scale, gesture.quarter);
      const x = clamp(gesture.base.x + mx / gesture.fitW, -2, 2);
      const y = clamp(gesture.base.y + my / gesture.fitH, -2, 2);
      store.update(
        (d) => {
          const item = d.items.find((i) => i.id === gesture.itemId);
          if (item) item.offset = { x, y };
        },
        { coalesce: `crop:${gesture.itemId}`, reason: 'crop' }
      );
      return;
    }

    const target = hitTest(pt);
    const id = target && target.itemId !== gesture.itemId ? target.itemId : null;
    if (id !== dropTargetId) {
      dropTargetId = id;
      requestRender();
    }
  }

  /**
   * Grips scale the piece about its own centre. Anchoring the opposite corner
   * instead would have to move the centre too, and under rotation that drifts —
   * symmetric scaling keeps the grip under the cursor at any angle.
   */
  function resizeTo(pt) {
    const { grip, cx, cy, angle, halfW, halfH, place } = gesture;
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const lx = dx * Math.cos(angle) + dy * Math.sin(angle);
    const ly = -dx * Math.sin(angle) + dy * Math.cos(angle);

    const fx = Math.abs(lx) / halfW;
    const fy = Math.abs(ly) / halfH;
    const corner = grip.sx !== 0 && grip.sy !== 0;
    const kx = corner ? Math.max(fx, fy) : grip.sx !== 0 ? fx : 1;
    const ky = corner ? Math.max(fx, fy) : grip.sy !== 0 ? fy : 1;

    patchItem(gesture.itemId, (item) => {
      item.place = {
        ...place,
        sw: clamp(place.sw * kx, 0.15, 8),
        sh: clamp(place.sh * ky, 0.15, 8),
      };
    }, `resize:${gesture.itemId}`, 'resize');
  }

  function patchItem(id, recipe, coalesce, reason) {
    store.update((d) => {
      const item = d.items.find((i) => i.id === id);
      if (item) recipe(item);
    }, { coalesce, reason });
  }

  function onPointerUp() {
    canvas.classList.remove('is-panning');
    canvas.style.cursor = '';
    if (!gesture) return;
    const finished = gesture;
    const target = dropTargetId;
    gesture = null;
    dropTargetId = null;

    if (finished.mode === 'swap' && target) {
      store.update(
        (d) => {
          const a = d.items.findIndex((i) => i.id === finished.itemId);
          const b = d.items.findIndex((i) => i.id === target);
          if (a >= 0 && b >= 0) {
            const held = d.items[a];
            d.items[a] = d.items[b];
            d.items[b] = held;
          }
        },
        { reason: 'swap' }
      );
    }
    requestRender();
  }

  function onDoubleClick(e) {
    const cell = hitTest(toBoard(e));
    if (!cell) return;
    store.update((d) => {
      const item = d.items.find((i) => i.id === cell.itemId);
      if (item) {
        item.offset = { x: 0, y: 0 };
        item.zoom = 1;
      }
    });
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.shiftKey) {
      tx -= e.deltaX || e.deltaY;
      fitMode = false;
      requestRender();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0018));
  }

  function onKeyDown(e) {
    if (e.code !== 'Space' || spaceHeld || isTyping(e.target)) return;
    spaceHeld = true;
    canvas.classList.add('is-grab');
    e.preventDefault();
  }

  function onKeyUp(e) {
    if (e.code !== 'Space') return;
    spaceHeld = false;
    canvas.classList.remove('is-grab');
  }

  function select(id) {
    store.update((d) => {
      d.selectedId = id;
    }, { history: false, reason: 'select' });
    onSelect?.(id);
  }
}

const quarterOf = (deg) => (((Math.round(deg / 90) % 4) + 4) % 4);

const placeOf = (item) => ({ dx: 0, dy: 0, sw: 1, sh: 1, ...(item?.place || {}) });

/** Maps a screen-space drag into the frame the photo is actually drawn in. */
function unrotate(x, y, quarter) {
  if (quarter === 1) return [y, -x];
  if (quarter === 2) return [-x, -y];
  if (quarter === 3) return [-y, x];
  return [x, y];
}

function isTyping(el) {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
}
