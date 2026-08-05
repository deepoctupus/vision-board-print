/**
 * Amor — convite, envelope, camafeu, bilhete. Objetos de papel em que a foto foi
 * impressa, não molduras coladas por cima. Toda a medida nasce em milímetros e
 * só vira pixel na multiplicação por `pxPerMm`.
 *
 * Nenhuma peça escreve palavra alguma: o recorte não sabe quem está na foto nem
 * o que se comemora, então onde ia uma linha de texto fica só a **marca** dela
 * (ver `ink.js`). O convite continua tendo bloco central, filetes e data; ele só
 * não afirma mais nada.
 */

import { makeRng, range } from '../../core/rng.js';
import { roundedRect } from '../shapes.js';
import { inkHeight, inkLine, inkWords, inkArc } from './ink.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Abaixo disto a marca vira borrão numa prévia a 26% e não paga o que custa. */
const MIN_MARK_MM = 1.6;

/* ---------------------------------------------------------------- cor ----- */

function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [253, 250, 244];
  const s = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Positivo escurece o papel, negativo clareia. A tinta sai da própria cor do papel. */
function shade(hex, amount, alpha = 1) {
  const rgb = parseHex(hex);
  const target = amount < 0 ? 255 : 0;
  const k = Math.abs(amount);
  const [r, g, b] = rgb.map((v) => Math.round(v + (target - v) * k));
  return `rgba(${r},${g},${b},${alpha})`;
}

/* -------------------------------------------------------------- traços ---- */

/**
 * Um filete de 0.14 mm some por completo numa prévia a 26%: vira 0.1 px e o
 * canvas o dilui até o nada. O piso de 0.35 px mantém a linha como um fio claro.
 */
function penWidth(px) {
  return Math.max(0.35, px);
}

function hairline(ctx, x0, y0, x1, y1, widthPx, style) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = penWidth(widthPx);
  ctx.strokeStyle = style;
  ctx.stroke();
}

function outline(ctx, path, widthPx, style) {
  ctx.lineWidth = penWidth(widthPx);
  ctx.strokeStyle = style;
  ctx.stroke(path);
}

function diamond(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fill();
}

function dot(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
}

/* --------------------------------------------------------------- marca ---- */

/**
 * A marca de uma linha impressa. Sem texto não há o que medir, então a largura
 * vem de `ratio`: quantos corpos de tipo a linha ocuparia se fosse composta. É
 * ele que preserva a proporção entre um olho miúdo e o bloco central da peça.
 *
 * Devolve a largura desenhada, 0 quando a linha é pequena demais para aparecer.
 */
function markLine(ctx, cx, y, maxW, sizeMm, pxPerMm, ratio, parts = 0, seed = 1, align = 'center') {
  if (!(sizeMm >= MIN_MARK_MM)) return 0;
  const w = Math.min(maxW, sizeMm * pxPerMm * ratio);
  return inkWords(ctx, cx, y, w, inkHeight(sizeMm, pxPerMm), align, parts, seed);
}

/* ------------------------------------------------------------ contorno ---- */

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function cumulative(pts, closed = false) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + dist(pts[i - 1], pts[i]));
  if (closed) acc.push(acc[acc.length - 1] + dist(pts[pts.length - 1], pts[0]));
  return acc;
}

function sampleAt(pts, acc, s) {
  const total = acc[acc.length - 1] || 1;
  const d = ((s % total) + total) % total;
  let i = 1;
  while (i < acc.length - 1 && acc[i] < d) i++;
  const seg = acc[i] - acc[i - 1] || 1;
  const t = (d - acc[i - 1]) / seg;
  const a = pts[(i - 1) % pts.length];
  const b = pts[i % pts.length];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

function pointsAlong(pts, spacing) {
  const acc = cumulative(pts, true);
  const total = acc[acc.length - 1];
  const count = Math.max(4, Math.round(total / spacing));
  const step = total / count;
  const out = [];
  for (let i = 0; i < count; i++) out.push(sampleAt(pts, acc, step * (i + 0.5)));
  return out;
}

/** O sinal da área diz o sentido do contorno; sem ele a renda cresceria pra dentro. */
function outwardNormals(pts) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area > 0 ? 1 : -1;
  return pts.map((_, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    return { x: (ty / len) * sign, y: (-tx / len) * sign };
  });
}

