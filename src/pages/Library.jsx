import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { sb } from '../lib/supabase.js';
import DOMPurify from 'dompurify';
import CalendarWindow from '../components/CalendarWindow/CalendarWindow.jsx';
import ProofreadPanel from '../components/ProofreadPanel.jsx';

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

/* ─── Flashcards Panel ───────────────────────────────────────────── */
function FlashcardsContent({ user }) {
  const [decks,       setDecks]       = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [reviewing,   setReviewing]   = useState(false);
  const [cardIdx,     setCardIdx]     = useState(0);
  const [flipped,     setFlipped]     = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);
  const [newTitle,    setNewTitle]    = useState('');
  const [newCards,    setNewCards]    = useState([{ q: '', a: '' }]);
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    sb.from('flashcard_decks')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setDecks(data); setLoading(false); });
  }, [user]);

  const deck = selected ? decks.find(d => d.id === selected) : null;
  const cards = deck?.cards || [];

  function openDeck(id) { setSelected(id); setReviewing(false); setCardIdx(0); setFlipped(false); }
  function startReview() { setReviewing(true); setCardIdx(0); setFlipped(false); }
  function nextCard() { setCardIdx(i => (i + 1) % cards.length); setFlipped(false); }
  function prevCard() { setCardIdx(i => (i - 1 + cards.length) % cards.length); setFlipped(false); }

  async function deleteDeck(id) {
    setDecks(prev => prev.filter(d => d.id !== id));
    if (selected === id) { setSelected(null); setReviewing(false); }
    await sb.from('flashcard_decks').delete().eq('id', id).eq('user_id', user.id);
  }

  async function saveNewDeck() {
    if (!user || !newTitle.trim()) return;
    const validCards = newCards.filter(c => c.q.trim() && c.a.trim());
    if (validCards.length === 0) return;
    setSaving(true);
    const { data, error } = await sb.from('flashcard_decks').insert({
      user_id: user.id,
      title: newTitle.trim().slice(0, 200),
      cards: validCards,
      source: 'manual',
      card_count: validCards.length,
    }).select('*').single();
    if (!error && data) {
      setDecks(prev => [data, ...prev]);
      setSelected(data.id);
    }
    setSaving(false);
    setShowCreate(false);
    setNewTitle('');
    setNewCards([{ q: '', a: '' }]);
  }

  function addCard() { setNewCards(prev => [...prev, { q: '', a: '' }]); }
  function updateCard(i, field, val) {
    setNewCards(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c));
  }
  function removeCard(i) { setNewCards(prev => prev.filter((_, idx) => idx !== i)); }

  const inputStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 10px', color: 'var(--foreground)', fontFamily: 'var(--font-ui)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Deck list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--sidebar)' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
            Flashcard Decks {decks.length > 0 && `· ${decks.length}`}
          </span>
          <button
            onClick={() => setShowCreate(true)}
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 600, padding: '3px 10px', cursor: 'pointer' }}
          >+ New</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>Loading…</div>}
          {!loading && decks.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
              No flashcard decks yet.<br/>Create one manually or ask the AI to "create flashcards on [topic]".
            </div>
          )}
          {decks.map(d => (
            <div
              key={d.id}
              onClick={() => openDeck(d.id)}
              style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected === d.id ? 'var(--muted)' : 'transparent', transition: 'background var(--duration-fast) ease-out' }}
              onMouseEnter={e => { if (selected !== d.id) e.currentTarget.style.background = 'var(--surface)'; }}
              onMouseLeave={e => { if (selected !== d.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', marginBottom: 2 }}>{d.title}</div>
              <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--muted-foreground)' }}>
                <span>{d.card_count || (d.cards || []).length} card{d.card_count !== 1 ? 's' : ''}</span>
                <span style={{ color: d.source === 'ai' ? 'var(--primary)' : 'var(--muted-foreground)' }}>{d.source}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail / review */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--background)' }}>
        {showCreate ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)' }}>New Flashcard Deck</span>
              <button onClick={() => setShowCreate(false)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Deck title…"
              style={{ ...inputStyle, marginBottom: 16, fontSize: 14, fontWeight: 600 }}
            />
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Cards</div>
            {newCards.map((card, i) => (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Card {i + 1}</span>
                  {newCards.length > 1 && (
                    <button onClick={() => removeCard(i)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 12 }}>Remove</button>
                  )}
                </div>
                <input
                  value={card.q}
                  onChange={e => updateCard(i, 'q', e.target.value)}
                  placeholder="Question…"
                  style={{ ...inputStyle, marginBottom: 6 }}
                />
                <textarea
                  value={card.a}
                  onChange={e => updateCard(i, 'a', e.target.value)}
                  placeholder="Answer…"
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
            ))}
            <button onClick={addCard} style={{ background: 'transparent', border: '1px dashed var(--border)', color: 'var(--muted-foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '8px 16px', cursor: 'pointer', width: '100%', marginBottom: 16 }}>+ Add card</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={saveNewDeck}
                disabled={saving || !newTitle.trim() || newCards.every(c => !c.q.trim())}
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, padding: '8px 20px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
              >{saving ? 'Saving…' : 'Save deck'}</button>
              <button onClick={() => setShowCreate(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '8px 20px', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        ) : deck && reviewing ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 16 }}>
              {deck.title} · Card {cardIdx + 1} of {cards.length}
            </div>
            {/* Flip card */}
            <div
              onClick={() => setFlipped(f => !f)}
              style={{ width: '100%', maxWidth: 520, minHeight: 200, background: flipped ? 'var(--muted)' : 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', transition: 'background 0.2s', marginBottom: 24 }}
            >
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                  {flipped ? 'Answer' : 'Question'}
                </div>
                <div style={{ fontSize: 15, color: 'var(--foreground)', lineHeight: 1.6 }}>
                  {flipped ? cards[cardIdx]?.a : cards[cardIdx]?.q}
                </div>
                {!flipped && <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 16 }}>tap to reveal answer</div>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button onClick={prevCard} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '6px 16px', cursor: 'pointer' }}>← Prev</button>
              <button onClick={() => setReviewing(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', fontSize: 12, cursor: 'pointer' }}>Done</button>
              <button onClick={nextCard} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '6px 16px', cursor: 'pointer' }}>Next →</button>
            </div>
          </div>
        ) : deck ? (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>{deck.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{cards.length} card{cards.length !== 1 ? 's' : ''} · {deck.source}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={startReview} style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, padding: '6px 16px', cursor: 'pointer' }}>Review</button>
                <button onClick={() => deleteDeck(deck.id)} style={{ background: 'transparent', border: '1px solid var(--error)', color: 'var(--error)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '6px 12px', cursor: 'pointer' }}>Delete</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cards.map((c, i) => (
                <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>Q: {c.q}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>A: {c.a}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', fontSize: 14 }}>
            Select a deck to review, or create a new one
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
  const [activeView, setActiveView] = useState('notes');

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

  useEffect(() => {
    function onCalEvent() { setActiveView('schedule'); }
    window.addEventListener('sos:calendar:new-event', onCalEvent);
    return () => window.removeEventListener('sos:calendar:new-event', onCalEvent);
  }, []);

  useEffect(() => {
    function onNewNote() { setActiveView('notes'); }
    window.addEventListener('sos:notes:created', onNewNote);
    return () => window.removeEventListener('sos:notes:created', onNewNote);
  }, []);

  function handleEventUpdate(updated) {
    setEvents(prev => prev.map(e => e.id === updated.id ? updated : e));
  }

  const views = [
    { id: 'notes',       label: 'Notes',        icon: '⊡' },
    { id: 'study-plans', label: 'Study Plans',   icon: '📋' },
    { id: 'flashcards',  label: 'Flashcards',    icon: '🃏' },
    { id: 'schedule',    label: 'Schedule',      icon: '📅' },
    { id: 'proofread',   label: 'Proofread',     icon: '✦' },
  ];

  const viewLabel = views.find(v => v.id === activeView)?.label || '';

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
          {viewLabel}
        </span>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {activeView === 'notes' && <NotesContent user={user} />}
        {activeView === 'study-plans' && <StudyPlansContent user={user} />}
        {activeView === 'flashcards' && <FlashcardsContent user={user} />}
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
        {activeView === 'proofread' && <ProofreadPanel />}
      </div>

      {/* Bottom toggle bar */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '7px 16px', borderTop: '1px solid var(--border)', background: 'var(--sidebar)', flexWrap: 'wrap' }}>
        {views.map(v => (
          <button
            key={v.id}
            onClick={() => setActiveView(v.id)}
            style={{
              background: activeView === v.id ? 'var(--muted)' : 'transparent',
              border: activeView === v.id ? '1px solid var(--primary)' : '1px solid transparent',
              color: activeView === v.id ? 'var(--primary)' : 'var(--muted-foreground)',
              borderRadius: 'var(--radius-full)',
              padding: '4px 14px',
              fontFamily: 'var(--font-ui)',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all var(--duration-fast) ease-out',
              whiteSpace: 'nowrap',
            }}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
