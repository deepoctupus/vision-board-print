/**
 * Viagem — cartão de embarque, selo, carimbo, mapa dobrado. Objetos que picotam,
 * carimbam e dobram: a foto foi impressa sobre eles, não colada por cima. Toda
 * medida nasce em milímetros e só vira pixel na multiplicação por `pxPerMm`.
 */

import { makeRng, range, pick } from '../../core/rng.js';
import { roundedRect } from '../shapes.js';
import { inkArc, inkField, inkHeight, inkLine, inkWords } from './ink.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Abaixo disto a marca vira sujeira numa prévia a 26% e não paga o que custa. */
const MIN_TEXT_MM = 1.6;

/** Tinta de carimbo é tinta de verdade, não a cor do papel escurecida. */
const TINTAS = ['#2f4d72', '#3a6350', '#6b3350', '#7a4726', '#3c4a7c'];

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

function withAlpha(hex, alpha) {
  const [r, g, b] = parseHex(hex);
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

function dot(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
}

function star(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * TAU;
    const rad = i % 2 ? r * 0.44 : r;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Código de barras determinístico. A quantidade de barras nasce da largura em
 * milímetros, nunca em pixels: se viesse do pixel, a prévia imprimiria um borrão
 * e a chapa a 300 dpi um código de verdade — duas peças diferentes.
 */
function barcode(ctx, x, y, w, h, pxPerMm, rng, color) {
  if (!(w > 0) || !(h > 0)) return;
  const bars = Math.round(clamp(w / pxPerMm / 0.55, 6, 22));
  const widths = [];
  let total = 0;
  for (let i = 0; i < bars; i++) {
    const bw = 1 + Math.floor(rng() * 2.6);
    widths.push(bw);
    total += bw + 1;
  }
  const unit = w / total;
  ctx.fillStyle = color;
  let at = x;
  for (const bw of widths) {
    ctx.fillRect(at, y, Math.max(0.35, bw * unit), h);
    at += (bw + 1) * unit;
  }
}

/** Aviãozinho: confiar num dingbat da fonte é loteria, um path não é. */
const PLANE = [
  [1, 0], [0.15, -0.16], [-0.35, -0.62], [-0.55, -0.62], [-0.18, -0.13],
  [-0.68, -0.13], [-0.85, -0.36], [-0.95, -0.36], [-0.88, -0.05], [-1, 0],
];

function planePath(cx, cy, s) {
  const p = new Path2D();
  const half = PLANE.slice(1, -1).reverse().map(([x, y]) => [x, -y]);
  const pts = [...PLANE, ...half];
  pts.forEach(([x, y], i) => {
    const px = cx + x * s;
    const py = cy + y * s;
    if (i) p.lineTo(px, py);
    else p.moveTo(px, py);
  });
  p.closePath();
  return p;
}

/* --------------------------------------------------------------- marcas --- */

/**
 * Onde ia uma linha impressa fica a marca dela, com a mesma altura e no mesmo
 * lugar. O recorte não sabe o código do aeroporto, o nome do país nem a data da
 * viagem de quem usa — então não escreve nenhum deles.
 *
 * `maxW` continua sendo o espaço reservado à linha e a marca ocupa uma fração
 * dele, como texto de verdade ocuparia. Devolve a largura desenhada, porque há
 * filete e coração que se posicionam pela ponta da linha.
 */
function markLine(ctx, cx, y, maxW, sizeMm, pxPerMm, { align = 'center', fill = 0.66, parts = 0 } = {}) {
  if (sizeMm < MIN_TEXT_MM || !(maxW > 0)) return 0;
  return inkWords(ctx, cx, y, maxW * fill, inkHeight(sizeMm, pxPerMm), align, parts);
}

/** A mesma marca, seguindo um arco: o anel do carimbo, a borda da etiqueta. */
function markArc(ctx, rx, ry, a0, a1, sizeMm, pxPerMm, parts = 3, fill = 0.78) {
  if (sizeMm < MIN_TEXT_MM) return false;
  inkArc(ctx, rx, ry, a0, a1, inkHeight(sizeMm, pxPerMm), parts, fill);
  return true;
}

function ellipsePath(rx, ry) {
  const p = new Path2D();
  p.ellipse(0, 0, rx, ry, 0, 0, TAU);
  return p;
}

function circlePath(r) {
  const p = new Path2D();
  p.arc(0, 0, r, 0, TAU);
  return p;
}

/* ---------------------------------------------------------- silhuetas ----- */

/**
 * Picote do selo. Os furos mordem para dentro, então a silhueta inteira continua
 * dentro do retângulo da célula sem precisar de recuo.
 */
function perforatedRect(hw, hh, r) {
  const cols = Math.max(2, Math.round((hw * 2) / (r * 2.7)));
  const rows = Math.max(2, Math.round((hh * 2) / (r * 2.7)));
  const stepX = (hw * 2) / cols;
  const stepY = (hh * 2) / rows;
  const rad = Math.min(r, stepX * 0.44, stepY * 0.44);

  const p = new Path2D();
  p.moveTo(-hw, -hh);
  for (let i = 0; i < cols; i++) {
    const cx = -hw + stepX * (i + 0.5);
    p.lineTo(cx - rad, -hh);
    p.arc(cx, -hh, rad, Math.PI, 0, true);
  }
  p.lineTo(hw, -hh);
  for (let i = 0; i < rows; i++) {
    const cy = -hh + stepY * (i + 0.5);
    p.lineTo(hw, cy - rad);
    p.arc(hw, cy, rad, -Math.PI / 2, Math.PI / 2, true);
  }
  p.lineTo(hw, hh);
  for (let i = 0; i < cols; i++) {
    const cx = hw - stepX * (i + 0.5);
    p.lineTo(cx + rad, hh);
    p.arc(cx, hh, rad, 0, Math.PI, true);
  }
  p.lineTo(-hw, hh);
  for (let i = 0; i < rows; i++) {
    const cy = hh - stepY * (i + 0.5);
    p.lineTo(-hw, cy + rad);
    p.arc(-hw, cy, rad, Math.PI / 2, -Math.PI / 2, true);
  }
  p.closePath();
  return p;
}

/** Cartão com talão: as duas meias-luas na linha do picote é que contam a história. */
function passPaper(hw, hh, cut, notch, corner, alongX) {
  const p = new Path2D();
  if (alongX) {
    p.moveTo(-hw + corner, -hh);
    p.lineTo(cut - notch, -hh);
    p.arc(cut, -hh, notch, Math.PI, 0, true);
    p.lineTo(hw - corner, -hh);
    p.arcTo(hw, -hh, hw, -hh + corner, corner);
    p.lineTo(hw, hh - corner);
    p.arcTo(hw, hh, hw - corner, hh, corner);
    p.lineTo(cut + notch, hh);
    p.arc(cut, hh, notch, 0, Math.PI, true);
    p.lineTo(-hw + corner, hh);
    p.arcTo(-hw, hh, -hw, hh - corner, corner);
    p.lineTo(-hw, -hh + corner);
    p.arcTo(-hw, -hh, -hw + corner, -hh, corner);
  } else {
    p.moveTo(-hw + corner, -hh);
    p.lineTo(hw - corner, -hh);
    p.arcTo(hw, -hh, hw, -hh + corner, corner);
    p.lineTo(hw, cut - notch);
    p.arc(hw, cut, notch, -Math.PI / 2, Math.PI / 2, true);
    p.lineTo(hw, hh - corner);
    p.arcTo(hw, hh, hw - corner, hh, corner);
    p.lineTo(-hw + corner, hh);
    p.arcTo(-hw, hh, -hw, hh - corner, corner);
    p.lineTo(-hw, cut + notch);
    p.arc(-hw, cut, notch, Math.PI / 2, -Math.PI / 2, true);
    p.lineTo(-hw, -hh + corner);
    p.arcTo(-hw, -hh, -hw + corner, -hh, corner);
  }
  p.closePath();
  return p;
}

/** Etiqueta de bagagem: ombro chanfrado no topo e o furo do cordão. */
function tagPaper(hw, hh, shoulder, corner, holeY, holeR) {
  const p = new Path2D();
  const topHw = Math.max(corner, hw - shoulder);
  p.moveTo(-topHw, -hh);
  p.lineTo(topHw, -hh);
  p.lineTo(hw, -hh + shoulder);
  p.lineTo(hw, hh - corner);
  p.arcTo(hw, hh, hw - corner, hh, corner);
  p.lineTo(-hw + corner, hh);
  p.arcTo(-hw, hh, -hw, hh - corner, corner);
  p.lineTo(-hw, -hh + shoulder);
  p.closePath();
  p.moveTo(holeR, holeY);
  p.arc(0, holeY, holeR, 0, TAU);
  return p;
}

/* ------------------------------------------------------------ carimbos ---- */

/**
 * Anel de carimbo desenhado em pedaços curtos com alfa sorteado: borracha nunca
 * entrega tinta parelha, e um anel perfeito denuncia o vetor na hora.
 */
function inkRing(ctx, r, widthPx, tinta, rng, alpha = 0.85) {
  const steps = 46;
  ctx.lineWidth = penWidth(widthPx);
  ctx.lineCap = 'butt';
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * TAU;
    const a1 = ((i + 1.06) / steps) * TAU;
    ctx.strokeStyle = withAlpha(tinta, alpha * range(rng, 0.55, 1));
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a1);
    ctx.stroke();
  }
}