/**
 * Bico de renda. A amplitude é |sin| do comprimento de arco, e não do parâmetro:
 * medida por arco as conchas saem do mesmo tamanho na barriga e na ponta do
 * coração, onde o parâmetro corre muito mais devagar.
 */
function laceOutline(pts, amp, period) {
  const acc = cumulative(pts, true);
  const total = acc[acc.length - 1];
  const lobes = Math.max(8, Math.round(total / period));
  const step = total / lobes;
  const normals = outwardNormals(pts);
  return pts.map((p, i) => {
    const d = amp * Math.abs(Math.sin((Math.PI * acc[i]) / step));
    return { x: p.x + normals[i].x * d, y: p.y + normals[i].y * d };
  });
}

function heartPoints(hw, hh, steps = 180) {
  const raw = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    raw.push([x, y]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const sx = (hw * 2) / (maxX - minX);
  const sy = (hh * 2) / (maxY - minY);
  return raw.map(([x, y]) => ({
    x: (x - (minX + maxX) / 2) * sx,
    y: (y - (minY + maxY) / 2) * sy,
  }));
}

function ellipsePoints(rx, ry, steps = 240) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
  }
  return pts;
}

function pathFrom(pts, cx = 0, cy = 0) {
  const p = new Path2D();
  pts.forEach((pt, i) => {
    if (i) p.lineTo(pt.x + cx, pt.y + cy);
    else p.moveTo(pt.x + cx, pt.y + cy);
  });
  p.closePath();
  return p;
}

function ellipsePath(rx, ry) {
  const p = new Path2D();
  p.ellipse(0, 0, rx, ry, 0, 0, TAU);
  return p;
}

/** Retângulo de topo curvo: raio grande vira arco de convite, raio pequeno vira cartão. */
function archRect(x, y, w, h, r) {
  const rad = clamp(r, 0, Math.min(w / 2, h));
  const p = new Path2D();
  if (rad <= 0.01) {
    p.rect(x, y, w, h);
    return p;
  }
  p.moveTo(x, y + h);
  p.lineTo(x, y + rad);
  p.arcTo(x, y, x + rad, y, rad);
  p.lineTo(x + w - rad, y);
  p.arcTo(x + w, y, x + w, y + rad, rad);
  p.lineTo(x + w, y + h);
  p.closePath();
  return p;
}

/* -------------------------------------------------------------- estilos --- */

const convite = {
  id: 'a-convite',
  label: 'Convite',
  build({ w, h, pxPerMm, seed }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const minSide = Math.min(w, h);
    const margin = clamp(minSide * 0.095, 2.6, 12);
    const band = clamp(h * 0.3, margin * 2.2, h * 0.42);

    const box = {
      x: -hw + mm(margin),
      y: -hh + mm(margin),
      w: mm(w - margin * 2),
      h: mm(h - margin - band),
    };
    const arch = Math.min(box.w / 2, box.h * 0.4);

    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.8)),
      photo: archRect(box.x, box.y, box.w, box.h, arch),
      photoBox: box,
      decorate: (ctx, info) => paintConvite(ctx, info, { margin, box, arch }),
    };
  },
};

