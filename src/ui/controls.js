import { randomSeed } from '../core/rng.js';
import {
  PRESET_GROUPS,
  resolveBoardSize,
  formatSize,
  exportPixels,
  maxCanvasMegapixels,
} from '../core/units.js';
import { computeLayout, arrangeItemsForCells } from '../layout/index.js';
import { cellTilt } from '../render/renderer.js';
import { CATEGORIES } from '../render/decor/index.js';
import { CUT_STYLES, CUT_LABELS } from '../render/shapes.js';

const $ = (id) => document.getElementById(id);
const labelOf = (label) => (typeof label === 'string' ? label : label.pt);
const MIN_PRINT_DPI = 150;

/**
 * Uma foto tem um formato só. Recorte simples e estilo de categoria respondem à
 * mesma pergunta — "que forma esta foto tem" — e para o renderer são o mesmo
 * campo. Ficam na mesma lista; o que muda entre eles é a família, não o tipo.
 */
const FAMILIES = [
  { id: 'basico', label: 'Básicos', styles: CUT_STYLES.map((id) => ({ id, label: CUT_LABELS[id] })) },
  ...CATEGORIES,
];

const familyOf = (cut) => FAMILIES.find((f) => f.styles.some((s) => s.id === cut)) || FAMILIES[0];

/**
 * Binds the sidebar to the store. The store is the single source of truth: every
 * widget writes into it and reads back out of the subscription, so undo, redo and
 * loading a project all move the controls without any extra wiring.
 *
 * Export options are deliberately kept out of the store — they describe the file
 * being produced, not the artwork, and putting them in the undo history would
 * mean "undo" could silently change what a print shop receives.
 */
