/**
 * A cheap stand-in for saliency: photographic subjects carry more local contrast
 * and colour than their surroundings, so an edge-energy map finds them well
 * enough to stop automatic cropping from beheading people.
 */

const MAP_EDGE = 64;

function toEnergyMap(source) {
  const scale = Math.min(1, MAP_EDGE / Math.max(source.width, source.height));
  const w = Math.max(8, Math.round(source.width * scale));
  const h = Math.max(8, Math.round(source.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);

  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  const luma = new Float32Array(w * h);
  const chroma = new Float32Array(w * h);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    luma[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    chroma[i] = max === 0 ? 0 : (max - min) / max;
  }

  const energy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -luma[i - w - 1] - 2 * luma[i - 1] - luma[i + w - 1] +
        luma[i - w + 1] + 2 * luma[i + 1] + luma[i + w + 1];
      const gy =
        -luma[i - w - 1] - 2 * luma[i - w] - luma[i - w + 1] +
        luma[i + w - 1] + 2 * luma[i + w] + luma[i + w + 1];
      energy[i] = Math.hypot(gx, gy) * 0.6 + chroma[i] * 0.4;
    }
  }

  // Blur so a single noisy pixel cannot drag the focal point across the frame.
  const blurred = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += energy[yy * w + xx];
          n++;
        }
      }
      blurred[y * w + x] = sum / n;
    }
  }

  return { map: blurred, w, h };
}

export function detectFocalPoint(source) {
  const result = toEnergyMap(source);
  if (!result) return { x: 0.5, y: 0.5 };
  const { map, w, h } = result;

  let total = 0;
  let cx = 0;
  let cy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = map[y * w + x];
      total += v;
      cx += v * (x + 0.5);
      cy += v * (y + 0.5);
    }
  }
  if (total <= 1e-6) return { x: 0.5, y: 0.5 };
  const centroid = { x: cx / total / w, y: cy / total / h };

  // Densest half-size window — catches an off-centre subject that the centroid
  // would average away against a busy background.
  const winW = Math.max(2, Math.round(w * 0.5));
  const winH = Math.max(2, Math.round(h * 0.5));
  const step = Math.max(1, Math.round(Math.min(w, h) / 16));
  let best = -1;
  let bestX = (w - winW) / 2;
  let bestY = (h - winH) / 2;
  for (let y = 0; y + winH <= h; y += step) {
    for (let x = 0; x + winW <= w; x += step) {
      let sum = 0;
      for (let yy = y; yy < y + winH; yy += 2) {
        const row = yy * w;
        for (let xx = x; xx < x + winW; xx += 2) sum += map[row + xx];
      }
      if (sum > best) {
        best = sum;
        bestX = x;
        bestY = y;
      }
    }
  }
  const window = { x: (bestX + winW / 2) / w, y: (bestY + winH / 2) / h };

  // Pulled back toward centre: a wrong guess is far more damaging than a timid one.
  const blend = (a, b, t) => a * (1 - t) + b * t;
  const x = blend(0.5, blend(centroid.x, window.x, 0.55), 0.72);
  const y = blend(0.5, blend(centroid.y, window.y, 0.55), 0.72);

  return {
    x: Math.min(0.82, Math.max(0.18, x)),
    y: Math.min(0.82, Math.max(0.18, y)),
  };
}

export function averageColor(source) {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, 8, 8);
  try {
    const { data } = ctx.getImageData(0, 0, 8, 8);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const n = data.length / 4;
    return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
  } catch {
    return 'rgb(128,128,128)';
  }
}