function paintConvite(ctx, { pxPerMm, tone, seed, w, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hw = mm(w) / 2;
  const hh = mm(h) / 2;
  const ink = shade(tone, 0.72, 0.9);
  const faint = shade(tone, 0.6, 0.5);

  ctx.save();
  ctx.lineJoin = 'miter';

  const off = mm(L.margin * 0.4);
  const gap = mm(clamp(L.margin * 0.16, 0.45, 1.5));
  outline(ctx, roundedRect(-hw + off, -hh + off, (hw - off) * 2, (hh - off) * 2, mm(0.4)), mm(0.3), ink);
  outline(
    ctx,
    roundedRect(-hw + off + gap, -hh + off + gap, (hw - off - gap) * 2, (hh - off - gap) * 2, mm(0.3)),
    mm(0.13),
    faint
  );

  ctx.fillStyle = ink;
  const gem = mm(clamp(L.margin * 0.15, 0.4, 1.3));
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) diamond(ctx, sx * (hw - off), sy * (hh - off), gem);
  }

  outline(
    ctx,
    archRect(L.box.x - mm(0.8), L.box.y - mm(0.8), L.box.w + mm(1.6), L.box.h + mm(0.8), L.arch + mm(0.8)),
    mm(0.18),
    faint
  );

  const top = L.box.y + L.box.h;
  const bottom = hh - mm(L.margin * 0.95);
  const content = bottom - top;
  const contentMm = content / pxPerMm;
  const maxW = L.box.w;
  if (contentMm < MIN_MARK_MM * 2) {
    ctx.restore();
    return;
  }

  // Olho miúdo espaçado, no lugar onde ia a chamada do convite.
  ctx.fillStyle = ink;
  markLine(ctx, 0, top + content * 0.14, maxW, clamp(contentMm * 0.11, 0, 3.2), pxPerMm, 6.9, 2, seed);

  const divY = top + content * 0.33;
  const arm = Math.min(maxW * 0.3, mm(18));
  const inner = mm(clamp(contentMm * 0.07, 0.9, 2.4));
  hairline(ctx, -arm, divY, -inner, divY, mm(0.16), faint);
  hairline(ctx, inner, divY, arm, divY, mm(0.16), faint);
  ctx.fillStyle = ink;
  diamond(ctx, 0, divY, mm(clamp(contentMm * 0.035, 0.4, 1.1)));

  // Bloco central: duas marcas grandes, o peso que o serifado tinha.
  markLine(ctx, 0, top + content * 0.6, maxW * 0.94, clamp(contentMm * 0.33, 0, 12), pxPerMm, 5.2, 2, (seed ^ 0x51) >>> 0);

  // Linha da data: quatro marcas curtas, o ritmo de dia-mês-ano.
  ctx.fillStyle = shade(tone, 0.62, 0.85);
  markLine(ctx, 0, top + content * 0.88, maxW * 0.86, clamp(contentMm * 0.1, 0, 2.8), pxPerMm, 13, 4, (seed ^ 0xa3) >>> 0);

  ctx.restore();
}

const envelope = {
  id: 'a-envelope',
  label: 'Envelope',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const pocketMm = clamp(h * 0.4, h * 0.3, h * 0.46);
    const pocketTop = hh - mm(pocketMm);
    const cardW = mm(w * 0.84);
    const cardX = -cardW / 2;
    const round = mm(0.7);

    // Cartão e bolso se sobrepõem de propósito: preenchidos por não-zero viram
    // uma silhueta só, e a foto para na boca do bolso.
    const paper = new Path2D();
    paper.addPath(archRect(cardX, -hh, cardW, pocketTop + hh + mm(pocketMm * 0.55), round));
    paper.addPath(roundedRect(-hw, pocketTop, hw * 2, mm(pocketMm), mm(1.1)));

    const box = { x: cardX, y: -hh, w: cardW, h: pocketTop + hh };
    return {
      paper,
      photo: archRect(box.x, box.y, box.w, box.h, round),
      photoBox: box,
      decorate: (ctx, info) => paintEnvelope(ctx, info, { pocketMm, pocketTop, box, round }),
    };
  },
};