function postmark(ctx, cx, cy, r, pxPerMm, tinta, rng) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(range(rng, -14, 14) * (Math.PI / 180));

  inkRing(ctx, r, r * 0.09, tinta, rng, 0.7);
  inkRing(ctx, r * 0.8, r * 0.05, tinta, rng, 0.55);

  ctx.fillStyle = withAlpha(tinta, 0.72);
  markArc(ctx, r * 0.9, r * 0.9, Math.PI, TAU, (r * 0.2) / pxPerMm, pxPerMm, 2);

  ctx.fillStyle = withAlpha(tinta, 0.78);
  markLine(ctx, 0, 0, r * 1.2, (r * 0.3) / pxPerMm, pxPerMm, { parts: 2, fill: 0.72 });

  // Ondas de obliteração: elas é que dizem que o selo já foi usado.
  ctx.strokeStyle = withAlpha(tinta, 0.5);
  ctx.lineWidth = penWidth(r * 0.07);
  ctx.lineCap = 'round';
  // Para os dois lados: o carimbo costuma encostar numa borda, e as ondas de um
  // lado só seriam aparadas junto com ela.
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y = -r * 0.3 + i * r * 0.3;
      ctx.beginPath();
      ctx.moveTo(dir * r * 1.05, y);
      for (let k = 1; k <= 8; k++) {
        const x = dir * (r * 1.05 + (k / 8) * r * 1.9);
        ctx.quadraticCurveTo(x - dir * r * 0.12, y + (k % 2 ? -r * 0.14 : r * 0.14), x, y);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

/* -------------------------------------------------------------- estilos --- */

const embarque = {
  id: 't-embarque',
  label: 'Cartão de embarque',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const minSide = Math.min(w, h);

    // Talão à direita quando há largura; senão ele desce para o pé do cartão.
    const alongX = w >= h * 0.92;
    const stub = clamp((alongX ? w : h) * 0.26, 7, 28);
    const notch = mm(clamp(minSide * 0.05, 0.8, 2.2));
    const corner = mm(clamp(minSide * 0.04, 0.6, 1.8));
    const cut = (alongX ? hw : hh) - mm(stub);

    const paper = passPaper(hw, hh, cut, notch, corner, alongX);

    const pad = mm(clamp(minSide * 0.055, 0.9, 3.2));
    const gap = notch * 0.8;
    const body = alongX
      ? { x0: -hw + pad, y0: -hh + pad, x1: cut - gap, y1: hh - pad }
      : { x0: -hw + pad, y0: -hh + pad, x1: hw - pad, y1: cut - gap };
    const stubBox = alongX
      ? { x0: cut + gap, y0: -hh + pad, x1: hw - pad, y1: hh - pad }
      : { x0: -hw + pad, y0: cut + gap, x1: hw - pad, y1: hh - pad };

    const bodyH = Math.max(mm(1), body.y1 - body.y0);
    const head = Math.min(mm(clamp(h * 0.09, 1.6, 6)), bodyH * 0.2);
    const foot = Math.min(mm(clamp(h * 0.17, 3, 13)), bodyH * 0.34);
    const box = {
      x: body.x0,
      y: body.y0 + head,
      w: Math.max(mm(1), body.x1 - body.x0),
      h: Math.max(mm(1), bodyH - head - foot),
    };

    return {
      paper,
      photo: roundedRect(box.x, box.y, box.w, box.h, 0),
      photoBox: box,
      decorate: (ctx, info) => paintEmbarque(ctx, info, { body, stubBox, box, head, cut, alongX, paper }),
    };
  },
};

