import React, { useState, useEffect, useRef } from 'react';
import CalendarWindow from './CalendarWindow/CalendarWindow.jsx';
import DOMPurify from 'dompurify';

/* ── Notes view ──────────────────────────────────────────────── */
function NotesView({ notes, onCreateNote, onUpdateNote, onDeleteNote }) {
  const [selected,  setSelected]  = useState(null);
  const [editing,   setEditing]   = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [search,    setSearch]    = useState('');
  const editorRef = useRef(null);

  function openNote(note) { setSelected(note); setEditing(false); }

  function startEdit() {
    setEditTitle(selected?.name || '');
    setEditing(true);
    setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = selected?.content || '';
    }, 0);
  }

  function saveNote() {
    if (!selected) return;
    const content = editorRef.current?.innerHTML || '';
    const updated = { ...selected, name: editTitle, content, updatedAt: new Date().toISOString() };
    onUpdateNote?.(updated);
    setSelected(updated);
    setEditing(false);
  }

  function createNote() {
    onCreateNote?.({ name: 'Untitled', content: '' });
  }

  const sorted = [...(notes || [])].sort((a, b) =>
    (b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1
  );
  const filtered = sorted.filter(n =>
    !search ||
    n.name.toLowerCase().includes(search.toLowerCase()) ||
    (n.content || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Sidebar */}
      <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--sidebar)' }}>
        <div style={{ padding: '8px' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px', color: 'var(--foreground)', fontFamily: 'var(--font-ui)', fontSize: 11, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <button
          onClick={createNote}
          style={{ margin: '0 8px 8px', background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600, padding: '4px 8px', cursor: 'pointer' }}
        >
          + New note
        </button>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map(note => (
            <div
              key={note.id}
              onClick={() => openNote(note)}
              style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?.id === note.id ? 'var(--muted)' : 'transparent', transition: 'background 0.12s ease' }}
              onMouseEnter={e => { if (selected?.id !== note.id) e.currentTarget.style.background = 'var(--surface)'; }}
              onMouseLeave={e => { if (selected?.id !== note.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600, color: 'var(--foreground)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {note.name || 'Untitled'}
              </div>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 10, color: 'var(--muted-foreground)' }}>
                {note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : ''}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--muted-foreground)' }}>
              No notes found
            </div>
          )}
        </div>
      </div>

      {/* Editor / viewer */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--background)' }}>
        {selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
              {editing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px', color: 'var(--foreground)', fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 600, outline: 'none' }}
                />
              ) : (
                <span style={{ flex: 1, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selected.name || 'Untitled'}
                </span>
              )}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {editing ? (
                  <>
                    <button onClick={saveNote} style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditing(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={startEdit} style={{ background: 'var(--muted)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => { onDeleteNote?.(selected.id); setSelected(null); }} style={{ background: 'transparent', border: '1px solid var(--error)', color: 'var(--error)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>Del</button>
                  </>
                )}
              </div>
            </div>
            {editing ? (
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                style={{ flex: 1, padding: '12px 14px', color: 'var(--foreground)', fontFamily: 'var(--font-ui)', fontSize: 13, lineHeight: 1.65, outline: 'none', overflowY: 'auto' }}
              />
            ) : (
              <div
                style={{ flex: 1, padding: '12px 14px', color: 'var(--foreground)', fontFamily: 'var(--font-ui)', fontSize: 13, lineHeight: 1.65, overflowY: 'auto' }}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selected.content || '') }}
              />
            )}
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', fontSize: 12 }}>
            Select a note to view or edit it
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Proofread placeholder ──────────────────────────────────── */
function ProofreadPlaceholder() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'var(--background)' }}>
      <span style={{ fontSize: 28, opacity: 0.45 }}>✦</span>
      <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, color: 'var(--foreground)' }}>
        Proofreading Mode
      </span>
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--muted-foreground)', maxWidth: 220, textAlign: 'center', lineHeight: 1.65 }}>
        AI grammar and style suggestions coming soon.
      </span>
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 10, color: 'var(--muted-foreground)', opacity: 0.5, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>
        Coming soon
      </span>
    </div>
  );
}

/* ── Main panel ──────────────────────────────────────────────── */
export default function LofiLeftPanel({
  events, userId, onEventUpdate,
  notes, onCreateNote, onUpdateNote, onDeleteNote,
}) {
  const [activeView, setActiveView] = useState('calendar');

  // AI auto-switch: new calendar event → calendar, new note → notes
  useEffect(() => {
    function onCalEvent()  { setActiveView('calendar'); }
    function onNoteEvent() { setActiveView('notes'); }
    window.addEventListener('sos:calendar:new-event', onCalEvent);
    window.addEventListener('sos:notes:created',      onNoteEvent);
    return () => {
      window.removeEventListener('sos:calendar:new-event', onCalEvent);
      window.removeEventListener('sos:notes:created',      onNoteEvent);
    };
  }, []);

  const views = [
    { id: 'calendar',  label: 'Calendar',  icon: '📅' },
    { id: 'notes',     label: 'Notes',     icon: '⊡' },
    { id: 'proofread', label: 'Proofread', icon: '✦' },
  ];

  return (
    <div className="study-left study-glass" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {activeView === 'calendar' && (
          <CalendarWindow
            embedded
            defaultSize="fullscreen"
            events={events || []}
            onEventUpdate={onEventUpdate}
            userId={userId}
          />
        )}
        {activeView === 'notes' && (
          <NotesView
            notes={notes || []}
            onCreateNote={onCreateNote}
            onUpdateNote={onUpdateNote}
            onDeleteNote={onDeleteNote}
          />
        )}
        {activeView === 'proofread' && <ProofreadPlaceholder />}
      </div>

      {/* Bottom toggle bar */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '6px 12px',
        borderTop: '1px solid var(--border)',
        background: 'var(--sidebar)',
      }}>
        {views.map(v => (
          <button
            key={v.id}
            onClick={() => setActiveView(v.id)}
            style={{
              background: activeView === v.id ? 'var(--muted)' : 'transparent',
              border: activeView === v.id ? '1px solid var(--primary)' : '1px solid transparent',
              color: activeView === v.id ? 'var(--primary)' : 'var(--muted-foreground)',
              borderRadius: 'var(--radius-full)',
              padding: '3px 14px',
              fontFamily: 'var(--font-ui)',
              fontSize: 11,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