function paintEnvelope(ctx, { pxPerMm, tone, seed, w, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hw = mm(w) / 2;
  const hh = mm(h) / 2;
  const minSide = Math.min(w, h);
  const rng = makeRng((seed ^ 0x2c77b1a9) >>> 0);
  const ink = shade(tone, 0.68, 0.85);
  const faint = shade(tone, 0.55, 0.4);

  ctx.save();

  // A aba projeta sombra no cartão: sem isso os dois viram um adesivo só.
  ctx.save();
  ctx.clip(archRect(L.box.x, L.box.y, L.box.w, L.box.h, L.round));
  const depth = mm(clamp(minSide * 0.045, 1.2, 4.5));
  const grad = ctx.createLinearGradient(0, L.pocketTop - depth, 0, L.pocketTop);
  grad.addColorStop(0, 'rgba(40,28,18,0)');
  grad.addColorStop(1, 'rgba(40,28,18,0.3)');
  ctx.fillStyle = grad;
  ctx.fillRect(L.box.x, L.pocketTop - depth, L.box.w, depth);
  ctx.restore();

  hairline(ctx, -hw + mm(1), L.pocketTop, hw - mm(1), L.pocketTop, mm(0.22), shade(tone, 0.45, 0.55));
  hairline(
    ctx,
    -hw + mm(1),
    L.pocketTop + mm(0.3),
    hw - mm(1),
    L.pocketTop + mm(0.3),
    mm(0.2),
    shade(tone, -0.6, 0.6)
  );

  const flapY = hh - mm(L.pocketMm * 0.2);
  hairline(ctx, -hw + mm(1.6), flapY, hw - mm(1.6), flapY, mm(0.14), faint);

  // Marca do destinatário sobre o filete: é ela que faz o bolso virar envelope.
  const markMax = mm(w * 0.7);
  ctx.fillStyle = ink;
  const nameSize = clamp(L.pocketMm * 0.24, 0, 7);
  const nameY = L.pocketTop + mm(L.pocketMm * 0.56);
  const drew = markLine(ctx, 0, nameY, markMax, nameSize, pxPerMm, 4.6, 2, seed);
  if (drew > 0) {
    const rule = Math.min(markMax, drew * 1.5);
    hairline(ctx, -rule / 2, nameY + mm(nameSize * 0.85), rule / 2, nameY + mm(nameSize * 0.85), mm(0.16), faint);
  }

  drawSeal(ctx, 0, L.pocketTop, mm(clamp(minSide * 0.1, 2.2, 9)), rng);

  ctx.restore();
}

/** Cera: contorno irregular, brilho radial e um coração afundado com dois relevos. */
function drawSeal(ctx, cx, cy, r, rng) {
  const steps = 40;
  const phase = rng() * TAU;
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    const wobble = 1 + Math.sin(a * 5 + phase) * 0.045 + Math.sin(a * 9 - phase) * 0.025;
    pts.push({ x: Math.cos(a) * r * wobble, y: Math.sin(a) * r * wobble });
  }
  const blob = pathFrom(pts, cx, cy);

  ctx.save();
  ctx.shadowColor = 'rgba(52,20,16,0.4)';
  ctx.shadowBlur = r * 0.35;
  ctx.shadowOffsetY = r * 0.14;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.05);
  g.addColorStop(0, '#a94a4c');
  g.addColorStop(0.62, '#8b3439');
  g.addColorStop(1, '#5f2126');
  ctx.fillStyle = g;
  ctx.fill(blob);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.72, 0, TAU);
  ctx.lineWidth = penWidth(r * 0.08);
  ctx.strokeStyle = 'rgba(255,222,208,0.2)';
  ctx.stroke();

  const heart = heartPoints(r * 0.3, r * 0.28, 90);
  ctx.fillStyle = 'rgba(58,18,20,0.42)';
  ctx.fill(pathFrom(heart, cx, cy + r * 0.06));
  ctx.fillStyle = 'rgba(255,214,200,0.22)';
  ctx.fill(pathFrom(heart, cx, cy - r * 0.02));
  ctx.restore();
}

