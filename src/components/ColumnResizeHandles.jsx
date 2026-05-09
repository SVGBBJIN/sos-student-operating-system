// ColumnResizeHandles — the thin draggable divider between the lofi columns
// plus a single lock toggle button anchored to the bottom-right of the layout.
// Wires into useColumnLayout (passed in as `layout`).

import React from 'react';

const HANDLE_BASE = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  width: 6,
  height: 56,
  background: 'rgba(255,255,255,0.12)',
  borderRadius: 3,
  cursor: 'col-resize',
  zIndex: 30,
  transition: 'background 0.15s ease',
};

export function ColumnResizeHandles({ layout, containerRef }) {
  if (!layout || layout.locked) return null;

  function handleStart(idx, e) {
    if (!containerRef?.current) return;
    layout.startDrag(idx, e, containerRef.current);
  }

  // Position handles by computing accumulated fr widths.
  const w0 = layout.widths[0];
  const w1 = layout.widths[1];
  const total = layout.widths.reduce((a, b) => a + b, 0);
  const pad = 14; // matches .study-app padding
  const gap = 10; // matches .study-app gap
  const splitA = `calc(${pad}px + (100% - ${pad * 2}px - ${gap * 2}px) * ${(w0 / total).toFixed(4)} + ${gap / 2}px)`;
  const splitB = `calc(${pad}px + (100% - ${pad * 2}px - ${gap * 2}px) * ${((w0 + w1) / total).toFixed(4)} + ${gap * 1.5}px)`;
  return (
    <>
      <div
        className="column-resize-handle"
        title="Drag to resize"
        style={{ ...HANDLE_BASE, left: splitA }}
        onMouseDown={(e) => handleStart(0, e)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(108,99,255,0.6)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
      />
      <div
        className="column-resize-handle"
        title="Drag to resize"
        style={{ ...HANDLE_BASE, left: splitB }}
        onMouseDown={(e) => handleStart(1, e)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(108,99,255,0.6)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
      />
    </>
  );
}

export function ColumnLockToggle({ layout }) {
  if (!layout) return null;
  return (
    <button
      type="button"
      onClick={layout.toggleLock}
      title={layout.locked ? 'Unlock columns to resize' : 'Lock current column widths'}
      aria-label={layout.locked ? 'Unlock columns' : 'Lock columns'}
      style={{
        position: 'absolute',
        bottom: 18,
        right: 18,
        zIndex: 35,
        width: 36,
        height: 36,
        borderRadius: 10,
        border: '1px solid var(--border, rgba(255,255,255,0.15))',
        background: layout.locked ? 'rgba(108,99,255,0.18)' : 'rgba(255,255,255,0.04)',
        color: layout.locked ? '#c4b5fd' : 'var(--text-dim, rgba(255,255,255,0.6))',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
      onDoubleClick={layout.reset}
    >
      {layout.locked ? '🔒' : '🔓'}
    </button>
  );
}
