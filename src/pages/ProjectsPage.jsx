import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { sb } from '../lib/supabase.js';
import StudyTopBar from '../components/StudyTopBar.jsx';

const DEFAULT_SUBJECTS = ['Math', 'English', 'Science', 'Social Studies'];

const SUBJECT_TONE = [
  { match: /math|calc|algebra|geometry|stat|linear/i, tone: 'math' },
  { match: /english|lit|writing|essay/i,              tone: 'english' },
  { match: /sci|bio|chem|physics/i,                   tone: 'science' },
  { match: /hist|gov|civic|econ|social/i,             tone: 'history' },
  { match: /cs|comp|code|program/i,                   tone: 'cs' },
];
const TONE_BG = {
  math:    'hsl(220,65%,55%)',
  english: 'hsl(30,75%,52%)',
  science: 'hsl(165,55%,45%)',
  history: 'hsl(12,65%,52%)',
  cs:      'hsl(260,65%,55%)',
  review:  'hsl(340,55%,52%)',
};
const TYPE_BG = {
  task:  'hsl(220,65%,55%)',
  event: 'hsl(12,65%,52%)',
  note:  'hsl(165,55%,45%)',
  deck:  'hsl(260,65%,55%)',
};
const TYPE_LABEL = { task: 'Task', event: 'Event', note: 'Note', deck: 'Study Set' };

