import { makeRng, range, pick } from '../../core/rng.js';
import { roundedRect } from '../shapes.js';

/**
 * Casa e corpo: a seção do quadro onde entram "quero essa casa", "quero esse
 * corpo", "quero essa rotina". Cada estilo finge que a foto foi impressa em cima
 * de um objeto da vida doméstica — a prancha do arquiteto, a ficha da academia,
 * o azulejo da parede.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const SANS = '"Inter", system-ui, sans-serif';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = 'ui-monospace, monospace';

/** Abaixo disso o texto vira borrão na prévia a 26% e não paga o custo de desenhar. */
const MIN_TEXT_MM = 1.6;

const num = (v, casas = 2) => v.toFixed(casas).replace('.', ',');

/**
 * Reparte a altura entre as faixas impressas e a foto. Peças muito baixas (uma
 * célula de 25 mm) estouram os mínimos absolutos das faixas, então tudo encolhe
 * junto em vez de comer a foto inteira.
 */
function bands(h, parts, minPhoto = 0.34) {
  const total = parts.reduce((a, b) => a + b, 0);
  const max = h * (1 - minPhoto);
  const k = total > max ? max / total : 1;
  return parts.map((p) => p * k);
}

function tools(ctx, pxPerMm) {
  return {
    px: (mm) => mm * pxPerMm,
    hair: (mm) => Math.max(0.35, mm * pxPerMm),
    font(sizeMm, family = SANS, weight = 400) {
      ctx.font = `${weight} ${Math.max(MIN_TEXT_MM, sizeMm) * pxPerMm}px ${family}`;
    },
  };
}

/**
 * Escreve respeitando uma largura máxima. Se não couber, comprime na horizontal
 * em vez de reduzir o corpo — abaixo do mínimo legível a linha some de vez, e
 * uma letra estreita ainda se lê.
 */