function paintEmbarque(ctx, { pxPerMm, tone, seed }, L) {
  const mm = (v) => v * pxPerMm;
  const rng = makeRng((seed ^ 0x4d20b19f) >>> 0);
  const ink = shade(tone, 0.8, 0.92);
  const faint = shade(tone, 0.55, 0.5);

  ctx.save();
  ctx.clip(L.paper);

  // Picote: um tracejado impresso, não furos. É o que separa do ingresso de cinema.
  ctx.save();
  ctx.strokeStyle = shade(tone, 0.5, 0.45);
  ctx.lineWidth = penWidth(mm(0.22));
  ctx.setLineDash([mm(0.9), mm(0.9)]);
  ctx.beginPath();
  if (L.alongX) {
    ctx.moveTo(L.cut, L.body.y0);
    ctx.lineTo(L.cut, L.body.y1);
  } else {
    ctx.moveTo(L.body.x0, L.cut);
    ctx.lineTo(L.body.x1, L.cut);
  }
  ctx.stroke();
  ctx.restore();

  const bodyW = L.body.x1 - L.body.x0;

  // Cabeçalho em negativo: a barra de tinta cheia continua, e o que era o nome da
  // companhia vazado nela vira marca vazada. O cartão segue tendo cabeçalho sem
  // dizer de que companhia é o voo de ninguém.
  const headMm = L.head / pxPerMm;
  if (headMm >= MIN_TEXT_MM * 1.1) {
    ctx.fillStyle = ink;
    ctx.fillRect(L.body.x0, L.body.y0, bodyW, L.head * 0.86);
    ctx.fillStyle = tone;
    const midY = L.body.y0 + L.head * 0.43;
    markLine(ctx, L.body.x0 + mm(1), midY, bodyW * 0.55, clamp(headMm * 0.4, MIN_TEXT_MM, 3), pxPerMm, {
      align: 'left',
      fill: 0.78,
      parts: 2,
    });
    markLine(ctx, L.body.x1 - mm(1), midY, bodyW * 0.42, clamp(headMm * 0.3, MIN_TEXT_MM, 2.2), pxPerMm, {
      align: 'right',
      fill: 0.88,
      parts: 3,
    });
  }

  ctx.strokeStyle = shade(tone, 0.4, 0.4);
  ctx.lineWidth = penWidth(mm(0.16));
  ctx.strokeRect(L.box.x, L.box.y, L.box.w, L.box.h);

  // Rodapé: as duas pontas do voo, o avião entre elas e a linha de campos.
  const footTop = L.box.y + L.box.h;
  const footH = L.body.y1 - footTop;
  const footMm = footH / pxPerMm;
  if (footMm >= MIN_TEXT_MM * 2) {
    const codeMm = clamp(footMm * 0.42, MIN_TEXT_MM, 11);
    const y = footTop + footH * 0.38;
    // O espaço de uma sigla de três letras, agora derivado do corpo: sem texto não
    // há o que medir, mas a folga que ele exigia continua a mesma.
    const cw = mm(codeMm * 1.9);
    if (cw * 2.6 <= bodyW) {
      const codeH = inkHeight(codeMm, pxPerMm);
      ctx.fillStyle = ink;
      inkLine(ctx, L.box.x, y, cw, codeH, 'left');
      inkLine(ctx, L.box.x + L.box.w, y, cw, codeH, 'right');

      const midX = L.box.x + L.box.w / 2;
      const arm = Math.min(bodyW * 0.16, mm(9));
      ctx.strokeStyle = faint;
      ctx.lineWidth = penWidth(mm(0.18));
      ctx.setLineDash([mm(0.7), mm(0.7)]);
      ctx.beginPath();
      ctx.moveTo(midX - arm, y);
      ctx.lineTo(midX + arm, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ink;
      ctx.fill(planePath(midX, y, Math.min(mm(codeMm * 0.42), arm * 0.7)));
    }

    const fieldMm = clamp(footMm * 0.2, 0, 3);
    if (fieldMm >= MIN_TEXT_MM && footMm >= MIN_TEXT_MM * 4) {
      const fy = footTop + footH * 0.86;
      const slot = bodyW / 3;
      // Três campos: é o par rótulo-e-valor repetido que faz o retângulo virar
      // formulário, e ele funciona igual sem que os campos digam o que carregam.
      for (let i = 0; i < 3; i++) {
        inkField(ctx, L.box.x + slot * i, fy, slot * 0.94, inkHeight(fieldMm, pxPerMm), ink, faint);
      }
    }
  }

  // Talão: o que é impresso nele corre no sentido comprido, então gira junto
  // quando o talão desce para o pé do cartão.
  const acrossMm = (L.alongX ? L.stubBox.x1 - L.stubBox.x0 : L.stubBox.y1 - L.stubBox.y0) / pxPerMm;
  const alongMm = (L.alongX ? L.stubBox.y1 - L.stubBox.y0 : L.stubBox.x1 - L.stubBox.x0) / pxPerMm;
  if (acrossMm >= MIN_TEXT_MM * 1.8) {
    ctx.save();
    ctx.translate((L.stubBox.x0 + L.stubBox.x1) / 2, (L.stubBox.y0 + L.stubBox.y1) / 2);
    if (L.alongX) ctx.rotate(-Math.PI / 2);

    const codeMm = clamp(acrossMm * 0.4, MIN_TEXT_MM, 9);
    ctx.fillStyle = ink;
    inkLine(ctx, 0, -mm(acrossMm * 0.24), mm(codeMm * 1.9), inkHeight(codeMm, pxPerMm), 'center');

    const smallMm = clamp(acrossMm * 0.17, 0, 2.6);
    if (smallMm >= MIN_TEXT_MM) {
      ctx.fillStyle = faint;
      markLine(ctx, 0, mm(acrossMm * 0.04), mm(alongMm) * 0.9, smallMm, pxPerMm, { parts: 2, fill: 0.62 });
    }

    const barH = mm(acrossMm * 0.26);
    const barW = Math.min(mm(alongMm) * 0.86, mm(30));
    barcode(ctx, -barW / 2, mm(acrossMm * 0.16), barW, barH, pxPerMm, rng, shade(tone, 0.85, 0.9));
    ctx.restore();
  }

  ctx.restore();
}

const selo = {
  id: 't-selo',
  label: 'Selo postal',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const minSide = Math.min(w, h);

    const holeMm = clamp(minSide * 0.03, 0.45, 1.5);
    const paper = perforatedRect(hw, hh, mm(holeMm));

    const margin = clamp(minSide * 0.13, holeMm + 1.1, 11);
    const bottom = Math.min(margin * 2, h * 0.3);
    const box = {
      x: -hw + mm(margin),
      y: -hh + mm(margin),
      w: Math.max(mm(1), mm(w - margin * 2)),
      h: Math.max(mm(1), mm(h - margin - bottom)),
    };

    return {
      paper,
      photo: roundedRect(box.x, box.y, box.w, box.h, 0),
      photoBox: box,
      decorate: (ctx, info) => paintSelo(ctx, info, { margin, bottom, box }),
    };
  },
};

