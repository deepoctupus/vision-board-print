import { createStore } from './core/store.js';
import { randomSeed } from './core/rng.js';
import { AssetStore, loadFiles } from './images/loader.js';
import { exportBoard, downloadBlob } from './export/index.js';
import { computeLayout, arrangeItemsForCells } from './layout/index.js';
import { createStage } from './ui/stage.js';
import { bindControls } from './ui/controls.js';
import { toast } from './ui/toast.js';

const $ = (id) => document.getElementById(id);

const PHASES = {
  preparing: 'Preparando…',
  decoding: 'Lendo as fotos…',
  rendering: 'Desenhando o quadro…',
  encoding: 'Gerando o arquivo…',
  done: 'Pronto',
};

const store = createStore();
const assetStore = new AssetStore();

const canvas = $('board-canvas');
const stage = createStage({
  canvas,
  viewport: $('stage'),
  store,
  assetStore,
  onZoomChange: (percent) => {
    $('zoom-level').textContent = `${percent}%`;
  },
});

const controls = bindControls({
  store,
  assetStore,
  getLayout: stage.getLayout,
  onSurfaceImage: () => openPicker('surface'),
});

/* ============================================================== arquivos == */

const fileInput = $('file-input');
let picker = 'add';

function openPicker(mode) {
  picker = mode;
  fileInput.click();
}

fileInput.addEventListener('change', () => {
  const files = fileInput.files;
  if (files?.length) intake(files);
  fileInput.value = '';
});

$('btn-add-photos').addEventListener('click', () => openPicker('add'));
$('btn-pick-empty').addEventListener('click', () => openPicker('add'));

async function intake(fileList) {
  const mode = picker;
  picker = 'add';

  showProgress(0, 'Lendo as fotos…');
  const { loaded, failed, skipped } = await loadFiles(fileList, {
    onProgress: (done, total) => showProgress(done / total, `Lendo as fotos… ${done}/${total}`),
  });
  hideProgress();

  for (const asset of loaded) assetStore.add(asset);

  if (!loaded.length) {
    toast('Nenhuma imagem pôde ser lida.', 'error');
    return;
  }

  if (mode === 'surface') {
    store.update((d) => {
      d.surface.kind = 'image';
      d.surface.assetId = loaded[0].id;
    }, { reason: 'surface-image' });
  } else if (typeof mode === 'object' && mode.replace) {
    const asset = loaded[0];
    store.update((d) => {
      const item = d.items.find((i) => i.id === mode.replace);
      if (item) {
        item.assetId = asset.id;
        item.focal = { ...asset.focal };
        item.offset = { x: 0, y: 0 };
        item.zoom = 1;
        item.rotationDeg = 0;
      }
    }, { reason: 'replace' });
  } else {
    store.update((d) => {
      for (const asset of loaded) d.items.push(makeItem(asset));
      // A new photo is only useful in a slot that suits its shape.
      if (d.layout.engine !== 'scatter' && d.items.length > 1) {
        d.items = arrangeItemsForCells(d.items, computeLayout(d, assetStore).cells, assetStore);
      }
    }, { reason: 'add-photos' });
  }

  const notes = [];
  if (failed.length) notes.push(`${failed.length} não abriu`);
  if (skipped) notes.push(`${skipped} ignorado por não ser imagem`);
  if (notes.length) toast(notes.join(' · '), 'error');
}

let itemCounter = 0;
function makeItem(asset) {
  return {
    id: `it_${Date.now().toString(36)}_${(itemCounter++).toString(36)}`,
    assetId: asset.id,
    seed: randomSeed(),
    focal: { ...asset.focal },
    zoom: 1,
    rotationDeg: 0,
    offset: { x: 0, y: 0 },
    cutOverride: null,
    tint: null,
    frameMm: 0,
    frameColor: '#ffffff',
    tiltDeg: null,
    elevation: 1,
    place: null,
    z: 0,
  };
}

