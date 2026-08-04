import { makeRng, range } from '../core/rng.js';

/**
 * Every frame shape except the torn one, which needs its own simulation.
 *
 * Each builder returns paths centred on the origin, already in pixels, plus the
 * box the photo should cover. `paper` is the silhouette that gets a shadow and a
 * paper fill; `photo` is what the image is clipped to. They differ whenever the
 * shape has a printed margin (polaroid, stamp, film) or a punched hole, and the
 * hole cases carry `rule: 'evenodd'` so the same path can describe both.
 */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const CUT_STYLES = [
  'torn', 'sharp', 'rounded', 'circle', 'arch', 'polaroid',
  'hex', 'blob', 'scallop', 'stamp', 'tag', 'film', 'heart',
];

export const CUT_LABELS = {
  torn: 'Rasgado',
  sharp: 'Reto',
  rounded: 'Cantos',
  circle: 'Círculo',
  arch: 'Arco',
  polaroid: 'Polaroid',
  hex: 'Hexágono',
  blob: 'Orgânico',
  scallop: 'Ondulado',
  stamp: 'Selo',
  tag: 'Etiqueta',
  film: 'Filme',
  heart: 'Coração',
};

export function buildShape(cut, { w, h, pxPerMm, seed, radiusMm }) {
  const hw = (w / 2) * pxPerMm;
  const hh = (h / 2) * pxPerMm;
  const box = { x: -hw, y: -hh, w: hw * 2, h: hh * 2 };
  const mm = (v) => v * pxPerMm;
  const minSide = Math.min(w, h);

  switch (cut) {
    case 'circle': {
      const p = new Path2D();
      p.ellipse(0, 0, hw, hh, 0, 0, TAU);
      return { paper: p, photo: p, photoBox: box };
    }

    case 'arch': {
      const r = Math.min(hw, hh * 0.9);
      const p = new Path2D();
      p.moveTo(-hw, hh);
      p.lineTo(-hw, -hh + r);
      p.arcTo(-hw, -hh, -hw + r, -hh, r);
      p.lineTo(hw - r, -hh);
      p.arcTo(hw, -hh, hw, -hh + r, r);
      p.lineTo(hw, hh);
      p.closePath();
      return { paper: p, photo: p, photoBox: box };
    }

    case 'polaroid': {
      const frame = mm(clamp(minSide * 0.06, 2.2, 9));
      const foot = frame * 2.7;
      const inner = {
        x: -hw + frame,
        y: -hh + frame,
        w: hw * 2 - frame * 2,
        h: hh * 2 - frame - foot,
      };
      return {
        paper: roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.6)),
        photo: roundedRect(inner.x, inner.y, inner.w, inner.h, 0),
        photoBox: inner,
      };
    }

    case 'hex': {
      const p = new Path2D();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const x = hw * Math.cos(a);
        const y = hh * Math.sin(a);
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      return { paper: p, photo: p, photoBox: box };
    }

    case 'blob':
      return sameForBoth(blobPath(hw, hh, seed), box);

    case 'scallop':
      return sameForBoth(scallopedPath(hw, hh, mm(clamp(minSide * 0.12, 4, 11))), box);

    case 'stamp': {
      const tooth = mm(clamp(minSide * 0.035, 1.3, 3.4));
      const margin = tooth * 1.9;
      const inner = { x: -hw + margin, y: -hh + margin, w: hw * 2 - margin * 2, h: hh * 2 - margin * 2 };
      return {
        paper: scallopedPath(hw, hh, tooth),
        photo: roundedRect(inner.x, inner.y, inner.w, inner.h, 0),
        photoBox: inner,
      };
    }

    case 'tag': {
      const chamfer = Math.min(hw, hh) * 0.34;
      const r = mm(clamp(radiusMm ?? 3, 0.5, 6));
      const p = new Path2D();
      p.moveTo(-hw, -hh + chamfer);
      p.lineTo(-hw + chamfer, -hh);
      p.lineTo(hw - chamfer, -hh);
      p.lineTo(hw, -hh + chamfer);
      p.lineTo(hw, hh - r);
      p.arcTo(hw, hh, hw - r, hh, r);
      p.lineTo(-hw + r, hh);
      p.arcTo(-hw, hh, -hw, hh - r, r);
      p.closePath();
      const hole = mm(clamp(minSide * 0.035, 1.1, 3));
      p.moveTo(hole, -hh + chamfer * 0.62);
      p.arc(0, -hh + chamfer * 0.62, hole, 0, TAU, true);
      return { paper: p, photo: p, photoBox: box, rule: 'evenodd' };
    }

    case 'film': {
      const band = mm(clamp(minSide * 0.13, 2.6, 9));
      const alongX = hw >= hh;
      const p = new Path2D();
      p.rect(-hw, -hh, hw * 2, hh * 2);

      const holeLong = band * 0.62;
      const holeShort = band * 0.44;
      const pitch = band * 1.25;
      const span = alongX ? hw * 2 : hh * 2;
      const count = Math.max(2, Math.floor(span / pitch));
      const step = span / count;

      for (let i = 0; i < count; i++) {
        const centre = -span / 2 + step * (i + 0.5);
        for (const side of [-1, 1]) {
          const cx = alongX ? centre : side * (hw - band / 2);
          const cy = alongX ? side * (hh - band / 2) : centre;
          const rw = alongX ? holeLong : holeShort;
          const rh = alongX ? holeShort : holeLong;
          p.addPath(roundedRect(cx - rw / 2, cy - rh / 2, rw, rh, Math.min(rw, rh) * 0.3));
        }
      }

      const inner = alongX
        ? { x: -hw, y: -hh + band, w: hw * 2, h: hh * 2 - band * 2 }
        : { x: -hw + band, y: -hh, w: hw * 2 - band * 2, h: hh * 2 };
      return {
        paper: p,
        photo: roundedRect(inner.x, inner.y, inner.w, inner.h, 0),
        photoBox: inner,
        rule: 'evenodd',
        printed: true,
      };
    }

    case 'heart':
      return sameForBoth(heartPath(hw, hh), box);

    case 'rounded':
      return sameForBoth(
        roundedRect(-hw, -hh, hw * 2, hh * 2, mm(clamp(radiusMm ?? 0, 0, minSide / 2))),
        box
      );

    default:
      return sameForBoth(roundedRect(-hw, -hh, hw * 2, hh * 2, 0), box);
  }
}