const renda = {
  id: 'a-renda',
  label: 'Coração rendado',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const minSide = Math.min(w, h);
    const amp = clamp(minSide * 0.026, 0.6, 2.2);
    const ring = Math.min(clamp(minSide * 0.105, 2.4, 11), minSide * 0.3);

    // A renda cresce para fora: o coração base nasce recuado para não invadir o vizinho.
    const baseHw = mm(w / 2 - amp);
    const baseHh = mm(h / 2 - amp);
    const paper = pathFrom(laceOutline(heartPoints(baseHw, baseHh, 220), mm(amp), mm(amp * 2.6)));

    const eyeR = mm(clamp(ring * 0.12, 0.22, 0.85));
    const mid = heartPoints(baseHw - mm(ring) * 0.46, baseHh - mm(ring) * 0.46, 200);
    for (const p of pointsAlong(mid, mm(ring * 0.66))) {
      paper.moveTo(p.x + eyeR, p.y);
      paper.arc(p.x, p.y, eyeR, 0, TAU);
    }

    const innerHw = Math.max(mm(2), baseHw - mm(ring));
    const innerHh = Math.max(mm(2), baseHh - mm(ring));
    const photo = pathFrom(heartPoints(innerHw, innerHh, 200));

    return {
      paper,
      photo,
      photoBox: { x: -innerHw, y: -innerHh, w: innerHw * 2, h: innerHh * 2 },
      rule: 'evenodd',
      decorate: (ctx, info) => paintRenda(ctx, info, { amp, ring, baseHw, baseHh, innerHw, innerHh }),
    };
  },
};

function paintRenda(ctx, { pxPerMm, tone }, L) {
  const mm = (v) => v * pxPerMm;
  const ink = shade(tone, 0.55, 0.45);

  ctx.save();

  outline(ctx, pathFrom(heartPoints(L.baseHw - mm(0.7), L.baseHh - mm(0.7), 200)), mm(0.2), shade(tone, 0.3, 0.35));

  outline(ctx, pathFrom(heartPoints(L.innerHw + mm(0.6), L.innerHh + mm(0.6), 200)), mm(0.3), shade(tone, 0.62, 0.7));
  outline(ctx, pathFrom(heartPoints(L.innerHw + mm(1.4), L.innerHh + mm(1.4), 200)), mm(0.13), ink);

  const pinR = mm(clamp(L.ring * 0.055, 0.16, 0.4));
  if (pinR > 0.2) {
    ctx.fillStyle = ink;
    const garland = heartPoints(L.innerHw + mm(L.ring * 0.3), L.innerHh + mm(L.ring * 0.3), 200);
    for (const p of pointsAlong(garland, mm(L.ring * 0.3))) dot(ctx, p.x, p.y, pinR);
  }

  ctx.restore();
}

const instantanea = {
  id: 'a-instantanea',
  label: 'Instantânea',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const minSide = Math.min(w, h);
    const frame = clamp(minSide * 0.055, 1.8, 8);
    const foot = frame * 3.1;
    const box = {
      x: -hw + mm(frame),
      y: -hh + mm(frame),
      w: mm(w - frame * 2),
      h: mm(h - frame - foot),
    };
    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.7)),
      photo: roundedRect(box.x, box.y, box.w, box.h, 0),
      photoBox: box,
      decorate: (ctx, info) => paintInstantanea(ctx, info, { frame, foot, box }),
    };
  },
};

