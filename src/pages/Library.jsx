import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { sb } from '../lib/supabase.js';
import DOMPurify from 'dompurify';
import CalendarWindow from '../components/CalendarWindow/CalendarWindow.jsx';
import StudioSidebar from '../components/StudioSidebar.jsx';
import StudyTopBar from '../components/StudyTopBar.jsx';

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

/* ─── Study Plans Panel ──────────────────────────────────────────── */
function StudyPlansContent({ user }) {
  const [plans,    setPlans]    = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    sb.from('study_plans')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setPlans(data); setLoading(false); });
  }, [user]);

  async function archivePlan(id) {
    setPlans(prev => prev.map(p => p.id === id ? { ...p, status: 'archived' } : p));
    await sb.from('study_plans').update({ status: 'archived' }).eq('id', id).eq('user_id', user.id);
  }

  const plan = selected ? plans.find(p => p.id === selected) : null;
  const pj = plan?.plan_json || {};

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* List */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--sidebar)', overflowY: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Study Plans {plans.length > 0 && `· ${plans.length}`}
        </div>
        {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>Loading…</div>}
        {!loading && plans.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
            No study plans yet.<br/>Ask the AI "help me survive finals week" to create one.
          </div>
        )}
        {plans.map(p => (
          <div
            key={p.id}
            onClick={() => setSelected(p.id)}
            style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected === p.id ? 'var(--muted)' : 'transparent', opacity: p.status === 'archived' ? 0.5 : 1, transition: 'background var(--duration-fast) ease-out' }}
            onMouseEnter={e => { if (selected !== p.id) e.currentTarget.style.background = 'var(--surface)'; }}
            onMouseLeave={e => { if (selected !== p.id) e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', marginBottom: 2 }}>{p.title}</div>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--muted-foreground)' }}>
              <span>{p.total_tasks} task{p.total_tasks !== 1 ? 's' : ''}</span>
              <span style={{ color: p.status === 'active' ? 'var(--primary)' : 'var(--muted-foreground)' }}>{p.status}</span>
              <span style={{ marginLeft: 'auto' }}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Detail */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--background)', overflowY: 'auto' }}>
        {plan ? (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>{plan.title}</div>
                {pj.summary && <div style={{ fontSize: 13, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>{pj.summary}</div>}
              </div>
              {plan.status === 'active' && (
                <button onClick={() => archivePlan(plan.id)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 12, padding: '4px 12px', cursor: 'pointer', flexShrink: 0 }}>Archive</button>
              )}
            </div>
            {(pj.recurring_blocks || []).length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Recurring Blocks</div>
                {(pj.recurring_blocks || []).map((b, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--foreground)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontWeight: 600, flex: 1 }}>{b.activity}</span>
                    <span style={{ color: 'var(--muted-foreground)' }}>{(b.days || []).join('/')}</span>
                    <span style={{ color: 'var(--primary)' }}>{b.start}–{b.end}</span>
                  </div>
                ))}
              </div>
            )}
            {(pj.milestone_tasks || []).length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Milestones</div>
                {(pj.milestone_tasks || []).map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--foreground)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ flex: 1 }}>{t.task_name}</span>
                    {t.due_date && <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>{t.due_date}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', fontSize: 14 }}>
            Select a study plan to view details
          </div>
        )}
      </div>
    </div>
  );
}


