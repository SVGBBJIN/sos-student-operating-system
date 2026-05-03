import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { sb } from '../lib/supabase.js';
import DOMPurify from 'dompurify';
import CalendarWindow from '../components/CalendarWindow/CalendarWindow.jsx';

/* ─── Notes Panel ────────────────────────────────────────────────── */
function NotesContent({ user }) {
  const [notes,     setNotes]     = useState([]);
  const [search,    setSearch]    = useState('');
  const [selected,  setSelected]  = useState(null);
  const [editing,   setEditing]   = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const editorRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    sb.from('notes')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .then(({ data }) => { if (data) setNotes(data); });
  }, [user]);

  function openNote(note) { setSelected(note); setEditing(false); }

  function startEdit() {
    setEditTitle(selected?.name || '');
    setEditing(true);
    setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = selected?.content || '';
    }, 0);
  }

  async function saveNote() {
    if (!user || !selected) return;
    const content = editorRef.current?.innerHTML || '';
    const updated = { ...selected, name: editTitle, content, updated_at: new Date().toISOString() };
    setNotes(prev => prev.map(n => n.id === selected.id ? updated : n));
    setSelected(updated);
    setEditing(false);
    await sb.from('notes').upsert({ ...updated, user_id: user.id }, { onConflict: 'id' });
  }

  async function createNote() {
    if (!user) return;
    const now  = new Date().toISOString();
    const id   = crypto.randomUUID();
    const note = { id, name: 'Untitled', content: '', updated_at: now };
    setNotes(prev => [note, ...prev]);
    setSelected(note);
    setEditing(true);
    setEditTitle('Untitled');
    setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = ''; }, 0);
    await sb.from('notes').insert({ ...note, user_id: user.id });
  }

  async function deleteNote(id) {
    setNotes(prev => prev.filter(n => n.id !== id));
    if (selected?.id === id) setSelected(null);
    await sb.from('notes').delete().eq('id', id).eq('user_id', user.id);
  }

  const filtered = notes.filter(n =>
    !search || n.name.toLowerCase().includes(search.toLowerCase()) ||
    n.content?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Sidebar */}
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--sidebar)' }}>
        <div style={{ padding: 'var(--spacing-3)' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes..."
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--spacing-2) var(--spacing-3)', color: 'var(--foreground)', fontFamily: 'var(--font-ui)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <button
          onClick={createNote}
          style={{ margin: '0 var(--spacing-3) var(--spacing-3)', background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, padding: 'var(--spacing-2) var(--spacing-4)', cursor: 'pointer' }}
        >
          + New note
        </button>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map(note => (
            <div
              key={note.id}
              onClick={() => openNote(note)}
              style={{ padding: 'var(--spacing-3) var(--spacing-4)', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?.id === note.id ? 'var(--muted)' : 'transparent', transition: 'background var(--duration-fast) ease-out' }}
              onMouseEnter={e => { if (selected?.id !== note.id) e.currentTarget.style.background = 'var(--surface)'; }}
              onMouseLeave={e => { if (selected?.id !== note.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, color: 'var(--foreground)', marginBottom: 2 }}>
                {note.name || 'Untitled'}
              </div>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--muted-foreground)' }}>
                {note.updated_at ? new Date(note.updated_at).toLocaleDateString() : ''}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 'var(--spacing-6)', textAlign: 'center', fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--muted-foreground)' }}>
              No notes found
            </div>
          )}
        </div>
      </div>

      {/* Editor / viewer */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--background)' }}>
        {selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--spacing-3) var(--spacing-6)', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
              {editing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--spacing-2) var(--spacing-3)', color: 'var(--foreground)', fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 600, outline: 'none' }}
                />
              ) : (
                <span style={{ flex: 1, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16, color: 'var(--foreground)' }}>
                  {selected.name || 'Untitled'}
                </span>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                {editing ? (
                  <>
                    <button onClick={saveNote} style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: 'var(--spacing-2) var(--spacing-4)', cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditing(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: 'var(--spacing-2) var(--spacing-4)', cursor: 'pointer' }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={startEdit} style={{ background: 'var(--muted)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: 'var(--spacing-2) var(--spacing-4)', cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => deleteNote(selected.id)} style={{ background: 'transparent', border: '1px solid var(--error)', color: 'var(--error)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: 'var(--spacing-2) var(--spacing-4)', cursor: 'pointer' }}>Delete</button>
                  </>
                )}
              </div>
            </div>
            {editing ? (
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                style={{ flex: 1, padding: 'var(--spacing-6)', color: 'var(--foreground)', fontFamily: 'var(--font-ui)', fontSize: 14, lineHeight: 1.7, outline: 'none', overflowY: 'auto' }}
              />
            ) : (
              <div
                style={{ flex: 1, padding: 'var(--spacing-6)', color: 'var(--foreground)', fontFamily: 'var(--font-ui)', fontSize: 14, lineHeight: 1.7, overflowY: 'auto' }}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selected.content || '') }}
              />
            )}
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', fontSize: 14 }}>
            Select a note to view or edit it
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Proofread placeholder ─────────────────────────────────────── */
function ProofreadPlaceholder() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: 'var(--background)' }}>
      <span style={{ fontSize: 36, opacity: 0.6 }}>✦</span>
      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 20, color: 'var(--foreground)' }}>
        Proofreading Mode
      </span>
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--muted-foreground)', maxWidth: 340, textAlign: 'center', lineHeight: 1.65 }}>
        AI-powered grammar, clarity, and style suggestions are coming soon. This mode will help you refine your notes and written work.
      </span>
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--muted-foreground)', opacity: 0.5, marginTop: 4, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Coming soon
      </span>
    </div>
  );
}