function paintInstantanea(ctx, { pxPerMm, tone, seed, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hh = mm(h) / 2;
  const rng = makeRng((seed ^ 0x3ba91d05) >>> 0);
  const ink = shade(tone, 0.7, 0.88);

  const top = L.box.y + L.box.h;
  const bottom = hh - mm(L.frame * 0.4);
  const span = bottom - top;
  const spanMm = span / pxPerMm;
  const maxW = L.box.w * 0.94;
  if (spanMm < MIN_MARK_MM * 1.6) return;

  ctx.save();
  ctx.fillStyle = ink;

  ctx.save();
  ctx.translate(0, top + span * 0.42);
  ctx.rotate(range(rng, -1.6, 1.6) * (Math.PI / 180));
  const capMm = clamp(spanMm * 0.42, 0, 9);
  const capW = markLine(ctx, 0, 0, maxW, capMm, pxPerMm, 5, 2, seed);
  if (capW > 0) {
    // Sublinhado de caneta: uma quadrática levemente torta, nunca uma reta.
    ctx.beginPath();
    ctx.moveTo(-capW / 2, mm(capMm * 0.46));
    ctx.quadraticCurveTo(0, mm(capMm * (0.46 + range(rng, 0.1, 0.2))), capW / 2, mm(capMm * range(rng, 0.38, 0.5)));
    ctx.lineWidth = penWidth(mm(0.22));
    ctx.strokeStyle = shade(tone, 0.6, 0.45);
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();

  const dateMm = clamp(spanMm * 0.16, 0, 2.8);
  if (dateMm >= MIN_MARK_MM) {
    const y = top + span * 0.82;
    ctx.fillStyle = shade(tone, 0.55, 0.7);
    const runW = Math.min(maxW * 0.7, mm(dateMm * 7.4));
    const heart = mm(dateMm * 0.6);
    // O coração vem antes da marca, como um marcador de margem à esquerda dela.
    ctx.fill(pathFrom(heartPoints(heart, heart * 0.92, 80), -runW / 2 - heart * 1.8, y));
    inkWords(ctx, heart * 0.9, y, runW, inkHeight(dateMm, pxPerMm), 'center', 3, seed);
  }

  ctx.restore();
}

const camafeu = {
  id: 'a-camafeu',
  label: 'Camafeu',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const minSide = Math.min(w, h);
    const ring = Math.min(clamp(minSide * 0.1, 2.4, 10), minSide * 0.3);
    const rx = Math.max(mm(1), hw - mm(ring));
    const ry = Math.max(mm(1), hh - mm(ring));

    return {
      paper: ellipsePath(hw, hh),
      photo: ellipsePath(rx, ry),
      photoBox: { x: -rx, y: -ry, w: rx * 2, h: ry * 2 },
      decorate: (ctx, info) => paintCamafeu(ctx, info, { ring, rx, ry }),
    };
  },
};

function paintCamafeu(ctx, { pxPerMm, tone, w, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hw = mm(w) / 2;
  const hh = mm(h) / 2;
  const ink = shade(tone, 0.66, 0.85);

  ctx.save();

  const beadR = mm(clamp(L.ring * 0.13, 0.22, 0.9));
  const beadRing = ellipsePoints(hw - mm(L.ring * 0.3), hh - mm(L.ring * 0.3), 260);
  for (const p of pointsAlong(beadRing, beadR * 2.5)) {
    ctx.fillStyle = shade(tone, 0.42, 0.5);
    dot(ctx, p.x, p.y, beadR);
    ctx.fillStyle = shade(tone, -0.7, 0.55);
    dot(ctx, p.x - beadR * 0.28, p.y - beadR * 0.3, beadR * 0.42);
  }

  outline(ctx, ellipsePath(L.rx + mm(0.5), L.ry + mm(0.5)), mm(0.28), shade(tone, 0.6, 0.75));
  outline(ctx, ellipsePath(L.rx + mm(1.3), L.ry + mm(1.3)), mm(0.12), ink);

  const engraveMm = clamp(L.ring * 0.3, 0, 3.4);
  if (engraveMm >= MIN_MARK_MM) {
    const arcRx = hw - mm(L.ring * 0.64);
    const arcRy = hh - mm(L.ring * 0.64);
    // Banda gravada na metade de baixo do anel, centrada pelo próprio `inkArc`.
    // A fração vem da largura que a gravação teria, senão a banda dá a volta toda.
    const arcLen = (Math.PI * (arcRx + arcRy)) / 2;
    ctx.fillStyle = ink;
    inkArc(ctx, arcRx, arcRy, 0, Math.PI, inkHeight(engraveMm, pxPerMm), 3, clamp(mm(engraveMm * 10) / arcLen, 0.12, 0.7));
  }

  ctx.restore();
}

const reserve = {
  id: 'a-reserve',
  label: 'Reserve a data',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const minSide = Math.min(w, h);
    const margin = clamp(minSide * 0.07, 2, 9);
    const band = clamp(h * 0.26, margin * 2.4, h * 0.38);
    const box = {
      x: -hw + mm(margin),
      y: -hh + mm(margin),
      w: mm(w - margin * 2),
      h: mm(h - margin - band),
    };
    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.8)),
      photo: roundedRect(box.x, box.y, box.w, box.h, mm(0.4)),
      photoBox: box,
      decorate: (ctx, info) => paintReserve(ctx, info, { margin, box }),
    };
  },
};