/* =========================================================== arrastar ===== */

const dropOverlay = $('drop-overlay');
let dragDepth = 0;
const carriesFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!carriesFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay.hidden = true;
});
window.addEventListener('drop', (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  picker = 'add';
  intake(e.dataTransfer.files);
});

/* ============================================================== bandeja === */

const tray = $('photo-tray');
let traySig = '';

tray.addEventListener('click', (e) => {
  const remove = e.target.closest('[data-remove]');
  if (remove) {
    removeItem(remove.closest('[data-item-id]').dataset.itemId);
    return;
  }
  const cell = e.target.closest('[data-item-id]');
  if (cell) select(cell.dataset.itemId);
});

function buildTray(state) {
  tray.textContent = '';
  const frag = document.createDocumentFragment();
  for (const item of state.items) {
    const asset = assetStore.get(item.assetId);
    const cell = document.createElement('div');
    cell.className = 'tray__item';
    cell.dataset.itemId = item.id;

    const img = document.createElement('img');
    img.alt = asset?.name || '';
    img.src = thumbUrl(asset);
    cell.appendChild(img);

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tray__x';
    x.dataset.remove = '1';
    x.title = 'Remover';
    x.setAttribute('aria-label', `Remover ${asset?.name || 'foto'}`);
    x.textContent = '×';
    cell.appendChild(x);

    frag.appendChild(cell);
  }
  tray.appendChild(frag);
}

const thumbCache = new Map();
function thumbUrl(asset) {
  if (!asset) return '';
  let url = thumbCache.get(asset.id);
  if (!url) {
    url = asset.thumb.toDataURL('image/jpeg', 0.72);
    thumbCache.set(asset.id, url);
  }
  return url;
}

/* ======================================================= seleção / célula = */

const cellToolbar = $('cell-toolbar');
const cellZoom = $('cell-zoom');

function select(id) {
  store.update((d) => {
    d.selectedId = d.selectedId === id ? null : id;
  }, { history: false, reason: 'select' });
}

function removeItem(id) {
  store.update((d) => {
    d.items = d.items.filter((i) => i.id !== id);
    if (d.selectedId === id) d.selectedId = null;
  }, { reason: 'remove' });
}

function patchSelected(recipe, options) {
  const id = store.get().selectedId;
  if (!id) return;
  store.update((d) => {
    const item = d.items.find((i) => i.id === id);
    if (item) recipe(item);
  }, options);
}

$('btn-cell-remove').addEventListener('click', () => {
  const id = store.get().selectedId;
  if (id) removeItem(id);
});

$('btn-cell-rotate').addEventListener('click', () => {
  patchSelected((item) => {
    item.rotationDeg = ((item.rotationDeg || 0) + 90) % 360;
    item.offset = { x: 0, y: 0 };
  }, { reason: 'rotate' });
});

$('btn-cell-replace').addEventListener('click', () => {
  const id = store.get().selectedId;
  if (id) openPicker({ replace: id });
});

cellZoom.addEventListener('input', () => {
  const zoom = Number(cellZoom.value) / 100;
  patchSelected((item) => {
    item.zoom = zoom;
  }, { coalesce: 'cell-zoom', reason: 'zoom' });
});

/* ============================================================= histórico == */

const btnUndo = $('btn-undo');
const btnRedo = $('btn-redo');
btnUndo.addEventListener('click', () => store.undo());
btnRedo.addEventListener('click', () => store.redo());

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (mod && key === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }
  if (key === 'escape') {
    if (!$('sidebar').hidden && isNarrow.matches) closeSidebar();
    else if (store.get().selectedId) select(store.get().selectedId);
    return;
  }
  if ((key === 'delete' || key === 'backspace') && store.get().selectedId) {
    e.preventDefault();
    removeItem(store.get().selectedId);
  }
});

/* ================================================================= zoom === */

