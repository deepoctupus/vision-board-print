import { randomSeed } from './rng.js';

/** Anything that is not JSON-serialisable (decoded bitmaps) lives in AssetStore, not here. */
export function createInitialState() {
  return {
    version: 1,
    board: {
      presetId: 'a3',
      orientation: 'portrait',
      customW: 300,
      customH: 400,
    },
    surface: {
      kind: 'paper',
      color: '#f4efe6',
      colorB: '#e2d6c4',
      angle: 145,
      grain: 0.35,
      vignette: 0.18,
      assetId: null,
    },
    layout: {
      engine: 'mosaic',
      seed: randomSeed(),
      gutterMm: 6,
      marginMm: 14,
      variety: 0.55,
    },
    style: {
      cut: 'torn',
      radiusMm: 4,
      tear: 0.6,
      fringe: 0.55,
      shadow: 0.7,
      tilt: 0.35,
      tape: 0,
      paperTone: '#fdfaf4',
    },
    caption: {
      enabled: false,
      text: '',
      font: 'display',
      size: 1,
      color: '#2b2622',
      position: 'bottom',
    },
    items: [],
    selectedId: null,
  };
}

const HISTORY_LIMIT = 60;
const COALESCE_MS = 600;

export function createStore(initial = createInitialState()) {
  let state = initial;
  let past = [];
  let future = [];
  let lastCoalesce = { key: null, at: 0 };
  const listeners = new Set();

  const snapshot = (s) => JSON.parse(JSON.stringify(s));

  function emit(reason) {
    for (const fn of listeners) fn(state, reason);
  }

  return {
    get: () => state,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * `recipe` mutates a draft copy. Pass `history:false` for ephemeral changes
     * (selection, hover) and `coalesce:'key'` for continuous input like sliders,
     * which collapses a drag into a single undo step.
     */
    update(recipe, { history = true, coalesce = null, reason = 'update' } = {}) {
      const draft = snapshot(state);
      const result = recipe(draft);
      const next = result === undefined ? draft : result;

      if (history) {
        const now = Date.now();
        const canMerge =
          coalesce && lastCoalesce.key === coalesce && now - lastCoalesce.at < COALESCE_MS;
        if (!canMerge) {
          past.push(snapshot(state));
          if (past.length > HISTORY_LIMIT) past.shift();
        }
        lastCoalesce = { key: coalesce, at: now };
        future = [];
      }

      state = next;
      emit(reason);
    },

    /** Replaces everything and clears history — for loading a project file. */
    replace(next, reason = 'replace') {
      past = [];
      future = [];
      state = next;
      emit(reason);
    },

    undo() {
      if (!past.length) return false;
      future.push(snapshot(state));
      state = past.pop();
      lastCoalesce = { key: null, at: 0 };
      emit('undo');
      return true;
    },

    redo() {
      if (!future.length) return false;
      past.push(snapshot(state));
      state = future.pop();
      lastCoalesce = { key: null, at: 0 };
      emit('redo');
      return true;
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
