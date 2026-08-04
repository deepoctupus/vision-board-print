/**
 * The board is measured in millimetres, always. Every visual feature (tear depth,
 * gutter, shadow spread, fibre length) is authored in mm, so the artwork looks
 * identical whether it is rasterised at 3 px/mm on screen or 11.8 px/mm for print.
 */

export const MM_PER_INCH = 25.4;
/** CSS reference density, used to give pixel-native presets a physical size. */
export const CSS_DPI = 96;

export const mmToPx = (mm, dpi) => (mm / MM_PER_INCH) * dpi;
export const pxToMm = (px, dpi) => (px / dpi) * MM_PER_INCH;
export const pxPerMmAt = (dpi) => dpi / MM_PER_INCH;

export const PRESET_GROUPS = [
  {
    id: 'print-a',
    label: { pt: 'Série A', en: 'A series' },
    items: [
      { id: 'a5', label: 'A5', w: 148, h: 210 },
      { id: 'a4', label: 'A4', w: 210, h: 297 },
      { id: 'a3', label: 'A3', w: 297, h: 420 },
      { id: 'a2', label: 'A2', w: 420, h: 594 },
      { id: 'a1', label: 'A1', w: 594, h: 841 },
      { id: 'a0', label: 'A0', w: 841, h: 1189 },
    ],
  },
  {
    id: 'print-poster',
    label: { pt: 'Pôster / Quadro', en: 'Poster / frame' },
    items: [
      { id: 'p2030', label: '20 × 30 cm', w: 200, h: 300 },
      { id: 'p3040', label: '30 × 40 cm', w: 300, h: 400 },
      { id: 'p3045', label: '30 × 45 cm', w: 300, h: 450 },
      { id: 'p4050', label: '40 × 50 cm', w: 400, h: 500 },
      { id: 'p4060', label: '40 × 60 cm', w: 400, h: 600 },
      { id: 'p5070', label: '50 × 70 cm', w: 500, h: 700 },
      { id: 'p6090', label: '60 × 90 cm', w: 600, h: 900 },
    ],
  },
  {
    id: 'print-square',
    label: { pt: 'Quadrado', en: 'Square' },
    items: [
      { id: 's20', label: '20 × 20 cm', w: 200, h: 200 },
      { id: 's30', label: '30 × 30 cm', w: 300, h: 300 },
      { id: 's40', label: '40 × 40 cm', w: 400, h: 400 },
      { id: 's50', label: '50 × 50 cm', w: 500, h: 500 },
    ],
  },
  {
    id: 'print-us',
    label: { pt: 'Padrão EUA', en: 'US sizes' },
    items: [
      { id: 'letter', label: 'Letter', w: 215.9, h: 279.4 },
      { id: 'legal', label: 'Legal', w: 215.9, h: 355.6 },
      { id: 'tabloid', label: 'Tabloid', w: 279.4, h: 431.8 },
      { id: 'photo46', label: '4 × 6 in', w: 101.6, h: 152.4 },
      { id: 'photo1114', label: '11 × 14 in', w: 279.4, h: 355.6 },
      { id: 'photo1824', label: '18 × 24 in', w: 457.2, h: 609.6 },
    ],
  },
  {
    id: 'screen',
    label: { pt: 'Tela / Redes', en: 'Screen / social' },
    items: [
      { id: 'ig-square', label: 'Instagram 1:1', px: [1080, 1080] },
      { id: 'ig-portrait', label: 'Instagram 4:5', px: [1080, 1350] },
      { id: 'ig-story', label: 'Story / Reels 9:16', px: [1080, 1920] },
      { id: 'phone', label: { pt: 'Papel de parede celular', en: 'Phone wallpaper' }, px: [1284, 2778] },
      { id: 'desktop', label: { pt: 'Papel de parede desktop', en: 'Desktop wallpaper' }, px: [2560, 1440] },
    ],
  },
];

export const ALL_PRESETS = PRESET_GROUPS.flatMap((g) =>
  g.items.map((item) => normalisePreset(item, g.id))
);

function normalisePreset(item, groupId) {
  if (item.px) {
    const [pw, ph] = item.px;
    return {
      ...item,
      group: groupId,
      native: 'px',
      nativePx: item.px,
      w: pxToMm(pw, CSS_DPI),
      h: pxToMm(ph, CSS_DPI),
    };
  }
  return { ...item, group: groupId, native: 'mm' };
}

export function getPreset(id) {
  return ALL_PRESETS.find((p) => p.id === id) || ALL_PRESETS.find((p) => p.id === 'a3');
}

/** Resolves a board spec (preset + orientation + custom size) into concrete mm. */
export function resolveBoardSize({ presetId, orientation = 'portrait', customW, customH }) {
  if (presetId === 'custom') {
    const w = Math.max(30, Number(customW) || 300);
    const h = Math.max(30, Number(customH) || 400);
    return applyOrientation(w, h, orientation, 'mm', null);
  }
  const preset = getPreset(presetId);
  return applyOrientation(preset.w, preset.h, orientation, preset.native, preset.nativePx);
}

function applyOrientation(w, h, orientation, native, nativePx) {
  const isSquare = Math.abs(w - h) < 0.01;
  const flip = !isSquare && orientation === 'landscape' === h > w;
  const out = flip ? { w: h, h: w } : { w, h };
  return {
    widthMm: out.w,
    heightMm: out.h,
    native,
    nativePx: nativePx ? (flip ? [nativePx[1], nativePx[0]] : nativePx.slice()) : null,
  };
}

export function formatSize(board, locale = 'pt') {
  if (board.native === 'px' && board.nativePx) {
    return `${board.nativePx[0]} × ${board.nativePx[1]} px`;
  }
  const fmt = (mm) => {
    const cm = mm / 10;
    return Number.isInteger(cm) ? String(cm) : cm.toFixed(1).replace('.', locale === 'pt' ? ',' : '.');
  };
  return `${fmt(board.widthMm)} × ${fmt(board.heightMm)} cm`;
}

export const DPI_OPTIONS = [96, 150, 300, 450, 600];

/** Megapixels a given board + dpi would produce. Guards against giant allocations. */
export function exportPixels(board, dpi, bleedMm = 0) {
  const w = Math.round(mmToPx(board.widthMm + bleedMm * 2, dpi));
  const h = Math.round(mmToPx(board.heightMm + bleedMm * 2, dpi));
  return { w, h, megapixels: (w * h) / 1e6 };
}

/**
 * Browsers silently produce a blank canvas past their area limit rather than
 * throwing, so we check up front. iOS/Safari caps far lower than desktop.
 */
export function maxCanvasMegapixels() {
  const ua = navigator.userAgent;
  const isWebkit = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  const isMobile = /iPhone|iPad|iPod|Android/.test(ua);
  if (isWebkit || isMobile) return 16;
  return 268;
}
