import { makeRng, makeLoopNoise, fbm, range, gaussian } from '../core/rng.js';

/**
 * Hand-torn paper, authored entirely in millimetres.
 *
 * The edge is not noise painted onto a rectangle. It is a crack walking around
 * the sheet, integrated as a damped driven oscillator in arc length: the tear
 * aims at a wandering target, overshoots it, and swings back. That single change
 * is what produces the long straight-ish runs joined by sudden diagonal jags that
 * a hand tear has and a noise displacement never does.
 *
 * Three things ride on top of the walk, all of them things real paper does:
 *
 *  - Grain. A sheet has a machine direction. Tearing along it the crack slips
 *    between fibres and stays straight; tearing across it the crack has to break
 *    fibres and wanders badly. So opposite sides of the same piece do not match,
 *    which is the strongest single cue that this is paper and not a filter.
 *  - Snags. A fibre bundle holds, then gives way all at once. Modelled as
 *    velocity impulses, biased inward, because paper gives way sooner than it
 *    stretches.
 *  - Delamination. The sheet is plies. The front tears along one line and the
 *    ply behind it along another, so a pale lip of the core shows past the print
 *    in patches — never uniformly, which is why a constant white stroke reads as
 *    fake immediately.
 *
 * Four outlines come back. `back` is the lower ply, `outer` the front face,
 * `inner` where the ink stops, and `band`/`bandCore` the exposed core between
 * them, already built as polygons so their width can vary along the tear.
 */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (t) => t * t * (3 - 2 * t);

const cache = new Map();
const CACHE_LIMIT = 320;