function write(ctx, text, x, y, maxPx) {
  if (!(maxPx > 0)) return;
  const w = ctx.measureText(text).width;
  if (w <= maxPx) {
    ctx.fillText(text, x, y);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(maxPx / w, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** `ctx.letterSpacing` não existe em todo navegador; o tracking é manual. */
function tracked(ctx, text, x, y, spacing, maxPx) {
  const chars = [...text];
  let total = -spacing;
  for (const c of chars) total += ctx.measureText(c).width + spacing;
  const k = maxPx > 0 && total > maxPx ? maxPx / total : 1;

  ctx.save();
  ctx.textAlign = 'left';
  ctx.translate(x - (total * k) / 2, y);
  ctx.scale(k, 1);
  let cx = 0;
  for (const c of chars) {
    ctx.fillText(c, cx, 0);
    cx += ctx.measureText(c).width + spacing;
  }
  ctx.restore();
}

function arrowHead(ctx, x, y, ux, uy, size) {
  const nx = -uy;
  const ny = ux;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + ux * size + nx * size * 0.3, y + uy * size + ny * size * 0.3);
  ctx.lineTo(x + ux * size - nx * size * 0.3, y + uy * size - ny * size * 0.3);
  ctx.closePath();
  ctx.fill();
}

/** Cota de desenho técnico: linha, chamadas nas pontas e setas cheias virando para dentro. */
function dimLine(ctx, ax, ay, bx, by, ext, head) {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const nx = -uy;
  const ny = ux;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.moveTo(ax + nx * ext, ay + ny * ext);
  ctx.lineTo(ax - nx * ext, ay - ny * ext);
  ctx.moveTo(bx + nx * ext, by + ny * ext);
  ctx.lineTo(bx - nx * ext, by - ny * ext);
  ctx.stroke();
  if (len > head * 3) {
    arrowHead(ctx, ax, ay, ux, uy, head);
    arrowHead(ctx, bx, by, -ux, -uy, head);
  }
}

const rectPath = (b) => roundedRect(b.x, b.y, b.w, b.h, 0);

/* ------------------------------------------------------------- planta baixa */

const planta = {
  id: 'v-planta',
  label: 'Planta baixa',
  build({ w, h, pxPerMm }) {
    const hw = (w / 2) * pxPerMm;
    const hh = (h / 2) * pxPerMm;
    const min = Math.min(w, h);
    const edge = clamp(min * 0.03, 1.2, 3.5);
    const [gutter, stamp] = bands(h, [clamp(min * 0.11, 5, 15), clamp(h * 0.14, 7, 20)], 0.42);
    const right = gutter * 0.45;

    const box = {
      x: (-w / 2 + edge + gutter) * pxPerMm,
      y: (-h / 2 + edge + gutter) * pxPerMm,
      w: (w - edge * 2 - gutter - right) * pxPerMm,
      h: (h - edge * 2 - gutter - stamp) * pxPerMm,
    };

    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, pxPerMm * 0.8),
      photo: rectPath(box),
      photoBox: box,
      zones: { edge, gutter, stamp },
      decorate(ctx, info) {
        const { px, hair, font } = tools(ctx, info.pxPerMm);
        const rng = makeRng(info.seed ^ 0x9a13c5);
        const ink = 'rgba(38,44,52,0.9)';
        const larguraM = range(rng, 7.4, 13.2);
        const fundoM = clamp(larguraM * (box.h / box.w), 4.2, 16);
        const areaM2 = larguraM * fundoM * range(rng, 0.74, 0.86);
        const cotaMm = clamp(gutter * 0.3, MIN_TEXT_MM, 2.6);

        ctx.save();
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;

        // Moldura da prancha
        ctx.lineWidth = hair(0.28);
        ctx.strokeRect(-hw + px(edge), -hh + px(edge), hw * 2 - px(edge * 2), hh * 2 - px(edge * 2));

        // Paredes externas: linha grossa mais um fio interno
        ctx.lineWidth = hair(0.55);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.lineWidth = hair(0.2);
        ctx.strokeRect(box.x + px(0.5), box.y + px(0.5), box.w - px(1), box.h - px(1));

        // Divisória interna com vão de porta e arco de abertura
        const split = box.x + box.w * range(rng, 0.38, 0.6);
        const doorW = Math.min(box.h * 0.24, px(clamp(min * 0.13, 3, 9)));
        const doorY = box.y + box.h * 0.68;
        ctx.lineWidth = hair(0.45);
        ctx.beginPath();
        ctx.moveTo(split, box.y);
        ctx.lineTo(split, doorY);
        ctx.moveTo(split, doorY + doorW);
        ctx.lineTo(split, box.y + box.h);
        ctx.stroke();
        ctx.lineWidth = hair(0.22);
        ctx.beginPath();
        ctx.moveTo(split, doorY + doorW);
        ctx.lineTo(split + doorW, doorY + doorW);
        ctx.arc(split, doorY + doorW, doorW, 0, -Math.PI / 2, true);
        ctx.stroke();

        // Cotas: uma corrida no topo, quebrada na divisória, e uma na lateral
        ctx.lineWidth = hair(0.2);
        const cy = -hh + px(edge + gutter * 0.42);
        const ext = px(gutter * 0.16);
        const head = px(clamp(gutter * 0.13, 0.6, 1.4));
        dimLine(ctx, box.x, cy, split, cy, ext, head);
        dimLine(ctx, split, cy, box.x + box.w, cy, ext, head);
        ctx.beginPath();
        ctx.moveTo(box.x, cy);
        ctx.lineTo(box.x, box.y);
        ctx.moveTo(split, cy);
        ctx.lineTo(split, box.y);
        ctx.moveTo(box.x + box.w, cy);
        ctx.lineTo(box.x + box.w, box.y);
        ctx.stroke();

        const fr = (split - box.x) / box.w;
        font(cotaMm, MONO, 500);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        write(ctx, num(larguraM * fr), (box.x + split) / 2, cy - px(0.4), (split - box.x) * 0.9);
        write(ctx, num(larguraM * (1 - fr)), (split + box.x + box.w) / 2, cy - px(0.4), (box.x + box.w - split) * 0.9);

        const cx = -hw + px(edge + gutter * 0.42);
        dimLine(ctx, cx, box.y, cx, box.y + box.h, ext, head);
        ctx.save();
        ctx.translate(cx - px(0.4), box.y + box.h / 2);
        ctx.rotate(-90 * DEG);
        write(ctx, `${num(fundoM)} m`, 0, 0, box.h * 0.9);
        ctx.restore();

        // Etiqueta de ambiente sobre a foto
        const tagMm = clamp(min * 0.045, MIN_TEXT_MM, 3);
        font(tagMm, SANS, 600);
        const room = pick(rng, ['SALA', 'SUÍTE', 'VARANDA', 'COZINHA']);
        const label = `${room}  ${num(areaM2 * range(rng, 0.16, 0.24), 1)} m²`;
        const padx = px(tagMm * 0.5);
        const plateW = Math.min(ctx.measureText(label).width + padx * 2, box.w * 0.8);
        const plateH = px(tagMm * 1.9);
        const plateX = box.x + px(1.2);
        const plateY = box.y + box.h - plateH - px(1.2);
        ctx.fillStyle = 'rgba(252,250,244,0.86)';
        ctx.fill(roundedRect(plateX, plateY, plateW, plateH, px(0.4)));
        ctx.fillStyle = ink;
        ctx.textBaseline = 'middle';
        write(ctx, label, plateX + plateW / 2, plateY + plateH / 2, plateW - padx);

        // Carimbo
        const sy = hh - px(edge + stamp);
        ctx.lineWidth = hair(0.3);
        ctx.beginPath();
        ctx.moveTo(-hw + px(edge), sy);
        ctx.lineTo(hw - px(edge), sy);
        ctx.stroke();
        const cells = ['PLANTA BAIXA', 'ESC. 1:50', `${num(areaM2, 1)} m²`];
        const cw = (hw * 2 - px(edge * 2)) / cells.length;
        ctx.lineWidth = hair(0.18);
        ctx.beginPath();
        for (let i = 1; i < cells.length; i++) {
          ctx.moveTo(-hw + px(edge) + cw * i, sy);
          ctx.lineTo(-hw + px(edge) + cw * i, hh - px(edge));
        }
        ctx.stroke();
        font(clamp(stamp * 0.24, MIN_TEXT_MM, 2.8), SANS, 600);
        ctx.textBaseline = 'middle';
        cells.forEach((t, i) => {
          write(ctx, t, -hw + px(edge) + cw * (i + 0.5), sy + (hh - px(edge) - sy) / 2, cw * 0.86);
        });

        // Rosa dos ventos
        const nr = px(gutter * 0.28);
        const nx = hw - px(edge + Math.max(right, gutter * 0.45) * 0.5);
        const ny = -hh + px(edge + gutter * 0.5);
        ctx.lineWidth = hair(0.18);
        ctx.beginPath();
        ctx.arc(nx, ny, nr, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(nx, ny - nr);
        ctx.lineTo(nx + nr * 0.45, ny + nr * 0.7);
        ctx.lineTo(nx, ny + nr * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      },
    };
  },
};

/* --------------------------------------------------------- chave e etiqueta */

const chave = {
  id: 'v-chave',
  label: 'Chave e etiqueta',
  build({ w, h, pxPerMm, seed }) {
    const hw = (w / 2) * pxPerMm;
    const hh = (h / 2) * pxPerMm;
    const min = Math.min(w, h);
    const rng = makeRng(seed ^ 0x33b71e);

    const [keyZone] = bands(h, [clamp(h * 0.3, 8, 34)], 0.5);
    const tagTop = -h / 2 + keyZone;
    const side = clamp(w * 0.06, 1, 6);
    const tagW = w - side * 2;
    const tagH = h - keyZone;
    const cham = Math.min(tagW, tagH) * 0.2;
    const holeR = clamp(min * 0.035, 0.7, 2.2);
    const foot = clamp(tagH * 0.24, 4, 14);
    const pad = clamp(min * 0.045, 1.2, 4);

    const L = (-tagW / 2) * pxPerMm;
    const T = tagTop * pxPerMm;
    const R = (tagW / 2) * pxPerMm;
    const B = hh;
    const c = cham * pxPerMm;

    // Furos em sentido anti-horário: com winding nonzero eles perfuram o papel
    // sem cancelar a chave, que se sobrepõe à etiqueta pelo cordão.
    const paper = new Path2D();
    paper.moveTo(L, T + c);
    paper.lineTo(L + c, T);
    paper.lineTo(R - c, T);
    paper.lineTo(R, T + c);
    paper.lineTo(R, B - pxPerMm * 0.8);
    paper.arcTo(R, B, R - pxPerMm * 0.8, B, pxPerMm * 0.8);
    paper.lineTo(L + pxPerMm * 0.8, B);
    paper.arcTo(L, B, L, B - pxPerMm * 0.8, pxPerMm * 0.8);
    paper.closePath();

    const holeY = T + Math.max(c * 0.75, holeR * pxPerMm * 2.1);
    paper.moveTo(holeR * pxPerMm, holeY);
    paper.arc(0, holeY, holeR * pxPerMm, 0, TAU, true);

    // Chave: aro furado, haste e palhetão dentado, tudo girado por semente
    const ang = range(rng, -22, -8) * DEG;
    const bowR = clamp(keyZone * 0.3, 1.6, 7) * pxPerMm;
    const bladeL = Math.min(hw * 1.5, bowR * 6.4);
    const bx = -bladeL * 0.35;
    const by = -hh + Math.max(bowR * 1.15, keyZone * pxPerMm * 0.42);
    const sin = Math.sin(ang);
    const cos = Math.cos(ang);
    const P = (x, y) => [bx + x * cos - y * sin, by + x * sin + y * cos];

    const key = new Path2D();
    key.moveTo(...P(bowR, 0));
    for (let i = 1; i <= 48; i++) {
      const a = (i / 48) * TAU;
      key.lineTo(...P(Math.cos(a) * bowR, Math.sin(a) * bowR));
    }
    key.closePath();
    const inner = bowR * 0.44;
    key.moveTo(...P(inner, 0));
    for (let i = 1; i <= 32; i++) {
      const a = -(i / 32) * TAU;
      key.lineTo(...P(Math.cos(a) * inner, Math.sin(a) * inner));
    }
    key.closePath();

    const sh = bowR * 0.3;
    const blade = new Path2D();
    blade.moveTo(...P(bowR * 0.6, -sh));
    blade.lineTo(...P(bladeL, -sh));
    blade.lineTo(...P(bladeL, sh * 2.4));
    blade.lineTo(...P(bladeL * 0.9, sh * 2.4));
    blade.lineTo(...P(bladeL * 0.9, sh));
    blade.lineTo(...P(bladeL * 0.78, sh));
    blade.lineTo(...P(bladeL * 0.78, sh * 2.1));
    blade.lineTo(...P(bladeL * 0.66, sh * 2.1));
    blade.lineTo(...P(bladeL * 0.66, sh));
    blade.lineTo(...P(bowR * 0.6, sh));
    blade.closePath();

    const metal = new Path2D();
    metal.addPath(key);
    metal.addPath(blade);
    paper.addPath(metal);

    const box = {
      x: L + pad * pxPerMm,
      y: holeY + holeR * pxPerMm * 1.9,
      w: (tagW - pad * 2) * pxPerMm,
      h: 0,
    };
    box.h = B - foot * pxPerMm - box.y;

    return {
      paper,
      photo: rectPath(box),
      photoBox: box,
      metal,
      anchor: { x: 0, y: holeY, r: holeR * pxPerMm, bow: P(0, 0) },
      decorate(ctx, info) {
        const { px, hair, font } = tools(ctx, info.pxPerMm);
        const rr = makeRng(info.seed ^ 0x77c2);

        ctx.save();
        ctx.lineCap = 'round';

        // Cordão passando do furo até o aro
        const [kx, ky] = P(0, 0);
        ctx.strokeStyle = 'rgba(122,104,78,0.85)';
        ctx.lineWidth = hair(0.42);
        ctx.beginPath();
        ctx.moveTo(0, holeY);
        ctx.quadraticCurveTo((kx - hw * 0.2) * 0.6, (holeY + ky) / 2 + px(1.2), kx, ky);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,250,238,0.35)';
        ctx.lineWidth = hair(0.16);
        ctx.stroke();

        // Metal da chave
        const g = ctx.createLinearGradient(0, ky - bowR, 0, ky + bowR * 2);
        g.addColorStop(0, '#d8dbdf');
        g.addColorStop(0.45, '#a2a8ae');
        g.addColorStop(1, '#7d848b');
        ctx.fillStyle = g;
        ctx.fill(metal);
        ctx.strokeStyle = 'rgba(48,54,60,0.55)';
        ctx.lineWidth = hair(0.16);
        ctx.stroke(metal);

        // Ilhós
        ctx.strokeStyle = 'rgba(120,126,132,0.9)';
        ctx.lineWidth = hair(0.35);
        ctx.beginPath();
        ctx.arc(0, holeY, holeR * info.pxPerMm * 1.35, 0, TAU);
        ctx.stroke();

        // Escrito na etiqueta
        const titleMm = clamp(foot * 0.4, MIN_TEXT_MM, 5);
        const maxW = box.w;
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'rgba(70,58,42,0.35)';
        ctx.lineWidth = hair(0.16);
        ctx.beginPath();
        ctx.moveTo(box.x, B - px(foot * 0.92));
        ctx.lineTo(box.x + box.w, B - px(foot * 0.92));
        ctx.stroke();

        ctx.fillStyle = 'rgba(46,38,28,0.92)';
        font(titleMm, SERIF, 600);
        ctx.textBaseline = 'alphabetic';
        write(ctx, pick(rr, ['casa nova', 'lar doce lar', 'minha casa', 'apê novo']), 0, B - px(foot * 0.4), maxW);
        font(clamp(foot * 0.2, MIN_TEXT_MM, 2.2), MONO, 500);
        ctx.fillStyle = 'rgba(70,58,42,0.72)';
        tracked(ctx, `2 VIAS · ${Math.floor(range(rr, 2027, 2031))}`, 0, B - px(foot * 0.12), px(0.25), maxW);
        ctx.restore();
      },
    };
  },
};

/* ---------------------------------------------------------- placa de imóvel */

const vendido = {
  id: 'v-vendido',
  label: 'Placa de vendido',
  build({ w, h, pxPerMm, seed }) {
    const hw = (w / 2) * pxPerMm;
    const hh = (h / 2) * pxPerMm;
    const min = Math.min(w, h);
    const [legs, head, foot] = bands(h, [
      clamp(h * 0.14, 4, 20),
      clamp(h * 0.11, 3.5, 12),
      clamp(h * 0.09, 3, 10),
    ], 0.4);

    const boardH = h - legs;
    const boardBottom = h / 2 - legs;
    const side = clamp(w * 0.05, 1.2, 5);
    const legW = clamp(w * 0.055, 1.2, 6);

    const paper = roundedRect(-hw, -hh, hw * 2, boardH * pxPerMm, pxPerMm * 0.7);
    for (const s of [-1, 1]) {
      paper.addPath(
        roundedRect((s * w * 0.26 - legW / 2) * pxPerMm, boardBottom * pxPerMm - pxPerMm * 0.5, legW * pxPerMm, (legs + 0.5) * pxPerMm, pxPerMm * 0.3)
      );
    }

    const box = {
      x: (-w / 2 + side) * pxPerMm,
      y: (-h / 2 + head) * pxPerMm,
      w: (w - side * 2) * pxPerMm,
      h: (boardH - head - foot) * pxPerMm,
    };

    return {
      paper,
      photo: rectPath(box),
      photoBox: box,
      decorate(ctx, info) {
        const { px, hair, font } = tools(ctx, info.pxPerMm);
        const rng = makeRng(seed ^ 0x5cd10a);
        const board = roundedRect(-hw, -hh, hw * 2, boardH * pxPerMm, px(0.7));

        ctx.save();
        ctx.clip(board);

        // Tarja da imobiliária
        ctx.fillStyle = '#27343d';
        ctx.fillRect(-hw, -hh, hw * 2, px(head));
        ctx.fillStyle = 'rgba(250,246,238,0.95)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        font(clamp(head * 0.4, MIN_TEXT_MM, 3.4), SANS, 700);
        tracked(ctx, 'CASA PRÓPRIA', 0, -hh + px(head / 2), px(clamp(head * 0.1, 0.2, 0.8)), hw * 1.7);

        // Rodapé
        const fy = boardBottom * pxPerMm - px(foot);
        ctx.fillStyle = 'rgba(30,38,45,0.08)';
        ctx.fillRect(-hw, fy, hw * 2, px(foot));
        ctx.fillStyle = 'rgba(39,52,61,0.9)';
        font(clamp(foot * 0.38, MIN_TEXT_MM, 3), MONO, 600);
        write(ctx, '(11) 9 8888-0000', 0, fy + px(foot / 2), hw * 1.8);

        // Faixa de vendido, levemente torta como uma etiqueta colada depois
        const bandH = clamp(boardH * 0.19, 4, 15);
        const tilt = range(rng, -7, -3) * DEG;
        ctx.save();
        ctx.translate(0, box.y + box.h * range(rng, 0.52, 0.66));
        ctx.rotate(tilt);
        const bw = hw * 2.02;
        ctx.fillStyle = '#b3261e';
        ctx.shadowColor = 'rgba(30,20,14,0.35)';
        ctx.shadowBlur = px(0.8);
        ctx.shadowOffsetY = px(0.35);
        ctx.fillRect(-bw / 2, -px(bandH) / 2, bw, px(bandH));
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = 'rgba(255,248,240,0.75)';
        ctx.lineWidth = hair(0.22);
        ctx.strokeRect(-bw / 2 + px(0.7), -px(bandH) / 2 + px(0.7), bw - px(1.4), px(bandH) - px(1.4));
        ctx.fillStyle = '#fff8f0';
        font(clamp(bandH * 0.52, MIN_TEXT_MM, 6.5), SANS, 800);
        tracked(ctx, 'VENDIDO', 0, 0, px(clamp(bandH * 0.16, 0.3, 1.6)), hw * 1.7);
        ctx.restore();

        // Parafusos
        ctx.fillStyle = 'rgba(60,70,78,0.55)';
        const sr = px(clamp(min * 0.014, 0.35, 1.1));
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(sx * (hw - px(side * 0.6)), sy === -1 ? -hh + px(head * 0.5) : fy + px(foot * 0.5), sr, 0, TAU);
            ctx.fill();
          }
        }
        ctx.restore();

        // Estacas
        ctx.save();
        ctx.fillStyle = 'rgba(122,110,94,0.5)';
        for (const s of [-1, 1]) {
          ctx.fillRect((s * w * 0.26 - legW / 2) * info.pxPerMm, boardBottom * info.pxPerMm, legW * info.pxPerMm, legs * info.pxPerMm);
        }
        ctx.restore();
      },
    };
  },
};

