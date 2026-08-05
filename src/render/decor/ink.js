/**
 * Marcas de impressão sem palavra nenhuma.
 *
 * Um recorte é moldura, não legenda. Ele não sabe quem está na foto, para onde
 * a pessoa viajou nem o que ela conquistou — então não pode escrever "RAK",
 * "VENDIDO" ou "CORREIO" no papel dela. Onde antes ia uma linha de texto fica
 * agora a **marca** daquela linha: barras de tinta com a altura e o peso que o
 * texto teria, no mesmo lugar em que ele estava.
 *
 * O objeto continua parecendo impresso — o cartão de embarque ainda tem
 * cabeçalho, campos e talão — e nada no papel afirma coisa alguma.
 *
 * Tudo aqui usa o `fillStyle` que já está no contexto e mede em pixels, porque
 * quem chama já converteu de milímetros. `y` é sempre o **meio** da linha, para
 * bater com o `textBaseline = 'middle'` que o código de texto usava.
 */

import { makeRng } from '../../core/rng.js';

/** Abaixo disso a barra some na prévia a 26% e vira sujeira no papel. */
const MIN_PX = 0.5;

/**
 * Altura da barra que ocupa o lugar de um corpo de `sizeMm`. Fica na altura de
 * x da fonte, não no corpo inteiro: uma barra do tamanho do corpo pesa demais e
 * a peça toda escurece.
 */
export const inkHeight = (sizeMm, pxPerMm) => Math.max(MIN_PX, sizeMm * pxPerMm * 0.56);

function anchor(x, w, align) {
  if (align === 'center') return x - w / 2;
  if (align === 'right') return x - w;
  return x;
}

/** Uma barra só — para código curto, número, sigla. Devolve a largura usada. */
export function inkLine(ctx, x, y, w, h, align = 'left') {
  if (!(w > 0) || !(h > 0)) return 0;
  ctx.fillRect(anchor(x, w, align), y - h / 2, w, h);
  return w;
}

/**
 * Barras curtas com respiro entre elas. De longe lê como palavras; uma barra
 * única e comprida no mesmo lugar leria como tarja de censura.
 *
 * As larguras variam, mas de forma determinística: a mesma peça reimpressa sai
 * idêntica, que é a regra da pasta inteira.
 */
export function inkWords(ctx, x, y, w, h, align = 'left', parts = 0, seed = 1) {
  if (!(w > 0) || !(h > 0)) return 0;
  const n = parts || Math.max(1, Math.min(4, Math.round(w / (h * 7))));
  if (n <= 1) return inkLine(ctx, x, y, w, h, align);

  const gap = Math.max(MIN_PX, h * 0.6);
  const usable = w - gap * (n - 1);
  if (usable <= h) return inkLine(ctx, x, y, w, h, align);

  const rng = makeRng((Math.round(Math.abs(x) * 31 + Math.abs(y) * 17 + w * 7) ^ (seed >>> 0)) >>> 0);
  const weights = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const t = 0.6 + rng() * 0.8;
    weights.push(t);
    total += t;
  }

  let at = anchor(x, w, align);
  for (const t of weights) {
    const bw = usable * (t / total);
    ctx.fillRect(at, y - h / 2, bw, h);
    at += bw + gap;
  }
  return w;
}

/**
 * Rótulo miúdo por cima de um valor mais forte: é esse par que faz um retângulo
 * virar formulário. Sem ele o cartão de embarque vira um papel em branco.
 */
export function inkField(ctx, x, y, w, h, ink, faint) {
  if (!(w > 0) || !(h > 0)) return;
  ctx.fillStyle = faint;
  inkWords(ctx, x, y - h * 1.7, w * 0.62, Math.max(MIN_PX, h * 0.66), 'left', 1);
  ctx.fillStyle = ink;
  inkWords(ctx, x, y, w * 0.82, h, 'left', 2, 0x9e37);
}

/**
 * Banda seguindo um arco — o lugar onde corria o nome do país no anel do
 * carimbo. Riscada em pedaços, pelo mesmo motivo de `inkWords`.
 */
export function inkArc(ctx, rx, ry, a0, a1, h, parts = 3, fill = 0.78) {
  if (!(h > 0) || !(rx > 0) || !(ry > 0)) return;
  const span = (a1 - a0) * fill;
  const start = a0 + (a1 - a0 - span) / 2;
  const gap = parts > 1 ? Math.abs(span) * 0.07 : 0;
  const each = (span - gap * (parts - 1) * Math.sign(span || 1)) / parts;

  ctx.save();
  ctx.lineWidth = Math.max(MIN_PX, h);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineCap = 'butt';
  for (let i = 0; i < parts; i++) {
    const s = start + i * (each + gap * Math.sign(span || 1));
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, s, s + each);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Várias linhas empilhadas, como um parágrafo. A última sai curta, que é o que
 * denuncia um bloco de texto de verdade visto de longe.
 */
export function inkParagraph(ctx, x, y, w, h, lines, leading = 2.1, align = 'left') {
  if (!(w > 0) || !(h > 0) || lines < 1) return;
  for (let i = 0; i < lines; i++) {
    const last = i === lines - 1;
    const lw = last && lines > 1 ? w * 0.55 : w;
    inkWords(ctx, x, y + i * h * leading, lw, h, align, 0, 0x51ed + i * 977);
  }
}
