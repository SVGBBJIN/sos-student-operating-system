import React, { useState, useEffect, useRef } from 'react';
import CalendarWindow from './CalendarWindow/CalendarWindow.jsx';
import DOMPurify from 'dompurify';
import ProofreadPanel from './ProofreadPanel.jsx';
import BacklinksList from './BacklinksList.jsx';
import ProjectsTree from './ProjectsTree.jsx';
import ProjectsBar from './ProjectsBar.jsx';
import DynamicIsland from './DynamicIsland.jsx';

/* ── Focused note editor for the Projects tree ─────────────── */
function ProjectNoteEditor({ note, notes, events, tasks, entityLinks, onBack, onUpdateNote, onDeleteNote }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note?.name || '');
  const editorRef = useRef(null);

  useEffect(() => {
    setTitle(note?.name || '');
    setEditing(false);
  }, [note?.id]);

  function startEdit() {
    setEditing(true);
    setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = note?.content || '';
    }, 0);
  }

  function save() {
    const content = editorRef.current?.innerHTML || '';
    onUpdateNote?.({ ...note, name: title, content, updatedAt: new Date().toISOString() });
    setEditing(false);
  }

  if (!note) return null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--background)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <button onClick={onBack} style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', borderRadius: 4, fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>‹ Back</button>
        {editing ? (
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px', color: 'var(--foreground)', fontSize: 12, fontWeight: 600, outline: 'none' }}
          />
        ) : (
          <span style={{ flex: 1, fontWeight: 700, fontSize: 12, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {note.is_folder ? '📁 ' : ''}{note.name || 'Untitled'}
          </span>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          {editing ? (
            <>
              <button onClick={save} style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 4, fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditing(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', borderRadius: 4, fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>Cancel</button>
            </>
          ) : (
            <>
              <button onClick={startEdit} style={{ background: 'var(--muted)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>Edit</button>
              <button onClick={() => onDeleteNote?.(note.id)} style={{ background: 'transparent', border: '1px solid var(--error)', color: 'var(--error)', borderRadius: 4, fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>Del</button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          style={{ flex: 1, padding: '12px 14px', color: 'var(--foreground)', fontSize: 13, lineHeight: 1.65, outline: 'none', overflowY: 'auto' }}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
          <div
            style={{ padding: '12px 14px', color: 'var(--foreground)', fontSize: 13, lineHeight: 1.65 }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.content || '') }}
          />
          <BacklinksList
            entityType="note"
            entityId={note.id}
            entityLinks={entityLinks}
            notes={notes}
            events={events}
            tasks={tasks}
          />
        </div>
      )}
    </div>
  );
}

/* ── Main panel ──────────────────────────────────────────────── */
export default function LofiLeftPanel({
  events, blocks, userId, onEventUpdate,
  notes, tasks, entityLinks,
  onCreateNote, onUpdateNote, onDeleteNote, onImportClick,
  aiThinking = false,
  ambient = null, onAmbientAction, onAmbientDismiss,
}) {
  const [activeView, setActiveView] = useState('calendar');
  const [openNoteId, setOpenNoteId] = useState(null);
  const [activeSubject, setActiveSubject] = useState(null);

  // AI auto-switch: new calendar event → calendar, new note → projects
  useEffect(() => {
    function onCalEvent()  { setActiveView('calendar'); }
    function onNoteEvent() { setActiveView('projects'); }
    window.addEventListener('sos:calendar:new-event', onCalEvent);
    window.addEventListener('sos:notes:created',      onNoteEvent);
    return () => {
      window.removeEventListener('sos:calendar:new-event', onCalEvent);
      window.removeEventListener('sos:notes:created',      onNoteEvent);
    };
  }, []);

  const views = [
    { id: 'calendar',  label: 'Calendar',  icon: '📅' },
    { id: 'projects',  label: 'Projects',  icon: '📁' },
    { id: 'proofread', label: 'Proofread', icon: '✦' },
  ];

  const openNote = openNoteId ? (notes || []).find(n => n.id === openNoteId) : null;

  return (
    <div className="study-left study-glass" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Dynamic Island */}
      <DynamicIsland
        aiThinking={aiThinking}
        ambient={ambient}
        onAmbientAction={onAmbientAction}
        onAmbientDismiss={onAmbientDismiss}
      />

      {/* Projects bar — colored-blob folder list mirroring the landing card */}
      <ProjectsBar
        tasks={tasks || []}
        events={events || []}
        notes={notes || []}
        activeSubject={activeSubject}
        onSelectSubject={setActiveSubject}
      />

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {activeView === 'calendar' && (
          <CalendarWindow
            embedded
            defaultSize="fullscreen"
            events={events || []}
            blocks={blocks || { recurring: [], dates: {} }}
            onEventUpdate={onEventUpdate}
            userId={userId}
          />
        )}
        {activeView === 'projects' && !openNote && (
          <ProjectsTree
            notes={notes || []}
            selectedId={openNoteId}
            onOpenNote={(n) => setOpenNoteId(n.id)}
            onCreateNote={({ parent_id }) => onCreateNote?.({ name: 'Untitled', content: '', parent_id, is_folder: false })}
            onCreateFolder={({ parent_id }) => onCreateNote?.({ name: 'New folder', content: '', parent_id, is_folder: true })}
            onImport={onImportClick}
          />
        )}
        {activeView === 'projects' && openNote && (
          <ProjectNoteEditor
            note={openNote}
            notes={notes || []}
            events={events || []}
            tasks={tasks || []}
            entityLinks={entityLinks || []}
            onBack={() => setOpenNoteId(null)}
            onUpdateNote={onUpdateNote}
            onDeleteNote={(id) => { onDeleteNote?.(id); setOpenNoteId(null); }}
          />
        )}
        {activeView === 'proofread' && <ProofreadPanel />}
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