/* ----------------------------------------------------------- ficha de treino */

const EXERCICIOS = ['AGACHAMENTO', 'SUPINO RETO', 'REMADA', 'LEVANTAMENTO', 'PRANCHA', 'AFUNDO'];
const SERIES = ['4×12', '3×10', '4×08', '3×15', '5×05'];

const treino = {
  id: 'v-treino',
  label: 'Ficha de treino',
  build({ w, h, pxPerMm, seed }) {
    const hw = (w / 2) * pxPerMm;
    const hh = (h / 2) * pxPerMm;
    const min = Math.min(w, h);
    const pad = clamp(min * 0.05, 1.2, 4.5);
    const [head, panel] = bands(h, [clamp(h * 0.11, 4, 13), clamp(h * 0.4, 11, 62)], 0.32);

    const box = {
      x: (-w / 2 + pad) * pxPerMm,
      y: (-h / 2 + head) * pxPerMm,
      w: (w - pad * 2) * pxPerMm,
      h: (h - head - panel) * pxPerMm,
    };

    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, pxPerMm * clamp(min * 0.02, 0.6, 2.4)),
      photo: rectPath(box),
      photoBox: box,
      decorate(ctx, info) {
        const { px, hair, font } = tools(ctx, info.pxPerMm);
        const rng = makeRng(seed ^ 0x4e91b3);
        const top = hh - px(panel);
        const left = -hw + px(pad);
        const right = hw - px(pad);
        const body = clamp(min * 0.042, MIN_TEXT_MM, 2.9);

        ctx.save();

        // Cabeçalho
        ctx.fillStyle = '#22292e';
        ctx.fillRect(-hw, -hh, hw * 2, px(head));
        ctx.fillStyle = '#f6f2ea';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        font(clamp(head * 0.42, MIN_TEXT_MM, 3.6), SANS, 700);
        write(ctx, `TREINO ${pick(rng, ['A', 'B', 'C'])}`, left, -hh + px(head / 2), hw * 0.9);
        ctx.textAlign = 'right';
        font(clamp(head * 0.3, MIN_TEXT_MM, 2.4), MONO, 500);
        ctx.fillStyle = 'rgba(246,242,234,0.7)';
        write(ctx, 'SEG · QUA · SEX', right, -hh + px(head / 2), hw * 0.8);

        // Quadriculado só no painel — sobre a foto viraria sujeira
        ctx.save();
        ctx.beginPath();
        ctx.rect(-hw, top, hw * 2, px(panel));
        ctx.clip();
        const cell = px(clamp(min * 0.055, 2.4, 5));
        ctx.strokeStyle = 'rgba(96,132,172,0.24)';
        ctx.lineWidth = hair(0.12);
        ctx.beginPath();
        for (let x = -hw; x <= hw; x += cell) {
          ctx.moveTo(x, top);
          ctx.lineTo(x, hh);
        }
        for (let y = top; y <= hh; y += cell) {
          ctx.moveTo(-hw, y);
          ctx.lineTo(hw, y);
        }
        ctx.stroke();
        ctx.restore();

        // Tabela
        const rowH = clamp(px(panel) / 5, px(2.4), px(7));
        const rows = clamp(Math.floor((px(panel) - px(pad)) / rowH) - 1, 2, 4);
        const colName = left + (right - left) * 0.54;
        const colSet = left + (right - left) * 0.76;
        const ink = 'rgba(34,41,46,0.88)';

        ctx.fillStyle = 'rgba(34,41,46,0.09)';
        ctx.fillRect(left, top + px(pad * 0.5), right - left, rowH);
        ctx.strokeStyle = 'rgba(34,41,46,0.4)';
        ctx.lineWidth = hair(0.18);
        ctx.beginPath();
        for (let i = 0; i <= rows + 1; i++) {
          const y = top + px(pad * 0.5) + rowH * i;
          if (y > hh) break;
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
        }
        const bottom = Math.min(hh, top + px(pad * 0.5) + rowH * (rows + 1));
        for (const x of [colName, colSet]) {
          ctx.moveTo(x, top + px(pad * 0.5));
          ctx.lineTo(x, bottom);
        }
        ctx.stroke();

        ctx.fillStyle = ink;
        ctx.textAlign = 'left';
        font(body * 0.86, SANS, 700);
        const midY = (i) => top + px(pad * 0.5) + rowH * (i + 0.5);
        write(ctx, 'EXERCÍCIO', left + px(0.7), midY(0), colName - left - px(1.4));
        write(ctx, 'SÉRIES', colName + px(0.7), midY(0), colSet - colName - px(1.4));
        write(ctx, 'CARGA', colSet + px(0.7), midY(0), right - colSet - px(1.4));

        const usados = new Set();
        for (let r = 1; r <= rows; r++) {
          if (midY(r) > hh - px(0.5)) break;
          let nome = pick(rng, EXERCICIOS);
          while (usados.has(nome)) nome = EXERCICIOS[(EXERCICIOS.indexOf(nome) + 1) % EXERCICIOS.length];
          usados.add(nome);
          font(body, SANS, 500);
          ctx.fillStyle = ink;
          write(ctx, nome, left + px(0.7), midY(r), colName - left - px(1.4));
          font(body, MONO, 500);
          write(ctx, pick(rng, SERIES), colName + px(0.7), midY(r), colSet - colName - px(1.4));
          write(ctx, `${Math.round(range(rng, 8, 42))} kg`, colSet + px(0.7), midY(r), right - colSet - px(1.4));

          // Risco de caneta em cima do que já foi feito
          if (rng() > 0.45) {
            ctx.save();
            ctx.strokeStyle = 'rgba(38,74,158,0.75)';
            ctx.lineWidth = hair(0.3);
            ctx.lineCap = 'round';
            const y = midY(r);
            const x0 = right - px(2.6);
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x0 + px(0.7), y + px(0.8));
            ctx.lineTo(x0 + px(2), y - px(1.1));
            ctx.stroke();
            ctx.restore();
          }
        }
        ctx.restore();
      },
    };
  },
};

