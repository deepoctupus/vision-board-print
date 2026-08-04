import { detectFocalPoint, averageColor } from './saliency.js';

export const PREVIEW_MAX_EDGE = 1100;
export const THUMB_MAX_EDGE = 220;
const ACCEPTED = /^image\/(jpeg|png|webp|gif|avif|bmp|heic|heif)$/i;

let assetCounter = 0;
const nextId = () => `img_${Date.now().toString(36)}_${(assetCounter++).toString(36)}`;

/**
 * Decoded bitmaps are deliberately kept out of the undo history — only asset ids
 * are stored in state. This registry owns the pixels.
 */
export class AssetStore {
  constructor() {
    this.assets = new Map();
  }

  add(asset) {
    this.assets.set(asset.id, asset);
    return asset;
  }

  get(id) {
    return this.assets.get(id);
  }

  has(id) {
    return this.assets.has(id);
  }

  remove(id) {
    const asset = this.assets.get(id);
    if (asset?.objectUrl) URL.revokeObjectURL(asset.objectUrl);
    this.assets.delete(id);
  }

  list() {
    return [...this.assets.values()];
  }

  clear() {
    for (const id of [...this.assets.keys()]) this.remove(id);
  }
}

/**
 * HTMLImageElement is used rather than createImageBitmap because every current
 * browser applies EXIF orientation when such an element is drawn to a canvas,
 * whereas the ImageBitmap orientation option is still uneven across Safari.
 */
function loadElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = async () => {
      try {
        if (img.decode) await img.decode().catch(() => {});
      } finally {
        resolve({ img, url });
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode-failed'));
    };
    img.src = url;
  });
}

function fitWithin(w, h, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/**
 * Halving repeatedly before the final draw. A single large downscale step in
 * canvas produces visible aliasing on detailed photos.
 */
export function resample(source, sw, sh, tw, th) {
  let curW = sw;
  let curH = sh;
  let current = source;

  while (curW / 2 >= tw && curH / 2 >= th && curW > 2 && curH > 2) {
    const nw = Math.max(tw, Math.floor(curW / 2));
    const nh = Math.max(th, Math.floor(curH / 2));
    const step = document.createElement('canvas');
    step.width = nw;
    step.height = nh;
    const sctx = step.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(current, 0, 0, curW, curH, 0, 0, nw, nh);
    current = step;
    curW = nw;
    curH = nh;
  }

  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, curW, curH, 0, 0, tw, th);
  return out;
}

export async function loadImageFile(file) {
  if (!ACCEPTED.test(file.type) && !/\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name)) {
    throw new Error('unsupported-type');
  }

  const { img, url } = await loadElement(file);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  if (!naturalW || !naturalH) {
    URL.revokeObjectURL(url);
    throw new Error('empty-image');
  }

  const previewSize = fitWithin(naturalW, naturalH, PREVIEW_MAX_EDGE);
  const preview = resample(img, naturalW, naturalH, previewSize.w, previewSize.h);

  const thumbSize = fitWithin(previewSize.w, previewSize.h, THUMB_MAX_EDGE);
  const thumb = resample(preview, previewSize.w, previewSize.h, thumbSize.w, thumbSize.h);

  URL.revokeObjectURL(url);

  return {
    id: nextId(),
    name: file.name,
    blob: file,
    width: naturalW,
    height: naturalH,
    aspect: naturalW / naturalH,
    preview,
    thumb,
    focal: detectFocalPoint(thumb),
    tint: averageColor(thumb),
  };
}

/**
 * Decodes at (roughly) the resolution the export actually needs and nothing more.
 * Called one image at a time so peak memory stays at a single photo.
 */
export async function decodeForExport(asset, targetW, targetH) {
  const needW = Math.ceil(targetW);
  const needH = Math.ceil(targetH);

  if (needW <= asset.preview.width && needH <= asset.preview.height) {
    return { source: asset.preview, release: () => {} };
  }
  if (needW >= asset.width && needH >= asset.height) {
    const { img, url } = await loadElement(asset.blob);
    return { source: img, release: () => URL.revokeObjectURL(url) };
  }

  const { img, url } = await loadElement(asset.blob);
  const scale = Math.min(1, Math.max(needW / asset.width, needH / asset.height));
  const w = Math.max(1, Math.round(asset.width * scale));
  const h = Math.max(1, Math.round(asset.height * scale));
  const canvas = resample(img, asset.width, asset.height, w, h);
  URL.revokeObjectURL(url);
  return { source: canvas, release: () => {} };
}

export async function loadFiles(fileList, { onProgress } = {}) {
  const files = [...fileList].filter(
    (f) => ACCEPTED.test(f.type) || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(f.name)
  );
  const loaded = [];
  const failed = [];

  for (let i = 0; i < files.length; i++) {
    try {
      loaded.push(await loadImageFile(files[i]));
    } catch {
      failed.push(files[i].name);
    }
    onProgress?.(i + 1, files.length);
  }

  return { loaded, failed, skipped: [...fileList].length - files.length };
}