/* ─── Library Page ───────────────────────────────────────────────── */
export default function Library() {
  const navigate = useNavigate();
  const [user,       setUser]       = useState(null);
  const [events,     setEvents]     = useState([]);
  const [tasks,      setTasks]      = useState([]);
  const [notes,      setNotes]      = useState([]);
  const [savedChats, setSavedChats] = useState([]);
  const [activeView, setActiveView] = useState('notes');
  // Calendar is a toggle-able feature (off by default) — see App.jsx's
  // `calendarEnabled` setting. This page reads the same localStorage flag
  // since it's routed independently of App.jsx's component tree.
  const [calendarEnabled] = useState(() => {
    try { return localStorage.getItem('sos_calendar_enabled') === 'true'; } catch (_) { return false; }
  });

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      const u = data?.session?.user;
      if (!u) return;
      setUser(u);
      sb.from('events').select('*').eq('user_id', u.id)
        .then(({ data: ev }) => { if (ev) setEvents(ev); });
      sb.from('tasks').select('*').eq('user_id', u.id)
        .then(({ data: t }) => { if (t) setTasks(t); });
      sb.from('notes').select('*').eq('user_id', u.id)
        .then(({ data: ns }) => {
          if (!ns) return;
          const chats = [], regular = [];
          ns.forEach(n => {
            if (n.name?.startsWith('[chat-save]')) {
              try {
                const p = JSON.parse(n.content);
                chats.push({ id: n.id, title: p.title || 'Untitled Chat', messages: p.messages || [], savedAt: p.savedAt || n.updated_at, messageCount: p.messageCount || 0 });
              } catch { regular.push(n); }
            } else { regular.push(n); }
          });
          setSavedChats(chats);
          setNotes(regular);
        });
    });
  }, []);

  useEffect(() => {
    if (!calendarEnabled) return;
    function onCalEvent() { setActiveView('schedule'); }
    window.addEventListener('sos:calendar:new-event', onCalEvent);
    return () => window.removeEventListener('sos:calendar:new-event', onCalEvent);
  }, [calendarEnabled]);

  useEffect(() => {
    function onNewNote() { setActiveView('notes'); }
    window.addEventListener('sos:notes:created', onNewNote);
    return () => window.removeEventListener('sos:notes:created', onNewNote);
  }, []);

  function handleEventUpdate(updated) {
    setEvents(prev => prev.map(e => e.id === updated.id ? updated : e));
  }

  async function handleLogout() {
    await sb.auth.signOut();
    navigate('/');
  }

  return (
    <div className="studio">
      {/* SVG symbol for the SOS mark used by StudyTopBar */}
      <svg width="0" height="0" style={{ position: 'absolute', overflow: 'hidden' }} aria-hidden="true">
        <defs>
          <symbol id="sos-bulb" viewBox="0 0 60 86">
            <path d="M 30 2 C 13.5 2, 4 16, 4 32 C 4 44.5, 11.5 53.5, 18 60 C 20 62, 21 63, 21 65.5 L 21 68 L 39 68 L 39 65.5 C 39 63, 40 62, 42 60 C 48.5 53.5, 56 44.5, 56 32 C 56 16, 46.5 2, 30 2 Z" fill="currentColor"/>
            <rect x="21" y="71" width="18" height="3.6" rx="1" fill="currentColor"/>
            <rect x="21" y="76" width="18" height="3.6" rx="1" fill="currentColor"/>
            <rect x="25" y="81" width="10" height="4" rx="1.4" fill="currentColor"/>
          </symbol>
        </defs>
      </svg>

      <StudyTopBar
        user={user}
        syncStatus="saved"
        onHome={() => navigate('/studio')}
        onAuthAction={user ? handleLogout : () => navigate('/studio')}
      />

      <div className="studio-sidebar-col">
        <StudioSidebar
          user={user}
          savedChats={savedChats}
          viewingSavedChatId={null}
          onPick={() => navigate('/studio')}
          onNew={() => navigate('/studio')}
          onDelete={() => {}}
          onAuthAction={user ? handleLogout : () => navigate('/studio')}
          aiThinking={false}
          syncStatus="saved"
          tasks={tasks}
          events={events}
          notes={notes}
        />
      </div>

      <div className="studio-center-col">
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeView === 'notes' && <NotesContent user={user} />}
          {activeView === 'study-plans' && <StudyPlansContent user={user} />}
          {activeView === 'schedule' && calendarEnabled && (
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
        </div>

      </div>
    </div>
  );
}
