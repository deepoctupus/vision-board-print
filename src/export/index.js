import { mmToPx, exportPixels, maxCanvasMegapixels } from '../core/units.js';
import { computeLayout } from '../layout/index.js';
import { renderBoard } from '../render/renderer.js';
import { decodeForExport } from '../images/loader.js';
import { buildPdf } from './pdf.js';
import { withPngDpi, withJpegDpi } from './dpi.js';

/**
 * Renders the board at print resolution and encodes it. Sources are decoded at
 * the size each photo actually occupies, so a 24 MP original does not get
 * resampled to a 40 mm cell at full weight.
 */
export async function exportBoard({
  state,
  assetStore,
  format = 'png',
  dpi = 300,
  bleedMm = 0,
  cropMarks = false,
  quality = 0.94,
  onProgress = () => {},
}) {
  const layout = computeLayout(state, assetStore);
  const { w, h, megapixels } = exportPixels(layout.board, dpi, bleedMm);

  const limit = maxCanvasMegapixels();
  if (megapixels > limit) {
    throw Object.assign(new Error('canvas-too-large'), { megapixels, limit });
  }

  onProgress(0.05, 'preparing');

  const pxPerMm = dpi / 25.4;
  const decoded = new Map();
  const releases = [];

  const needed = new Map();
  for (const cell of layout.cells) {
    const need = Math.max(cell.w, cell.h) * pxPerMm;
    needed.set(cell.assetId, Math.max(needed.get(cell.assetId) || 0, need));
  }
  if (state.surface.kind === 'image' && state.surface.assetId) {
    needed.set(state.surface.assetId, Math.max(layout.board.widthMm, layout.board.heightMm) * pxPerMm);
  }

  let done = 0;
  for (const [assetId, edge] of needed) {
    const asset = assetStore.get(assetId);
    if (!asset) continue;
    const scale = edge / Math.max(1, Math.min(asset.width, asset.height));
    const { source, release } = await decodeForExport(asset, asset.width * scale, asset.height * scale);
    decoded.set(assetId, source);
    releases.push(release);
    done++;
    onProgress(0.05 + (done / needed.size) * 0.55, 'decoding');
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (format === 'jpg' || format === 'pdf') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  onProgress(0.65, 'rendering');
  renderBoard(ctx, {
    state,
    layout,
    pxPerMm,
    resolveSource: (id) => decoded.get(id) || null,
    mode: 'export',
    bleedMm,
    cropMarks,
  });

  for (const release of releases) release();

  onProgress(0.85, 'encoding');
  const name = fileName(state, layout, dpi, format);

  if (format === 'pdf') {
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality);
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    const pdf = buildPdf({
      jpegBytes: bytes,
      pixelWidth: w,
      pixelHeight: h,
      widthMm: layout.board.widthMm + bleedMm * 2,
      heightMm: layout.board.heightMm + bleedMm * 2,
      trimMm: bleedMm,
    });
    onProgress(1, 'done');
    return { blob: new Blob([pdf], { type: 'application/pdf' }), name, width: w, height: h };
  }

  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  let blob = await canvasToBlob(canvas, mime, quality);
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const tagged = format === 'jpg' ? withJpegDpi(buffer, dpi) : withPngDpi(buffer, dpi);
  blob = new Blob([tagged], { type: mime });

  canvas.width = 0;
  canvas.height = 0;
  onProgress(1, 'done');
  return { blob, name, width: w, height: h };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode-failed'))), type, quality);
  });
}

function fileName(state, layout, dpi, format) {
  const size = `${Math.round(layout.board.widthMm)}x${Math.round(layout.board.heightMm)}mm`;
  const stamp = new Date().toISOString().slice(0, 10);
  return `visionboard-${size}-${dpi}dpi-${stamp}.${format}`;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Physical size preview text for the export panel. */
export function describeExport(board, dpi, bleedMm) {
  const { w, h, megapixels } = exportPixels(board, dpi, bleedMm);
  return { w, h, megapixels, overLimit: megapixels > maxCanvasMegapixels() };
}

export { mmToPx };