function paintReserve(ctx, { pxPerMm, tone, seed, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hh = mm(h) / 2;
  const ink = shade(tone, 0.74, 0.92);
  const faint = shade(tone, 0.58, 0.45);

  const top = L.box.y + L.box.h;
  const bottom = hh - mm(L.margin * 0.9);
  const span = bottom - top;
  const spanMm = span / pxPerMm;
  if (spanMm < MIN_MARK_MM * 2) return;

  ctx.save();

  const arm = Math.min(L.box.w * 0.16, mm(11));
  hairline(ctx, -arm, top + span * 0.08, arm, top + span * 0.08, mm(0.18), faint);

  ctx.fillStyle = shade(tone, 0.6, 0.85);
  markLine(ctx, 0, top + span * 0.24, L.box.w, clamp(spanMm * 0.13, 0, 3), pxPerMm, 13, 3, seed);

  const y = top + span * 0.66;
  const maxW = L.box.w;

  // Marca grande do dia entre dois filetes, ladeada pelas marcas de mês e ano.
  // As três encolhem juntas até a fila caber, como faziam quando eram texto.
  let dayMm = clamp(spanMm * 0.46, 0, 22);
  let sideMm = clamp(spanMm * 0.15, 0, 4);
  let layout = null;
  while (dayMm >= MIN_MARK_MM * 1.5) {
    const dayW = mm(dayMm * 1.15);
    const mesW = mm(sideMm * 2.3);
    const anoW = mm(sideMm * 3.2);
    const gap = mm(dayMm * 0.42);
    if (dayW + gap * 4 + mesW + anoW <= maxW) {
      layout = { dayW, mesW, anoW, gap };
      break;
    }
    dayMm *= 0.9;
    sideMm *= 0.9;
  }
  if (!layout) {
    ctx.restore();
    return;
  }

  ctx.fillStyle = ink;
  inkLine(ctx, 0, y, layout.dayW, inkHeight(dayMm, pxPerMm), 'center');

  const edge = layout.dayW / 2 + layout.gap;
  const half = mm(dayMm * 0.42);
  hairline(ctx, -edge, y - half, -edge, y + half, mm(0.16), faint);
  hairline(ctx, edge, y - half, edge, y + half, mm(0.16), faint);

  if (sideMm >= MIN_MARK_MM) {
    ctx.fillStyle = shade(tone, 0.62, 0.85);
    const sideH = inkHeight(sideMm, pxPerMm);
    inkLine(ctx, -edge - layout.gap - layout.mesW / 2, y, layout.mesW, sideH, 'center');
    inkLine(ctx, edge + layout.gap + layout.anoW / 2, y, layout.anoW, sideH, 'center');
  }

  ctx.restore();
}

const bilhete = {
  id: 'a-bilhete',
  label: 'Bilhete dobrado',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const paper = roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.6));
    const box = { x: -hw, y: -hh, w: hw * 2, h: hh * 2 };
    return {
      paper,
      photo: paper,
      photoBox: box,
      decorate: (ctx, info) => paintBilhete(ctx, info, { paper }),
    };
  },
};

