/**
 * Deterministic randomness. Every visual decision in the app derives from a seed
 * so that a preview and a 300 DPI export are guaranteed to be the same artwork.
 */

export function hashSeed(input) {
  const str = String(input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough distribution for visuals. */
export function makeRng(seed) {
  let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng, min, max) {
  return min + rng() * (max - min);
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function shuffled(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Approximately gaussian via sum of uniforms — cheaper than Box-Muller and bounded. */
export function gaussian(rng) {
  return (rng() + rng() + rng() - 1.5) * 1.1547;
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * 1D value noise over an integer lattice. Returns [-1, 1].
 * Lattice values are hashed from the seed, so the field is infinite and stateless.
 */
export function makeNoise1D(seed) {
  const base = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
  const at = (i) => {
    let h = (i >>> 0) ^ base;
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 2147483648 - 1;
  };
  return function noise(x) {
    const i = Math.floor(x);
    const f = x - i;
    return at(i) + (at(i + 1) - at(i)) * smoothstep(f);
  };
}

/**
 * Fractal brownian motion. `octaves` layers of noise at doubling frequency and
 * halving amplitude. Normalised so the result stays in roughly [-1, 1].
 */
export function fbm(noise, x, octaves = 4, gain = 0.5, lacunarity = 2) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}

/**
 * Wraps a noise field so it tiles seamlessly over [0, period). Needed for closed
 * outlines: without it the tear edge would visibly seam where it wraps around.
 */
export function makeLoopNoise(seed, period) {
  const n = makeNoise1D(seed);
  return function loop(x) {
    const t = ((x % period) + period) / period % 1;
    return n(t * period) * (1 - t) + n(t * period - period) * t;
  };
}
