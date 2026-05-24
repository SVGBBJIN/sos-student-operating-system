import React, { useState, useMemo } from 'react';

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

export default function ProjectPanel({ subject, tasks = [], events = [], notes = [], flashcardDecks = [], onClose, onDeleteItems }) {
  const [activeTab, setActiveTab] = useState('all');
  const [checked,   setChecked]   = useState(new Set());
  const [confirm,   setConfirm]   = useState(false);
  const [deleting,  setDeleting]  = useState(false);

  const sl = subject.toLowerCase();

  const proj = useMemo(() => {
    const projTasks  = tasks.filter(t => !t.is_folder && (t.subject || '').toLowerCase() === sl && t.status !== 'done');
    const projEvents = events.filter(e => (e.subject || '').toLowerCase() === sl);
    const projNotes  = notes.filter(n => !n.is_folder && ((n.subject || n.tab_name || '').toLowerCase() === sl));
    const projDecks  = flashcardDecks.filter(d => d.title.toLowerCase().includes(sl));
    return { tasks: projTasks, events: projEvents, notes: projNotes, decks: projDecks };
  }, [subject, tasks, events, notes, flashcardDecks, sl]);

  const allItems = useMemo(() => [
    ...proj.tasks.map(t  => ({ id: t.id, _type: 'task',  _label: t.title || 'Untitled', _meta: t.dueDate || '' })),
    ...proj.events.map(e => ({ id: e.id, _type: 'event', _label: e.title || 'Untitled', _meta: e.date || '' })),
    ...proj.notes.map(n  => ({ id: n.id, _type: 'note',  _label: n.name  || 'Untitled', _meta: n.updatedAt ? new Date(n.updatedAt).toLocaleDateString() : '' })),
    ...proj.decks.map(d  => ({ id: d.id, _type: 'deck',  _label: d.title || 'Untitled', _meta: `${d.card_count || (d.cards || []).length} cards` })),
  ], [proj]);

  const items = useMemo(() => {
    if (activeTab === 'tasks')  return allItems.filter(i => i._type === 'task');
    if (activeTab === 'events') return allItems.filter(i => i._type === 'event');
    if (activeTab === 'notes')  return allItems.filter(i => i._type === 'note');
    if (activeTab === 'decks')  return allItems.filter(i => i._type === 'deck');
    return allItems;
  }, [allItems, activeTab]);

  function toggleItem(id, type) {
    const key = `${type}:${id}`;
    setChecked(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function toggleAll() {
    if (checked.size === items.length && items.length > 0) setChecked(new Set());
    else setChecked(new Set(items.map(i => `${i._type}:${i.id}`)));
  }

  async function deleteSelected() {
    if (checked.size === 0) return;
    setDeleting(true);
    const toDelete = [...checked].map(key => { const [type, id] = key.split(':'); return { type, id }; });
    onDeleteItems?.(toDelete);
    setChecked(new Set());
    setConfirm(false);
    setDeleting(false);
  }

  function switchTab(id) { setActiveTab(id); setChecked(new Set()); setConfirm(false); }

  const tone = toneFor(subject);
  const dotColor = TONE_BG[tone] || TONE_BG.review;
  const totalCount = allItems.length;

  const TABS = [
    { id: 'all',    label: 'All',        count: totalCount },
    { id: 'events', label: 'Events',     count: proj.events.length },
    { id: 'tasks',  label: 'Tasks',      count: proj.tasks.length },
    { id: 'notes',  label: 'Notes',      count: proj.notes.length },
    { id: 'decks',  label: 'Study Sets', count: proj.decks.length },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', background: 'var(--background)' }}>
      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--foreground)', fontFamily: 'var(--font-heading)', flex: 1 }}>{subject}</span>
        <span style={{ fontSize: 12, color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)' }}>{totalCount} item{totalCount !== 1 ? 's' : ''}</span>
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
            <button onClick={deleteSelected} disabled={deleting} style={{ background: 'var(--error,hsl(0,72%,51%))', border: 'none', color: '#fff', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, padding: '4px 14px', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}>
              {deleting ? 'Deleting…' : `Confirm (${checked.size})`}
            </button>
            <button onClick={() => setConfirm(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '4px 14px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        )}
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 6px', borderRadius: 'var(--radius)' }} title="Close project view" aria-label="Close project view">×</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
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

      {/* Items */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px' }}>
        {items.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 14, fontFamily: 'var(--font-ui)' }}>
            No {activeTab === 'all' ? 'items' : activeTab} in this project yet.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 10px 10px', borderBottom: '1px solid var(--border)', marginBottom: 8, cursor: 'pointer' }} onClick={toggleAll}>
              <input type="checkbox" readOnly checked={checked.size === items.length && items.length > 0} style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--primary)', pointerEvents: 'none' }} />
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', userSelect: 'none' }}>
                {checked.size > 0 ? `${checked.size} of ${items.length} selected` : `Select all (${items.length})`}
              </span>
            </div>
            {items.map(item => {
              const key = `${item._type}:${item.id}`;
              const isSel = checked.has(key);
              const dot = TYPE_BG[item._type];
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
                  <input type="checkbox" readOnly checked={isSel} onClick={e => e.stopPropagation()} onChange={() => toggleItem(item.id, item._type)} style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--primary)', flexShrink: 0, pointerEvents: 'none' }} />
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--foreground)', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item._label}</span>
                  {item._meta && <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', flexShrink: 0 }}>{item._meta}</span>}
                  <span style={{ fontSize: 10, fontWeight: 700, color: dot, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>{TYPE_LABEL[item._type]}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
