import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { sb } from '../lib/supabase.js';
import DOMPurify from 'dompurify';
import SkillHub from '../components/skillhub/SkillHub.jsx';
import ModePillSwitcher from '../components/skillhub/ModePillSwitcher.jsx';

/* ─── Simple Notes Panel ─────────────────────────────────────────── */
function NotesTab({ user }) {
  const [notes,     setNotes]     = useState([]);
  const [search,    setSearch]    = useState('');
  const [selected,  setSelected]  = useState(null);
  const [editing,   setEditing]   = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [viewMode,  setViewMode]  = useState('normal'); // 'normal' | 'fullscreen' | 'proofread'
  const editorRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    sb.from('notes')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .then(({ data }) => { if (data) setNotes(data); });
  }, [user]);

  // Escape exits expanded modes
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && viewMode !== 'normal') setViewMode('normal');
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewMode]);

  function openNote(note) {
    setSelected(note);
    setEditing(false);
  }

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

  const isExpanded  = viewMode !== 'normal';
  const isProofread = viewMode === 'proofread';

  // ── Bottom toggle bar ────────────────────────────────────────────
  const bottomBar = (
    <div style={{
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      padding: '7px 16px',
      borderTop: '1px solid var(--border)',
      background: 'var(--sidebar)',
    }}>
      {[
        { id: 'normal',     label: 'Normal',     icon: '⊡' },
        { id: 'fullscreen', label: 'Fullscreen', icon: '⛶' },
        { id: 'proofread',  label: 'Proofread',  icon: '✦' },
      ].map(m => (
        <button
          key={m.id}
          onClick={() => setViewMode(m.id)}
          style={{
            background: viewMode === m.id ? 'var(--muted)' : 'transparent',
            border: viewMode === m.id ? '1px solid var(--primary)' : '1px solid transparent',
            color: viewMode === m.id ? 'var(--primary)' : 'var(--muted-foreground)',
            borderRadius: 'var(--radius-full)',
            padding: '3px 14px',
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            cursor: 'pointer',
            transition: 'all var(--duration-fast) ease-out',
          }}
        >
          {m.icon} {m.label}
        </button>
      ))}
      {isExpanded && (
        <span style={{
          marginLeft: 8, fontSize: 11,
          color: 'var(--muted-foreground)',
          fontFamily: 'var(--font-ui)',
          opacity: 0.6,
        }}>
          Esc to exit
        </span>
      )}
    </div>
  );

  // ── Proofreading mode: fullscreen, no sidebar, centered reading ──
  if (isProofread) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1001,
        background: 'var(--background)',
        display: 'flex', flexDirection: 'column',
      }}>
        {selected ? (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 24px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
              flexShrink: 0,
            }}>
              {editing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: '6px 12px',
                    color: 'var(--foreground)',
                    fontFamily: '"DM Sans", sans-serif',
                    fontSize: 16, fontWeight: 600, outline: 'none',
                  }}
                />
              ) : (
                <span style={{
                  flex: 1,
                  fontFamily: '"DM Sans", sans-serif',
                  fontWeight: 700, fontSize: 18,
                  color: 'var(--foreground)',
                }}>
                  {selected.name || 'Untitled'}
                </span>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                {editing ? (
                  <>
                    <button onClick={saveNote} style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '6px 16px', cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditing(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '6px 16px', cursor: 'pointer' }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={startEdit} style={{ background: 'var(--muted)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '6px 16px', cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => deleteNote(selected.id)} style={{ background: 'transparent', border: '1px solid var(--error)', color: 'var(--error)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '6px 16px', cursor: 'pointer' }}>Delete</button>
                  </>
                )}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '40px 24px' }}>
              <div style={{ maxWidth: 720, margin: '0 auto' }}>
                {editing ? (
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    style={{
                      color: 'var(--foreground)',
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: 16, lineHeight: 1.85,
                      outline: 'none', minHeight: 300,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      color: 'var(--foreground)',
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: 16, lineHeight: 1.85,
                    }}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selected.content || '') }}
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', fontSize: 14 }}>
            Select a note to proofread
          </div>
        )}
        {bottomBar}
      </div>
    );
  }

  // ── Fullscreen and Normal modes ──────────────────────────────────
  return (
    <div style={isExpanded
      ? { position: 'fixed', inset: 0, zIndex: 1001, background: 'var(--background)', display: 'flex', flexDirection: 'column' }
      : { display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }
    }>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 0 }}>
        {/* Sidebar */}
        <div style={{
          width: 260,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--sidebar)',
        }}>
          <div style={{ padding: 'var(--spacing-3)' }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search notes..."
              style={{
                width: '100%',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: 'var(--spacing-2) var(--spacing-3)',
                color: 'var(--foreground)',
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            onClick={createNote}
            style={{
              margin: '0 var(--spacing-3) var(--spacing-3)',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: 600,
              padding: 'var(--spacing-2) var(--spacing-4)',
              cursor: 'pointer',
            }}
          >
            + New note
          </button>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.map(note => (
              <div
                key={note.id}
                onClick={() => openNote(note)}
                style={{
                  padding: 'var(--spacing-3) var(--spacing-4)',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selected?.id === note.id ? 'var(--muted)' : 'transparent',
                  transition: 'background var(--duration-fast) ease-out',
                }}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--spacing-3) var(--spacing-6)', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                {editing ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    style={{
                      flex: 1,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      padding: 'var(--spacing-2) var(--spacing-3)',
                      color: 'var(--foreground)',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 14,
                      fontWeight: 600,
                      outline: 'none',
                    }}
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
                  style={{
                    flex: 1,
                    padding: 'var(--spacing-6)',
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 14,
                    lineHeight: 1.7,
                    outline: 'none',
                    overflowY: 'auto',
                  }}
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
      {bottomBar}
    </div>
  );
}

