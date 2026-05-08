// useColumnLayout — owns the three lofi column widths and the lock state.
//
// Stored as `[leftFr, centerFr, rightFr]` (fractional flex weights, not px).
// Default mirrors the historical `1fr 1fr 220px` layout but expressed as
// `[1, 1, 0.32]` so resize math stays in fr-space and the right column
// scales proportionally on viewport changes.
//
// LocalStorage key: `sos_column_layout` → JSON{ widths, locked }.

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'sos_column_layout';
const DEFAULT_WIDTHS = [1.0, 1.0, 0.32];
const MIN_FR = 0.18;
const MAX_FR = 4.0;

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { widths: DEFAULT_WIDTHS, locked: false };
    const parsed = JSON.parse(raw);
    const widths = Array.isArray(parsed?.widths) && parsed.widths.length === 3
      ? parsed.widths.map(n => clamp(Number(n) || 0, MIN_FR, MAX_FR))
      : DEFAULT_WIDTHS;
    return { widths, locked: Boolean(parsed?.locked) };
  } catch (_) {
    return { widths: DEFAULT_WIDTHS, locked: false };
  }
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

export function useColumnLayout() {
  const init = loadInitial();
  const [widths, setWidths] = useState(init.widths);
  const [locked, setLocked] = useState(init.locked);
  const dragStateRef = useRef(null); // { dividerIdx, startX, startWidths, containerWidth }

  const persist = useCallback((nextWidths, nextLocked) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        widths: nextWidths ?? widths,
        locked: nextLocked ?? locked,
      }));
    } catch (_) {}
  }, [widths, locked]);

  const toggleLock = useCallback(() => {
    setLocked(prev => {
      const next = !prev;
      persist(undefined, next);
      return next;
    });
  }, [persist]);

  const reset = useCallback(() => {
    setWidths(DEFAULT_WIDTHS);
    persist(DEFAULT_WIDTHS, undefined);
  }, [persist]);

  // Mouse-driven resize. dividerIdx = 0 → between col0/col1, 1 → between col1/col2.
  const startDrag = useCallback((dividerIdx, e, containerEl) => {
    if (locked) return;
    e.preventDefault();
    const rect = containerEl.getBoundingClientRect();
    dragStateRef.current = {
      dividerIdx,
      startX: e.clientX,
      startWidths: [...widths],
      containerWidth: rect.width,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      const ds = dragStateRef.current;
      if (!ds) return;
      const dxPx = ev.clientX - ds.startX;
      // Convert px delta to fr delta. Total fr = sum of widths. px-per-fr = container/total.
      const totalFr = ds.startWidths.reduce((a, b) => a + b, 0);
      const pxPerFr = ds.containerWidth / totalFr;
      const dFr = dxPx / pxPerFr;
      const next = [...ds.startWidths];
      const a = ds.dividerIdx;
      const b = ds.dividerIdx + 1;
      const candidateA = clamp(next[a] + dFr, MIN_FR, MAX_FR);
      const candidateB = clamp(next[b] - dFr, MIN_FR, MAX_FR);
      // If either side hit a clamp boundary, freeze the move at the boundary.
      const usedDeltaA = candidateA - next[a];
      const usedDeltaB = next[b] - candidateB;
      const usedDelta = Math.abs(usedDeltaA) < Math.abs(usedDeltaB) ? usedDeltaA : -usedDeltaB;
      next[a] = next[a] + usedDelta;
      next[b] = next[b] - usedDelta;
      setWidths(next);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragStateRef.current = null;
      // Persist on release so we don't write localStorage on every move.
      setWidths(prev => { persist(prev, undefined); return prev; });
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [locked, widths, persist]);

  // Cleanup if the component unmounts mid-drag
  useEffect(() => () => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const gridTemplateColumns = widths.map(w => `${w.toFixed(3)}fr`).join(' ');

  return {
    widths,
    locked,
    toggleLock,
    reset,
    startDrag,
    gridTemplateColumns,
  };
}