function paintSelo(ctx, { pxPerMm, tone, w, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hw = mm(w) / 2;
  const hh = mm(h) / 2;
  const ink = shade(tone, 0.78, 0.9);
  const faint = shade(tone, 0.5, 0.45);

  ctx.save();

  const off = mm(0.5);
  ctx.strokeStyle = faint;
  ctx.lineWidth = penWidth(mm(0.18));
  ctx.strokeRect(L.box.x - off, L.box.y - off, L.box.w + off * 2, L.box.h + off * 2);

  // Valor à esquerda, emissor à direita: é esse par desequilibrado no alto que
  // faz o retângulo picotado ler como selo, e não como foto com borda de renda.
  const topMm = L.margin;
  const valueMm = clamp(topMm * 0.62, 0, 5);
  if (valueMm >= MIN_TEXT_MM) {
    const y = -hh + mm(topMm * 0.52);
    ctx.fillStyle = ink;
    inkLine(ctx, L.box.x, y, mm(valueMm * 1.5), inkHeight(valueMm, pxPerMm), 'left');
    ctx.fillStyle = faint;
    markLine(ctx, L.box.x + L.box.w, y, L.box.w * 0.3, clamp(valueMm * 0.5, MIN_TEXT_MM, 2.4), pxPerMm, {
      align: 'right',
      fill: 0.9,
      parts: 1,
    });
  }

  const bandTop = L.box.y + L.box.h;
  const bandH = hh - bandTop;
  const bandMm = bandH / pxPerMm;
  if (bandMm >= MIN_TEXT_MM * 1.4) {
    ctx.fillStyle = ink;
    markLine(ctx, 0, bandTop + bandH * 0.42, L.box.w, clamp(bandMm * 0.4, 0, 4.4), pxPerMm, { fill: 0.58, parts: 1 });
    const sub = clamp(bandMm * 0.22, 0, 2.4);
    if (sub >= MIN_TEXT_MM && bandMm >= MIN_TEXT_MM * 2.6) {
      ctx.fillStyle = faint;
      markLine(ctx, 0, bandTop + bandH * 0.78, L.box.w, sub, pxPerMm, { fill: 0.4, parts: 2 });
    }
  }

  // Cantos: dois filetes curtos, o suficiente para o papel parecer gravado.
  ctx.strokeStyle = faint;
  const arm = mm(clamp(L.margin * 0.4, 0.6, 2.4));
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = sx * (hw - mm(L.margin * 0.35));
      const y = sy * (hh - mm(L.margin * 0.35));
      hairline(ctx, x - sx * arm, y, x, y, mm(0.14), faint);
      hairline(ctx, x, y - sy * arm, x, y, mm(0.14), faint);
    }
  }

  ctx.restore();
}

const carimbo = {
  id: 't-carimbo',
  label: 'Carimbo de passaporte',
  build({ w, h, pxPerMm, seed }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const minSide = Math.min(w, h);

    const ring = clamp(minSide * 0.12, 2.4, 12);
    const r = Math.max(mm(1), Math.min(hw, hh) - mm(ring));

    const tinta = pick(makeRng((seed ^ 0x3c9e2b47) >>> 0), TINTAS);

    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.5)),
      photo: circlePath(r),
      photoBox: { x: -r, y: -r, w: r * 2, h: r * 2 },
      decorate: (ctx, info) => paintCarimbo(ctx, info, { ring, r, tinta }),
    };
  },
};