const sameForBoth = (path, box) => ({ paper: path, photo: path, photoBox: box });

export function roundedRect(x, y, w, h, r) {
  const path = new Path2D();
  const radius = Math.min(r, w / 2, h / 2);
  if (radius <= 0.01) {
    path.rect(x, y, w, h);
    return path;
  }
  path.moveTo(x + radius, y);
  path.arcTo(x + w, y, x + w, y + h, radius);
  path.arcTo(x + w, y + h, x, y + h, radius);
  path.arcTo(x, y + h, x, y, radius);
  path.arcTo(x, y, x + w, y, radius);
  path.closePath();
  return path;
}

/**
 * Semicircular teeth around the whole edge — a postage perforation when the
 * period is small, a scalloped photo border when it is large. The rectangle is
 * inset by half a period first so the teeth end flush with the cell instead of
 * spilling into the neighbours.
 */
function scallopedPath(hw, hh, period) {
  const p = new Path2D();
  const inset = Math.min(period / 2, hw * 0.45, hh * 0.45);
  const x = hw - inset;
  const y = hh - inset;

  const sides = [
    { len: x * 2, from: [-x, -y], step: [1, 0], a0: Math.PI, a1: TAU },
    { len: y * 2, from: [x, -y], step: [0, 1], a0: -Math.PI / 2, a1: Math.PI / 2 },
    { len: x * 2, from: [x, y], step: [-1, 0], a0: 0, a1: Math.PI },
    { len: y * 2, from: [-x, y], step: [0, -1], a0: Math.PI / 2, a1: Math.PI * 1.5 },
  ];

  p.moveTo(-x, -y);
  for (const side of sides) {
    const n = Math.max(1, Math.round(side.len / (inset * 2)));
    const step = side.len / n;
    const radius = Math.min(step / 2, inset);
    for (let i = 0; i < n; i++) {
      const at = step * (i + 0.5);
      p.arc(
        side.from[0] + side.step[0] * at,
        side.from[1] + side.step[1] * at,
        radius,
        side.a0,
        side.a1,
        false
      );
    }
  }
  p.closePath();
  return p;
}

/** A closed organic outline: a circle with a few seeded harmonics on its radius. */
function blobPath(hw, hh, seed) {
  const rng = makeRng((seed ^ 0x51a2c7d3) >>> 0);
  const harmonics = [
    { k: 2, amp: range(rng, 0.05, 0.13), phase: rng() * TAU },
    { k: 3, amp: range(rng, 0.04, 0.1), phase: rng() * TAU },
    { k: 5, amp: range(rng, 0.02, 0.06), phase: rng() * TAU },
  ];

  const steps = 128;
  const radii = new Array(steps);
  let peak = 0;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    let r = 1;
    for (const harm of harmonics) r += Math.sin(a * harm.k + harm.phase) * harm.amp;
    radii[i] = r;
    if (r > peak) peak = r;
  }

  const p = new Path2D();
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    const r = radii[i] / peak;
    const x = hw * r * Math.cos(a);
    const y = hh * r * Math.sin(a);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

function heartPath(hw, hh) {
  const steps = 160;
  const pts = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push([x, y]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const p = new Path2D();
  const sx = (hw * 2) / (maxX - minX);
  const sy = (hh * 2) / (maxY - minY);
  pts.forEach(([x, y], i) => {
    const px = (x - (minX + maxX) / 2) * sx;
    const py = (y - (minY + maxY) / 2) * sy;
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  });
  p.closePath();
  return p;
}
