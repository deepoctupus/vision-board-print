import { makeRng, range, gaussian } from '../../core/rng.js';
import { roundedRect } from '../shapes.js';

/**
 * Conquista — carreira, dinheiro, estudo e metas materiais.
 *
 * A foto não ganha uma moldura: ela é impressa no objeto que representa a meta.
 * O carro dos sonhos vira a estampa de uma cédula, a formatura vira o certificado
 * com selo em relevo, o cargo vira o crachá da empresa.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const SANS = '"Inter", system-ui, sans-serif';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = 'ui-monospace, monospace';

// Abaixo disso o texto é só uma mancha na prévia a 26% e não paga o que custa.
const MIN_TEXT_MM = 1.6;

/** Um traço de 0.06 mm existe na gráfica e some da tela; o piso o mantém visível. */
const hair = (mm, pxPerMm, floor = 0.35) => Math.max(floor, mm * pxPerMm);

const oneOf = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

/* ------------------------------------------------------------------ tinta -- */

const rgbCache = new Map();

function rgbOf(hex) {
  let v = rgbCache.get(hex);
  if (v) return v;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) v = [253, 250, 244];
  else {
    const s = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const n = parseInt(s, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (rgbCache.size > 32) rgbCache.clear();
  rgbCache.set(hex, v);
  return v;
}

/** Negativo clareia até o branco, positivo escurece até o preto. */
function shade(hex, amount, alpha = 1) {
  const target = amount < 0 ? 255 : 0;
  const k = Math.abs(amount);
  const c = rgbOf(hex).map((v) => Math.round(v + (target - v) * k));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/* ------------------------------------------------------------------ texto -- */

/**
 * Texto com entreletra, medido glifo a glifo: `ctx.letterSpacing` ainda falta em
 * navegadores que a gráfica pode estar usando. `track` é fração do corpo.
 * Devolve a largura ocupada em px, ou 0 quando o corpo ficou pequeno demais.
 */
function label(ctx, str, o) {
  const px = o.pxPerMm;
  let size = o.mm;
  if (!(size >= MIN_TEXT_MM)) return 0;

  const family = o.family || SANS;
  const weight = o.weight ?? 600;
  const track = o.track || 0;
  const chars = String(str).split('');

  const measure = (mm) => {
    ctx.font = `${weight} ${mm * px}px ${family}`;
    const ws = chars.map((c) => ctx.measureText(c).width);
    const sum = ws.reduce((a, b) => a + b, 0);
    return { ws, total: sum + track * mm * px * Math.max(0, chars.length - 1) };
  };

  ctx.save();
  let m = measure(size);
  if (o.maxMm && m.total > o.maxMm * px) {
    size *= (o.maxMm * px) / m.total;
    if (!(size >= MIN_TEXT_MM)) {
      ctx.restore();
      return 0;
    }
    m = measure(size);
  }

  const body = size * px;
  const align = o.align || 'center';
  let x = align === 'center' ? o.x - m.total / 2 : align === 'right' ? o.x - m.total : o.x;

  if (o.plate) {
    const padX = body * 0.4;
    const padY = body * 0.36;
    ctx.fillStyle = o.plate;
    ctx.fill(roundedRect(x - padX, o.y - body * 0.62 - padY, m.total + padX * 2, body * 1.24 + padY * 2, body * 0.22));
  }

  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.fillStyle = o.color || '#1c1a17';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, o.y);
    x += m.ws[i] + track * body;
  }
  ctx.restore();
  return m.total;
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function serialCode(rng, letters, digits) {
  let out = '';
  for (let i = 0; i < letters; i++) out += ALPHA[Math.floor(rng() * ALPHA.length) % ALPHA.length];
  if (letters) out += ' ';
  for (let i = 0; i < digits; i++) out += Math.floor(rng() * 10);
  return out;
}

/* --------------------------------------------------------------- gravuras -- */

/** Ponto no perímetro do retângulo (hw,hh) encolhido por `inset`, com s em [0,1). */
function ringPoint(hw, hh, inset, s) {
  const x = Math.max(0.01, hw - inset);
  const y = Math.max(0.01, hh - inset);
  let d = (s - Math.floor(s)) * (4 * (x + y));
  if (d < 2 * x) return [-x + d, -y];
  d -= 2 * x;
  if (d < 2 * y) return [x, -y + d];
  d -= 2 * y;
  if (d < 2 * x) return [x - d, y];
  d -= 2 * x;
  return [-x, y - d];
}

/**
 * Guilhochê. Cada linha percorre o perímetro deslocada para dentro por uma soma
 * de dois senos; empilhando as linhas com fases progressivas as curvas se cruzam
 * e nasce a interferência que a gente lê como gravura de cédula. Os cantos do
 * retângulo dobram a fase — é por isso que toda cédula real tem uma roseta em
 * cima do canto, escondendo exatamente essa emenda.
 */
function guilloche(ctx, o) {
  const steps = 240;
  const span = o.to - o.from;
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.globalAlpha = o.alpha ?? 0.55;
  ctx.lineWidth = hair(0.05, o.pxPerMm, 0.4);
  for (let j = 0; j < o.lines; j++) {
    const t = o.lines === 1 ? 0.5 : j / (o.lines - 1);
    const base = o.from + span * t;
    const amp = span * 0.3;
    const ph = (o.phase || 0) + j * 0.44;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const wave =
        Math.sin(s * TAU * o.freqA + ph) * 0.62 + Math.sin(s * TAU * o.freqB - ph * 1.7) * 0.38;
      const pt = ringPoint(o.hw, o.hh, base + amp * wave, s);
      if (i === 0) ctx.moveTo(pt[0], pt[1]);
      else ctx.lineTo(pt[0], pt[1]);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

/** Roseta concêntrica: anéis com raio modulado por pétalas, defasados entre si. */
function rosette(ctx, cx, cy, radius, o) {
  const rings = o.rings ?? 4;
  const petals = o.petals ?? 9;
  const depth = o.depth ?? 0.18;
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.globalAlpha = o.alpha ?? 0.5;
  ctx.lineWidth = hair(0.045, o.pxPerMm, 0.4);
  for (let r = 0; r < rings; r++) {
    const rr = radius * (1 - (r / rings) * 0.7);
    const ph = (o.phase || 0) + r * 0.62;
    ctx.beginPath();
    for (let i = 0; i <= 84; i++) {
      const a = (i / 84) * TAU;
      const rad = rr * (1 + depth * Math.cos(petals * a + ph));
      const x = cx + rad * Math.cos(a);
      const y = cy + rad * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function starPath(cx, cy, outer, inner, points = 5, rot = -Math.PI / 2) {
  const p = new Path2D();
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const r = i % 2 ? inner : outer;
    const a = rot + (i / n) * TAU;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

/** Círculo serrilhado — a borda de selo lacrado. */
function serratedCircle(cx, cy, radius, teeth, depth) {
  const p = new Path2D();
  const steps = teeth * 6;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    const r = radius * (1 + depth * Math.cos(teeth * a));
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

function barcode(ctx, x, y, w, h, rng, color, pxPerMm) {
  const unit = Math.max(hair(0.22, pxPerMm), w / 62);
  ctx.save();
  ctx.fillStyle = color;
  let cx = x;
  while (cx < x + w - unit) {
    const bar = unit * (1 + Math.floor(rng() * 3));
    const gap = unit * (1 + Math.floor(rng() * 2));
    ctx.fillRect(cx, y, Math.min(bar, x + w - cx), h);
    cx += bar + gap;
  }
  ctx.restore();
}

/** Anel de dois traços — filete duplo de documento oficial. */
function doubleRule(ctx, x, y, w, h, gap, o) {
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.lineWidth = hair(o.outerMm, o.pxPerMm, 0.5);
  ctx.stroke(roundedRect(x, y, w, h, o.radius || 0));
  ctx.lineWidth = hair(o.innerMm, o.pxPerMm, 0.35);
  ctx.stroke(roundedRect(x + gap, y + gap, w - gap * 2, h - gap * 2, Math.max(0, (o.radius || 0) - gap)));
  ctx.restore();
}

/* --------------------------------------------------------------- cédula --- */

const NOTES = [
  { n: '100', words: 'CEM REAIS' },
  { n: '200', words: 'DUZENTOS REAIS' },
  { n: '500', words: 'QUINHENTOS REAIS' },
  { n: '1.000', words: 'MIL REAIS' },
];

const cedula = {
  id: 'c-cedula',
  label: 'Cédula',
  build({ w, h, pxPerMm, seed }) {
    const px = pxPerMm;
    const mm = (v) => v * px;
    const hw = mm(w / 2);
    const hh = mm(h / 2);
    const minSide = Math.min(w, h);
    const bandMm = clamp(minSide * 0.13, 3, 11);
    const band = mm(bandMm);

    const paper = roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.9));
    const box = { x: -hw + band, y: -hh + band, w: hw * 2 - band * 2, h: hh * 2 - band * 2 };
    const photo = roundedRect(box.x, box.y, box.w, box.h, mm(0.35));

    const pick = makeRng((seed ^ 0x9e3f11a7) >>> 0);
    const note = oneOf(pick, NOTES);
    const serial = serialCode(pick, 2, 8);

    return {
      paper,
      photo,
      photoBox: box,
      decorate(ctx, { tone }) {
        const ink = shade(tone, 0.74, 1);
        const rng = makeRng((seed ^ 0x2c7be519) >>> 0);

        ctx.save();

        // Só a faixa entre o papel e a janela da foto: gravura nenhuma pode
        // invadir a imagem.
        const frame = new Path2D();
        frame.addPath(paper);
        frame.addPath(photo);

        ctx.save();
        ctx.fillStyle = shade(tone, 0.07, 1);
        ctx.fill(frame, 'evenodd');
        ctx.clip(frame, 'evenodd');
        guilloche(ctx, {
          hw, hh, pxPerMm: px, color: ink, alpha: 0.5,
          from: band * 0.16, to: band * 0.96, lines: 9, freqA: 7, freqB: 12, phase: rng() * TAU,
        });
        guilloche(ctx, {
          hw, hh, pxPerMm: px, color: ink, alpha: 0.34,
          from: band * 0.24, to: band * 0.88, lines: 6, freqA: 17, freqB: 5, phase: rng() * TAU,
        });
        ctx.restore();

        ctx.strokeStyle = ink;
        ctx.lineWidth = hair(0.28, px, 0.5);
        ctx.stroke(roundedRect(-hw + band * 0.1, -hh + band * 0.1, hw * 2 - band * 0.2, hh * 2 - band * 0.2, mm(0.7)));

        // Microimpressão: sugerida por um tracejado curtíssimo, que na gráfica
        // vira uma linha de texto e na tela vira um fio cinza.
        ctx.save();
        ctx.setLineDash([hair(0.16, px, 0.5), hair(0.16, px, 0.5)]);
        ctx.strokeStyle = shade(tone, 0.55, 0.8);
        ctx.lineWidth = hair(0.12, px);
        ctx.stroke(roundedRect(box.x - band * 0.22, box.y - band * 0.22, box.w + band * 0.44, box.h + band * 0.44, mm(0.4)));
        ctx.restore();

        const rr = band * 0.46;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            rosette(ctx, sx * (hw - band * 0.5), sy * (hh - band * 0.5), rr, {
              pxPerMm: px, color: ink, alpha: 0.62, rings: 3, petals: 8, depth: 0.22, phase: rng() * TAU,
            });
          }
        }

        label(ctx, 'BANCO DOS SONHOS', {
          x: 0, y: -hh + band * 0.5, mm: bandMm * 0.4, pxPerMm: px,
          family: SERIF, weight: 700, track: 0.16, color: ink, maxMm: w - bandMm * 3.2,
        });
        label(ctx, note.words, {
          x: 0, y: hh - band * 0.5, mm: bandMm * 0.34, pxPerMm: px,
          family: SANS, weight: 600, track: 0.22, color: ink, maxMm: w - bandMm * 3.2,
        });

        // Marca d'água sobre a foto: um par claro/escuro deslocado, para
        // aparecer tanto em foto clara quanto em foto escura.
        const wmR = Math.min(box.w, box.h) * 0.3;
        const wmX = box.x + box.w * 0.76;
        const wmY = box.y + box.h * 0.5;
        rosette(ctx, wmX + hair(0.2, px), wmY + hair(0.2, px), wmR, {
          pxPerMm: px, color: 'rgba(20,16,10,1)', alpha: 0.14, rings: 5, petals: 12, depth: 0.14,
        });
        rosette(ctx, wmX, wmY, wmR, {
          pxPerMm: px, color: 'rgba(255,255,255,1)', alpha: 0.22, rings: 5, petals: 12, depth: 0.14,
        });

        const valueMm = clamp(Math.min(w, h) * 0.085, 1.8, 7);
        const pad = mm(valueMm * 0.9);
        const plate = shade(tone, -0.12, 0.84);
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            label(ctx, `R$ ${note.n}`, {
              x: sx < 0 ? box.x + pad : box.x + box.w - pad,
              y: sy < 0 ? box.y + pad : box.y + box.h - pad,
              mm: valueMm, pxPerMm: px, family: SERIF, weight: 700,
              align: sx < 0 ? 'left' : 'right', color: ink, plate, maxMm: w * 0.3,
            });
          }
        }

        label(ctx, serial, {
          x: box.x + box.w * 0.5, y: box.y + box.h - mm(valueMm * 0.7),
          mm: clamp(valueMm * 0.5, 1.6, 3.4), pxPerMm: px,
          family: MONO, weight: 500, track: 0.12, color: ink, plate, maxMm: w * 0.44,
        });

        ctx.restore();
      },
    };
  },
};

/* ----------------------------------------------------------- certificado -- */

const SEAL_INKS = ['#a8862a', '#8c3030', '#2b4a72'];

const certificado = {
  id: 'c-diploma',
  label: 'Certificado',
  build({ w, h, pxPerMm, seed }) {
    const px = pxPerMm;
    const mm = (v) => v * px;
    const hw = mm(w / 2);
    const hh = mm(h / 2);

    let topMm = clamp(h * 0.17, 3.6, 15);
    let footMm = clamp(h * 0.25, 6, 26);
    const roomMm = h * 0.62;
    if (topMm + footMm > roomMm) {
      const k = roomMm / (topMm + footMm);
      topMm *= k;
      footMm *= k;
    }
    const sideMm = clamp(w * 0.075, 2, 10);

    const paper = roundedRect(-hw, -hh, hw * 2, hh * 2, mm(1.2));
    const box = {
      x: -hw + mm(sideMm),
      y: -hh + mm(topMm),
      w: hw * 2 - mm(sideMm) * 2,
      h: hh * 2 - mm(topMm) - mm(footMm),
    };
    const photo = roundedRect(box.x, box.y, box.w, box.h, mm(0.4));

    const pick = makeRng((seed ^ 0x41d0c5b3) >>> 0);
    const sealInk = oneOf(pick, SEAL_INKS);

    return {
      paper,
      photo,
      photoBox: box,
      decorate(ctx, { tone }) {
        const ink = shade(tone, 0.78, 1);
        const soft = shade(tone, 0.5, 0.85);
        ctx.save();

        const inset = mm(clamp(Math.min(w, h) * 0.03, 0.9, 3));
        doubleRule(ctx, -hw + inset, -hh + inset, hw * 2 - inset * 2, hh * 2 - inset * 2,
          mm(clamp(Math.min(w, h) * 0.018, 0.5, 1.8)),
          { color: ink, outerMm: 0.42, innerMm: 0.14, pxPerMm: px, radius: mm(0.6) });

        // Losangos nos quatro cantos do filete: o arremate que todo diploma tem.
        const dia = mm(clamp(Math.min(w, h) * 0.022, 0.6, 2.2));
        ctx.fillStyle = ink;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            const cx = sx * (hw - inset * 2.1);
            const cy = sy * (hh - inset * 2.1);
            ctx.beginPath();
            ctx.moveTo(cx, cy - dia);
            ctx.lineTo(cx + dia, cy);
            ctx.lineTo(cx, cy + dia);
            ctx.lineTo(cx - dia, cy);
            ctx.closePath();
            ctx.fill();
          }
        }

        const titleY = -hh + mm(topMm) * 0.46;
        const drawn = label(ctx, 'CERTIFICADO', {
          x: 0, y: titleY, mm: topMm * 0.5, pxPerMm: px,
          family: SERIF, weight: 700, track: 0.2, color: ink, maxMm: w - sideMm * 2.4,
        });

        if (drawn) {
          const fy = -hh + mm(topMm) * 0.86;
          const half = Math.max(drawn * 0.34, mm(3));
          ctx.strokeStyle = soft;
          ctx.lineWidth = hair(0.14, px);
          ctx.beginPath();
          ctx.moveTo(-half, fy);
          ctx.lineTo(-mm(0.9), fy);
          ctx.moveTo(mm(0.9), fy);
          ctx.lineTo(half, fy);
          ctx.stroke();
          ctx.fillStyle = soft;
          ctx.fill(starPath(0, fy, mm(0.75), mm(0.3), 4, 0));
        }

        const footTop = hh - mm(footMm);
        const sealR = mm(Math.min(footMm * 0.34, w * 0.13));
        const sealX = -hw + mm(sideMm) + sealR * 1.15;
        const sealY = footTop + mm(footMm) * 0.44;

        // Fitas primeiro, para saírem por trás do lacre.
        ctx.fillStyle = shade(sealInk, 0.18, 0.95);
        for (const dir of [-1, 1]) {
          const tipY = hh - mm(footMm) * 0.08;
          ctx.beginPath();
          ctx.moveTo(sealX + dir * sealR * 0.15, sealY);
          ctx.lineTo(sealX + dir * sealR * 0.9, sealY);
          ctx.lineTo(sealX + dir * sealR * 1.15, tipY);
          ctx.lineTo(sealX + dir * sealR * 0.62, tipY - sealR * 0.3);
          ctx.lineTo(sealX + dir * sealR * 0.1, tipY);
          ctx.closePath();
          ctx.fill();
        }

        ctx.fillStyle = sealInk;
        ctx.fill(serratedCircle(sealX, sealY, sealR, 20, 0.07));
        ctx.strokeStyle = shade(sealInk, -0.45, 0.9);
        ctx.lineWidth = hair(0.16, px);
        ctx.beginPath();
        ctx.arc(sealX, sealY, sealR * 0.74, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = shade(sealInk, -0.55, 0.95);
        ctx.fill(starPath(sealX, sealY, sealR * 0.44, sealR * 0.18, 5));

        const linesLeft = sealX + sealR * 1.5;
        const linesRight = hw - mm(sideMm);
        const gapPx = mm(clamp(w * 0.03, 1, 4));
        const colW = (linesRight - linesLeft - gapPx) / 2;
        if (colW > mm(6)) {
          const lineY = footTop + mm(footMm) * 0.58;
          ctx.strokeStyle = ink;
          ctx.lineWidth = hair(0.16, px);
          ['Diretoria', 'Data'].forEach((caption, i) => {
            const x0 = linesLeft + (colW + gapPx) * i;
            ctx.beginPath();
            ctx.moveTo(x0, lineY);
            ctx.lineTo(x0 + colW, lineY);
            ctx.stroke();
            label(ctx, caption, {
              x: x0 + colW / 2, y: lineY + mm(footMm) * 0.22, mm: footMm * 0.18, pxPerMm: px,
              family: SANS, weight: 500, track: 0.08, color: soft, maxMm: colW / px,
            });
          });
        }

        ctx.restore();
      },
    };
  },
};

/* ---------------------------------------------------------------- crachá -- */

const BADGE_INKS = ['#1f3f66', '#2b3138', '#6d2530', '#1d5145'];

const cracha = {
  id: 'c-cracha',
  label: 'Crachá',
  build({ w, h, pxPerMm, seed }) {
    const px = pxPerMm;
    const mm = (v) => v * px;
    const hw = mm(w / 2);
    const hh = mm(h / 2);
    const minSide = Math.min(w, h);

    const headMm = clamp(h * 0.19, 4, 16);
    const footMm = clamp(h * 0.16, 3.6, 14);
    const sideMm = clamp(w * 0.05, 0.8, 4);

    const paper = roundedRect(-hw, -hh, hw * 2, hh * 2, mm(clamp(minSide * 0.06, 1.2, 4)));

    const slotW = mm(clamp(w * 0.3, 5, 22));
    const slotH = mm(clamp(h * 0.03, 0.9, 2.6));
    const slotY = -hh + mm(headMm) * 0.42;
    const slot = roundedRect(-slotW / 2, slotY - slotH / 2, slotW, slotH, slotH / 2);
    paper.addPath(slot);

    const box = {
      x: -hw + mm(sideMm),
      y: -hh + mm(headMm),
      w: hw * 2 - mm(sideMm) * 2,
      h: hh * 2 - mm(headMm) - mm(footMm),
    };
    const photo = roundedRect(box.x, box.y, box.w, box.h, mm(0.5));

    const pick = makeRng((seed ^ 0x7b31d90f) >>> 0);
    const accent = oneOf(pick, BADGE_INKS);
    const serial = `Nº ${serialCode(pick, 0, 6)}`;

    return {
      paper,
      photo,
      photoBox: box,
      rule: 'evenodd',
      decorate(ctx, { tone }) {
        const rng = makeRng((seed ^ 0x35c2a081) >>> 0);
        ctx.save();

        // O furo é vazado no papel: pintar as faixas dentro do clip do papel
        // com evenodd é o que impede a tinta de tapar o furo.
        ctx.save();
        ctx.clip(paper, 'evenodd');
        ctx.fillStyle = accent;
        ctx.fillRect(-hw, -hh, hw * 2, mm(headMm));
        ctx.fillStyle = shade(tone, 0.06, 1);
        ctx.fillRect(-hw, hh - mm(footMm), hw * 2, mm(footMm));
        ctx.restore();

        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = hair(0.22, px);
        ctx.stroke(slot);
        ctx.save();
        ctx.translate(0, -hair(0.16, px));
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = hair(0.12, px);
        ctx.stroke(slot);
        ctx.restore();

        label(ctx, 'CREDENCIAL', {
          x: 0, y: -hh + mm(headMm) * 0.79, mm: headMm * 0.27, pxPerMm: px,
          family: SANS, weight: 700, track: 0.28, color: 'rgba(255,255,255,0.94)',
          maxMm: w * 0.7,
        });

        const footTop = hh - mm(footMm);
        const barH = mm(footMm) * 0.44;
        const barW = Math.min(hw * 1.3, mm(w * 0.62));
        barcode(ctx, -barW / 2, footTop + mm(footMm) * 0.16, barW, barH, rng, shade(tone, 0.82, 1), px);
        label(ctx, serial, {
          x: 0, y: footTop + mm(footMm) * 0.8, mm: footMm * 0.28, pxPerMm: px,
          family: MONO, weight: 500, track: 0.1, color: shade(tone, 0.6, 1), maxMm: w * 0.6,
        });

        label(ctx, 'ACESSO TOTAL', {
          x: box.x + mm(clamp(w * 0.03, 0.8, 3)),
          y: box.y + box.h - mm(clamp(h * 0.04, 1, 4)),
          mm: clamp(minSide * 0.055, 1.6, 3.4), pxPerMm: px,
          family: SANS, weight: 700, track: 0.16, align: 'left',
          color: 'rgba(255,255,255,0.96)', plate: shade(accent, -0.06, 0.92), maxMm: w * 0.62,
        });

        ctx.restore();
      },
    };
  },
};

/* ------------------------------------------------------- capa de revista -- */

const MASTHEADS = ['FORTUNA', 'VITÓRIA', 'CONQUISTA', 'ASCENSÃO'];
const COVER_LINES = [
  ['O ANO DA VIRADA', 'como eu cheguei lá'],
  ['DE ZERO A TUDO', 'a rotina que mudou o jogo'],
  ['A META BATIDA', 'o plano que ninguém viu'],
];

const revista = {
  id: 'c-revista',
  label: 'Capa de revista',
  build({ w, h, pxPerMm, seed }) {
    const px = pxPerMm;
    const mm = (v) => v * px;
    const hw = mm(w / 2);
    const hh = mm(h / 2);
    const box = { x: -hw, y: -hh, w: hw * 2, h: hh * 2 };
    const paper = roundedRect(box.x, box.y, box.w, box.h, mm(0.6));

    const pick = makeRng((seed ^ 0x6ac1f337) >>> 0);
    const name = oneOf(pick, MASTHEADS);
    const lines = oneOf(pick, COVER_LINES);
    const issue = 3 + Math.floor(pick() * 20);

    return {
      paper,
      photo: paper,
      photoBox: box,
      decorate(ctx, { tone }) {
        const rng = makeRng((seed ^ 0x18f4d2b7) >>> 0);
        const accent = '#d94f3d';
        const padMm = clamp(Math.min(w, h) * 0.055, 1.4, 6);
        const pad = mm(padMm);
        ctx.save();

        // Sem os véus a manchete some em qualquer foto clara.
        const topScrim = ctx.createLinearGradient(0, -hh, 0, -hh + hh * 0.9);
        topScrim.addColorStop(0, 'rgba(18,14,10,0.55)');
        topScrim.addColorStop(1, 'rgba(18,14,10,0)');
        ctx.fillStyle = topScrim;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 0.9);

        const botScrim = ctx.createLinearGradient(0, hh, 0, hh - hh * 0.95);
        botScrim.addColorStop(0, 'rgba(14,11,8,0.62)');
        botScrim.addColorStop(1, 'rgba(14,11,8,0)');
        ctx.fillStyle = botScrim;
        ctx.fillRect(-hw, hh - hh * 0.95, hw * 2, hh * 0.95);

        const headMm = clamp(w * 0.2, 3.2, 34);
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = mm(0.8);
        label(ctx, name, {
          x: 0, y: -hh + pad + mm(headMm) * 0.5, mm: headMm, pxPerMm: px,
          family: SERIF, weight: 800, track: -0.01, color: '#fff', maxMm: w - padMm * 2,
        });
        ctx.restore();

        label(ctx, `EDIÇÃO Nº ${issue} · MARÇO 2026`, {
          x: 0, y: -hh + pad + mm(headMm) * 1.16, mm: clamp(w * 0.034, 1.6, 3.6), pxPerMm: px,
          family: SANS, weight: 600, track: 0.24, color: 'rgba(255,255,255,0.86)', maxMm: w * 0.8,
        });

        const codeMm = clamp(Math.min(w, h) * 0.13, 4, 16);
        const codeW = mm(codeMm);
        const codeH = mm(codeMm * 0.52);
        const codeY = hh - pad - codeH;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fill(roundedRect(-hw + pad, codeY, codeW, codeH, mm(0.4)));
        barcode(ctx, -hw + pad + mm(0.5), codeY + mm(0.5), codeW - mm(1), codeH - mm(1), rng, '#16130f', px);
        label(ctx, 'R$ 24,90', {
          x: -hw + pad + codeW + mm(1.2), y: codeY + codeH * 0.5,
          mm: clamp(w * 0.032, 1.6, 3.4), pxPerMm: px,
          family: SANS, weight: 600, align: 'left', color: 'rgba(255,255,255,0.9)', maxMm: w * 0.3,
        });

        const leadMm = clamp(w * 0.068, 1.8, 9);
        const subMm = clamp(w * 0.04, 1.6, 5);
        const leadY = codeY - mm(leadMm) * 1.5;
        const barX = -hw + pad;
        ctx.fillStyle = accent;
        ctx.fillRect(barX, leadY - mm(leadMm) * 0.72, mm(clamp(w * 0.012, 0.4, 1.6)), mm(leadMm) * 1.5);
        const textX = barX + mm(clamp(w * 0.012, 0.4, 1.6)) + mm(clamp(w * 0.02, 0.6, 2.4));
        label(ctx, lines[0], {
          x: textX, y: leadY, mm: leadMm, pxPerMm: px,
          family: SANS, weight: 800, align: 'left', track: -0.01, color: '#fff', maxMm: w * 0.62,
        });
        label(ctx, lines[1], {
          x: textX, y: leadY + mm(leadMm) * 0.92, mm: subMm, pxPerMm: px,
          family: SERIF, weight: 'italic 500', align: 'left', color: 'rgba(255,255,255,0.88)',
          maxMm: w * 0.6,
        });

        const badgeR = mm(clamp(Math.min(w, h) * 0.14, 3.6, 15));
        const bx = hw - pad - badgeR;
        const by = leadY - badgeR * 0.1;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(-9 * DEG);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(0, 0, badgeR, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = hair(0.2, px);
        ctx.beginPath();
        ctx.arc(0, 0, badgeR * 0.86, 0, TAU);
        ctx.stroke();
        label(ctx, 'ESPECIAL', {
          x: 0, y: -badgeR * 0.24, mm: (badgeR / px) * 0.3, pxPerMm: px,
          family: SANS, weight: 800, track: 0.06, color: '#fff', maxMm: (badgeR / px) * 1.5,
        });
        label(ctx, 'METAS', {
          x: 0, y: badgeR * 0.3, mm: (badgeR / px) * 0.38, pxPerMm: px,
          family: SERIF, weight: 800, color: '#fff', maxMm: (badgeR / px) * 1.5,
        });
        ctx.restore();

        ctx.strokeStyle = shade(tone, 0.2, 0.35);
        ctx.lineWidth = hair(0.15, px);
        ctx.stroke(paper);
        ctx.restore();
      },
    };
  },
};

/* --------------------------------------------------------- placa gravada -- */

const METALS = [
  { hi: '#f7e9bd', mid: '#c9a227', lo: '#7f6114' },
  { hi: '#f4f6f8', mid: '#b6bec6', lo: '#767e86' },
  { hi: '#f2d8ba', mid: '#b47a45', lo: '#6f4522' },
];
const ENGRAVINGS = ['CONQUISTA', 'REALIZADO', 'META BATIDA'];

const placa = {
  id: 'c-placa',
  label: 'Placa gravada',
  build({ w, h, pxPerMm, seed }) {
    const px = pxPerMm;
    const mm = (v) => v * px;
    const hw = mm(w / 2);
    const hh = mm(h / 2);
    const minSide = Math.min(w, h);

    const edgeMm = clamp(minSide * 0.085, 1.8, 11);
    const footMm = Math.min(edgeMm * 2.6, h * 0.26);

    const paper = roundedRect(-hw, -hh, hw * 2, hh * 2, mm(1.4));
    const box = {
      x: -hw + mm(edgeMm),
      y: -hh + mm(edgeMm),
      w: hw * 2 - mm(edgeMm) * 2,
      h: hh * 2 - mm(edgeMm) - mm(footMm),
    };
    const photo = roundedRect(box.x, box.y, box.w, box.h, mm(0.5));

    const pick = makeRng((seed ^ 0x5d0aa93b) >>> 0);
    const metal = oneOf(pick, METALS);
    const word = oneOf(pick, ENGRAVINGS);

    return {
      paper,
      photo,
      photoBox: box,
      decorate(ctx) {
        const rng = makeRng((seed ^ 0x2ef6b115) >>> 0);
        ctx.save();

        const band = new Path2D();
        band.addPath(paper);
        band.addPath(photo);

        ctx.save();
        ctx.clip(band, 'evenodd');
        const g = ctx.createLinearGradient(-hw, -hh, hw, hh);
        g.addColorStop(0, metal.hi);
        g.addColorStop(0.32, metal.mid);
        g.addColorStop(0.52, metal.hi);
        g.addColorStop(0.78, metal.mid);
        g.addColorStop(1, metal.lo);
        ctx.fillStyle = g;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);

        // Escovado: fios horizontais de brilho e sombra, densidade em mm para a
        // textura não mudar de escala entre a prévia e o arquivo de impressão.
        const streaks = clamp(Math.round(h * 2.2), 40, 320);
        ctx.lineWidth = hair(0.05, px, 0.4);
        for (let i = 0; i < streaks; i++) {
          const y = -hh + (i / streaks) * hh * 2 + range(rng, -0.4, 0.4) * (hh * 2 / streaks);
          const a = Math.abs(gaussian(rng)) * 0.1;
          ctx.strokeStyle = rng() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(40,30,12,${a})`;
          ctx.beginPath();
          ctx.moveTo(-hw, y);
          ctx.lineTo(hw, y);
          ctx.stroke();
        }
        ctx.restore();

        ctx.save();
        ctx.clip(paper);
        const bevel = ctx.createLinearGradient(-hw, -hh, hw, hh);
        bevel.addColorStop(0, 'rgba(255,255,255,0.75)');
        bevel.addColorStop(0.5, 'rgba(255,255,255,0.1)');
        bevel.addColorStop(1, 'rgba(20,14,4,0.45)');
        ctx.strokeStyle = bevel;
        ctx.lineWidth = mm(clamp(edgeMm * 0.22, 0.3, 1.6)) * 2;
        ctx.stroke(paper);
        ctx.restore();

        const rebate = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
        rebate.addColorStop(0, 'rgba(18,12,4,0.6)');
        rebate.addColorStop(0.55, 'rgba(120,96,50,0.25)');
        rebate.addColorStop(1, 'rgba(255,255,255,0.6)');
        ctx.strokeStyle = rebate;
        ctx.lineWidth = mm(clamp(edgeMm * 0.18, 0.25, 1.2));
        ctx.stroke(photo);

        const screwR = mm(clamp(edgeMm * 0.3, 0.5, 2.6));
        const inX = hw - mm(edgeMm) * 0.5;
        const inY = hh - mm(edgeMm) * 0.5;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            const cx = sx * inX;
            const cy = sy * (sy > 0 ? hh - mm(footMm) * 0.5 : inY);
            ctx.fillStyle = 'rgba(20,14,6,0.4)';
            ctx.beginPath();
            ctx.arc(cx, cy + hair(0.12, px), screwR, 0, TAU);
            ctx.fill();
            const sg = ctx.createLinearGradient(cx - screwR, cy - screwR, cx + screwR, cy + screwR);
            sg.addColorStop(0, metal.hi);
            sg.addColorStop(1, metal.lo);
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.arc(cx, cy, screwR, 0, TAU);
            ctx.fill();
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(range(rng, 0, Math.PI));
            ctx.strokeStyle = 'rgba(20,14,6,0.55)';
            ctx.lineWidth = hair(0.16, px);
            ctx.beginPath();
            ctx.moveTo(-screwR * 0.66, 0);
            ctx.lineTo(screwR * 0.66, 0);
            ctx.stroke();
            ctx.restore();
          }
        }

        // Gravação a baixo relevo: cópia clara meio fio acima da escura.
        const engraveY = hh - mm(footMm) * 0.5;
        const engraveMm = clamp(footMm * 0.36, 1.6, 9);
        const wide = w - edgeMm * 3.2;
        label(ctx, word, {
          x: 0, y: engraveY - hair(0.14, px), mm: engraveMm, pxPerMm: px,
          family: SERIF, weight: 700, track: 0.26, color: 'rgba(255,255,255,0.5)', maxMm: wide,
        });
        label(ctx, word, {
          x: 0, y: engraveY, mm: engraveMm, pxPerMm: px,
          family: SERIF, weight: 700, track: 0.26, color: 'rgba(26,18,6,0.78)', maxMm: wide,
        });

        ctx.restore();
      },
    };
  },
};

/* --------------------------------------------------------- ticket dourado -- */

const ticket = {
  id: 'c-ticket',
  label: 'Ticket dourado',
  build({ w, h, pxPerMm, seed }) {
    const px = pxPerMm;
    const mm = (v) => v * px;
    const hw = mm(w / 2);
    const hh = mm(h / 2);
    const minSide = Math.min(w, h);
    const alongX = w >= h;

    const stubMm = clamp((alongX ? w : h) * 0.26, 5, 32);
    const stub = mm(stubMm);
    const padMm = clamp(minSide * 0.045, 0.7, 3.5);
    const pad = mm(padMm);
    const notchR = mm(clamp(minSide * 0.055, 0.8, 3));

    const paper = roundedRect(-hw, -hh, hw * 2, hh * 2, mm(clamp(minSide * 0.05, 0.8, 3)));
    const tear = alongX ? hw - stub : hh - stub;
    for (const side of [-1, 1]) {
      const cx = alongX ? tear : side * hw;
      const cy = alongX ? side * hh : tear;
      paper.moveTo(cx + notchR, cy);
      paper.arc(cx, cy, notchR, 0, TAU, true);
    }

    const box = alongX
      ? { x: -hw + pad, y: -hh + pad, w: hw * 2 - stub - pad * 2.2, h: hh * 2 - pad * 2 }
      : { x: -hw + pad, y: -hh + pad, w: hw * 2 - pad * 2, h: hh * 2 - stub - pad * 2.2 };
    const photo = roundedRect(box.x, box.y, box.w, box.h, mm(0.4));

    const pick = makeRng((seed ^ 0x0f7c2a55) >>> 0);
    const serial = serialCode(pick, 1, 6);

    return {
      paper,
      photo,
      photoBox: box,
      rule: 'evenodd',
      decorate(ctx) {
        ctx.save();

        const chrome = new Path2D();
        chrome.addPath(paper);
        chrome.addPath(photo);

        ctx.save();
        ctx.clip(chrome, 'evenodd');
        const g = ctx.createLinearGradient(-hw, -hh, hw, hh);
        g.addColorStop(0, '#f8edbe');
        g.addColorStop(0.3, '#d8b444');
        g.addColorStop(0.55, '#f6e5a6');
        g.addColorStop(0.8, '#c69a24');
        g.addColorStop(1, '#f3e0a2');
        ctx.fillStyle = g;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        guilloche(ctx, {
          hw, hh, pxPerMm: px, color: 'rgba(96,68,10,1)', alpha: 0.32,
          from: pad * 0.2, to: pad * 1.1, lines: 4, freqA: 11, freqB: 6, phase: 0.7,
        });
        ctx.restore();

        // Picote: linha tracejada exatamente entre os dois entalhes.
        ctx.save();
        ctx.setLineDash([mm(0.8), mm(0.6)]);
        ctx.strokeStyle = 'rgba(88,62,8,0.6)';
        ctx.lineWidth = hair(0.2, px);
        ctx.beginPath();
        if (alongX) {
          ctx.moveTo(tear, -hh + notchR * 1.3);
          ctx.lineTo(tear, hh - notchR * 1.3);
        } else {
          ctx.moveTo(-hw + notchR * 1.3, tear);
          ctx.lineTo(hw - notchR * 1.3, tear);
        }
        ctx.stroke();
        ctx.restore();

        const stubCx = alongX ? tear + stub / 2 : 0;
        const stubCy = alongX ? 0 : tear + stub / 2;
        const stubLen = alongX ? h : w;

        ctx.save();
        ctx.translate(stubCx, stubCy);
        if (alongX) ctx.rotate(-90 * DEG);
        const ink = 'rgba(74,52,6,0.92)';
        label(ctx, 'ADMITE UM', {
          x: 0, y: -stub * 0.2, mm: clamp(stubMm * 0.24, 1.6, 5), pxPerMm: px,
          family: SANS, weight: 800, track: 0.22, color: ink, maxMm: stubLen * 0.74,
        });
        label(ctx, serial, {
          x: 0, y: stub * 0.22, mm: clamp(stubMm * 0.17, 1.6, 3.6), pxPerMm: px,
          family: MONO, weight: 500, track: 0.08, color: ink, maxMm: stubLen * 0.7,
        });
        ctx.restore();

        const starR = mm(clamp(minSide * 0.03, 0.5, 2));
        ctx.fillStyle = 'rgba(92,64,8,0.7)';
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            ctx.fill(starPath(sx * (hw - pad * 0.5), sy * (hh - pad * 0.5), starR, starR * 0.42, 5));
          }
        }

        label(ctx, 'VIP', {
          x: box.x + mm(clamp(minSide * 0.05, 1, 4)),
          y: box.y + mm(clamp(minSide * 0.06, 1.2, 5)),
          mm: clamp(minSide * 0.09, 1.6, 6), pxPerMm: px,
          family: SERIF, weight: 800, track: 0.12, align: 'left',
          color: 'rgba(58,40,4,0.95)', plate: 'rgba(246,229,166,0.92)', maxMm: w * 0.3,
        });

        ctx.strokeStyle = 'rgba(88,62,8,0.45)';
        ctx.lineWidth = hair(0.16, px);
        ctx.stroke(paper, 'evenodd');
        ctx.restore();
      },
    };
  },
};

/* -------------------------------------------------------------- aprovado -- */

const STAMP_INKS = ['#b0392e', '#2f6a4f', '#2b4a86'];

const aprovado = {
  id: 'c-aprovado',
  label: 'Aprovado',
  build({ w, h, pxPerMm, seed }) {
    const px = pxPerMm;
    const mm = (v) => v * px;
    const hw = mm(w / 2);
    const hh = mm(h / 2);
    const minSide = Math.min(w, h);

    const edgeMm = clamp(minSide * 0.05, 0.9, 5);
    const paper = roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.6));
    const box = {
      x: -hw + mm(edgeMm), y: -hh + mm(edgeMm),
      w: hw * 2 - mm(edgeMm) * 2, h: hh * 2 - mm(edgeMm) * 2,
    };
    const photo = roundedRect(box.x, box.y, box.w, box.h, mm(0.2));

    const pick = makeRng((seed ^ 0x63b8e011) >>> 0);
    const ink = oneOf(pick, STAMP_INKS);
    const protocolo = `PROTOCOLO ${2026}/${serialCode(pick, 0, 4)}`;
    const tilt = range(pick, -15, -5);

    return {
      paper,
      photo,
      photoBox: box,
      decorate(ctx, { tone }) {
        const rng = makeRng((seed ^ 0x1a9f4d73) >>> 0);
        ctx.save();

        ctx.strokeStyle = shade(tone, 0.45, 0.5);
        ctx.lineWidth = hair(0.14, px);
        ctx.stroke(photo);

        label(ctx, protocolo, {
          x: box.x + mm(clamp(minSide * 0.04, 0.8, 3.5)),
          y: box.y + mm(clamp(minSide * 0.05, 1, 4)),
          mm: clamp(minSide * 0.045, 1.6, 3.2), pxPerMm: px,
          family: MONO, weight: 500, track: 0.06, align: 'left',
          color: shade(tone, 0.72, 1), plate: shade(tone, -0.1, 0.8), maxMm: w * 0.6,
        });

        const stampW = Math.min(mm(clamp(minSide * 0.66, 11, 96)), box.w * 0.84);
        const stampH = stampW * 0.42;
        const cx = box.x + box.w - stampW * 0.55;
        const cy = box.y + box.h - stampH * 0.72;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt * DEG);
        ctx.globalAlpha = 0.86;
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.lineJoin = 'round';

        // A tinta de carimbo nunca sai contínua: um tracejado irregular longo
        // imita a borracha que não encostou por inteiro no papel.
        const dash = [];
        for (let i = 0; i < 8; i++) dash.push(mm(range(rng, 2.4, 9)), mm(range(rng, 0.1, 0.5)));
        ctx.setLineDash(dash);
        ctx.lineDashOffset = mm(range(rng, 0, 6));

        ctx.lineWidth = hair(0.45, px, 0.7);
        ctx.stroke(roundedRect(-stampW / 2, -stampH / 2, stampW, stampH, mm(1.2)));
        const gap = mm(clamp(minSide * 0.018, 0.4, 1.6));
        ctx.lineWidth = hair(0.16, px);
        ctx.stroke(roundedRect(-stampW / 2 + gap * 1.6, -stampH / 2 + gap * 1.6, stampW - gap * 3.2, stampH - gap * 3.2, mm(0.8)));
        ctx.setLineDash([]);

        const titleMm = (stampH / px) * 0.42;
        label(ctx, 'APROVADO', {
          x: 0, y: -stampH * 0.1, mm: titleMm, pxPerMm: px,
          family: SANS, weight: 800, track: 0.14, color: ink, maxMm: (stampW / px) * 0.76,
        });
        label(ctx, 'META CONCLUÍDA · 2026', {
          x: 0, y: stampH * 0.26, mm: (stampH / px) * 0.15, pxPerMm: px,
          family: SANS, weight: 600, track: 0.16, color: ink, maxMm: (stampW / px) * 0.78,
        });

        // Respingos: a tinta que escapa da borda quando o carimbo bate forte.
        ctx.globalAlpha = 0.4;
        for (let i = 0; i < 16; i++) {
          const edge = rng() > 0.5 ? -1 : 1;
          const x = range(rng, -stampW * 0.54, stampW * 0.54);
          const y = edge * (stampH * 0.5 + mm(range(rng, -0.4, 1.2)));
          const r = mm(range(rng, 0.06, 0.24));
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        }
        ctx.restore();

        ctx.restore();
      },
    };
  },
};

export const ACHIEVEMENT = {
  id: 'conquista',
  label: 'Conquista',
  styles: [cedula, certificado, cracha, revista, placa, ticket, aprovado],
};