function paintCarimbo(ctx, { pxPerMm, tone, seed, w, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hw = mm(w) / 2;
  const hh = mm(h) / 2;
  const rng = makeRng((seed ^ 0x77c1a3e0) >>> 0);

  ctx.save();

  // Página do passaporte: guilhoché de mentira, só linhas paralelas bem fracas.
  ctx.save();
  ctx.clip(roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.5)));
  ctx.strokeStyle = shade(tone, 0.3, 0.16);
  ctx.lineWidth = penWidth(mm(0.12));
  const step = mm(clamp(Math.min(w, h) * 0.06, 1.2, 4));
  for (let y = -hh; y <= hh; y += step) hairline(ctx, -hw, y, hw, y, mm(0.12), shade(tone, 0.3, 0.14));
  ctx.restore();

  ctx.save();
  // O carimbo pode encostar na borda da página; o renderer não recorta `decorate`.
  ctx.clip(roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.5)));
  ctx.rotate(range(rng, -7, 7) * (Math.PI / 180));

  const outerW = mm(clamp(L.ring * 0.1, 0.25, 1));
  const innerW = mm(clamp(L.ring * 0.05, 0.18, 0.5));
  const innerR = L.r + mm(L.ring * 0.16);
  const outerR = Math.max(innerR + innerW, Math.min(L.r + mm(L.ring * 0.78), Math.min(hw, hh) - outerW / 2 - mm(0.3)));

  inkRing(ctx, outerR, outerW, L.tinta, rng, 0.9);
  inkRing(ctx, innerR, innerW, L.tinta, rng, 0.7);

  // A faixa é o vão limpo medido entre os dois anéis. Derivar daqui, e não de uma
  // fração do miolo, é o que impede a marca de sair cortada pelo anel.
  const gapLo = innerR + innerW / 2;
  const gapHi = outerR - outerW / 2;
  const textR = (gapLo + gapHi) / 2;
  const bandMm = clamp(((gapHi - gapLo) / pxPerMm) * 0.5, 0, 4);
  ctx.fillStyle = withAlpha(L.tinta, 0.88);
  markArc(ctx, textR, textR, Math.PI, TAU, bandMm, pxPerMm, 2, 0.7);

  // A tarjeta atravessada é o que todo carimbo de fronteira tem, e ela ocupa o pé
  // do anel. Sem tarjeta, o arco de baixo volta a ser o lugar da marca.
  const dateMm = clamp(L.ring * 0.34, 0, 3.6);
  let tarjeta = false;
  if (dateMm >= MIN_TEXT_MM) {
    const padX = mm(dateMm * 0.5);
    const boxH = mm(dateMm * 1.7);
    const y = outerR - boxH * 0.1;
    const tw = Math.min(mm(dateMm * 6.5), hw * 1.4);
    if (tw + padX * 2 < hw * 1.9) {
      ctx.fillStyle = withAlpha(L.tinta, 0.9);
      ctx.fillRect(-tw / 2 - padX, y - boxH / 2, tw + padX * 2, boxH);
      ctx.fillStyle = tone;
      inkWords(ctx, 0, y, tw, inkHeight(dateMm, pxPerMm), 'center', 2);
      tarjeta = true;
    }
  }
  if (!tarjeta) {
    ctx.fillStyle = withAlpha(L.tinta, 0.88);
    markArc(ctx, textR, textR, Math.PI * 0.72, Math.PI * 0.28, bandMm * 0.9, pxPerMm, 1, 0.42);
  }

  const starR = mm(clamp(L.ring * 0.16, 0.3, 1.4));
  ctx.fillStyle = withAlpha(L.tinta, 0.8);
  for (const sx of [-1, 1]) star(ctx, sx * textR, 0, starR);

  ctx.restore();
  ctx.restore();
}

const postal = {
  id: 't-postal',
  label: 'Cartão postal',
  build({ w, h, pxPerMm, seed }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const minSide = Math.min(w, h);

    const margin = clamp(minSide * 0.055, 1.2, 5);
    const band = Math.min(clamp(h * 0.16, margin * 2.2, 14), h * 0.3);
    const box = {
      x: -hw + mm(margin),
      y: -hh + mm(margin),
      w: Math.max(mm(1), mm(w - margin * 2)),
      h: Math.max(mm(1), mm(h - margin - band)),
    };

    const tinta = pick(makeRng((seed ^ 0x59f0c223) >>> 0), TINTAS);

    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.9)),
      photo: roundedRect(box.x, box.y, box.w, box.h, mm(0.3)),
      photoBox: box,
      decorate: (ctx, info) => paintPostal(ctx, info, { margin, box, tinta }),
    };
  },
};

function paintPostal(ctx, { pxPerMm, tone, seed, w, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hh = mm(h) / 2;
  const rng = makeRng((seed ^ 0x6b0d94a1) >>> 0);
  const ink = shade(tone, 0.76, 0.9);
  const faint = shade(tone, 0.5, 0.45);

  ctx.save();

  // Obliteração por cima da foto: no postal que viajou, o carimbo pega a imagem.
  const markR = mm(clamp(Math.min(w, h) * 0.11, 2.2, 9));
  if (markR > mm(2)) {
    ctx.save();
    ctx.clip(roundedRect(L.box.x, L.box.y, L.box.w, L.box.h, mm(0.3)));
    postmark(ctx, L.box.x + L.box.w - markR * 1.15, L.box.y + markR * 1.15, markR, pxPerMm, L.tinta, rng);
    ctx.restore();
  }

  const bandTop = L.box.y + L.box.h;
  const bandH = hh - mm(L.margin * 0.5) - bandTop;
  const bandMm = bandH / pxPerMm;
  if (bandMm < MIN_TEXT_MM * 1.4) {
    ctx.restore();
    return;
  }

  ctx.fillStyle = ink;
  const nameW = markLine(ctx, 0, bandTop + bandH * 0.44, L.box.w * 0.92, clamp(bandMm * 0.52, 0, 12), pxPerMm, {
    fill: 0.5,
    parts: 1,
  });

  const subMm = clamp(bandMm * 0.2, 0, 2.6);
  if (nameW > 0 && subMm >= MIN_TEXT_MM && bandMm >= MIN_TEXT_MM * 3) {
    ctx.fillStyle = faint;
    markLine(ctx, 0, bandTop + bandH * 0.82, L.box.w * 0.9, subMm, pxPerMm, { fill: 0.52, parts: 3 });
  }

  if (nameW > 0) {
    const arm = Math.min(L.box.w * 0.2, mm(12));
    const y = bandTop + bandH * 0.1;
    hairline(ctx, -arm, y, -nameW * 0.06 - mm(1), y, mm(0.16), faint);
    hairline(ctx, nameW * 0.06 + mm(1), y, arm, y, mm(0.16), faint);
  }

  ctx.restore();
}

const mapa = {
  id: 't-mapa',
  label: 'Mapa dobrado',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const paper = roundedRect(-hw, -hh, hw * 2, hh * 2, mm(0.5));

    return {
      paper,
      photo: paper,
      photoBox: { x: -hw, y: -hh, w: hw * 2, h: hh * 2 },
      decorate: (ctx, info) => paintMapa(ctx, info, { paper }),
    };
  },
};