export function bindControls({ store, assetStore, getLayout, onSurfaceImage }) {
  const exportSettings = { format: 'png', dpi: 300, bleedMm: 3, cropMarks: false };
  const binders = [];

  fillPresets();

  /* --------------------------------------------------------- 0. esta foto */

  itemSeg('photo-tint', {
    read: (item) => item.tint || 'none',
    write: (item, v) => {
      item.tint = v === 'none' ? null : v;
    },
  });

  itemSlider('photo-frame', {
    read: (item) => item.frameMm || 0,
    write: (item, v) => {
      item.frameMm = v;
    },
    format: (v) => `${v} mm`,
    step: 0.5,
  });

  itemColor('photo-frame-color', {
    read: (item) => item.frameColor || '#ffffff',
    write: (item, v) => {
      item.frameColor = v;
    },
  });

  itemSlider('photo-size', {
    read: (item) => (item.place?.sw ?? 1) * 100,
    write: (item, v) => {
      const place = { dx: 0, dy: 0, sw: 1, sh: 1, ...(item.place || {}) };
      // Keep whatever aspect the corner grips produced, and move both axes with it.
      const ratio = place.sh / place.sw;
      item.place = { ...place, sw: v / 100, sh: (v / 100) * ratio };
    },
    format: (v) => `${v}%`,
  });

  itemSlider('photo-tilt', {
    read: (item, state) => {
      if (item.tiltDeg !== null && item.tiltDeg !== undefined) return item.tiltDeg;
      // Untouched pieces still sit at an angle the layout chose — start there so
      // the first drag of the slider does not jump.
      const cell = getLayout?.()?.cells.find((c) => c.itemId === item.id);
      return cell ? cellTilt(cell, state) : 0;
    },
    write: (item, v) => {
      item.tiltDeg = v;
    },
    format: (v) => `${v}°`,
  });

  itemSlider('photo-elevation', {
    read: (item) => (item.elevation ?? 1) * 100,
    write: (item, v) => {
      item.elevation = v / 100;
    },
    format: (v) => `${v}%`,
  });

  $('btn-photo-front').addEventListener('click', () => restack(1));
  $('btn-photo-back').addEventListener('click', () => restack(-1));

  $('btn-photo-reset').addEventListener('click', () => {
    patchSelected((item) => {
      item.cutOverride = null;
      item.tint = null;
      item.frameMm = 0;
      item.tiltDeg = null;
      item.elevation = 1;
      item.place = null;
      item.z = 0;
      item.offset = { x: 0, y: 0 };
      item.zoom = 1;
      item.rotationDeg = 0;
    }, { reason: 'photo-reset' });
  });

  /* ------------------------------------------------------------ 2. tamanho */

  const preset = $('board-preset');
  preset.addEventListener('change', () => {
    store.update((d) => {
      d.board.presetId = preset.value;
    });
  });

  bindSeg('orientation', {
    read: (s) => s.board.orientation,
    write: (d, v) => {
      d.board.orientation = v;
    },
  });

  bindNumber('custom-w', {
    read: (s) => s.board.customW / 10,
    write: (d, v) => {
      d.board.customW = v * 10;
    },
    coalesce: 'custom-w',
  });
  bindNumber('custom-h', {
    read: (s) => s.board.customH / 10,
    write: (d, v) => {
      d.board.customH = v * 10;
    },
    coalesce: 'custom-h',
  });

  /* ------------------------------------------------------------ 3. arranjo */

  bindSeg('engine', {
    read: (s) => s.layout.engine,
    write: (d, v) => {
      d.layout.engine = v;
      reflow(d);
    },
  });

  $('btn-shuffle').addEventListener('click', () => {
    store.update((d) => {
      d.layout.seed = randomSeed();
      reflow(d);
    });
  });

  bindSlider('margin', {
    read: (s) => s.layout.marginMm,
    write: (d, v) => {
      d.layout.marginMm = v;
    },
    format: (v) => `${v} mm`,
  });
  bindSlider('gutter', {
    read: (s) => s.layout.gutterMm,
    write: (d, v) => {
      d.layout.gutterMm = v;
    },
    format: (v) => `${v} mm`,
  });
  bindSlider('variety', {
    read: (s) => s.layout.variety * 100,
    write: (d, v) => {
      d.layout.variety = v / 100;
    },
  });

  /* ------------------------------------------------------------- 1. estilo */

  // Um controle só para o formato. O alvo é a foto selecionada; sem seleção, o
  // padrão do quadro. Dois controles separados só diferiam em escopo, e escopo é
  // invisível: o override da foto ganhava do padrão do quadro sem avisar ninguém.
  let cutFamily = FAMILIES[0].id;
  let cutKey = null;

  fillSeg($('cut-family'), FAMILIES.map((f) => ({ value: f.id, label: f.label })));
  fillCutList();

  $('cut-family').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    cutFamily = btn.dataset.value;
    fillCutList();
    sync(store.get());
  });

  $('cut').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    const value = btn.dataset.value;
    const s = store.get();
    const target = selectedItem(s);
    if ((target ? target.cutOverride : s.style.cut) === value) return;
    store.update((d) => {
      const item = d.items.find((i) => i.id === s.selectedId);
      if (item) item.cutOverride = value;
      else d.style.cut = value;
    }, { reason: 'cut' });
  });

  $('cut-inherit').addEventListener('click', () => {
    patchSelected((item) => {
      item.cutOverride = null;
    }, { reason: 'cut' });
  });

  binders.push((s) => {
    const item = selectedItem(s);
    const cut = item?.cutOverride || s.style.cut;
    // A família só se move quando o formato muda de fato. Reagir a toda pintura
    // desfaria o clique de quem está apenas olhando outra categoria.
    const key = `${s.selectedId}:${cut}`;
    if (key !== cutKey) {
      cutKey = key;
      if (familyOf(cut).id !== cutFamily) {
        cutFamily = familyOf(cut).id;
        fillCutList();
      }
    }
    paintSeg($('cut-family'), cutFamily);
    paintSeg($('cut'), cut);
    $('cut-scope').textContent = item ? 'Formato desta foto' : 'Formato de todas as fotos';
    $('cut-inherit').hidden = !item?.cutOverride;
  });

  bindSlider('tear', {
    read: (s) => s.style.tear * 100,
    write: (d, v) => {
      d.style.tear = v / 100;
    },
  });
  bindSlider('fringe', {
    read: (s) => s.style.fringe * 100,
    write: (d, v) => {
      d.style.fringe = v / 100;
    },
  });
  bindSlider('shadow', {
    read: (s) => s.style.shadow * 100,
    write: (d, v) => {
      d.style.shadow = v / 100;
    },
  });
  bindSlider('tilt', {
    read: (s) => s.style.tilt * 100,
    write: (d, v) => {
      d.style.tilt = v / 100;
    },
  });
  bindSlider('tape', {
    read: (s) => s.style.tape * 100,
    write: (d, v) => {
      d.style.tape = v / 100;
    },
  });
  bindSlider('radius', {
    read: (s) => s.style.radiusMm,
    write: (d, v) => {
      d.style.radiusMm = v;
    },
    format: (v) => `${v} mm`,
  });

  /* -------------------------------------------------------------- 4. fundo */

  bindSeg('surface-kind', {
    read: (s) => s.surface.kind,
    write: (d, v) => {
      d.surface.kind = v;
    },
    after: (v) => {
      if (v === 'image' && !store.get().surface.assetId) onSurfaceImage();
    },
  });

  bindColor('surface-color', {
    read: (s) => s.surface.color,
    write: (d, v) => {
      d.surface.color = v;
    },
  });
  bindColor('surface-color-b', {
    read: (s) => s.surface.colorB,
    write: (d, v) => {
      d.surface.colorB = v;
    },
  });

  bindSlider('grain', {
    read: (s) => s.surface.grain * 100,
    write: (d, v) => {
      d.surface.grain = v / 100;
    },
  });
  bindSlider('vignette', {
    read: (s) => s.surface.vignette * 100,
    write: (d, v) => {
      d.surface.vignette = v / 100;
    },
  });

  /* ----------------------------------------------------------- 5. exportar */

  const formatGroup = $('export-format');
  formatGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    exportSettings.format = btn.dataset.value;
    paintSeg(formatGroup, exportSettings.format);
    sync(store.get());
  });

  const dpiSelect = $('export-dpi');
  dpiSelect.value = String(exportSettings.dpi);
  dpiSelect.addEventListener('change', () => {
    exportSettings.dpi = Number(dpiSelect.value);
    sync(store.get());
  });

  const bleed = $('export-bleed');
  bleed.value = String(exportSettings.bleedMm);
  bleed.addEventListener('input', () => {
    exportSettings.bleedMm = clampInput(bleed);
    sync(store.get());
  });

  const crop = $('export-crop');
  crop.checked = exportSettings.cropMarks;
  crop.addEventListener('change', () => {
    exportSettings.cropMarks = crop.checked;
    sync(store.get());
  });

  /* ------------------------------------------------------------------ sync */

  store.subscribe(sync);
  sync(store.get());

  return {
    getExportSettings: () => ({ ...exportSettings }),
    refresh: () => sync(store.get()),
  };

  /* --------------------------------------------------------------- helpers */

  function reflow(draft) {
    if (draft.layout.engine === 'scatter' || draft.items.length < 2) return;
    const next = computeLayout(draft, assetStore);
    draft.items = arrangeItemsForCells(draft.items, next.cells, assetStore);
  }

  function fillPresets() {
    const select = $('board-preset');
    const frag = document.createDocumentFragment();
    for (const group of PRESET_GROUPS) {
      const og = document.createElement('optgroup');
      og.label = labelOf(group.label);
      for (const item of group.items) {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = labelOf(item.label);
        og.appendChild(opt);
      }
      frag.appendChild(og);
    }
    const free = document.createElement('optgroup');
    free.label = 'Livre';
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Personalizado';
    free.appendChild(custom);
    frag.appendChild(free);
    select.appendChild(frag);
  }

  function bindSeg(id, { read, write, after }) {
    const group = $(id);
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-value]');
      if (!btn || !group.contains(btn)) return;
      const value = btn.dataset.value;
      if (read(store.get()) !== value) store.update((d) => write(d, value));
      after?.(value);
    });
    binders.push((s) => paintSeg(group, read(s)));
  }

  function bindSlider(id, { read, write, format }) {
    const input = $(id);
    const out = $(`${id}-value`);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (out) out.textContent = format ? format(value) : String(value);
      store.update((d) => write(d, value), { coalesce: id });
    });
    binders.push((s) => {
      const value = Math.round(read(s));
      if (document.activeElement !== input) input.value = String(value);
      if (out) out.textContent = format ? format(value) : String(value);
    });
  }

  function bindNumber(id, { read, write, coalesce }) {
    const input = $(id);
    input.addEventListener('input', () => {
      const value = clampInput(input);
      if (Number.isFinite(value)) store.update((d) => write(d, value), { coalesce });
    });
    binders.push((s) => {
      if (document.activeElement !== input) input.value = String(round1(read(s)));
    });
  }

  function bindColor(id, { read, write }) {
    const input = $(id);
    input.addEventListener('input', () => {
      store.update((d) => write(d, input.value), { coalesce: id });
    });
    binders.push((s) => {
      if (document.activeElement !== input) input.value = read(s);
    });
  }

  /* ----------------------------------------------------------- por foto -- */

  function selectedItem(s) {
    return s.items.find((i) => i.id === s.selectedId) || null;
  }

  function patchSelected(recipe, options) {
    const id = store.get().selectedId;
    if (!id) return;
    store.update((d) => {
      const item = d.items.find((i) => i.id === id);
      if (item) recipe(item);
    }, options);
  }

  function restack(direction) {
    store.update((d) => {
      const item = d.items.find((i) => i.id === d.selectedId);
      if (!item) return;
      const layers = d.items.map((i) => i.z || 0);
      item.z = direction > 0 ? Math.max(...layers) + 1 : Math.min(...layers) - 1;
    }, { reason: 'restack' });
  }

  /**
   * The per-photo widgets differ from the board ones in one way: they address
   * whichever item is selected, so they read through the selection and go quiet
   * when there is none.
   */
  function itemSeg(id, { read, write }) {
    const group = $(id);
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-value]');
      if (!btn || !group.contains(btn)) return;
      patchSelected((item) => write(item, btn.dataset.value), { reason: id });
    });
    binders.push((s) => {
      const item = selectedItem(s);
      if (item) paintSeg(group, read(item, s));
    });
  }

  function fillCutList() {
    const family = FAMILIES.find((f) => f.id === cutFamily) || FAMILIES[0];
    const group = $('cut');
    // Nome de categoria é frase inteira ("Cartão de embarque") e a grade de duas
    // colunas o cortaria; recorte simples é uma palavra e cabe em duas colunas.
    group.classList.toggle('seg--decor', family.id !== 'basico');
    fillSeg(group, family.styles.map((s) => ({ value: s.id, label: s.label })));
  }

  function itemSlider(id, { read, write, format, step = 1 }) {
    const input = $(id);
    const out = $(`${id}-value`);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (out) out.textContent = format ? format(value) : String(value);
      patchSelected((item) => write(item, value), { coalesce: id, reason: id });
    });
    binders.push((s) => {
      const item = selectedItem(s);
      if (!item) return;
      const value = Math.round(read(item, s) / step) * step;
      if (document.activeElement !== input) input.value = String(value);
      if (out) out.textContent = format ? format(value) : String(value);
    });
  }

  function itemColor(id, { read, write }) {
    const input = $(id);
    input.addEventListener('input', () => {
      patchSelected((item) => write(item, input.value), { coalesce: id, reason: id });
    });
    binders.push((s) => {
      const item = selectedItem(s);
      if (item && document.activeElement !== input) input.value = read(item, s);
    });
  }

  function sync(state) {
    for (const paint of binders) paint(state);
    $('photo-group').hidden = !selectedItem(state);

    preset.value = state.board.presetId;
    $('custom-size').hidden = state.board.presetId !== 'custom';

    const torn = state.style.cut === 'torn';
    setEnabled('tear', torn);
    setEnabled('fringe', torn);
    setEnabled('radius', state.style.cut === 'rounded' || state.style.cut === 'polaroid');
    setEnabled('surface-color-b', state.surface.kind === 'gradient');

    paintSeg(formatGroup, exportSettings.format);

    const board = resolveBoardSize(state.board);
    const px = exportPixels(board, exportSettings.dpi, exportSettings.bleedMm);
    $('size-readout').textContent = `${formatSize(board)} · ${px.w} × ${px.h} px`;
    $('export-readout').textContent =
      `${exportSettings.format.toUpperCase()} · ${px.w} × ${px.h} px · ${px.megapixels.toFixed(1)} MP`;

    paintWarning(state, board, px);
  }

  function paintWarning(state, board, px) {
    const el = $('export-warning');
    const limit = maxCanvasMegapixels();

    if (px.megapixels > limit) {
      el.textContent =
        `Este arquivo tem ${px.megapixels.toFixed(0)} MP e passa do limite de ${limit} MP ` +
        'deste navegador. Reduza a resolução ou o tamanho do quadro.';
      el.hidden = false;
      return;
    }

    const low = countLowResolution(state, board);
    if (low > 0) {
      el.textContent =
        low === 1
          ? `1 foto fica abaixo de ${MIN_PRINT_DPI} dpi neste tamanho — pode sair borrada na gráfica.`
          : `${low} fotos ficam abaixo de ${MIN_PRINT_DPI} dpi neste tamanho — podem sair borradas na gráfica.`;
      el.hidden = false;
      return;
    }

    el.hidden = true;
    el.textContent = '';
  }

  /** Effective resolution of each photo once stretched to cover its cell. */
  function countLowResolution(state, board) {
    const layout = getLayout?.() ?? computeLayout(state, assetStore);
    if (!layout || layout.board.widthMm !== board.widthMm) return 0;

    let low = 0;
    for (const cell of layout.cells) {
      const asset = assetStore.get(cell.assetId);
      if (!asset) continue;
      const zoom = cell.item?.zoom || 1;
      const dpi = Math.min(asset.width / (cell.w / 25.4), asset.height / (cell.h / 25.4)) / zoom;
      if (dpi < MIN_PRINT_DPI) low++;
    }
    return low;
  }

  function setEnabled(id, on) {
    const input = $(id);
    if (!input) return;
    input.disabled = !on;
    input.closest('.slider, .swatch, .field')?.classList.toggle('is-muted', !on);
  }
}

/** Rebuilds a segmented group. Delegated listeners survive it; per-button ones would not. */
function fillSeg(group, options) {
  group.replaceChildren(...options.map((o) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg__btn';
    btn.dataset.value = o.value;
    btn.textContent = labelOf(o.label);
    btn.setAttribute('aria-pressed', 'false');
    return btn;
  }));
}

function paintSeg(group, value) {
  for (const btn of group.querySelectorAll('[data-value]')) {
    const on = btn.dataset.value === value;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function clampInput(input) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return Number(input.min) || 0;
  return Math.min(Number(input.max), Math.max(Number(input.min), value));
}

const round1 = (v) => Math.round(v * 10) / 10;