function paintBilhete(ctx, { pxPerMm, seed, w, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hw = mm(w) / 2;
  const hh = mm(h) / 2;
  const minSide = Math.min(w, h);
  const rng = makeRng((seed ^ 0x6f21c4b3) >>> 0);

  ctx.save();
  ctx.clip(L.paper);

  const band = mm(clamp(minSide * 0.035, 1.2, 4));

  const crease = (along, at, flip) => {
    const g = along === 'x'
      ? ctx.createLinearGradient(0, at - band / 2, 0, at + band / 2)
      : ctx.createLinearGradient(at - band / 2, 0, at + band / 2, 0);
    const a = flip ? 1 : 0;
    g.addColorStop(0, 'rgba(255,252,246,0)');
    g.addColorStop(0.46, `rgba(255,252,246,${0.16 * (1 - a) + 0.04 * a})`);
    g.addColorStop(0.5, 'rgba(28,19,12,0.17)');
    g.addColorStop(0.54, `rgba(255,252,246,${0.16 * a + 0.04 * (1 - a)})`);
    g.addColorStop(1, 'rgba(255,252,246,0)');
    ctx.fillStyle = g;
    if (along === 'x') ctx.fillRect(-hw, at - band / 2, hw * 2, band);
    else ctx.fillRect(at - band / 2, -hh, band, hh * 2);

    // O vinco raspa a emulsão: é esse fio claro que faz a foto parecer dobrada.
    ctx.strokeStyle = 'rgba(255,253,248,0.3)';
    ctx.lineWidth = penWidth(mm(0.16));
    ctx.beginPath();
    if (along === 'x') {
      ctx.moveTo(-hw, at);
      ctx.lineTo(hw, at);
    } else {
      ctx.moveTo(at, -hh);
      ctx.lineTo(at, hh);
    }
    ctx.stroke();
  };

  crease('x', -hh + (hh * 2) / 3, false);
  crease('x', -hh + ((hh * 2) * 2) / 3, true);
  crease('y', 0, false);

  const wear = mm(clamp(minSide * 0.05, 1.5, 6));
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = sx * hw;
      const cy = sy * hh;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, wear);
      g.addColorStop(0, 'rgba(255,252,246,0.26)');
      g.addColorStop(1, 'rgba(255,252,246,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - wear, cy - wear, wear * 2, wear * 2);
    }
  }

  const noteMm = clamp(minSide * 0.075, 0, 7);
  if (noteMm >= MIN_MARK_MM) {
    ctx.save();
    // Tinta branca com sombra própria é o que segura a marca sobre qualquer foto.
    ctx.shadowColor = 'rgba(22,15,9,0.5)';
    ctx.shadowBlur = mm(0.9);
    ctx.shadowOffsetY = mm(0.25);
    ctx.fillStyle = 'rgba(255,252,246,0.94)';
    ctx.translate(-hw + mm(minSide * 0.075), hh - mm(minSide * 0.075));
    ctx.rotate(range(rng, -1.4, 1.4) * (Math.PI / 180));
    const noteW = Math.max(0, Math.min(mm(noteMm * 4.6), mm(w) - mm(minSide * 0.3)));
    // A origem está na linha de base do bilhete: a marca sobe até a altura de x.
    const drawn = inkWords(ctx, 0, -mm(noteMm * 0.25), noteW, inkHeight(noteMm, pxPerMm), 'left', 3, seed);
    if (drawn > 0) {
      const heart = mm(noteMm * 0.34);
      ctx.fill(pathFrom(heartPoints(heart, heart * 0.92, 80), drawn + heart * 2, -heart));
    }
    ctx.restore();
  }

  ctx.restore();
}

export const LOVE = {
  id: 'amor',
  label: 'Amor',
  styles: [convite, envelope, renda, instantanea, camafeu, reserve, bilhete],
};