/* ---------------------------------------------------------- ficha de receita */

const RECEITAS = ['Bolo de fubá', 'Pão de queijo', 'Sopa de domingo', 'Café da manhã'];
const INGREDIENTES = [
  ['2 xíc. de fubá', '1 xíc. de leite', '3 ovos', 'forno 180°'],
  ['500 g de polvilho', '200 g de queijo', '1 xíc. de leite', '2 ovos'],
  ['1 kg de legumes', '2 l de caldo', 'sal e alecrim', 'fogo baixo'],
  ['pão na chapa', 'café coado', 'ovos mexidos', 'sem pressa'],
];

const receita = {
  id: 'v-receita',
  label: 'Ficha de receita',
  build({ w, h, pxPerMm, seed }) {
    const hw = (w / 2) * pxPerMm;
    const hh = (h / 2) * pxPerMm;
    const min = Math.min(w, h);
    const pad = clamp(min * 0.055, 1.4, 5);
    const [head, notes] = bands(h, [clamp(h * 0.15, 5, 17), clamp(h * 0.34, 9, 52)], 0.3);
    const marginX = pad + clamp(w * 0.035, 1, 4);

    const box = {
      x: (-w / 2 + marginX) * pxPerMm,
      y: (-h / 2 + head) * pxPerMm,
      w: (w - marginX - pad) * pxPerMm,
      h: (h - head - notes) * pxPerMm,
    };

    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, pxPerMm * clamp(min * 0.015, 0.5, 1.6)),
      photo: rectPath(box),
      photoBox: box,
      decorate(ctx, info) {
        const { px, hair, font } = tools(ctx, info.pxPerMm);
        const rng = makeRng(seed ^ 0x2ac8f1);
        const idx = Math.floor(rng() * RECEITAS.length) % RECEITAS.length;
        const red = 'rgba(178,58,48,0.8)';
        const blue = 'rgba(104,140,178,0.55)';

        ctx.save();
        ctx.clip(roundedRect(-hw, -hh, hw * 2, hh * 2, px(1)));

        // Margem vermelha da ficha pautada
        ctx.strokeStyle = red;
        ctx.lineWidth = hair(0.22);
        ctx.beginPath();
        ctx.moveTo(-hw + px(marginX * 0.55), -hh);
        ctx.lineTo(-hw + px(marginX * 0.55), hh);
        ctx.stroke();

        // Cabeçalho
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(150,120,92,0.85)';
        font(clamp(head * 0.2, MIN_TEXT_MM, 2.2), MONO, 600);
        const x0 = -hw + px(marginX);
        const w0 = hw * 2 - px(marginX + pad);
        tracked(ctx, 'RECEITA DA CASA', x0 + w0 / 2, -hh + px(head * 0.32), px(0.3), w0);
        ctx.fillStyle = 'rgba(52,40,32,0.92)';
        font(clamp(head * 0.4, MIN_TEXT_MM, 5), SERIF, 600);
        ctx.textAlign = 'center';
        write(ctx, RECEITAS[idx], x0 + w0 / 2, -hh + px(head * 0.78), w0);
        ctx.strokeStyle = red;
        ctx.lineWidth = hair(0.3);
        ctx.beginPath();
        ctx.moveTo(x0, -hh + px(head * 0.92));
        ctx.lineTo(x0 + w0, -hh + px(head * 0.92));
        ctx.stroke();

        // Pauta e ingredientes
        const step = px(clamp(min * 0.06, 2.4, 5.4));
        const first = box.y + box.h + step * 0.9;
        const lista = INGREDIENTES[idx];
        ctx.lineWidth = hair(0.15);
        ctx.textAlign = 'left';
        let n = 0;
        for (let y = first; y < hh - px(pad * 0.4); y += step, n++) {
          ctx.strokeStyle = blue;
          ctx.beginPath();
          ctx.moveTo(-hw + px(marginX * 0.55), y);
          ctx.lineTo(hw - px(pad), y);
          ctx.stroke();
          if (n < lista.length) {
            ctx.fillStyle = 'rgba(52,44,36,0.85)';
            font(clamp(step / info.pxPerMm * 0.46, MIN_TEXT_MM, 2.8), SANS, 400);
            write(ctx, `— ${lista[n]}`, x0, y - px(0.5), w0 * 0.95);
          }
        }

        // Rodapé técnico e mancha de café
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(150,120,92,0.9)';
        font(clamp(head * 0.18, MIN_TEXT_MM, 2.1), MONO, 500);
        write(ctx, `${Math.round(range(rng, 20, 60))} MIN · RENDE ${Math.round(range(rng, 2, 9))}`, hw - px(pad), -hh + px(head * 0.32), w0 * 0.6);

        const cr = px(clamp(min * 0.11, 3, 11));
        ctx.strokeStyle = 'rgba(148,104,62,0.22)';
        ctx.lineWidth = hair(0.7);
        ctx.beginPath();
        ctx.arc(hw - px(pad) - cr * range(rng, 0.2, 0.8), hh - px(pad) - cr * range(rng, 0.1, 0.6), cr, 0, TAU);
        ctx.stroke();
        ctx.restore();
      },
    };
  },
};

