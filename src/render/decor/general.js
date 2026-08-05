/**
 * Categoria coringa: objetos bons demais para ficarem de fora e que não
 * pertencem a nenhum tema. Um ingresso, um post-it, um adesivo recortado.
 *
 * Contrato em `./index.js`. Tudo aqui é mm × pxPerMm e determinístico por seed.
 */

import { makeRng, range, gaussian } from '../../core/rng.js';
import { roundedRect } from '../shapes.js';
import { inkHeight, inkLine, inkWords } from './ink.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Abaixo disso a marca vira borrão na prévia a 26% e não paga o que custa. */
const MIN_MARK_MM = 1.6;

/** Fio de cabelo: some na prévia se não tiver um piso em pixel de dispositivo. */
const hair = (mm, ppm) => Math.max(0.45, mm * ppm);

const INK = (a = 1) => `rgba(58,44,32,${a})`;
const ACCENT = (a = 1) => `rgba(168,58,44,${a})`;

const toneCache = new Map();

function rgbOf(hex) {
  let rgb = toneCache.get(hex);
  if (!rgb) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) rgb = [253, 250, 244];
    else {
      const s = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
      const n = parseInt(s, 16);
      rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    if (toneCache.size > 24) toneCache.clear();
    toneCache.set(hex, rgb);
  }
  return rgb;
}