$('btn-zoom-in').addEventListener('click', stage.zoomIn);
$('btn-zoom-out').addEventListener('click', stage.zoomOut);
$('btn-zoom-fit').addEventListener('click', stage.zoomFit);

/* ============================================================== gaveta ==== */

const sidebar = $('sidebar');
const backdrop = $('sidebar-backdrop');
const btnMenu = $('btn-menu');
const isNarrow = window.matchMedia('(max-width: 1023px)');

function openSidebar() {
  sidebar.hidden = false;
  backdrop.hidden = false;
  btnMenu.setAttribute('aria-expanded', 'true');
}
function closeSidebar() {
  sidebar.hidden = true;
  backdrop.hidden = true;
  btnMenu.setAttribute('aria-expanded', 'false');
}
function applyBreakpoint() {
  if (isNarrow.matches) closeSidebar();
  else {
    sidebar.hidden = false;
    backdrop.hidden = true;
    btnMenu.setAttribute('aria-expanded', 'false');
  }
}
btnMenu.addEventListener('click', () => (sidebar.hidden ? openSidebar() : closeSidebar()));
backdrop.addEventListener('click', closeSidebar);
isNarrow.addEventListener('change', applyBreakpoint);
applyBreakpoint();

/* ============================================================= exportar === */

const progress = $('progress');
const progressFill = $('progress-fill');
const progressLabel = $('progress-label');
const btnExport = $('btn-export');

function showProgress(value, label) {
  progress.hidden = false;
  progressFill.style.width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  progress.setAttribute('aria-valuenow', String(Math.round(value * 100)));
  progressLabel.textContent = label;
}
function hideProgress() {
  progress.hidden = true;
  progressFill.style.width = '0%';
}

btnExport.addEventListener('click', runExport);

async function runExport() {
  const state = store.get();
  if (!state.items.length) {
    toast('Adicione fotos antes de exportar.', 'error');
    return;
  }

  const settings = controls.getExportSettings();
  btnExport.disabled = true;
  showProgress(0.02, 'Preparando…');

  try {
    const result = await exportBoard({
      state,
      assetStore,
      format: settings.format,
      dpi: settings.dpi,
      bleedMm: settings.bleedMm,
      cropMarks: settings.cropMarks,
      onProgress: (value, phase) => showProgress(value, PHASES[phase] || phase),
    });
    downloadBlob(result.blob, result.name);
    toast(`Arquivo pronto: ${result.name}`, 'success', 5000);
  } catch (err) {
    if (err?.message === 'canvas-too-large') {
      toast(
        `Nesse tamanho o arquivo daria ${Math.round(err.megapixels)} MP e o navegador só ` +
          `aguenta ${err.limit} MP. Escolha 150 dpi ou um formato menor.`,
        'error',
        8000
      );
    } else {
      toast('Não foi possível gerar o arquivo. Tente uma resolução menor.', 'error', 6000);
      console.error(err);
    }
  } finally {
    hideProgress();
    btnExport.disabled = false;
  }
}

/* ================================================================ sync ==== */

store.subscribe(paint);
paint(store.get());

function paint(state) {
  const sig = state.items.map((i) => `${i.id}:${i.assetId}`).join('|');
  if (sig !== traySig) {
    traySig = sig;
    buildTray(state);
  }
  for (const cell of tray.children) {
    cell.classList.toggle('is-active', cell.dataset.itemId === state.selectedId);
  }

  $('photo-count').textContent =
    state.items.length === 1 ? '1 foto' : `${state.items.length} fotos`;
  $('empty-state').hidden = state.items.length > 0;

  const selected = state.items.find((i) => i.id === state.selectedId);
  cellToolbar.hidden = !selected;
  if (selected && document.activeElement !== cellZoom) {
    cellZoom.value = String(Math.round((selected.zoom || 1) * 100));
  }

  btnUndo.disabled = !store.canUndo();
  btnRedo.disabled = !store.canRedo();
}

function isTyping(el) {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
}