function paintMapa(ctx, { pxPerMm, seed, w, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hw = mm(w) / 2;
  const hh = mm(h) / 2;
  const minSide = Math.min(w, h);
  const rng = makeRng((seed ^ 0x4e6b7702) >>> 0);

  ctx.save();
  ctx.clip(L.paper);

  // Vincos: o fio claro é a emulsão raspada na dobra, e é ele que vende o papel.
  const band = mm(clamp(minSide * 0.03, 1, 3.6));
  const crease = (along, at, flip) => {
    const g = along === 'x'
      ? ctx.createLinearGradient(0, at - band / 2, 0, at + band / 2)
      : ctx.createLinearGradient(at - band / 2, 0, at + band / 2, 0);
    const a = flip ? 1 : 0;
    g.addColorStop(0, 'rgba(255,252,246,0)');
    g.addColorStop(0.46, `rgba(255,252,246,${0.15 * (1 - a) + 0.04 * a})`);
    g.addColorStop(0.5, 'rgba(28,19,12,0.16)');
    g.addColorStop(0.54, `rgba(255,252,246,${0.15 * a + 0.04 * (1 - a)})`);
    g.addColorStop(1, 'rgba(255,252,246,0)');
    ctx.fillStyle = g;
    if (along === 'x') ctx.fillRect(-hw, at - band / 2, hw * 2, band);
    else ctx.fillRect(at - band / 2, -hh, band, hh * 2);
  };
  crease('y', -hw / 2, false);
  crease('y', 0, true);
  crease('y', hw / 2, false);
  crease('x', 0, false);

  const white = 'rgba(255,253,248,0.92)';
  ctx.save();
  ctx.shadowColor = 'rgba(20,14,8,0.55)';
  ctx.shadowBlur = mm(0.8);
  ctx.shadowOffsetY = mm(0.2);

  // Rota: uma curva tracejada entre dois pontos, com o alfinete na chegada.
  const a = { x: -hw * 0.62, y: hh * 0.5 };
  const b = { x: hw * 0.5, y: -hh * 0.42 };
  const ctrl = { x: range(rng, -0.3, 0.3) * hw, y: range(rng, 0.2, 0.7) * -hh };
  ctx.strokeStyle = white;
  ctx.lineWidth = penWidth(mm(clamp(minSide * 0.012, 0.3, 0.9)));
  ctx.setLineDash([mm(1.4), mm(1)]);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(ctrl.x, ctrl.y, b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const pinR = mm(clamp(minSide * 0.022, 0.5, 1.8));
  ctx.fillStyle = white;
  dot(ctx, a.x, a.y, pinR * 0.7);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y + pinR * 2.2);
  ctx.lineTo(b.x - pinR, b.y - pinR * 0.2);
  ctx.lineTo(b.x + pinR, b.y - pinR * 0.2);
  ctx.closePath();
  ctx.fill();
  dot(ctx, b.x, b.y - pinR * 0.4, pinR);

  // Coordenadas na margem: sem elas é uma foto com riscos, com elas é mapa. As
  // letras e os números viram as marcas deles, uma por casa da grade.
  const gridMm = clamp(minSide * 0.035, 0, 2.6);
  if (gridMm >= MIN_TEXT_MM) {
    ctx.fillStyle = 'rgba(255,253,248,0.8)';
    const cell = inkHeight(gridMm, pxPerMm);
    const cols = 4;
    for (let i = 0; i < cols; i++) {
      const x = -hw + ((i + 0.5) * hw * 2) / cols;
      inkLine(ctx, x, -hh + mm(gridMm * 1.1), cell * 0.9, cell, 'center');
    }
    const rows = 3;
    for (let i = 0; i < rows; i++) {
      const y = -hh + ((i + 0.5) * hh * 2) / rows;
      inkLine(ctx, -hw + mm(gridMm * 0.9), y, cell * 0.55, cell, 'center');
    }
  }

  // Escala e rosa: canto inferior, o par que assina qualquer carta topográfica.
  const scaleW = Math.min(hw * 0.5, mm(16));
  const scaleY = hh - mm(clamp(minSide * 0.06, 1.4, 5));
  const tick = mm(clamp(minSide * 0.014, 0.4, 1.1));
  ctx.strokeStyle = white;
  ctx.lineWidth = penWidth(mm(0.24));
  ctx.beginPath();
  ctx.moveTo(-hw + mm(2), scaleY);
  ctx.lineTo(-hw + mm(2) + scaleW, scaleY);
  for (let i = 0; i <= 4; i++) {
    const x = -hw + mm(2) + (scaleW * i) / 4;
    ctx.moveTo(x, scaleY);
    ctx.lineTo(x, scaleY - tick);
  }
  ctx.stroke();

  const nMm = clamp(minSide * 0.05, 0, 4);
  if (nMm >= MIN_TEXT_MM) {
    const nx = hw - mm(clamp(minSide * 0.07, 1.6, 6));
    const ny = hh - mm(clamp(minSide * 0.07, 1.6, 6));
    ctx.fillStyle = white;
    ctx.beginPath();
    ctx.moveTo(nx, ny - mm(nMm * 1.1));
    ctx.lineTo(nx + mm(nMm * 0.4), ny + mm(nMm * 0.2));
    ctx.lineTo(nx, ny - mm(nMm * 0.1));
    ctx.lineTo(nx - mm(nMm * 0.4), ny + mm(nMm * 0.2));
    ctx.closePath();
    ctx.fill();
    // A seta já aponta o norte sozinha; a letra ao pé dela era repetição.
  }

  const titleMm = clamp(minSide * 0.075, 0, 6.5);
  if (titleMm >= MIN_TEXT_MM) {
    ctx.fillStyle = white;
    markLine(ctx, -hw + mm(clamp(minSide * 0.06, 1.4, 5)), -hh + mm(clamp(minSide * 0.13, 3, 11)), hw * 1.4, titleMm, pxPerMm, {
      align: 'left',
      fill: 0.44,
      parts: 1,
    });
  }

  ctx.restore();
  ctx.restore();
}

const bagagem = {
  id: 't-bagagem',
  label: 'Etiqueta de bagagem',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const minSide = Math.min(w, h);

    const shoulder = mm(clamp(minSide * 0.12, 1.6, 9));
    const corner = mm(clamp(minSide * 0.04, 0.6, 2));
    const holeR = mm(clamp(minSide * 0.035, 0.6, 2.4));
    const head = Math.min(mm(clamp(h * 0.16, 3, 14)), hh * 0.5);
    const holeY = -hh + head * 0.45;

    const paper = tagPaper(hw, hh, shoulder, corner, holeY, holeR);

    const pad = mm(clamp(minSide * 0.05, 0.8, 3));
    const foot = Math.min(mm(clamp(h * 0.2, 3.4, 16)), (hh * 2 - head) * 0.42);
    const box = {
      x: -hw + pad,
      y: -hh + head,
      w: Math.max(mm(1), hw * 2 - pad * 2),
      h: Math.max(mm(1), hh - (-hh + head) - foot),
    };

    return {
      paper,
      photo: roundedRect(box.x, box.y, box.w, box.h, mm(0.3)),
      photoBox: box,
      rule: 'evenodd',
      decorate: (ctx, info) => paintBagagem(ctx, info, { holeY, holeR, head, box, paper }),
    };
  },
};