export function tornOutline(w, h, seed, options = {}) {
  const key = `${w.toFixed(2)}|${h.toFixed(2)}|${seed}|${options.tear}|${options.fringe}|${options.detail || 1}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const built = buildOutline(w, h, seed, options);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, built);
  return built;
}

export function clearTornCache() {
  cache.clear();
}

/**
 * Noise that tiles over the perimeter and whose smallest feature spans
 * `featureMm` of arc. Sizing it in millimetres matters: a tear looks the same on
 * a postcard and a poster because paper fibres do not scale with the page.
 */
function loopField(seed, perimeter, featureMm) {
  const n = makeLoopNoise(seed, perimeter / featureMm);
  return (arc) => n(arc / featureMm);
}

function buildOutline(w, h, seed, { tear = 0.6, fringe = 0.55, detail = 1 } = {}) {
  const rng = makeRng(seed);
  const minSide = Math.min(w, h);

  const amplitude = clamp(minSide * 0.055, 1.4, 11) * (0.28 + tear * 1.5);
  const maxFringe = clamp(minSide * 0.016, 0.3, 2.4) * (0.28 + fringe * 1.6);
  const maxDelam = clamp(minSide * 0.01, 0.15, 1.2) * (0.3 + fringe * 1.1);
  const corner = clamp(minSide * 0.03, 0.8, 5) * (0.5 + tear);

  const base = sampleRoundedRect(w, h, corner, clamp(0.3 / detail, 0.14, 0.9));
  const points = base.points;
  const perimeter = base.perimeter;
  const N = points.length;
  const ds = perimeter / N;

  // How far the tear runs before it changes its mind.
  const lambda = clamp(minSide * 0.42, 9, 46);
  const omega = TAU / lambda;
  const zeta = 0.34;

  const grain = rng() * Math.PI;
  const driveField = loopField(seed ^ 0x1f2e3d4c, perimeter, lambda);
  const fringeField = loopField(seed ^ 0x7a5b3c11, perimeter, lambda * 0.34);
  const delamField = loopField(seed ^ 0x2c9d16b3, perimeter, lambda * 0.5);
  const scallopField = loopField(seed ^ 0x4b7f21d9, perimeter, 1.15);

  const target = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = points[i];
    const along = Math.abs(Math.cos(Math.atan2(p.nx, -p.ny) - grain));
    const aniso = 0.42 + 1.05 * (1 - along);
    target[i] = fbm((x) => driveField(x * lambda), p.t / lambda, 4, 0.55, 2.1) * amplitude * aniso;
  }

  const impulse = new Float64Array(N);
  for (const snag of buildSnags(rng, perimeter, minSide, tear)) {
    impulse[Math.floor(snag.at / ds) % N] += snag.kick;
  }

  const { offset, velocity } = walkCrack(target, impulse, N, ds, omega, zeta);

  const outer = new Array(N);
  const inner = new Array(N);
  const mid = new Array(N);
  const back = new Array(N);

  for (let i = 0; i < N; i++) {
    const p = points[i];
    const d = offset[i];

    // Paper gives way inward more readily than it bulges outward.
    let o = d < 0 ? d * 1.15 : d * 0.82;
    o -= Math.abs(scallopField(p.t)) * amplitude * 0.1;

    // Where the crack was moving fast it also shed more of the printed face, so
    // the pale core is widest exactly where the edge is most jagged.
    const jag = clamp(Math.abs(velocity[i]) * 1.4, 0, 1);
    const fw = maxFringe * clamp(0.14 + 0.55 * (fringeField(p.t) * 0.5 + 0.5) + 0.5 * jag, 0.06, 1.35);
    const dl = clamp(delamField(p.t) - 0.28, 0, 1) * maxDelam * 1.6;

    outer[i] = { x: p.x + p.nx * o, y: p.y + p.ny * o };
    mid[i] = { x: p.x + p.nx * (o - fw * 0.45), y: p.y + p.ny * (o - fw * 0.45) };
    inner[i] = { x: p.x + p.nx * (o - fw), y: p.y + p.ny * (o - fw) };
    back[i] = { x: p.x + p.nx * (o + dl), y: p.y + p.ny * (o + dl) };
  }

  return {
    outer,
    inner,
    back,
    band: [...outer, ...inner.slice().reverse()],
    bandCore: [...outer, ...mid.slice().reverse()],
    fibers: buildFibers(rng, outer, points, velocity, perimeter, maxFringe),
    dust: buildDust(rng, outer, points, maxFringe),
    amplitude,
    maxFringe,
    perimeter,
  };
}

/**
 * Integrates the crack around the piece. It runs two laps before recording so the
 * oscillator settles into its periodic response, then cross-fades the recorded
 * lap into its own continuation — without that the outline visibly seams where it
 * closes.
 */
function walkCrack(target, impulse, N, ds, omega, zeta) {
  const blend = Math.max(6, Math.round(N * 0.13));
  const rec = new Float64Array(N + blend);
  const recV = new Float64Array(N + blend);

  let d = 0;
  let v = 0;
  for (let s = 0; s < N * 2 + N + blend; s++) {
    const i = s % N;
    v += impulse[i];
    v += (omega * omega * (target[i] - d) - 2 * zeta * omega * v) * ds;
    d += v * ds;
    const r = s - N * 2;
    if (r >= 0) {
      rec[r] = d;
      recV[r] = v;
    }
  }

  const offset = new Float64Array(N);
  const velocity = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (i < blend) {
      const k = smoothstep(i / blend);
      offset[i] = rec[N + i] * (1 - k) + rec[i] * k;
      velocity[i] = recV[N + i] * (1 - k) + recV[i] * k;
    } else {
      offset[i] = rec[i];
      velocity[i] = recV[i];
    }
  }
  return { offset, velocity };
}

/** Fibre bundles that hold and then let go all at once. */
function buildSnags(rng, perimeter, minSide, tear) {
  const spacing = clamp(minSide * 0.3, 7, 34);
  const count = Math.max(1, Math.round((perimeter / spacing) * range(rng, 0.7, 1.4) * (0.5 + tear)));
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({
      at: rng() * perimeter,
      kick: (rng() < 0.72 ? -1 : 1) * range(rng, 0.35, 1.25),
    });
  }
  return list;
}

/**
 * Sampling a rounded rectangle rather than a sharp one keeps the outward normal
 * rotating continuously through the corners, so the walk stays smooth there
 * instead of spiking where two sides disagree.
 */
function sampleRoundedRect(w, h, radius, step) {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(radius, hw * 0.6, hh * 0.6);
  const straightX = w - 2 * r;
  const straightY = h - 2 * r;
  const arc = (TAU * r) / 4;
  const perimeter = 2 * straightX + 2 * straightY + 4 * arc;

  const segments = [
    { kind: 'line', len: straightX, from: [-hw + r, -hh], dir: [1, 0], n: [0, -1] },
    { kind: 'arc', len: arc, center: [hw - r, -hh + r], start: -Math.PI / 2 },
    { kind: 'line', len: straightY, from: [hw, -hh + r], dir: [0, 1], n: [1, 0] },
    { kind: 'arc', len: arc, center: [hw - r, hh - r], start: 0 },
    { kind: 'line', len: straightX, from: [hw - r, hh], dir: [-1, 0], n: [0, 1] },
    { kind: 'arc', len: arc, center: [-hw + r, hh - r], start: Math.PI / 2 },
    { kind: 'line', len: straightY, from: [-hw, hh - r], dir: [0, -1], n: [-1, 0] },
    { kind: 'arc', len: arc, center: [-hw + r, -hh + r], start: Math.PI },
  ];

  const points = [];
  let travelled = 0;
  for (const seg of segments) {
    if (seg.len <= 1e-6) continue;
    const count = Math.max(1, Math.round(seg.len / step));
    for (let i = 0; i < count; i++) {
      const u = i / count;
      const t = travelled + u * seg.len;
      if (seg.kind === 'line') {
        points.push({
          x: seg.from[0] + seg.dir[0] * seg.len * u,
          y: seg.from[1] + seg.dir[1] * seg.len * u,
          nx: seg.n[0],
          ny: seg.n[1],
          t,
        });
      } else {
        const a = seg.start + u * (Math.PI / 2);
        const nx = Math.cos(a);
        const ny = Math.sin(a);
        points.push({ x: seg.center[0] + nx * r, y: seg.center[1] + ny * r, nx, ny, t });
      }
    }
    travelled += seg.len;
  }

  return { points, perimeter };
}

/**
 * Loose fibres, in tufts rather than evenly spread, leaning the way the tear was
 * travelling. Lengths are heavy-tailed so a handful reach far out while most sit
 * just past the edge. Grouped into weight buckets so the renderer can stroke each
 * as one path instead of thousands of calls.
 */
function buildFibers(rng, outer, base, velocity, perimeter, maxFringe) {
  const N = outer.length;
  const buckets = [[], [], []];
  const clusters = Math.max(3, Math.round(perimeter / 6.5));
  const maxLen = clamp(maxFringe * 2.6, 0.35, 4.2);
  const spread = Math.max(2, Math.round(N * 0.012));

  for (let c = 0; c < clusters; c++) {
    const centre = Math.floor(rng() * N);
    const hairs = 2 + Math.floor(rng() * 7);
    for (let k = 0; k < hairs; k++) {
      const idx = (((centre + Math.round(gaussian(rng) * spread)) % N) + N) % N;
      const p = outer[idx];
      const b = base[idx];
      const sweep = clamp(velocity[idx] * 0.9, -1, 1) * 0.7;
      const a = Math.atan2(b.ny, b.nx) + sweep + gaussian(rng) * 0.45;
      const len = maxLen * (Math.pow(rng(), 2.1) + 0.06);
      const root = maxLen * range(rng, 0.15, 0.6);
      buckets[k % 3].push({
        x0: p.x - Math.cos(a) * root,
        y0: p.y - Math.sin(a) * root,
        x1: p.x + Math.cos(a) * len,
        y1: p.y + Math.sin(a) * len,
      });
    }
  }
  return buckets;
}

/** Specks of fibre shed just past the tear. */
function buildDust(rng, outer, base, maxFringe) {
  const out = [[], []];
  const count = Math.round(outer.length * 0.16);
  const reach = maxFringe * 1.8;

  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng() * outer.length);
    const p = outer[idx];
    const b = base[idx];
    const away = Math.pow(rng(), 1.7) * reach;
    const side = gaussian(rng) * maxFringe * 0.5;
    out[i % 2].push({
      x: p.x + b.nx * away - b.ny * side,
      y: p.y + b.ny * away + b.nx * side,
      r: clamp(maxFringe * range(rng, 0.05, 0.18), 0.02, 0.3),
    });
  }
  return out;
}

/** Builds a Path2D at a given pixel scale. Geometry stays in mm; only this scales. */
export function pathFromPoints(points, pxPerMm) {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(points[0].x * pxPerMm, points[0].y * pxPerMm);
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x * pxPerMm, points[i].y * pxPerMm);
  }
  path.closePath();
  return path;
}