/** Negativo clareia em direção ao branco, positivo escurece. */
function shade(hex, amount, alpha = 1) {
  const target = amount < 0 ? 255 : 0;
  const k = Math.abs(amount);
  const c = rgbOf(hex).map((v) => Math.round(v + (target - v) * k));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

const ringOf = (outer, inner) => {
  const p = new Path2D();
  p.addPath(outer);
  p.addPath(inner);
  return p;
};

const boxOf = (x0, y0, x1, y1, ppm) => ({
  x: x0 * ppm,
  y: y0 * ppm,
  w: (x1 - x0) * ppm,
  h: (y1 - y0) * ppm,
});

/* ------------------------------------------------------------- ingresso -- */

function ticketPaper(mm, hw, hh, cut, notch, corner, alongX) {
  const p = new Path2D();
  if (alongX) {
    p.moveTo(mm(-hw + corner), mm(-hh));
    p.lineTo(mm(cut - notch), mm(-hh));
    p.arc(mm(cut), mm(-hh), mm(notch), Math.PI, 0, true);
    p.lineTo(mm(hw - corner), mm(-hh));
    p.arcTo(mm(hw), mm(-hh), mm(hw), mm(-hh + corner), mm(corner));
    p.lineTo(mm(hw), mm(hh - corner));
    p.arcTo(mm(hw), mm(hh), mm(hw - corner), mm(hh), mm(corner));
    p.lineTo(mm(cut + notch), mm(hh));
    p.arc(mm(cut), mm(hh), mm(notch), 0, Math.PI, true);
    p.lineTo(mm(-hw + corner), mm(hh));
    p.arcTo(mm(-hw), mm(hh), mm(-hw), mm(hh - corner), mm(corner));
    p.lineTo(mm(-hw), mm(-hh + corner));
    p.arcTo(mm(-hw), mm(-hh), mm(-hw + corner), mm(-hh), mm(corner));
  } else {
    p.moveTo(mm(-hw + corner), mm(-hh));
    p.lineTo(mm(hw - corner), mm(-hh));
    p.arcTo(mm(hw), mm(-hh), mm(hw), mm(-hh + corner), mm(corner));
    p.lineTo(mm(hw), mm(cut - notch));
    p.arc(mm(hw), mm(cut), mm(notch), -Math.PI / 2, Math.PI / 2, true);
    p.lineTo(mm(hw), mm(hh - corner));
    p.arcTo(mm(hw), mm(hh), mm(hw - corner), mm(hh), mm(corner));
    p.lineTo(mm(-hw + corner), mm(hh));
    p.arcTo(mm(-hw), mm(hh), mm(-hw), mm(hh - corner), mm(corner));
    p.lineTo(mm(-hw), mm(cut + notch));
    p.arc(mm(-hw), mm(cut), mm(notch), Math.PI / 2, -Math.PI / 2, true);
    p.lineTo(mm(-hw), mm(-hh + corner));
    p.arcTo(mm(-hw), mm(-hh), mm(-hw + corner), mm(-hh), mm(corner));
  }
  p.closePath();
  return p;
}

const ingresso = {
  id: 'g-ingresso',
  label: 'Ingresso',
  build({ w, h, pxPerMm, seed }) {
    const rng = makeRng((seed ^ 0x1a7c33e9) >>> 0);
    const mm = (v) => v * pxPerMm;
    const hw = w / 2;
    const hh = h / 2;
    const minSide = Math.min(w, h);
    const alongX = w >= h;

    const stub = clamp((alongX ? w : h) * 0.24, 6, 24);
    const notch = clamp(minSide * 0.055, 0.8, 2.4);
    const corner = clamp(minSide * 0.035, 0.5, 1.8);
    const holeR = clamp(minSide * 0.013, 0.2, 0.5);
    const cut = (alongX ? hw : hh) - stub;

    const paper = ticketPaper(mm, hw, hh, cut, notch, corner, alongX);

    const perfLen = Math.max(0, (alongX ? h : w) - notch * 2.6);
    const count = Math.max(2, Math.round(perfLen / (holeR * 4.4)));
    const step = perfLen / count;
    for (let i = 0; i < count; i++) {
      const at = -perfLen / 2 + step * (i + 0.5);
      const cx = alongX ? cut : at;
      const cy = alongX ? at : cut;
      paper.moveTo(mm(cx + holeR), mm(cy));
      paper.arc(mm(cx), mm(cy), mm(holeR), 0, TAU);
    }

    const margin = clamp(minSide * 0.045, 0.7, 2.4);
    const gap = margin + notch * 0.55;
    const body = alongX
      ? { x0: -hw + margin, y0: -hh + margin, x1: cut - gap, y1: hh - margin }
      : { x0: -hw + margin, y0: -hh + margin, x1: hw - margin, y1: cut - gap };
    const stubBox = alongX
      ? { x0: cut + gap, y0: -hh + margin, x1: hw - margin, y1: hh - margin }
      : { x0: -hw + margin, y0: cut + gap, x1: hw - margin, y1: hh - margin };

    const band = Math.min(clamp(h * 0.17, 2.4, 6.5), (body.y1 - body.y0) * 0.3);
    const shot = { x0: body.x0, y0: body.y0, x1: body.x1, y1: body.y1 - band };

    // Comprimento das marcas impressas. É o que faz um ingresso não sair igual
    // ao outro, agora que não há número de série para variar.
    const mark = {
      band: range(rng, 0.46, 0.6),
      serial: range(rng, 0.2, 0.3),
      stub: range(rng, 0.58, 0.76),
    };

    return {
      paper,
      photo: roundedRect(mm(shot.x0), mm(shot.y0), mm(shot.x1 - shot.x0), mm(shot.y1 - shot.y0), 0),
      photoBox: boxOf(shot.x0, shot.y0, shot.x1, shot.y1, pxPerMm),
      rule: 'evenodd',
      decorate(ctx, info) {
        const ppm = info?.pxPerMm || pxPerMm;
        const px = (v) => v * ppm;
        ctx.save();
        ctx.clip(paper, 'evenodd');

        // Vinco do picote: uma sombra larga e fraca dos dois lados da linha.
        ctx.strokeStyle = 'rgba(60,44,30,0.07)';
        ctx.lineWidth = px(clamp(minSide * 0.02, 0.5, 1.6));
        ctx.beginPath();
        if (alongX) {
          ctx.moveTo(px(cut), px(-hh));
          ctx.lineTo(px(cut), px(hh));
        } else {
          ctx.moveTo(px(-hw), px(cut));
          ctx.lineTo(px(hw), px(cut));
        }
        ctx.stroke();

        ctx.strokeStyle = INK(0.32);
        ctx.lineWidth = hair(0.16, ppm);
        ctx.strokeRect(px(shot.x0), px(shot.y0), px(shot.x1 - shot.x0), px(shot.y1 - shot.y0));

        const bandMid = (shot.y1 + body.y1) / 2;
        const bandSize = clamp(band * 0.46, MIN_MARK_MM, 3.2);
        if (band >= bandSize * 1.25) {
          const ih = inkHeight(bandSize, ppm);
          const avail = px(shot.x1 - shot.x0);
          ctx.fillStyle = INK(0.72);
          inkWords(ctx, px(shot.x0), px(bandMid), avail * mark.band, ih, 'left', 3, seed);
          ctx.fillStyle = ACCENT(0.8);
          inkWords(ctx, px(shot.x1), px(bandMid), avail * mark.serial, ih, 'right', 2, seed ^ 0x51);
        }

        // Talão: a marca corre no sentido comprido, então gira quando é vertical.
        const acrossMm = alongX ? stubBox.x1 - stubBox.x0 : stubBox.y1 - stubBox.y0;
        const alongMm = alongX ? stubBox.y1 - stubBox.y0 : stubBox.x1 - stubBox.x0;
        if (acrossMm >= MIN_MARK_MM * 1.6) {
          ctx.save();
          ctx.translate(px((stubBox.x0 + stubBox.x1) / 2), px((stubBox.y0 + stubBox.y1) / 2));
          if (alongX) ctx.rotate(-Math.PI / 2);

          const twoLines = acrossMm >= MIN_MARK_MM * 3.2;
          const size = clamp(acrossMm * (twoLines ? 0.34 : 0.5), MIN_MARK_MM, 4.2);
          ctx.fillStyle = INK(0.88);
          inkWords(ctx, 0, twoLines ? -px(size) * 0.62 : 0, px(alongMm) * mark.stub,
            inkHeight(size, ppm), 'center', 2, seed);

          if (twoLines) {
            const small = clamp(size * 0.66, MIN_MARK_MM, 3);
            ctx.fillStyle = INK(0.5);
            inkWords(ctx, 0, px(size) * 0.8, px(alongMm) * mark.serial * 1.6,
              inkHeight(small, ppm), 'center', 2, seed ^ 0x77);
          }
          ctx.restore();
        }

        ctx.restore();
      },
    };
  },
};

/* --------------------------------------------------------------- post-it -- */

function noteShape(mm, x0, y0, x1, y1, r, curl) {
  const p = new Path2D();
  p.moveTo(mm(x0 + r), mm(y0));
  p.lineTo(mm(x1 - r), mm(y0));
  p.arcTo(mm(x1), mm(y0), mm(x1), mm(y0 + r), mm(r));
  p.lineTo(mm(x1), mm(y1 - curl));
  // Côncava: a ponta enrolou e levou a silhueta para dentro.
  p.quadraticCurveTo(mm(x1 - curl * 0.62), mm(y1 - curl * 0.62), mm(x1 - curl), mm(y1));
  p.lineTo(mm(x0 + r), mm(y1));
  p.arcTo(mm(x0), mm(y1), mm(x0), mm(y1 - r), mm(r));
  p.lineTo(mm(x0), mm(y0 + r));
  p.arcTo(mm(x0), mm(y0), mm(x0 + r), mm(y0), mm(r));
  p.closePath();
  return p;
}

const postit = {
  id: 'g-postit',
  label: 'Post-it',
  build({ w, h, pxPerMm, seed }) {
    const rng = makeRng((seed ^ 0x2f91b40d) >>> 0);
    const mm = (v) => v * pxPerMm;
    const hw = w / 2;
    const hh = h / 2;
    const minSide = Math.min(w, h);

    const curl = clamp(minSide * 0.17, 2.6, 12);
    const r = clamp(minSide * 0.012, 0.3, 1);
    const margin = clamp(minSide * 0.05, 0.8, 3);
    const glue = clamp(h * 0.15, 2, 7);

    const paper = noteShape(mm, -hw, -hh, hw, hh, r, curl);
    const shot = { x0: -hw + margin, y0: -hh + margin + glue, x1: hw - margin, y1: hh - margin };
    const photo = noteShape(mm, shot.x0, shot.y0, shot.x1, shot.y1, r * 0.5, curl);
    const ring = ringOf(paper, photo);
    const combs = Array.from({ length: 14 }, () => ({ at: rng(), a: range(rng, 0.05, 0.16) }));

    return {
      paper,
      photo,
      photoBox: boxOf(shot.x0, shot.y0, shot.x1, shot.y1, pxPerMm),
      decorate(ctx, info) {
        const ppm = info?.pxPerMm || pxPerMm;
        const tone = info?.tone || '#fdfaf4';
        const px = (v) => v * ppm;

        ctx.save();
        ctx.clip(ring, 'evenodd');
        // Só uma insinuação de amarelo: a paleta escolhida pelo usuário manda.
        ctx.fillStyle = 'rgba(242,201,76,0.16)';
        ctx.fillRect(px(-hw), px(-hh), px(w), px(h));
        ctx.restore();

        ctx.save();
        ctx.clip(paper);

        const glueTop = -hh + margin * 0.25;
        const glueBot = -hh + margin + glue * 0.82;
        const g = ctx.createLinearGradient(0, px(glueTop), 0, px(glueBot));
        g.addColorStop(0, shade(tone, 0.1, 0.42));
        g.addColorStop(0.72, shade(tone, 0.06, 0.28));
        g.addColorStop(1, shade(tone, 0.04, 0));
        ctx.fillStyle = g;
        ctx.fillRect(px(-hw), px(glueTop), px(w), px(glueBot - glueTop));

        // Marcas de pente da cola: listras verticais no adesivo.
        ctx.lineWidth = hair(0.22, ppm);
        for (const c of combs) {
          ctx.strokeStyle = shade(tone, 0.22, c.a);
          const x = px(-hw + w * c.at);
          ctx.beginPath();
          ctx.moveTo(x, px(glueTop));
          ctx.lineTo(x, px(glueBot - glue * 0.18));
          ctx.stroke();
        }

        ctx.strokeStyle = shade(tone, 0.24, 0.3);
        ctx.lineWidth = hair(0.16, ppm);
        ctx.beginPath();
        ctx.moveTo(px(-hw), px(glueBot));
        ctx.lineTo(px(hw), px(glueBot));
        ctx.stroke();

        // A sombra que a ponta enrolada joga de volta na folha.
        const flapShadow = new Path2D();
        flapShadow.moveTo(px(hw), px(hh - curl));
        flapShadow.quadraticCurveTo(px(hw - curl * 0.62), px(hh - curl * 0.62), px(hw - curl), px(hh));
        flapShadow.quadraticCurveTo(px(hw - curl * 0.2), px(hh - curl * 0.2), px(hw), px(hh - curl));
        ctx.save();
        ctx.shadowColor = 'rgba(46,32,20,0.42)';
        ctx.shadowBlur = px(curl * 0.22);
        ctx.shadowOffsetX = -px(curl * 0.1);
        ctx.shadowOffsetY = -px(curl * 0.1);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fill(flapShadow);
        ctx.restore();
        ctx.restore();

        // A aba em si fica fora da silhueta recortada, por isso sem clip.
        const flap = new Path2D();
        flap.moveTo(px(hw), px(hh - curl));
        flap.quadraticCurveTo(px(hw - curl * 0.62), px(hh - curl * 0.62), px(hw - curl), px(hh));
        flap.quadraticCurveTo(px(hw - curl * 0.16), px(hh - curl * 0.16), px(hw), px(hh - curl));
        const fg = ctx.createLinearGradient(
          px(hw - curl * 0.62), px(hh - curl * 0.62), px(hw), px(hh)
        );
        fg.addColorStop(0, shade(tone, -0.16, 1));
        fg.addColorStop(0.55, shade(tone, 0.08, 1));
        fg.addColorStop(1, shade(tone, 0.34, 1));
        ctx.save();
        ctx.fillStyle = fg;
        ctx.fill(flap);
        ctx.strokeStyle = shade(tone, 0.32, 0.35);
        ctx.lineWidth = hair(0.14, ppm);
        ctx.stroke(flap);
        ctx.restore();
      },
    };
  },
};

/* --------------------------------------------------------------- adesivo -- */

/** Superelipse: o formato de faca de corte de um adesivo, com leve assimetria. */
function stickerPath(mm, a, b, exp, wob, phase) {
  const p = new Path2D();
  const steps = 128;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * TAU;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const k = 2 / exp;
    const wobble = 1 + Math.sin(t * 3 + phase) * wob;
    const x = mm(a * Math.sign(c) * Math.abs(c) ** k * wobble);
    const y = mm(b * Math.sign(s) * Math.abs(s) ** k * wobble);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

const adesivo = {
  id: 'g-adesivo',
  label: 'Adesivo',
  build({ w, h, pxPerMm, seed }) {
    const rng = makeRng((seed ^ 0x3b0c9e57) >>> 0);
    const mm = (v) => v * pxPerMm;
    const hw = w / 2;
    const hh = h / 2;
    const minSide = Math.min(w, h);

    const exp = range(rng, 3.6, 4.8);
    const wob = range(rng, 0.006, 0.016);
    const phase = rng() * TAU;
    const border = clamp(minSide * 0.055, 1.4, 5);

    const paper = stickerPath(mm, hw, hh, exp, wob, phase);
    const ia = hw - border;
    const ib = hh - border;
    const photo = stickerPath(mm, ia, ib, exp, wob, phase);

    return {
      paper,
      photo,
      photoBox: boxOf(-ia, -ib, ia, ib, pxPerMm),
      decorate(ctx, info) {
        const ppm = info?.pxPerMm || pxPerMm;
        const px = (v) => v * ppm;

        // O contorno branco grosso é a assinatura do die-cut: metade do traço
        // cai fora do clip e é descartada, então ele encosta exato na faca.
        ctx.save();
        ctx.clip(paper);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = px(border) * 2;
        ctx.lineJoin = 'round';
        ctx.stroke(paper);

        const gloss = ctx.createLinearGradient(px(-hw), px(-hh), px(hw), px(hh));
        gloss.addColorStop(0, 'rgba(255,255,255,0)');
        gloss.addColorStop(0.3, 'rgba(255,255,255,0.03)');
        gloss.addColorStop(0.42, 'rgba(255,255,255,0.2)');
        gloss.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        gloss.addColorStop(0.58, 'rgba(255,255,255,0.14)');
        gloss.addColorStop(0.72, 'rgba(255,255,255,0)');
        ctx.fillStyle = gloss;
        ctx.fillRect(px(-hw), px(-hh), px(w), px(h));

        const spot = ctx.createRadialGradient(
          px(-hw * 0.42), px(-hh * 0.5), 0,
          px(-hw * 0.42), px(-hh * 0.5), px(minSide * 0.62)
        );
        spot.addColorStop(0, 'rgba(255,255,255,0.22)');
        spot.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = spot;
        ctx.fillRect(px(-hw), px(-hh), px(w), px(h));

        ctx.strokeStyle = 'rgba(70,54,38,0.16)';
        ctx.lineWidth = hair(0.14, ppm);
        ctx.stroke(paper);
        ctx.restore();

        // Vinil tem espessura: sombra por dentro da borda da imagem.
        ctx.save();
        ctx.clip(photo);
        ctx.strokeStyle = 'rgba(38,28,18,0.2)';
        ctx.lineWidth = px(clamp(minSide * 0.012, 0.25, 1)) * 2;
        ctx.stroke(photo);
        ctx.restore();
      },
    };
  },
};

/* --------------------------------------------------------------- revista -- */

function pathFromMm(pts, mm) {
  const p = new Path2D();
  pts.forEach(([x, y], i) => {
    if (i === 0) p.moveTo(mm(x), mm(y));
    else p.lineTo(mm(x), mm(y));
  });
  p.closePath();
  return p;
}

const revista = {
  id: 'g-revista',
  label: 'Revista',
  build({ w, h, pxPerMm, seed }) {
    const rng = makeRng((seed ^ 0x4d2e81b3) >>> 0);
    const mm = (v) => v * pxPerMm;
    const hw = w / 2;
    const hh = h / 2;
    const minSide = Math.min(w, h);

    // Tesoura: segmentos retos e longos, com uma virada de ângulo a cada golpe.
    const snip = clamp(minSide * 0.16, 3, 8);
    const jitter = clamp(minSide * 0.012, 0.14, 0.55);
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const pts = [];
    for (let s = 0; s < 4; s++) {
      const a = corners[s];
      const b = corners[(s + 1) % 4];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const nx = dy / len;
      const ny = -dx / len;
      const n = Math.max(2, Math.round(len / snip));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const off = gaussian(rng) * jitter;
        pts.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
        // Uma tesourada que passou do ponto deixa um bico para dentro.
        if (i > 0 && rng() < 0.12) {
          const tn = (i + 0.4) / n;
          pts.push([a[0] + dx * tn - nx * jitter * 2.4, a[1] + dy * tn - ny * jitter * 2.4]);
        }
      }
    }
    const paper = pathFromMm(pts, mm);

    // Uma tira da coluna vizinha que a tesoura não conseguiu eliminar.
    const stripSide = Math.floor(rng() * 2);
    const strip = clamp(minSide * 0.09, 1.8, 5.5);
    const rowPitch = clamp(strip * 0.2, 0.7, 1.5);
    const rows = [];
    for (let y = -hh + rowPitch; y < hh - rowPitch * 0.5; y += rowPitch) {
      rows.push({ y, fill: range(rng, 0.55, 1), lead: rng() < 0.1 });
    }

    const glue = {
      x: range(rng, -hw * 0.72, hw * 0.72),
      y: range(rng, -hh * 0.72, hh * 0.72),
      r: clamp(minSide * range(rng, 0.06, 0.11), 1.2, 6),
      amp: [range(rng, 0.1, 0.24), range(rng, 0.06, 0.16)],
      phase: [rng() * TAU, rng() * TAU],
    };

    return {
      paper,
      photo: paper,
      photoBox: boxOf(-hw, -hh, hw, hh, pxPerMm),
      decorate(ctx, info) {
        const ppm = info?.pxPerMm || pxPerMm;
        const tone = info?.tone || '#fdfaf4';
        const px = (v) => v * ppm;

        ctx.save();
        ctx.clip(paper);

        const x0 = stripSide ? hw - strip : -hw;
        ctx.fillStyle = shade(tone, -0.05, 0.97);
        ctx.fillRect(px(x0), px(-hh), px(strip), px(h));

        const pad = strip * 0.14;
        const barH = Math.max(0.4, rowPitch * 0.3 * ppm);
        for (const row of rows) {
          ctx.fillStyle = row.lead ? 'rgba(48,38,28,0.55)' : 'rgba(72,60,46,0.32)';
          const bw = (strip - pad * 2) * (row.lead ? 0.72 : row.fill);
          ctx.fillRect(px(x0 + pad), px(row.y), px(bw), row.lead ? barH * 1.9 : barH);
        }

        ctx.strokeStyle = 'rgba(60,46,32,0.2)';
        ctx.lineWidth = hair(0.14, ppm);
        ctx.beginPath();
        ctx.moveTo(px(stripSide ? x0 : x0 + strip), px(-hh));
        ctx.lineTo(px(stripSide ? x0 : x0 + strip), px(hh));
        ctx.stroke();

        // Respingo de cola: brilha, engelha e escurece na borda ao secar.
        const blob = new Path2D();
        const steps = 48;
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * TAU;
          const rr = glue.r * (1
            + Math.sin(t * 2 + glue.phase[0]) * glue.amp[0]
            + Math.sin(t * 5 + glue.phase[1]) * glue.amp[1]);
          const x = px(glue.x + Math.cos(t) * rr);
          const y = px(glue.y + Math.sin(t) * rr * 0.82);
          if (i === 0) blob.moveTo(x, y);
          else blob.lineTo(x, y);
        }
        blob.closePath();
        const gg = ctx.createRadialGradient(
          px(glue.x - glue.r * 0.3), px(glue.y - glue.r * 0.3), 0,
          px(glue.x), px(glue.y), px(glue.r * 1.2)
        );
        gg.addColorStop(0, 'rgba(255,255,250,0.3)');
        gg.addColorStop(0.7, 'rgba(246,238,222,0.14)');
        gg.addColorStop(1, 'rgba(150,128,96,0.2)');
        ctx.fillStyle = gg;
        ctx.fill(blob);
        ctx.strokeStyle = 'rgba(132,110,80,0.28)';
        ctx.lineWidth = hair(0.16, ppm);
        ctx.stroke(blob);
        ctx.beginPath();
        ctx.arc(px(glue.x - glue.r * 0.32), px(glue.y - glue.r * 0.3), px(glue.r * 0.2), 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.fill();

        // O miolo branco do papel exposto pelo corte.
        ctx.strokeStyle = 'rgba(255,255,252,0.5)';
        ctx.lineWidth = px(clamp(minSide * 0.006, 0.14, 0.5)) * 2;
        ctx.lineJoin = 'round';
        ctx.stroke(paper);
        ctx.restore();
      },
    };
  },
};

/* -------------------------------------------------------------- negativo -- */

const negativo = {
  id: 'g-negativo',
  label: 'Negativo',
  build({ w, h, pxPerMm, seed }) {
    const rng = makeRng((seed ^ 0x5e73a2c1) >>> 0);
    const mm = (v) => v * pxPerMm;
    const hw = w / 2;
    const hh = h / 2;
    const minSide = Math.min(w, h);
    const alongX = w >= h;

    // Proporções do 35 mm real: tarja de 5,5 mm, furo de 2,8 × 2,0, passo 4,75.
    const band = clamp(minSide * 0.15, 2.8, 11);
    const holeAcross = band * 0.36;
    const holeAlong = band * 0.51;
    const holeMid = band * 0.38;
    const endGap = band * 0.35;

    const paper = new Path2D();
    paper.rect(mm(-hw), mm(-hh), mm(w), mm(h));

    const span = alongX ? w : h;
    const count = Math.max(2, Math.floor(span / (band * 0.86)));
    const step = span / count;
    for (let i = 0; i < count; i++) {
      const at = -span / 2 + step * (i + 0.5);
      for (const side of [-1, 1]) {
        const cx = alongX ? at : side * (hw - holeMid);
        const cy = alongX ? side * (hh - holeMid) : at;
        const rw = alongX ? holeAlong : holeAcross;
        const rh = alongX ? holeAcross : holeAlong;
        paper.addPath(roundedRect(
          mm(cx - rw / 2), mm(cy - rh / 2), mm(rw), mm(rh), mm(Math.min(rw, rh) * 0.28)
        ));
      }
    }

    const shot = alongX
      ? { x0: -hw + endGap, y0: -hh + band, x1: hw - endGap, y1: hh - band }
      : { x0: -hw + band, y0: -hh + endGap, x1: hw - band, y1: hh - endGap };
    const photo = roundedRect(mm(shot.x0), mm(shot.y0), mm(shot.x1 - shot.x0), mm(shot.y1 - shot.y0), 0);
    const ring = ringOf(paper, photo);

    // Numeração de fotograma: alterna uma marca comprida e uma curta, no ritmo
    // do "12" seguido de "12A" que o filme traz. Onde começa varia com a seed.
    const phase = Math.floor(rng() * 2);
    const marks = [];
    for (let i = 0; i < count; i += 2) {
      marks.push({
        at: -span / 2 + step * (i + 1),
        wide: (i / 2 + phase) % 2 === 1,
      });
    }

    return {
      paper,
      photo,
      photoBox: boxOf(shot.x0, shot.y0, shot.x1, shot.y1, pxPerMm),
      rule: 'evenodd',
      decorate(ctx, info) {
        const ppm = info?.pxPerMm || pxPerMm;
        const px = (v) => v * ppm;

        ctx.save();
        // O clip com evenodd preserva os furos: eles não recebem base nenhuma.
        ctx.clip(paper, 'evenodd');
        const base = ctx.createLinearGradient(px(-hw), px(-hh), px(hw), px(hh));
        base.addColorStop(0, '#2a1a12');
        base.addColorStop(0.5, '#3a2418');
        base.addColorStop(1, '#241610');
        ctx.fillStyle = base;
        ctx.fill(ring, 'evenodd');

        // Véu de máscara alaranjada, o que denuncia um negativo escaneado.
        ctx.fillStyle = 'rgba(214,112,44,0.09)';
        ctx.fillRect(px(shot.x0), px(shot.y0), px(shot.x1 - shot.x0), px(shot.y1 - shot.y0));
        ctx.strokeStyle = 'rgba(18,10,6,0.75)';
        ctx.lineWidth = hair(0.2, ppm);
        ctx.strokeRect(px(shot.x0), px(shot.y0), px(shot.x1 - shot.x0), px(shot.y1 - shot.y0));

        // Impressão de borda na faixa entre os furos e o fotograma.
        const laneMid = band * 0.79;
        const size = clamp(band * 0.3, 0, 2.6);
        if (size >= MIN_MARK_MM) {
          const ih = inkHeight(size, ppm);
          ctx.fillStyle = 'rgba(255,196,124,0.72)';
          ctx.save();
          // A pista corre no sentido comprido do filme: gira quando é vertical.
          if (!alongX) ctx.rotate(Math.PI / 2);
          const across = (alongX ? hh : hw) - laneMid;
          for (const m of marks) {
            const x = px(m.at);
            inkLine(ctx, x, px(-across), px(size * (m.wide ? 1.9 : 1.3)), ih, 'center');
            ctx.beginPath();
            ctx.arc(x, px(across), px(size * 0.2), 0, TAU);
            ctx.fill();
          }
          ctx.restore();
        }
        ctx.restore();
      },
    };
  },
};

/* -------------------------------------------------------------- amassado -- */

/** Trecho da reta que fica dentro do retângulo, pelo método das faixas. */
function lineInRect(px0, py0, dx, dy, hw, hh) {
  let t0 = -Infinity;
  let t1 = Infinity;
  const slabs = [[dx, -hw - px0, hw - px0], [dy, -hh - py0, hh - py0]];
  for (const [d, lo, hi] of slabs) {
    if (Math.abs(d) < 1e-6) {
      if (lo > 0 || hi < 0) return null;
      continue;
    }
    let a = lo / d;
    let b = hi / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  return t1 > t0 ? [t0, t1] : null;
}

const amassado = {
  id: 'g-amassado',
  label: 'Amassado',
  build({ w, h, pxPerMm, seed }) {
    const rng = makeRng((seed ^ 0x6a15cd77) >>> 0);
    const mm = (v) => v * pxPerMm;
    const hw = w / 2;
    const hh = h / 2;
    const diag = Math.hypot(w, h);

    // A folha nunca volta a ser reta: a borda ondula de leve.
    const wave = clamp(Math.min(w, h) * 0.008, 0.1, 0.6);
    const ph = [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU];
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const pts = [];
    for (let s = 0; s < 4; s++) {
      const a = corners[s];
      const b = corners[(s + 1) % 4];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const nx = dy / len;
      const ny = -dx / len;
      const n = Math.max(6, Math.round(len / 2.5));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const off = (Math.sin(t * 7 + ph[s]) * 0.6 + Math.sin(t * 13 + ph[(s + 1) % 4]) * 0.4) * wave;
        pts.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
      }
    }
    const paper = pathFromMm(pts, mm);

    const creases = [];
    const major = 7 + Math.floor(rng() * 4);
    for (let i = 0; i < major; i++) {
      const ang = rng() * Math.PI;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const cx = range(rng, -hw * 0.85, hw * 0.85);
      const cy = range(rng, -hh * 0.85, hh * 0.85);
      const t = lineInRect(cx, cy, dx, dy, hw, hh);
      if (!t) continue;
      creases.push({
        x0: cx + dx * t[0], y0: cy + dy * t[0],
        x1: cx + dx * t[1], y1: cy + dy * t[1],
        nx: -dy, ny: dx, strength: range(rng, 0.6, 1),
      });
    }
    const minor = 12 + Math.floor(rng() * 8);
    for (let i = 0; i < minor; i++) {
      const ang = rng() * Math.PI;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const cx = range(rng, -hw, hw);
      const cy = range(rng, -hh, hh);
      const half = diag * range(rng, 0.04, 0.14);
      creases.push({
        x0: cx - dx * half, y0: cy - dy * half,
        x1: cx + dx * half, y1: cy + dy * half,
        nx: -dy, ny: dx, strength: range(rng, 0.22, 0.5),
      });
    }

    const facets = Array.from({ length: 8 }, () => ({
      x: range(rng, -hw, hw),
      y: range(rng, -hh, hh),
      r: diag * range(rng, 0.16, 0.36),
      up: rng() < 0.5,
    }));

    return {
      paper,
      photo: paper,
      photoBox: boxOf(-hw, -hh, hw, hh, pxPerMm),
      decorate(ctx, info) {
        const ppm = info?.pxPerMm || pxPerMm;
        const px = (v) => v * ppm;

        ctx.save();
        ctx.clip(paper);
        ctx.lineCap = 'round';

        for (const f of facets) {
          const g = ctx.createRadialGradient(px(f.x), px(f.y), 0, px(f.x), px(f.y), px(f.r));
          g.addColorStop(0, f.up ? 'rgba(255,255,255,0.14)' : 'rgba(52,38,24,0.13)');
          g.addColorStop(1, f.up ? 'rgba(255,255,255,0)' : 'rgba(52,38,24,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px(-hw), px(-hh), px(w), px(h));
        }

        // Cada vinco é um par de linhas: a face iluminada e a que ficou na sombra.
        const off = clamp(Math.min(w, h) * 0.004, 0.08, 0.3);
        for (const c of creases) {
          const passes = [
            { d: -off, color: `rgba(255,255,255,${0.34 * c.strength})`, wMm: 0.14 },
            { d: off, color: `rgba(62,46,30,${0.2 * c.strength})`, wMm: 0.14 },
            { d: 0, color: `rgba(62,46,30,${0.05 * c.strength})`, wMm: 0.75 },
          ];
          for (const p of passes) {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = hair(p.wMm, ppm);
            ctx.beginPath();
            ctx.moveTo(px(c.x0 + c.nx * p.d), px(c.y0 + c.ny * p.d));
            ctx.lineTo(px(c.x1 + c.nx * p.d), px(c.y1 + c.ny * p.d));
            ctx.stroke();
          }
        }
        ctx.restore();
      },
    };
  },
};

/* ----------------------------------------------------------------- ficha -- */

const ficha = {
  id: 'g-ficha',
  label: 'Ficha de biblioteca',
  build({ w, h, pxPerMm, seed }) {
    const rng = makeRng((seed ^ 0x7c40b915) >>> 0);
    const mm = (v) => v * pxPerMm;
    const hw = w / 2;
    const hh = h / 2;
    const minSide = Math.min(w, h);

    const r = clamp(minSide * 0.02, 0.4, 1.4);
    const margin = clamp(minSide * 0.05, 0.8, 2.8);
    const ledger = Math.min(clamp(h * 0.34, 7, 34), h * 0.44);
    const paper = roundedRect(mm(-hw), mm(-hh), mm(w), mm(h), mm(r));

    const shot = { x0: -hw + margin, y0: -hh + margin, x1: hw - margin, y1: hh - ledger };
    const top = shot.y1 + margin * 0.9;
    const bottom = hh - margin;
    const rowH = clamp(ledger * 0.2, 2.2, 6);
    const rowCount = Math.max(1, Math.floor((bottom - top - rowH) / rowH));

    const stamps = [];
    const stampCount = Math.min(rowCount, 2 + Math.floor(rng() * 3));
    for (let i = 0; i < stampCount; i++) {
      stamps.push({
        // Datas têm comprimentos parecidos, mas não idênticos.
        wide: range(rng, 0.74, 0.92),
        tilt: range(rng, -0.05, 0.05),
        ink: range(rng, 0.5, 0.86),
        dx: range(rng, -0.4, 0.6),
      });
    }

    return {
      paper,
      photo: roundedRect(mm(shot.x0), mm(shot.y0), mm(shot.x1 - shot.x0), mm(shot.y1 - shot.y0), 0),
      photoBox: boxOf(shot.x0, shot.y0, shot.x1, shot.y1, pxPerMm),
      decorate(ctx, info) {
        const ppm = info?.pxPerMm || pxPerMm;
        const px = (v) => v * ppm;

        ctx.save();
        ctx.clip(paper);

        ctx.strokeStyle = INK(0.3);
        ctx.lineWidth = hair(0.14, ppm);
        ctx.strokeRect(px(shot.x0), px(shot.y0), px(shot.x1 - shot.x0), px(shot.y1 - shot.y0));

        ctx.strokeStyle = ACCENT(0.6);
        ctx.lineWidth = hair(0.35, ppm);
        ctx.beginPath();
        ctx.moveTo(px(shot.x0), px(top));
        ctx.lineTo(px(shot.x1), px(top));
        ctx.stroke();

        const head = clamp(rowH * 0.44, 0, 2.4);
        const colX = shot.x0 + (shot.x1 - shot.x0) * 0.6;
        let y = top + rowH * 0.9;

        // Os dois rótulos do cabeçalho: é o par deles que faz a grade virar
        // formulário em vez de papel pautado.
        if (head >= MIN_MARK_MM) {
          const ih = inkHeight(head, ppm);
          // `top + head * 1.5` é a pauta: a marca sobe meia altura para assentar
          // sobre ela em vez de ficar cortada ao meio.
          const midY = px(top + head * 1.5) - ih / 2;
          const leftW = Math.max(0, colX - shot.x0 - rowH * 0.4);
          const rightW = Math.max(0, shot.x1 - colX - rowH * 0.4);
          ctx.fillStyle = INK(0.6);
          inkWords(ctx, px(shot.x0 + rowH * 0.2), midY, px(leftW * 0.62), ih, 'left', 2, 0x1d0f);
          inkWords(ctx, px(colX + rowH * 0.2), midY, px(rightW * 0.5), ih, 'left', 1, 0x2e11);
          y = top + head * 1.5 + rowH * 0.55;
        }

        ctx.strokeStyle = INK(0.22);
        ctx.lineWidth = hair(0.12, ppm);
        for (let i = 0; i < rowCount && y < bottom; i++, y += rowH) {
          ctx.beginPath();
          ctx.moveTo(px(shot.x0), px(y));
          ctx.lineTo(px(shot.x1), px(y));
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(px(colX), px(top));
        ctx.lineTo(px(colX), px(Math.min(y, bottom)));
        ctx.stroke();

        // Carimbos: tinta roxa, torto, mais fraco a cada devolução.
        const size = clamp(rowH * 0.5, 0, 3);
        if (size >= MIN_MARK_MM) {
          const ih = inkHeight(size, ppm);
          // O carimbo cai na coluna da esquerda e não pode cruzar o fio do meio.
          const span = Math.max(0, colX - shot.x0 - rowH * 0.6);
          let sy = (head >= MIN_MARK_MM ? top + head * 1.5 + rowH * 0.55 : top + rowH * 0.9) - rowH * 0.3;
          for (const s of stamps) {
            if (sy > bottom) break;
            ctx.save();
            ctx.translate(px(shot.x0 + rowH * 0.3 + s.dx), px(sy));
            ctx.rotate(s.tilt);
            ctx.fillStyle = `rgba(86,62,132,${s.ink})`;
            // Três blocos: o dia, o mês e o ano de um datador de borracha.
            inkWords(ctx, 0, -ih / 2, px(span * s.wide), ih, 'left', 3, 0x4a37);
            ctx.restore();
            sy += rowH;
          }
        }
        ctx.restore();
      },
    };
  },
};

/* --------------------------------------------------------------- cortiça -- */

const PIN_COLORS = [
  ['#e0453a', '#8d1f18'],
  ['#2f8f86', '#16514b'],
  ['#e5a327', '#96620e'],
  ['#3a5aa8', '#1d2f61'],
];

const cortica = {
  id: 'g-cortica',
  label: 'Cortiça',
  build({ w, h, pxPerMm, seed }) {
    const rng = makeRng((seed ^ 0x8d61f0a3) >>> 0);
    const mm = (v) => v * pxPerMm;
    const hw = w / 2;
    const hh = h / 2;
    const minSide = Math.min(w, h);

    const border = clamp(minSide * 0.085, 2.6, 10);
    const paper = roundedRect(mm(-hw), mm(-hh), mm(w), mm(h), mm(clamp(minSide * 0.015, 0.4, 1.6)));
    const shot = { x0: -hw + border, y0: -hh + border, x1: hw - border, y1: hh - border };
    const photo = roundedRect(mm(shot.x0), mm(shot.y0), mm(shot.x1 - shot.x0), mm(shot.y1 - shot.y0), 0);
    const ring = ringOf(paper, photo);

    // Grânulos só na moldura: sorteia no retângulo todo e descarta o que cai na foto.
    const grain = clamp(minSide * 0.014, 0.28, 0.9);
    const grains = [];
    const target = Math.min(340, Math.round((w * h - (shot.x1 - shot.x0) * (shot.y1 - shot.y0)) / (grain * grain * 5)));
    for (let i = 0, guard = 0; i < target && guard < target * 8; guard++) {
      const x = range(rng, -hw, hw);
      const y = range(rng, -hh, hh);
      if (x > shot.x0 - grain && x < shot.x1 + grain && y > shot.y0 - grain && y < shot.y1 + grain) continue;
      grains.push({
        x, y,
        rx: grain * range(rng, 0.5, 1.5),
        ry: grain * range(rng, 0.4, 1.1),
        rot: rng() * Math.PI,
        dark: range(rng, -0.24, 0.3),
        a: range(rng, 0.2, 0.6),
      });
      i++;
    }

    const pinR = clamp(minSide * 0.045, 1.1, 3.4);
    const pin = { x: range(rng, -hw * 0.3, hw * 0.3), y: shot.y0 + pinR * 1.15, r: pinR };
    const pinColor = PIN_COLORS[Math.floor(rng() * PIN_COLORS.length) % PIN_COLORS.length];

    return {
      paper,
      photo,
      photoBox: boxOf(shot.x0, shot.y0, shot.x1, shot.y1, pxPerMm),
      decorate(ctx, info) {
        const ppm = info?.pxPerMm || pxPerMm;
        const px = (v) => v * ppm;

        ctx.save();
        ctx.clip(ring, 'evenodd');
        const base = ctx.createLinearGradient(0, px(-hh), 0, px(hh));
        base.addColorStop(0, '#d3ad78');
        base.addColorStop(0.55, '#c49c66');
        base.addColorStop(1, '#b78d59');
        ctx.fillStyle = base;
        ctx.fillRect(px(-hw), px(-hh), px(w), px(h));

        for (const g of grains) {
          ctx.fillStyle = g.dark < 0
            ? `rgba(255,238,208,${g.a})`
            : `rgba(122,84,44,${g.a})`;
          ctx.beginPath();
          ctx.ellipse(px(g.x), px(g.y), px(g.rx), px(g.ry), g.rot, 0, TAU);
          ctx.fill();
        }

        // A foto está por cima da cortiça, então joga sombra nela.
        ctx.shadowColor = 'rgba(56,36,16,0.5)';
        ctx.shadowBlur = px(border * 0.3);
        ctx.shadowOffsetY = px(border * 0.1);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fill(photo);
        ctx.restore();

        const soft = ctx.createRadialGradient(px(pin.x), px(pin.y), 0, px(pin.x), px(pin.y), px(pin.r * 2.4));
        soft.addColorStop(0, 'rgba(40,26,12,0.34)');
        soft.addColorStop(1, 'rgba(40,26,12,0)');
        ctx.save();
        ctx.fillStyle = soft;
        ctx.beginPath();
        ctx.arc(px(pin.x + pin.r * 0.25), px(pin.y + pin.r * 0.45), px(pin.r * 2.4), 0, TAU);
        ctx.fill();

        const dome = ctx.createRadialGradient(
          px(pin.x - pin.r * 0.34), px(pin.y - pin.r * 0.4), px(pin.r * 0.1),
          px(pin.x), px(pin.y), px(pin.r)
        );
        dome.addColorStop(0, pinColor[0]);
        dome.addColorStop(0.72, pinColor[0]);
        dome.addColorStop(1, pinColor[1]);
        ctx.fillStyle = dome;
        ctx.beginPath();
        ctx.arc(px(pin.x), px(pin.y), px(pin.r), 0, TAU);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.68)';
        ctx.beginPath();
        ctx.ellipse(
          px(pin.x - pin.r * 0.34), px(pin.y - pin.r * 0.36),
          px(pin.r * 0.26), px(pin.r * 0.18), -0.7, 0, TAU
        );
        ctx.fill();
        ctx.restore();
      },
    };
  },
};

export const GENERAL = {
  id: 'geral',
  label: 'Geral',
  styles: [ingresso, postit, adesivo, revista, negativo, amassado, ficha, cortica],
};
