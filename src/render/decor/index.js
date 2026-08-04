/**
 * Categorias de customização.
 *
 * Um recorte comum (círculo, rasgado) decide onde o papel termina. Uma categoria
 * vai além: ela finge que a foto foi impressa **em cima de um objeto** — um
 * cartão de embarque, um selo de alfândega, um convite. Por isso cada estilo
 * entrega duas coisas, e não uma: a silhueta do objeto e o que está impresso nele.
 *
 * CONTRATO — todo estilo é um objeto:
 *
 *   {
 *     id: 'boarding',                  // único no projeto inteiro
 *     label: 'Cartão de embarque',     // pt-BR, curto, cabe num botão
 *     build({ w, h, pxPerMm, seed, radiusMm }) -> geom
 *   }
 *
 * `build` recebe o tamanho da peça em **milímetros** e devolve geometria já em
 * **pixels, centrada na origem** (multiplique por `pxPerMm`; o centro é 0,0):
 *
 *   {
 *     paper:    Path2D,   // silhueta do objeto — leva sombra e cor de papel
 *     photo:    Path2D,   // recorte por onde a foto aparece
 *     photoBox: { x, y, w, h },  // retângulo que a foto preenche, em px
 *     rule?:    'evenodd',       // se paper/photo tiverem furos
 *     decorate?(ctx, info)       // o que está impresso no objeto
 *   }
 *
 * `decorate` roda depois da foto e antes da moldura, no mesmo espaço centrado em
 * pixels, com o canvas já salvo/restaurado por fora. `info` traz
 * `{ pxPerMm, tone, seed, w, h, geom }` — `w`/`h` em mm, `tone` é a cor do papel.
 *
 * REGRAS QUE NÃO SE NEGOCIAM
 *  - Tudo dimensionado em mm × pxPerMm. Nada em pixels fixos: a mesma peça é
 *    desenhada a 26% na tela e a 300 dpi na gráfica, e tem que ficar igual.
 *  - Determinístico. Aleatoriedade só via `makeRng(seed)` de `core/rng.js`.
 *  - Fontes: só 'Inter' e 'Fraunces', que já estão carregadas.
 *  - Legível de longe. O que só aparece com lupa não vale o custo de desenhar.
 */

import { GENERAL } from './general.js';
import { TRAVEL } from './travel.js';
import { LOVE } from './love.js';
import { ACHIEVEMENT } from './achievement.js';
import { HOME } from './home.js';

export const CATEGORIES = [GENERAL, TRAVEL, LOVE, ACHIEVEMENT, HOME];

const INDEX = new Map();
for (const category of CATEGORIES) {
  for (const style of category.styles) INDEX.set(style.id, { style, category });
}

export const findDecor = (id) => INDEX.get(id) || null;

export const categoryOf = (id) => INDEX.get(id)?.category.id || null;

/** Devolve a geometria do estilo, ou `null` se o id não for de uma categoria. */
export function buildDecor(id, options) {
  const found = INDEX.get(id);
  return found ? found.style.build(options) : null;
}