/* ─── Library Page ───────────────────────────────────────────────── */
export default function Library() {
  const navigate = useNavigate();
  const [user,       setUser]       = useState(null);
  const [events,     setEvents]     = useState([]);
  const [activeView, setActiveView] = useState('notes'); // 'notes' | 'schedule' | 'proofread'

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      const u = data?.session?.user;
      if (!u) return;
      setUser(u);
      sb.from('events')
        .select('*')
        .eq('user_id', u.id)
        .then(({ data: ev }) => { if (ev) setEvents(ev); });
    });
  }, []);

  // AI auto-switch: new calendar event → show schedule
  useEffect(() => {
    function onCalEvent() { setActiveView('schedule'); }
    window.addEventListener('sos:calendar:new-event', onCalEvent);
    return () => window.removeEventListener('sos:calendar:new-event', onCalEvent);
  }, []);

  // AI auto-switch: new note created → show notes
  useEffect(() => {
    function onNewNote() { setActiveView('notes'); }
    window.addEventListener('sos:notes:created', onNewNote);
    return () => window.removeEventListener('sos:notes:created', onNewNote);
  }, []);

  function handleEventUpdate(updated) {
    setEvents(prev => prev.map(e => e.id === updated.id ? updated : e));
  }

  const views = [
    { id: 'notes',    label: 'Notes',    icon: '⊡' },
    { id: 'schedule', label: 'Schedule', icon: '📅' },
    { id: 'proofread', label: 'Proofread', icon: '✦' },
  ];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--background)', fontFamily: 'var(--font-ui)' }}>
      {/* Amber accent line */}
      <div style={{ height: 2, background: 'linear-gradient(90deg, hsl(35,70%,50%), hsl(30,70%,55%))' }} />

      {/* Minimal top nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-4)', padding: 'var(--spacing-3) var(--spacing-6)', background: 'var(--sidebar)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={() => navigate('/studio')}
          style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', fontSize: 13, cursor: 'pointer', padding: 'var(--spacing-1) var(--spacing-2)', borderRadius: 'var(--radius-sm)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--foreground)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted-foreground)'; }}
        >
          ← Studio
        </button>
        <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--foreground)' }}>
          Library
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--muted-foreground)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {activeView === 'notes' ? 'Notes' : activeView === 'schedule' ? 'Schedule' : 'Proofread'}
        </span>
      </div>

      {/* Main content — fills all remaining height */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {activeView === 'notes' && <NotesContent user={user} />}

        {activeView === 'schedule' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <CalendarWindow
              embedded
              defaultSize="fullscreen"
              events={events}
              onEventUpdate={handleEventUpdate}
              userId={user?.id}
            />
          </div>
        )}

        {activeView === 'proofread' && <ProofreadPlaceholder />}
      </div>

      {/* Bottom toggle bar */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '7px 16px', borderTop: '1px solid var(--border)', background: 'var(--sidebar)' }}>
        {views.map(v => (
          <button
            key={v.id}
            onClick={() => setActiveView(v.id)}
            style={{
              background: activeView === v.id ? 'var(--muted)' : 'transparent',
              border: activeView === v.id ? '1px solid var(--primary)' : '1px solid transparent',
              color: activeView === v.id ? 'var(--primary)' : 'var(--muted-foreground)',
              borderRadius: 'var(--radius-full)',
              padding: '4px 18px',
              fontFamily: 'var(--font-ui)',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all var(--duration-fast) ease-out',
            }}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