function paintBagagem(ctx, { pxPerMm, tone, seed, w, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hw = mm(w) / 2;
  const hh = mm(h) / 2;
  const minSide = Math.min(w, h);
  const rng = makeRng((seed ^ 0x1c8f43aa) >>> 0);
  const ink = shade(tone, 0.82, 0.92);
  const faint = shade(tone, 0.5, 0.5);

  ctx.save();

  // Ilhós: o anel metálico é o que impede o furo de rasgar — e de parecer decalque.
  ctx.strokeStyle = shade(tone, 0.45, 0.6);
  ctx.lineWidth = penWidth(mm(clamp(minSide * 0.012, 0.3, 1)));
  ctx.beginPath();
  ctx.arc(0, L.holeY, L.holeR * 1.5, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = faint;
  ctx.lineWidth = penWidth(mm(0.2));
  ctx.setLineDash([mm(1.1), mm(0.8)]);
  ctx.strokeRect(L.box.x, L.box.y - mm(0.6), L.box.w, L.box.h + mm(1.2));
  ctx.setLineDash([]);

  const footTop = L.box.y + L.box.h;
  const footH = hh - footTop;
  const footMm = footH / pxPerMm;
  if (footMm >= MIN_TEXT_MM * 1.6) {
    const codeMm = clamp(footMm * 0.46, MIN_TEXT_MM, 14);
    const codeW = mm(codeMm * 1.9);
    const y = footTop + footH * 0.42;
    if (codeW <= L.box.w * 0.6) {
      ctx.fillStyle = ink;
      inkLine(ctx, L.box.x, y, codeW, inkHeight(codeMm, pxPerMm), 'left');

      const sideMm = clamp(footMm * 0.19, 0, 2.6);
      if (sideMm >= MIN_TEXT_MM) {
        ctx.fillStyle = faint;
        markLine(ctx, L.box.x + L.box.w, y - mm(sideMm * 0.7), L.box.w * 0.3, sideMm, pxPerMm, { align: 'right', parts: 1 });
        markLine(ctx, L.box.x + L.box.w, y + mm(sideMm * 0.7), L.box.w * 0.34, sideMm, pxPerMm, { align: 'right', parts: 2 });
      }
    }

    const barY = footTop + footH * 0.72;
    const barH = Math.min(footH * 0.22, mm(4));
    if (barH > mm(0.8)) barcode(ctx, L.box.x, barY, L.box.w, barH, pxPerMm, rng, shade(tone, 0.86, 0.9));
  }

  const topMm = (L.head * 0.4) / pxPerMm;
  if (topMm >= MIN_TEXT_MM) {
    ctx.fillStyle = faint;
    markLine(ctx, 0, -hh + L.head * 0.82, hw * 1.5, clamp(topMm * 0.5, 0, 2.4), pxPerMm, { fill: 0.5, parts: 2 });
  }

  ctx.restore();
}

const bussola = {
  id: 't-bussola',
  label: 'Rosa dos ventos',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const minSide = Math.min(w, h);
    const outer = (Math.min(mm(w), mm(h))) / 2;
    const ring = clamp(minSide * 0.11, 2.2, 11);
    const r = Math.max(mm(1), outer - mm(ring));

    return {
      paper: circlePath(outer),
      photo: circlePath(r),
      photoBox: { x: -r, y: -r, w: r * 2, h: r * 2 },
      decorate: (ctx, info) => paintBussola(ctx, info, { outer, ring, r }),
    };
  },
};

function paintBussola(ctx, { pxPerMm, tone }, L) {
  const mm = (v) => v * pxPerMm;
  const ink = shade(tone, 0.78, 0.9);
  const faint = shade(tone, 0.5, 0.5);

  ctx.save();
  ctx.textBaseline = 'middle';

  outline(ctx, circlePath(L.outer - mm(0.4)), mm(0.3), faint);
  outline(ctx, circlePath(L.r + mm(0.5)), mm(0.28), ink);

  // Um traço a cada 5°, os de 30° mais longos: é a régua que faz virar instrumento.
  // Os traços moram na metade de fora do anel e as letras na de dentro, senão a
  // cardeal cai justamente em cima do traço de 90° e sai furada.
  const tickR = L.outer - mm(0.4);
  for (let deg = 0; deg < 360; deg += 5) {
    if (deg % 90 === 0) continue;
    const a = (deg - 90) * (Math.PI / 180);
    const long = deg % 30 === 0;
    const len = mm(L.ring) * (long ? 0.26 : 0.13);
    const x0 = Math.cos(a) * (tickR - len);
    const y0 = Math.sin(a) * (tickR - len);
    hairline(ctx, x0, y0, Math.cos(a) * tickR, Math.sin(a) * tickR, mm(long ? 0.24 : 0.12), long ? ink : faint);
  }

  // As quatro cardeais viram losangos: sem letra, o que marca os quatro pontos é a
  // forma que só existe neles — os traços de grau são todos retos.
  const letterMm = clamp(L.ring * 0.38, 0, 5);
  if (letterMm >= MIN_TEXT_MM) {
    ctx.fillStyle = ink;
    const at = L.r + mm(L.ring * 0.42);
    const d = mm(letterMm * 0.34);
    for (const deg of [-90, 0, 90, 180]) {
      const a = deg * (Math.PI / 180);
      const cx = Math.cos(a) * at;
      const cy = Math.sin(a) * at;
      ctx.beginPath();
      ctx.moveTo(cx, cy - d);
      ctx.lineTo(cx + d, cy);
      ctx.lineTo(cx, cy + d);
      ctx.lineTo(cx - d, cy);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Bico do norte. Mora na pista dos traços, aproveitando a falha dos 90°, senão
  // cobre a letra N — o anel tem três moradores e cada um precisa da sua faixa.
  const nose = mm(clamp(L.ring * 0.13, 0.4, 1.6));
  const noseY = -(L.r + mm(L.ring * 0.83));
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(0, noseY - nose);
  ctx.lineTo(nose * 0.7, noseY + nose * 0.5);
  ctx.lineTo(-nose * 0.7, noseY + nose * 0.5);
  ctx.closePath();
  ctx.fill();

  const nameMm = clamp(L.ring * 0.26, 0, 3);
  if (nameMm >= MIN_TEXT_MM) {
    ctx.fillStyle = shade(tone, 0.7, 0.8);
    const textR = L.r + mm(L.ring * 0.16);
    markArc(ctx, textR, textR, Math.PI * 0.78, Math.PI * 0.22, nameMm, pxPerMm, 2, 0.44);
  }

  ctx.restore();
}

const hotel = {
  id: 't-hotel',
  label: 'Etiqueta de hotel',
  build({ w, h, pxPerMm }) {
    const mm = (v) => v * pxPerMm;
    const hw = mm(w) / 2;
    const hh = mm(h) / 2;
    const minSide = Math.min(w, h);

    const ring = clamp(minSide * 0.13, 2.6, 13);
    const rx = Math.max(mm(1), hw - mm(ring));
    const ry = Math.max(mm(1), hh - mm(ring * 1.35));

    return {
      paper: roundedRect(-hw, -hh, hw * 2, hh * 2, mm(clamp(minSide * 0.05, 0.8, 3.5))),
      photo: ellipsePath(rx, ry),
      photoBox: { x: -rx, y: -ry, w: rx * 2, h: ry * 2 },
      decorate: (ctx, info) => paintHotel(ctx, info, { ring, rx, ry }),
    };
  },
};

function paintHotel(ctx, { pxPerMm, tone, seed, w, h }, L) {
  const mm = (v) => v * pxPerMm;
  const hw = mm(w) / 2;
  const hh = mm(h) / 2;
  const rng = makeRng((seed ^ 0x5a2c9e77) >>> 0);
  const ink = shade(tone, 0.78, 0.9);
  const faint = shade(tone, 0.52, 0.5);
  const tinta = pick(rng, TINTAS);

  ctx.save();

  const off = mm(clamp(L.ring * 0.22, 0.5, 2.6));
  outline(ctx, roundedRect(-hw + off, -hh + off, (hw - off) * 2, (hh - off) * 2, mm(0.6)), mm(0.3), ink);
  outline(
    ctx,
    roundedRect(-hw + off * 1.5, -hh + off * 1.5, (hw - off * 1.5) * 2, (hh - off * 1.5) * 2, mm(0.4)),
    mm(0.13),
    faint
  );

  outline(ctx, ellipsePath(L.rx + mm(0.5), L.ry + mm(0.5)), mm(0.3), ink);
  outline(ctx, ellipsePath(L.rx + mm(1.2), L.ry + mm(1.2)), mm(0.12), faint);

  const bandMm = clamp(L.ring * 0.42, 0, 5);
  ctx.fillStyle = withAlpha(tinta, 0.9);
  const arcRx = L.rx + mm(L.ring * 0.62);
  const arcRy = L.ry + mm(L.ring * 0.62);
  markArc(ctx, arcRx, arcRy, Math.PI * 1.18, Math.PI * 1.82, bandMm, pxPerMm, 2, 0.62);

  const footMm = clamp(L.ring * 0.32, 0, 3.4);
  if (footMm >= MIN_TEXT_MM) {
    const y = hh - mm(L.ring * 0.5);
    ctx.fillStyle = ink;
    const paisW = markLine(ctx, 0, y, hw * 1.6, footMm, pxPerMm, { fill: 0.34, parts: 1 });
    const arm = Math.min(hw * 0.34, mm(11));
    const inner = paisW / 2 + mm(footMm * 0.9);
    // O filete só entra se sobrar folga depois da marca; senão ele a risca.
    if (paisW > 0 && arm > inner + mm(0.8)) {
      hairline(ctx, -arm, y, -inner, y, mm(0.16), faint);
      hairline(ctx, inner, y, arm, y, mm(0.16), faint);
    }
  }

  const lemaMm = clamp(L.ring * 0.26, 0, 2.8);
  if (lemaMm >= MIN_TEXT_MM && L.ring > 4) {
    ctx.fillStyle = faint;
    markLine(ctx, 0, -hh + mm(L.ring * 0.42), hw * 1.3, lemaMm, pxPerMm, { fill: 0.5, parts: 3 });
  }

  ctx.restore();
}

export const TRAVEL = {
  id: 'viagem',
  label: 'Viagem',
  styles: [embarque, selo, carimbo, postal, mapa, bagagem, bussola, hotel],
};
