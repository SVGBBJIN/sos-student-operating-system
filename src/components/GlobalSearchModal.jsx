import React from 'react';

/* ═══════════════════════════════════════════════
   GLOBAL SEARCH MODAL (Cmd+K)
   ═══════════════════════════════════════════════ */
export default function GlobalSearchModal({ query, onQueryChange, onClose, tasks, events, notes, savedChats = [], onSelectNote, onOpenSavedChat, onSendMessage }) {
  const inputRef = React.useRef(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const q = query.trim().toLowerCase();
  const results = React.useMemo(() => {
    if (!q) return [];
    const out = [];
    tasks.forEach(t => {
      if (t.title?.toLowerCase().includes(q) || t.subject?.toLowerCase().includes(q)) {
        out.push({ kind: 'task', id: t.id, label: t.title, sub: t.dueDate ? `Due ${t.dueDate}` : t.subject || 'Task', obj: t });
      }
    });
    events.forEach(ev => {
      if (ev.title?.toLowerCase().includes(q)) {
        out.push({ kind: 'event', id: ev.id, label: ev.title, sub: ev.date || 'Event', obj: ev });
      }
    });
    notes.forEach(n => {
      const plain = (n.content || '').replace(/<[^>]+>/g, '');
      if (n.name?.toLowerCase().includes(q) || plain.toLowerCase().includes(q)) {
        const idx = plain.toLowerCase().indexOf(q);
        const snippet = idx >= 0 ? '…' + plain.slice(Math.max(0, idx - 20), idx + 60) + '…' : plain.slice(0, 80);
        out.push({ kind: 'note', id: n.id, label: n.name || 'Untitled', sub: snippet, obj: n });
      }
    });
    savedChats.forEach(chat => {
      const haystack = [chat.title, ...(chat.messages || []).map(m => m.content)].join(' ').toLowerCase();
      if (haystack.includes(q)) {
        const msg = (chat.messages || []).find(m => (m.content || '').toLowerCase().includes(q));
        const sub = msg?.content ? 'Chat · ' + msg.content.slice(0, 80) : `Saved chat · ${chat.messageCount || 0} messages`;
        out.push({ kind: 'chat', id: chat.id, label: chat.title || 'Saved chat', sub, obj: chat });
      }
    });
    return out.slice(0, 12);
  }, [q, tasks, events, notes, savedChats]);

  React.useEffect(() => { setActiveIndex(0); }, [query]);

  const kindIcon = { task: '☑', event: '📅', note: '📝', chat: '💬' };

  function handleSelect(r) {
    if (!r) return;
    if (r.kind === 'note') onSelectNote(r.obj);
    else if (r.kind === 'chat') onOpenSavedChat?.(r.id);
    else onSendMessage(`Tell me about "${r.label}"`);
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    }
  }

  return (
    <div className="gsearch-overlay" onClick={onClose}>
      <div className="gsearch-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="gsearch-input-wrap">
          <span className="gsearch-icon">⌘K</span>
          <input
            ref={inputRef}
            className="gsearch-input"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Search tasks, events, notes, chats…"
            onKeyDown={handleSearchKeyDown}
          />
          {query && <button className="gsearch-clear" onClick={() => onQueryChange('')}>×</button>}
        </div>
        {results.length > 0 ? (
          <div className="gsearch-results">
            {results.map((r, index) => (
              <button key={r.kind + r.id} className={'gsearch-result' + (index === activeIndex ? ' active' : '')} onMouseEnter={() => setActiveIndex(index)} onClick={() => handleSelect(r)}>
                <span className="gsearch-kind">{kindIcon[r.kind]}</span>
                <span className="gsearch-result-label">{r.label}</span>
                <span className="gsearch-result-sub">{r.sub}</span>
              </button>
            ))}
          </div>
        ) : q ? (
          <div className="gsearch-empty">No matches for "{query}"</div>
        ) : (
          <div className="gsearch-empty">Start typing to search tasks, events, and notes</div>
        )}
      </div>
    </div>
  );
}
