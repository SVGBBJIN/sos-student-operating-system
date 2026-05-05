import React, { useState, useEffect, useRef } from 'react';
import { sb } from '../../lib/supabase.js';

const COLOR_SWATCHES = [
  { label: 'Primary',  value: 'var(--primary)' },
  { label: 'Error',    value: 'var(--error)' },
  { label: 'Warning',  value: 'hsl(38,92%,50%)' },
  { label: 'Info',     value: 'hsl(200,95%,55%)' },
  { label: 'Purple',   value: 'hsl(260,45%,65%)' },
];

/**
 * EventEditPopover — inline edit popover anchored to an event element.
 *
 * Props:
 *   event         — event object { id, title, date, start_time, end_time, color }
 *   anchorRect    — DOMRect of the clicked event element
 *   onSave        — (updatedEvent) => void   (optimistic)
 *   onClose       — () => void
 *   userId        — string
 */
export default function EventEditPopover({ event, anchorRect, onSave, onClose, userId }) {
  const [title,     setTitle]     = useState(event?.title     || '');
  const [date,      setDate]      = useState(event?.date || event?.event_date || '');
  const [startTime, setStartTime] = useState(event?.start_time || event?.startTime || event?.time || '');
  const [endTime,   setEndTime]   = useState(event?.end_time || event?.endTime || '');
  const [color,     setColor]     = useState(event?.color     || 'var(--primary)');
  const [saving,    setSaving]    = useState(false);
  const popoverRef = useRef(null);

  // Position: below anchor, clamped to viewport
  const style = (() => {
    if (!anchorRect) return { top: 100, left: 100 };
    let top  = anchorRect.bottom + 6;
    let left = anchorRect.left;
    const pw = 240, ph = 280;
    if (left + pw > window.innerWidth  - 8) left = window.innerWidth  - pw - 8;
    if (top  + ph > window.innerHeight - 8) top  = anchorRect.top - ph - 6;
    return { top, left };
  })();

  // Close on Escape or outside click
  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    function handleClick(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('keydown',   handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown',   handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  async function handleSave() {
    const updated = { ...event, title, date, start_time: startTime, end_time: endTime, time: startTime || null, color };
    onSave(updated);   // optimistic
    onClose();
    setSaving(true);
    try {
      await sb.from('events').upsert({
        id: updated.id,
        user_id: userId,
        title: updated.title,
        event_type: updated.type || updated.event_type || 'other',
        subject: updated.subject || '',
        event_date: updated.date,
        start_time: updated.start_time || null,
        end_time: updated.end_time || null,
        description: updated.description || '',
        location: updated.location || '',
        priority: updated.priority || 'medium',
        color: updated.color || null,
        recurring: updated.recurring || 'none',
        created_at: updated.createdAt || updated.created_at || new Date().toISOString(),
        google_id: updated.googleId || updated.google_id || null,
        source: updated.source || 'manual',
      }, { onConflict: 'id' });
    } catch { /* silent — optimistic update already applied */ }
    setSaving(false);
  }

  const inputStyle = {
    width: '100%',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: 'var(--spacing-2) var(--spacing-3)',
    color: 'var(--foreground)',
    fontFamily: 'var(--font-ui)',
    fontSize: 13,
    marginBottom: 6,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: style.top,
        left: style.left,
        width: 240,
        background: 'var(--popup)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)',
        padding: 'var(--spacing-4)',
        zIndex: 'calc(var(--z-overlay) + 10)',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Event title"
        style={inputStyle}
        onFocus={e => { e.target.style.boxShadow = 'var(--shadow-focus)'; }}
        onBlur={e  => { e.target.style.boxShadow = 'none'; }}
      />
      <input
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        style={inputStyle}
        onFocus={e => { e.target.style.boxShadow = 'var(--shadow-focus)'; }}
        onBlur={e  => { e.target.style.boxShadow = 'none'; }}
      />
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          type="time"
          value={startTime}
          onChange={e => setStartTime(e.target.value)}
          style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
          onFocus={e => { e.target.style.boxShadow = 'var(--shadow-focus)'; }}
          onBlur={e  => { e.target.style.boxShadow = 'none'; }}
        />
        <input
          type="time"
          value={endTime}
          onChange={e => setEndTime(e.target.value)}
          style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
          onFocus={e => { e.target.style.boxShadow = 'var(--shadow-focus)'; }}
          onBlur={e  => { e.target.style.boxShadow = 'none'; }}
        />
      </div>

      {/* Color swatches */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--spacing-4)' }}>
        {COLOR_SWATCHES.map(sw => (
          <button
            key={sw.value}
            title={sw.label}
            onClick={() => setColor(sw.value)}
            style={{
              width: 20, height: 20,
              borderRadius: 'var(--radius-full)',
              background: sw.value,
              border: color === sw.value ? '2px solid var(--foreground)' : '1px solid var(--border)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1,
            background: 'var(--primary)',
            color: 'var(--primary-foreground)',
            border: 'none',
            borderRadius: 'var(--radius)',
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
            fontWeight: 600,
            padding: 'var(--spacing-2) var(--spacing-4)',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          Save
        </button>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--muted-foreground)',
            borderRadius: 'var(--radius)',
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
            padding: 'var(--spacing-2) var(--spacing-4)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
