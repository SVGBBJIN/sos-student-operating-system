// WikilinkAutocomplete — popover that opens when the user types `[[`.
//
// Owns the mechanics of detecting the trigger sequence, tracking the
// in-progress query, suggesting matches via searchEntities, and committing
// a selection (replacing `[[query` → `[[Selected Name]]`). Keyboard nav:
// ArrowUp/ArrowDown to move, Enter/Tab to commit, Escape to dismiss.
//
// Two adapters: useWikilinkOnTextarea (for plain <textarea> like the chat
// input) and useWikilinkOnContentEditable (for the note editor). Both call
// back with the resolved insertion when a candidate is selected.

import React, { useEffect, useRef, useState } from 'react';
import { searchEntities } from '../lib/wikilinkSearch.js';

function ENTITY_ICON(type) {
  if (type === 'note')  return '⊡';
  if (type === 'event') return '📅';
  if (type === 'task')  return '✓';
  return '•';
}

export function WikilinkPopover({ items, activeIdx, onPick, position }) {
  if (!items || items.length === 0) return null;
  return (
    <div
      className="wikilink-popover"
      style={{
        position: 'absolute',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        zIndex: 60,
        minWidth: 220,
        maxWidth: 320,
        background: 'var(--sidebar, rgba(20,22,38,0.96))',
        border: '1px solid var(--border, rgba(255,255,255,0.12))',
        borderRadius: 10,
        boxShadow: '0 10px 28px rgba(0,0,0,0.42)',
        padding: 4,
        backdropFilter: 'blur(8px)',
      }}
      onMouseDown={e => e.preventDefault() /* keep focus in editor */}
    >
      {items.map((item, i) => (
        <button
          key={`${item.type}-${item.id}`}
          type="button"
          onClick={() => onPick(item)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '6px 8px',
            border: 'none',
            background: i === activeIdx ? 'rgba(108,99,255,0.18)' : 'transparent',
            color: 'var(--text, #e0e4f0)',
            borderRadius: 6,
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: 13,
          }}
        >
          <span style={{ width: 14, opacity: 0.7 }}>{ENTITY_ICON(item.type)}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{item.subtitle}</span>
        </button>
      ))}
      <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--text-dim, rgba(255,255,255,0.45))' }}>
        ↑↓ navigate · ↵ insert · Esc cancel
      </div>
    </div>
  );
}

// Parses the text up to a caret position and returns either the in-progress
// wikilink query (if the caret sits inside an unclosed `[[ ...` sequence) or
// null. Detects the same `[[` we use in the parser.
export function getActiveWikilinkQuery(textBeforeCaret) {
  if (!textBeforeCaret) return null;
  const open = textBeforeCaret.lastIndexOf('[[');
  if (open === -1) return null;
  const between = textBeforeCaret.slice(open + 2);
  // bail if user already closed
  if (between.includes(']]')) return null;
  // bail if the query has a hard-line-break (long-form prevents drift)
  if (between.includes('\n')) return null;
  return { query: between, openIndex: open };
}

// Hook for plain <textarea> / <input>. Returns:
//  - inputProps to spread on the element (handles onChange + onKeyDown)
//  - popover JSX (or null) to render alongside
//  - controlled `value` and `setValue` are owned by caller
export function useWikilinkAutocomplete({
  value, setValue, inputRef, notes, events, tasks, limit = 8, onCommit,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const items = open ? searchEntities(query, { notes, events, tasks, limit }) : [];

  function recompute(nextValue, caret) {
    const before = nextValue.slice(0, caret);
    const q = getActiveWikilinkQuery(before);
    if (!q) { setOpen(false); return; }
    setOpen(true);
    setQuery(q.query);
    setActiveIdx(0);
    if (inputRef?.current) {
      const el = inputRef.current;
      const rect = el.getBoundingClientRect();
      // Anchor under the input by default — caret math against textareas is
      // unreliable enough that a fixed anchor under the box is the better UX.
      setPosition({
        top: rect.bottom - rect.top + 4,
        left: 8,
      });
    }
  }

  function commit(item) {
    if (!item || !inputRef?.current) return;
    const el = inputRef.current;
    const caret = el.selectionEnd ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const q = getActiveWikilinkQuery(before);
    if (!q) { setOpen(false); return; }
    const head = before.slice(0, q.openIndex); // text before "[["
    const inserted = `[[${item.title}]]`;
    const next = head + inserted + after;
    setValue(next);
    setOpen(false);
    onCommit?.(item);
    requestAnimationFrame(() => {
      try {
        const newCaret = head.length + inserted.length;
        el.focus();
        el.setSelectionRange(newCaret, newCaret);
      } catch (_) {}
    });
  }

  function onKeyDown(e) {
    if (!open || items.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(items[activeIdx]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  }

  function onChangeAdapter(e) {
    const next = e.target.value;
    setValue(next);
    requestAnimationFrame(() => {
      const caret = inputRef.current?.selectionEnd ?? next.length;
      recompute(next, caret);
    });
  }

  // Re-evaluate when `value` shifts externally
  useEffect(() => {
    if (!inputRef?.current || !open) return;
    const caret = inputRef.current.selectionEnd ?? value.length;
    recompute(value, caret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const popover = open && items.length > 0
    ? <WikilinkPopover items={items} activeIdx={activeIdx} onPick={commit} position={position} />
    : null;

  return {
    inputProps: { onChange: onChangeAdapter, onKeyDown },
    popover,
    isOpen: open,
  };
}