/* ─── Library Page ───────────────────────────────────────────────── */
export default function Library() {
  const navigate = useNavigate();
  const [tab,          setTab]          = useState('notes');   // 'notes' | 'skillhub'
  const [user,         setUser]         = useState(null);
  const [notes,        setNotes]        = useState([]);
  const [lessons,      setLessons]      = useState([]);
  const [skillHubTab,  setSkillHubTab]  = useState('lessons');
  const [skillHubMode, setSkillHubMode] = useState('cause-effect');

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      const u = data?.session?.user;
      if (u) setUser(u);
    });
  }, []);

  const TABS = [
    { id: 'notes',    label: '📝  Notes' },
    { id: 'skillhub', label: '🎓  Skill Hub' },
  ];

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--background)',
      fontFamily: 'var(--font-ui)',
    }}>
      {/* Amber line */}
      <div style={{ height: 2, background: 'linear-gradient(90deg, hsl(35,70%,50%), hsl(30,70%,55%))' }} />

      {/* Top nav */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-4)',
        padding: 'var(--spacing-3) var(--spacing-6)',
        background: 'var(--sidebar)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate('/studio')}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--muted-foreground)',
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
            cursor: 'pointer',
            padding: 'var(--spacing-1) var(--spacing-2)',
            borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--foreground)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted-foreground)'; }}
        >
          ← Studio
        </button>
        <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--foreground)' }}>
          Library
        </span>
      </div>

      {/* Internal tab bar */}
      <div style={{
        display: 'flex',
        background: 'var(--sidebar)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? 'var(--surface)' : 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--primary)' : '2px solid transparent',
              color: tab === t.id ? 'var(--foreground)' : 'var(--muted-foreground)',
              fontFamily: 'var(--font-ui)',
              fontSize: 14,
              padding: 'var(--spacing-3) var(--spacing-6)',
              cursor: 'pointer',
              transition: `color var(--duration-fast) ease-out,
                           border-color var(--duration-fast) ease-out,
                           background var(--duration-fast) ease-out`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {tab === 'notes' ? (
          <NotesTab user={user} />
        ) : (
          <SkillHub
            activeTab={skillHubTab}
            setActiveTab={setSkillHubTab}
            activeMode={skillHubMode}
            onModeSwitch={setSkillHubMode}
            onAutoSwitchMode={setSkillHubMode}
            lessons={lessons}
            onLessonsChange={setLessons}
            tasks={[]}
            events={[]}
            notes={notes}
            user={user}
            onBack={() => setTab('notes')}
            setToastMsg={() => {}}
          />
        )}
      </div>
    </div>
  );
}
