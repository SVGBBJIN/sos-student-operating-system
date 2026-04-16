import { useState, useMemo, useRef, useCallback } from 'react';
import Icon from '../../lib/icons';
import { fmt } from '../../lib/dateUtils';
import { normalize } from '../../lib/textUtils';

export default function NotesPanel({ notes, onClose, onDeleteNote, onUpdateNote, onCreateNote, embedded = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newNoteName, setNewNoteName] = useState('');
  const editorRef = useRef(null);

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const queryWords = normalize(searchQuery).split(/\s+/).filter(w => w.length > 0);
    if (queryWords.length === 0) return notes;

    const scored = notes.map(note => {
      const normName = normalize(note.name);
      const normContent = normalize(note.content || '');
      let score = 0;
      let firstMatchIndex = -1;
      queryWords.forEach(qw => {
        if (normName.includes(qw)) score += 40;
        const idx = normContent.indexOf(qw);
        if (idx >= 0) {
          score += 30;
          if (firstMatchIndex < 0) firstMatchIndex = idx;
        }
      });
      return { note, score, firstMatchIndex };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

    return scored.map(s => ({ ...s.note, _firstMatch: s.firstMatchIndex }));
  }, [notes, searchQuery]);

  function getSnippet(content, firstMatch) {
    if (firstMatch < 0 || !content) return content?.slice(0, 150) || '';
    const start = Math.max(0, firstMatch - 80);
    const end = Math.min(content.length, firstMatch + 120);
    let snippet = content.slice(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < content.length) snippet += '…';
    return snippet;
  }

  function highlightText(text) {
    if (!searchQuery.trim() || !text) return text;
    const queryWords = normalize(searchQuery).split(/\s+/).filter(w => w.length > 1);
    if (queryWords.length === 0) return text;
    const pattern = queryWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const splitRegex = new RegExp('(' + pattern + ')', 'gi');
    const testRegex = new RegExp(pattern, 'i');
    const parts = text.split(splitRegex);
    return parts.map((part, i) => testRegex.test(part)
      ? <span key={i} className="notes-match">{part}</span>
      : part
    );
  }

  function getSourceBadge(note) {
    const src = note.source || '';
    if (src === 'pdf') return <span className="notes-badge notes-badge-pdf">PDF</span>;
    if (src === 'google_docs') return <span className="notes-badge notes-badge-docs">Docs</span>;
    if (src === 'manual') return <span className="notes-badge" style={{background:'rgba(43,203,186,0.12)',color:'var(--teal)'}}>Manual</span>;
    return <span className="notes-badge notes-badge-ai">AI</span>;
  }

  function execFormat(cmd, value) {
    document.execCommand(cmd, false, value || null);
    editorRef.current?.focus();
  }

  function startEdit(note, e) {
    e.stopPropagation();
    setEditingId(note.id);
    setEditingName(note.name);
    setExpandedId(note.id);
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = note.content || '';
        editorRef.current.focus();
      }
    }, 50);
  }

  function saveEdit() {
    if (!editingName.trim()) return;
    const content = editorRef.current?.innerHTML || '';
    onUpdateNote({ id: editingId, name: editingName.trim(), content, updatedAt: new Date().toISOString() });
    setEditingId(null);
    setEditingName('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName('');
  }

  function startNewNote() {
    setIsCreatingNew(true);
    setNewNoteName('');
    setExpandedId(null);
    setEditingId(null);
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
        editorRef.current.focus();
      }
    }, 50);
  }

  function saveNewNote() {
    const title = newNoteName.trim() || 'Untitled Note';
    const content = editorRef.current?.innerHTML || '';
    onCreateNote({ name: title, content, source: 'manual' });
    setIsCreatingNew(false);
    setNewNoteName('');
  }

  function cancelNewNote() {
    setIsCreatingNew(false);
    setNewNoteName('');
  }

  const FormatToolbar = useCallback(() => (
    <div className="notes-toolbar">
      <button className="notes-toolbar-btn" onClick={() => execFormat('bold')} title="Bold"><b>B</b></button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('italic')} title="Italic"><i>I</i></button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('underline')} title="Underline"><u>U</u></button>
      <div className="notes-toolbar-sep"/>
      <button className="notes-toolbar-btn" onClick={() => execFormat('fontSize', '2')} title="Small text" style={{fontSize:'0.68rem'}}>A</button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('fontSize', '4')} title="Medium text" style={{fontSize:'0.82rem'}}>A</button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('fontSize', '6')} title="Large text" style={{fontSize:'1rem'}}>A</button>
      <div className="notes-toolbar-sep"/>
      <button className="notes-toolbar-btn" onClick={() => execFormat('indent')} title="Indent">{Icon.arrowRight(14)}</button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('outdent')} title="Outdent">{Icon.arrowLeft(14)}</button>
      <div className="notes-toolbar-sep"/>
      <button className="notes-toolbar-btn" onClick={() => execFormat('insertUnorderedList')} title="Bullet list">•</button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('insertOrderedList')} title="Numbered list">1.</button>
    </div>
  ), []);

  return (
    <>
      {!embedded && <div className="peek-overlay" onClick={onClose}/>}
      <div className={'notes-panel' + (embedded ? ' embedded' : '') + (isFullscreen && !embedded ? ' fullscreen' : '')}>
        {!isFullscreen && <div className="peek-handle"/>}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{display:'flex',color:'var(--accent)'}}>{Icon.fileText(18)}</span>
            <span style={{fontWeight:700,fontSize:'1.05rem'}}>Notes</span>
            {notes.length > 0 && <span style={{fontSize:'0.75rem',color:'var(--text-dim)',background:'var(--bg2)',padding:'2px 8px',borderRadius:10,fontWeight:600}}>{notes.length}</span>}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <button className="notes-new-btn" onClick={startNewNote} style={{display:'flex',alignItems:'center',gap:4}}>{Icon.plus(14)} New Note</button>
            <button className="notes-fs-btn" onClick={() => setIsFullscreen(f => !f)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? Icon.minimize(16) : Icon.maximize(16)}
            </button>
            {!embedded && <button className="g-modal-close" onClick={onClose}>{Icon.x(16)}</button>}
          </div>
        </div>

        {isCreatingNew && (
          <div style={{marginBottom:16,animation:'fadeIn .2s ease'}}>
            <input className="notes-title-input" value={newNoteName} onChange={e => setNewNoteName(e.target.value)}
              placeholder="Note title..." autoFocus/>
            <FormatToolbar/>
            <div ref={editorRef} className="notes-editor" contentEditable data-placeholder="What are you studying today?"
              onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); execFormat('indent'); }}}/>
            <div className="notes-edit-actions">
              <button className="notes-cancel-btn" onClick={cancelNewNote}>Cancel</button>
              <button className="notes-save-btn" onClick={saveNewNote}>Save Note</button>
            </div>
          </div>
        )}

        {notes.length > 0 && !isCreatingNew && !editingId && (
          <div className="notes-search-wrap">
            <span className="notes-search-icon" style={{display:'flex'}}>{Icon.search(14)}</span>
            <input className="notes-search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search notes for keywords..." autoFocus/>
          </div>
        )}

        {filteredNotes.length === 0 && !searchQuery.trim() && !isCreatingNew && (
          <div className="notes-empty">
            <div style={{marginBottom:8,opacity:0.4,display:'flex',justifyContent:'center',color:'var(--accent)'}}>{Icon.fileText(28)}</div>
            <div>Nothing here yet — drop your first note 📝</div>
            <div style={{fontSize:'0.82rem',marginTop:4}}>Click "+ New Note" to create one, or import a PDF, Google Doc, or save study materials from chat</div>
          </div>
        )}

        {filteredNotes.length === 0 && searchQuery.trim() && !isCreatingNew && (
          <div className="notes-empty">
            <div style={{marginBottom:8,opacity:0.4,display:'flex',justifyContent:'center',color:'var(--accent)'}}>{Icon.search(24)}</div>
            <div>No matches for "{searchQuery}"</div>
            <div style={{fontSize:'0.82rem',marginTop:4}}>Try different keywords or check spelling</div>
          </div>
        )}

        <div className="notes-list">
          {filteredNotes.map(note => {
            const isExpanded = expandedId === note.id;
            const isEditing = editingId === note.id;
            const isSearching = searchQuery.trim().length > 0;
            const plainContent = (note.content || '').replace(/<[^>]*>/g, '');
            const snippet = isSearching && note._firstMatch !== undefined
              ? getSnippet(plainContent, note._firstMatch)
              : plainContent.slice(0, 150);

            return (
              <div key={note.id} className={'notes-item' + (isExpanded ? ' expanded' : '')}
                onClick={() => { if (!isEditing) { setExpandedId(isExpanded ? null : note.id); setEditingId(null); } }}>
                {isEditing ? (
                  <div onClick={e => e.stopPropagation()}>
                    <input className="notes-title-input" value={editingName} onChange={e => setEditingName(e.target.value)}
                      placeholder="Note title..." autoFocus/>
                    <FormatToolbar/>
                    <div ref={editorRef} className="notes-editor" contentEditable data-placeholder="Write something..."
                      onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); execFormat('indent'); }}}/>
                    <div className="notes-edit-actions">
                      <button className="notes-cancel-btn" onClick={cancelEdit}>Cancel</button>
                      <button className="notes-save-btn" onClick={saveEdit}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="notes-item-header">
                      <div className="notes-item-name">{isSearching ? highlightText(note.name) : note.name}</div>
                      <div className="notes-item-meta">
                        {getSourceBadge(note)}
                        {note.updatedAt && <span className="notes-item-date">{fmt(note.updatedAt)}</span>}
                        <button className="notes-toolbar-btn" onClick={e => startEdit(note, e)} title="Edit" style={{fontSize:'0.72rem',padding:'3px 7px'}}>✎</button>
                        <button className="notes-delete" style={{display:'flex',alignItems:'center',gap:2}} onClick={e => { e.stopPropagation(); onDeleteNote(note.id); }}>{Icon.trash(12)} Delete</button>
                      </div>
                    </div>
                    {!isExpanded && snippet && (
                      <div className="notes-item-preview">
                        {isSearching ? highlightText(snippet) : snippet}{!isSearching && plainContent.length > 150 ? '…' : ''}
                      </div>
                    )}
                    {isExpanded && (
                      <div className="notes-item-content" dangerouslySetInnerHTML={{__html: note.content || ''}}/>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