/* ------------------------------------------------------------ mapa de hábitos */

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const DIAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const habitos = {
  id: 'v-habitos',
  label: 'Mapa de hábitos',
  build({ w, h, pxPerMm, seed }) {
    const hw = (w / 2) * pxPerMm;
    const hh = (h / 2) * pxPerMm;
    const min = Math.min(w, h);
    const pad = clamp(min * 0.05, 1.2, 4.5);
    const [head, grid] = bands(h, [clamp(h * 0.12, 4.5, 14), clamp(h * 0.42, 12, 66)], 0.3);

    const box = {
      x: (-w / 2 + pad) * pxPerMm,
      y: (-h / 2 + head) * pxPerMm,
      w: (w - pad * 2) * pxPerMm,
      h: (h - head - grid) * pxPerMm,
    };

    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, pxPerMm * clamp(min * 0.02, 0.6, 2.6)),
      photo: rectPath(box),
      photoBox: box,
      decorate(ctx, info) {
        const { px, hair, font } = tools(ctx, info.pxPerMm);
        const rng = makeRng(seed ^ 0x6b0d24);
        const mes = MESES[Math.floor(rng() * 12) % 12];
        const ano = 2026 + Math.floor(rng() * 3);
        const accent = '#c2683a';
        const ink = 'rgba(46,40,34,0.9)';

        ctx.save();
        ctx.textBaseline = 'middle';

        // Título
        ctx.fillStyle = ink;
        ctx.textAlign = 'left';
        font(clamp(head * 0.42, MIN_TEXT_MM, 4.4), SERIF, 600);
        write(ctx, mes, -hw + px(pad), -hh + px(head * 0.5), hw * 1.3);
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(46,40,34,0.55)';
        font(clamp(head * 0.28, MIN_TEXT_MM, 2.6), MONO, 500);
        write(ctx, String(ano), hw - px(pad), -hh + px(head * 0.5), hw * 0.7);
        ctx.strokeStyle = 'rgba(46,40,34,0.25)';
        ctx.lineWidth = hair(0.2);
        ctx.beginPath();
        ctx.moveTo(-hw + px(pad), -hh + px(head * 0.86));
        ctx.lineTo(hw - px(pad), -hh + px(head * 0.86));
        ctx.stroke();

        // Grade de dias
        const top = hh - px(grid) + px(pad * 0.4);
        const availW = hw * 2 - px(pad * 2);
        const availH = hh - px(pad * 0.6) - top;
        const colW = availW / 7;
        const headerH = Math.min(availH * 0.22, colW * 0.8);
        const rows = clamp(Math.floor((availH - headerH) / (colW * 0.92)), 2, 5);
        const rowH = (availH - headerH) / rows;
        const size = Math.min(colW, rowH) * 0.72;
        const left = -hw + px(pad);

        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(46,40,34,0.5)';
        font(clamp(headerH / info.pxPerMm * 0.62, MIN_TEXT_MM, 2.6), SANS, 600);
        for (let c = 0; c < 7; c++) {
          write(ctx, DIAS[c], left + colW * (c + 0.5), top + headerH * 0.5, colW * 0.9);
        }

        // Sequência: os primeiros dias saem cheios, depois falha de vez em quando
        const streak = Math.floor(range(rng, 6, rows * 7 - 4));
        let done = 0;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < 7; c++) {
            const i = r * 7 + c;
            const cx = left + colW * (c + 0.5);
            const cy = top + headerH + rowH * (r + 0.5);
            const cell = roundedRect(cx - size / 2, cy - size / 2, size, size, size * 0.26);
            const filled = i < streak && (i < 5 || rng() > 0.22);
            if (filled) {
              done++;
              ctx.fillStyle = accent;
              ctx.fill(cell);
              ctx.strokeStyle = 'rgba(255,252,246,0.9)';
              ctx.lineWidth = Math.max(0.4, size * 0.1);
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.beginPath();
              ctx.moveTo(cx - size * 0.2, cy);
              ctx.lineTo(cx - size * 0.04, cy + size * 0.17);
              ctx.lineTo(cx + size * 0.22, cy - size * 0.18);
              ctx.stroke();
            } else {
              ctx.strokeStyle = i < streak ? 'rgba(194,104,58,0.45)' : 'rgba(46,40,34,0.24)';
              ctx.lineWidth = hair(0.16);
              ctx.stroke(cell);
            }
          }
        }

        // Contador, se sobrar faixa embaixo da grade
        const restH = hh - px(pad * 0.4) - (top + headerH + rowH * rows);
        if (restH > px(2.2)) {
          ctx.fillStyle = accent;
          font(clamp(restH / info.pxPerMm * 0.62, MIN_TEXT_MM, 2.8), SANS, 700);
          write(ctx, `${done} dias seguidos`, 0, top + headerH + rowH * rows + restH * 0.5, availW * 0.9);
        }
        ctx.restore();
      },
    };
  },
};