function toneFor(name) {
  for (const r of SUBJECT_TONE) if (r.match.test(name || '')) return r.tone;
  return 'review';
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [user,      setUser]      = useState(null);
  const [tasks,     setTasks]     = useState([]);
  const [events,    setEvents]    = useState([]);
  const [notes,     setNotes]     = useState([]);
  const [decks,     setDecks]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState(null);  // selected subject name
  const [activeTab, setActiveTab] = useState('all');
  const [checked,   setChecked]   = useState(new Set()); // `${type}:${id}`
  const [confirm,   setConfirm]   = useState(false);
  const [deleting,  setDeleting]  = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      const u = data?.session?.user;
      if (!u) { navigate('/'); return; }
      setUser(u);
      load(u.id);
    });
  }, [navigate]);

  async function load(uid) {
    setLoading(true);
    const [t, e, n, d] = await Promise.all([
      sb.from('tasks').select('*').eq('user_id', uid),
      sb.from('events').select('*').eq('user_id', uid),
      sb.from('notes').select('*').eq('user_id', uid),
      sb.from('flashcard_decks').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    ]);
    setTasks(t.data || []);
    setEvents(e.data || []);
    setNotes((n.data || []).filter(r => !r.name?.startsWith('[chat-save]')));
    setDecks(d.data || []);
    setLoading(false);
  }

  // Group all items by subject
  const subjects = useMemo(() => {
    const map = new Map();
    DEFAULT_SUBJECTS.forEach(s => map.set(s, { tasks: [], events: [], notes: [], decks: [] }));

    function upsertKey(rawSubject) {
      const s = (rawSubject || 'Uncategorized').trim();
      const existing = [...map.keys()].find(k => k.toLowerCase() === s.toLowerCase());
      const key = existing || s;
      if (!map.has(key)) map.set(key, { tasks: [], events: [], notes: [], decks: [] });
      return key;
    }

    tasks.forEach(t  => map.get(upsertKey(t.subject))?.tasks.push(t));
    events.forEach(e => map.get(upsertKey(e.subject))?.events.push(e));
    notes.forEach(n  => map.get(upsertKey(n.subject || n.tab_name))?.notes.push(n));

    // Match decks to subjects by title; unmatched go to a dedicated "Study Sets" bucket
    decks.forEach(d => {
      let matched = false;
      for (const [subj] of map) {
        if (subj !== 'Uncategorized' && subj !== 'Study Sets' &&
            d.title.toLowerCase().includes(subj.toLowerCase())) {
          map.get(subj)?.decks.push(d);
          matched = true;
          break;
        }
      }
      if (!matched) {
        const key = upsertKey('Study Sets');
        map.get(key)?.decks.push(d);
      }
    });

    return [...map.entries()]
      .map(([name, content]) => ({
        name,
        tone: toneFor(name),
        count: content.tasks.length + content.events.length + content.notes.length + content.decks.length,
        tasks:  content.tasks,
        events: content.events,
        notes:  content.notes,
        decks:  content.decks,
      }))
      .sort((a, b) => {
        const ai = DEFAULT_SUBJECTS.findIndex(d => d.toLowerCase() === a.name.toLowerCase());
        const bi = DEFAULT_SUBJECTS.findIndex(d => d.toLowerCase() === b.name.toLowerCase());
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b.count - a.count;
      });
  }, [tasks, events, notes, decks]);

  const proj = subjects.find(s => s.name === selected);

  // Flat item list for the active tab
  const items = useMemo(() => {
    if (!proj) return [];
    const all = [
      ...proj.tasks.map(t  => ({ id: t.id, _type: 'task',  _label: t.title || 'Untitled', _meta: t.due_date || '' })),
      ...proj.events.map(e => ({ id: e.id, _type: 'event', _label: e.title || 'Untitled', _meta: e.event_date || e.date || '' })),
      ...proj.notes.map(n  => ({ id: n.id, _type: 'note',  _label: n.name  || 'Untitled', _meta: n.updated_at ? new Date(n.updated_at).toLocaleDateString() : '' })),
      ...proj.decks.map(d  => ({ id: d.id, _type: 'deck',  _label: d.title || 'Untitled', _meta: `${d.card_count || (d.cards || []).length} cards` })),
    ];
    if (activeTab === 'all')    return all;
    if (activeTab === 'tasks')  return all.filter(i => i._type === 'task');
    if (activeTab === 'events') return all.filter(i => i._type === 'event');
    if (activeTab === 'notes')  return all.filter(i => i._type === 'note');
    if (activeTab === 'decks')  return all.filter(i => i._type === 'deck');
    return all;
  }, [proj, activeTab]);

  function toggleItem(id, type) {
    const key = `${type}:${id}`;
    setChecked(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function toggleAll() {
    if (checked.size === items.length && items.length > 0) {
      setChecked(new Set());
    } else {
      setChecked(new Set(items.map(i => `${i._type}:${i.id}`)));
    }
  }

  async function deleteSelected() {
    if (!user || checked.size === 0) return;
    setDeleting(true);
    const ops = [];
    for (const key of checked) {
      const [type, id] = key.split(':');
      if      (type === 'task')  { ops.push(sb.from('tasks').delete().eq('id', id).eq('user_id', user.id));          setTasks(p  => p.filter(x => x.id !== id)); }
      else if (type === 'event') { ops.push(sb.from('events').delete().eq('id', id).eq('user_id', user.id));         setEvents(p => p.filter(x => x.id !== id)); }
      else if (type === 'note')  { ops.push(sb.from('notes').delete().eq('id', id).eq('user_id', user.id));          setNotes(p  => p.filter(x => x.id !== id)); }
      else if (type === 'deck')  { ops.push(sb.from('flashcard_decks').delete().eq('id', id).eq('user_id', user.id)); setDecks(p  => p.filter(x => x.id !== id)); }
    }
    await Promise.all(ops);
    setChecked(new Set());
    setConfirm(false);
    setDeleting(false);
  }

  function pickSubject(name) {
    setSelected(name);
    setActiveTab('all');
    setChecked(new Set());
    setConfirm(false);
  }

  const TABS = [
    { id: 'all',    label: 'All',        count: proj?.count || 0 },
    { id: 'events', label: 'Events',     count: proj?.events.length || 0 },
    { id: 'tasks',  label: 'Tasks',      count: proj?.tasks.length  || 0 },
    { id: 'notes',  label: 'Notes',      count: proj?.notes.length  || 0 },
    { id: 'decks',  label: 'Study Sets', count: proj?.decks.length  || 0 },
  ];

  return (
    <div className="studio" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* SVG defs for StudyTopBar */}
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
        onAuthAction={async () => { await sb.auth.signOut(); navigate('/'); }}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left sidebar — project list */}
        <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--sidebar)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Projects
          </div>

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>Loading…</div>
          ) : subjects.map(s => {
            const isActive = selected === s.name;
            const dotColor = TONE_BG[s.tone] || TONE_BG.review;
            return (
              <button
                key={s.name}
                onClick={() => pickSubject(s.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 16px', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer', background: isActive ? 'var(--muted)' : 'transparent',
                  border: 'none', width: '100%', textAlign: 'left',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: dotColor, opacity: s.count === 0 ? 0.3 : 1 }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: isActive ? 600 : 400, color: 'var(--foreground)', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.name}
                </span>
                {s.count > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--muted-foreground)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--background)' }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)' }}>
              <svg viewBox="0 0 24 24" width={40} height={40} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <span style={{ fontSize: 14 }}>Select a project to view its contents</span>
            </div>
          ) : (
            <>
              {/* Project header */}
              <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: TONE_BG[proj?.tone || 'review'], flexShrink: 0 }} />
                <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--foreground)', fontFamily: 'var(--font-heading)', flex: 1 }}>{selected}</span>
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)' }}>{proj?.count || 0} item{proj?.count !== 1 ? 's' : ''}</span>
                {checked.size > 0 && !confirm && (
                  <button
                    onClick={() => setConfirm(true)}
                    style={{ background: 'transparent', border: '1px solid var(--error,hsl(0,72%,51%))', color: 'var(--error,hsl(0,72%,51%))', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, padding: '4px 14px', cursor: 'pointer' }}
                  >
                    Delete {checked.size} selected
                  </button>
                )}
                {confirm && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={deleteSelected}
                      disabled={deleting}
                      style={{ background: 'var(--error,hsl(0,72%,51%))', border: 'none', color: '#fff', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, padding: '4px 14px', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
                    >
                      {deleting ? 'Deleting…' : `Confirm (${checked.size})`}
                    </button>
                    <button
                      onClick={() => setConfirm(false)}
                      style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '4px 14px', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 4, padding: '8px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); setChecked(new Set()); setConfirm(false); }}
                    style={{
                      padding: '3px 11px', fontSize: 12, borderRadius: '999px', cursor: 'pointer',
                      border: `1px solid ${activeTab === tab.id ? 'var(--primary)' : 'var(--border)'}`,
                      background: activeTab === tab.id ? 'var(--muted)' : 'transparent',
                      color: activeTab === tab.id ? 'var(--primary)' : 'var(--muted-foreground)',
                      fontFamily: 'var(--font-ui)', fontWeight: activeTab === tab.id ? 600 : 400,
                    }}
                  >
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>

              {/* Items list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px' }}>
                {items.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 14, fontFamily: 'var(--font-ui)' }}>
                    No {activeTab === 'all' ? 'items' : activeTab} in this project yet.
                  </div>
                ) : (
                  <>
                    {/* Select-all row */}
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 10px 10px', borderBottom: '1px solid var(--border)', marginBottom: 8, cursor: 'pointer' }}
                      onClick={toggleAll}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={checked.size === items.length && items.length > 0}
                        style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--primary)', pointerEvents: 'none' }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', userSelect: 'none' }}>
                        {checked.size > 0 ? `${checked.size} of ${items.length} selected` : `Select all (${items.length})`}
                      </span>
                    </div>

                    {items.map(item => {
                      const key = `${item._type}:${item.id}`;
                      const isSel = checked.has(key);
                      const dot   = TYPE_BG[item._type];
                      return (
                        <div
                          key={key}
                          onClick={() => toggleItem(item.id, item._type)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px',
                            borderRadius: 'var(--radius)', marginBottom: 4, cursor: 'pointer',
                            background: isSel ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'var(--surface)',
                            border: `1px solid ${isSel ? 'var(--primary)' : 'var(--border)'}`,
                            transition: 'border-color 0.1s, background 0.1s',
                          }}
                        >
                          <input
                            type="checkbox"
                            readOnly
                            checked={isSel}
                            onClick={e => e.stopPropagation()}
                            onChange={() => toggleItem(item.id, item._type)}
                            style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--primary)', flexShrink: 0, pointerEvents: 'none' }}
                          />
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--foreground)', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item._label}
                          </span>
                          {item._meta && (
                            <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', flexShrink: 0 }}>
                              {item._meta}
                            </span>
                          )}
                          <span style={{ fontSize: 10, fontWeight: 700, color: dot, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>
                            {TYPE_LABEL[item._type]}
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