/* ------------------------------------------------------------------ azulejo */

const azulejo = {
  id: 'v-azulejo',
  label: 'Azulejo',
  build({ w, h, pxPerMm, seed }) {
    const hw = (w / 2) * pxPerMm;
    const hh = (h / 2) * pxPerMm;
    const min = Math.min(w, h);
    const band = clamp(min * 0.15, 2.6, 16) * pxPerMm;

    const box = { x: -hw + band, y: -hh + band, w: hw * 2 - band * 2, h: hh * 2 - band * 2 };
    const cham = Math.min(box.w, box.h) * 0.22;
    const oct = new Path2D();
    oct.moveTo(box.x + cham, box.y);
    oct.lineTo(box.x + box.w - cham, box.y);
    oct.lineTo(box.x + box.w, box.y + cham);
    oct.lineTo(box.x + box.w, box.y + box.h - cham);
    oct.lineTo(box.x + box.w - cham, box.y + box.h);
    oct.lineTo(box.x + cham, box.y + box.h);
    oct.lineTo(box.x, box.y + box.h - cham);
    oct.lineTo(box.x, box.y + cham);
    oct.closePath();

    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, pxPerMm * 0.6),
      photo: oct,
      photoBox: box,
      decorate(ctx, info) {
        const { px, hair } = tools(ctx, info.pxPerMm);
        const rng = makeRng(seed ^ 0x1d77a4);
        const blue = '#2b4f8e';
        const inset = band * 0.28;

        ctx.save();
        ctx.clip(roundedRect(-hw, -hh, hw * 2, hh * 2, px(0.6)));

        // Filete duplo da borda
        ctx.strokeStyle = blue;
        ctx.lineWidth = hair(0.5);
        ctx.strokeRect(-hw + inset, -hh + inset, hw * 2 - inset * 2, hh * 2 - inset * 2);
        ctx.lineWidth = hair(0.18);
        ctx.strokeRect(-hw + inset * 1.9, -hh + inset * 1.9, hw * 2 - inset * 3.8, hh * 2 - inset * 3.8);

        // Meias-luas correndo pelas quatro faixas
        const r = band * 0.24;
        const runX = hw * 2 - inset * 3.8;
        const runY = hh * 2 - inset * 3.8;
        ctx.strokeStyle = 'rgba(43,79,142,0.72)';
        ctx.lineWidth = hair(0.2);
        const arcRow = (n, from, step, ax, ay, a0) => {
          for (let i = 0; i < n; i++) {
            const at = step * (i + 0.5);
            ctx.beginPath();
            ctx.arc(from[0] + ax * at, from[1] + ay * at, r, a0, a0 + Math.PI);
            ctx.stroke();
          }
        };
        const nx = Math.max(2, Math.round(runX / (r * 2.2)));
        const ny = Math.max(2, Math.round(runY / (r * 2.2)));
        const ix = -hw + inset * 1.9;
        const iy = -hh + inset * 1.9;
        arcRow(nx, [ix, iy], runX / nx, 1, 0, 0);
        arcRow(nx, [ix, iy + runY], runX / nx, 1, 0, Math.PI);
        arcRow(ny, [ix, iy], runY / ny, 0, 1, -Math.PI / 2);
        arcRow(ny, [ix + runX, iy], runY / ny, 0, 1, Math.PI / 2);

        // Fleurões nos cantos
        const f = band * 0.5;
        ctx.lineWidth = hair(0.3);
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            const cx = sx * (hw - inset * 1.9);
            const cy = sy * (hh - inset * 1.9);
            for (const k of [0.45, 0.75]) {
              ctx.beginPath();
              ctx.arc(cx, cy, f * k, 0, TAU);
              ctx.stroke();
            }
            ctx.fillStyle = blue;
            ctx.beginPath();
            ctx.arc(cx, cy, f * 0.18, 0, TAU);
            ctx.fill();
          }
        }

        // Contorno do recorte e um brilho de esmalte fora de centro
        ctx.strokeStyle = 'rgba(24,44,84,0.85)';
        ctx.lineWidth = hair(0.35);
        ctx.stroke(oct);

        const gx = range(rng, -0.3, 0.3);
        const g = ctx.createRadialGradient(hw * gx, -hh * 0.5, 0, hw * gx, -hh * 0.5, Math.max(hw, hh) * 1.5);
        g.addColorStop(0, 'rgba(255,255,255,0.22)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
        ctx.restore();
      },
    };
  },
};

export const HOME = {
  id: 'vida',
  label: 'Casa e corpo',
  styles: [planta, chave, vendido, treino, receita, habitos, azulejo],
};
