import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { sb } from '../lib/supabase.js';
import DOMPurify from 'dompurify';
import CalendarWindow from '../components/CalendarWindow/CalendarWindow.jsx';
import ProofreadPanel from '../components/ProofreadPanel.jsx';
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

/* ─── Study Packs Panel ──────────────────────────────────────────── */
function packArtifacts(p) {
  const arr = Array.isArray(p?.artifacts) ? p.artifacts : [];
  return {
    summary: arr.find(a => a.kind === 'summary')?.data || { bullets: [], key_concepts: [] },
    flashcards: arr.find(a => a.kind === 'flashcards')?.data || [],
    quiz: arr.find(a => a.kind === 'quiz')?.data || [],
  };
}

function packUrgency(p, eventsById) {
  if (p.status === 'archived') return -100;
  if (p.status === 'mastered') return -50;
  let score = p.status === 'needs_review' ? 100 : 0;
  const ev = p.linked_event_id ? eventsById[p.linked_event_id] : null;
  if (ev?.event_date) {
    const days = Math.round((new Date(ev.event_date) - new Date(new Date().toDateString())) / 86400000);
    score += days >= 0 ? Math.exp(-days / 3) * 50 : 5;
  }
  if (p.mastery != null) score += (1 - p.mastery) * 20;
  return score;
}

const PACK_STATUS_COLOR = {
  generating: 'var(--muted-foreground)',
  ready: 'var(--primary)',
  needs_review: 'hsl(8,70%,55%)',
  mastered: 'hsl(150,55%,45%)',
  archived: 'var(--muted-foreground)',
};

function StudyPacksContent({ user, events }) {
  const [packs,    setPacks]    = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [tab,      setTab]      = useState('summary');
  const [fcIdx,    setFcIdx]    = useState(0);
  const [flipped,  setFlipped]  = useState(false);
  const [qIdx,     setQIdx]     = useState(0);
  const [qSel,     setQSel]     = useState(null);
  const [qRevealed,setQRevealed]= useState(false);
  const [qScore,   setQScore]   = useState(0);
  const [qDone,    setQDone]    = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    sb.from('study_packs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setPacks(data); setLoading(false); });
    sb.from('study_attempts')
      .select('*')
      .eq('user_id', user.id)
      .order('attempted_at', { ascending: true })
      .then(({ data }) => { if (data) setAttempts(data); });
  }, [user]);

  const eventsById = {};
  (events || []).forEach(e => { eventsById[e.id] = e; });

  const sorted = [...packs].sort((a, b) => packUrgency(b, eventsById) - packUrgency(a, eventsById));
  const needsReviewCount = packs.filter(p => p.status === 'needs_review').length;
  const pack = selected ? packs.find(p => p.id === selected) : null;
  const { summary, flashcards, quiz } = packArtifacts(pack);
  const packAttempts = pack ? attempts.filter(a => a.study_pack_id === pack.id) : [];

  function openPack(id) {
    setSelected(id); setTab('summary');
    setFcIdx(0); setFlipped(false);
    setQIdx(0); setQSel(null); setQRevealed(false); setQScore(0); setQDone(false);
  }

  async function deletePack(id) {
    setPacks(prev => prev.filter(p => p.id !== id));
    if (selected === id) setSelected(null);
    await sb.from('study_packs').delete().eq('id', id).eq('user_id', user.id);
  }

  async function linkPackToEvent(packId, eventId) {
    const linked = eventId || null;
    setPacks(prev => prev.map(p => p.id === packId ? { ...p, linked_event_id: linked } : p));
    await sb.from('study_packs').update({ linked_event_id: linked }).eq('id', packId).eq('user_id', user.id);
  }

  async function finishQuiz(packId, correct, total) {
    const mastery = total > 0 ? correct / total : 0;
    const status = mastery >= 0.8 ? 'mastered' : mastery < 0.6 ? 'needs_review' : 'ready';
    const patch = { mastery, status, last_reviewed_at: new Date().toISOString() };
    setPacks(prev => prev.map(p => p.id === packId ? { ...p, ...patch } : p));
    await sb.from('study_packs').update(patch).eq('id', packId).eq('user_id', user.id);
    const p = packs.find(x => x.id === packId);
    const { data } = await sb.from('study_attempts').insert({
      user_id: user.id,
      study_pack_id: packId,
      topic: p?.topic || p?.title || null,
      subject: p?.subject || null,
      correct, total, mastery,
    }).select('*').single();
    if (data) setAttempts(prev => [...prev, data]);
  }

  const linkedEvent = pack?.linked_event_id ? eventsById[pack.linked_event_id] : null;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* List */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--sidebar)', overflowY: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Study Packs {packs.length > 0 && `· ${packs.length}`}{needsReviewCount > 0 && ` · ${needsReviewCount} need review`}
        </div>
        {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>Loading…</div>}
        {!loading && packs.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
            No study packs yet.<br/>Add a test or exam, import notes, or ask the AI for a "study pack".
          </div>
        )}
        {sorted.map(p => {
          const ev = p.linked_event_id ? eventsById[p.linked_event_id] : null;
          return (
            <div
              key={p.id}
              onClick={() => openPack(p.id)}
              style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected === p.id ? 'var(--muted)' : 'transparent', opacity: p.status === 'archived' ? 0.5 : 1 }}
              onMouseEnter={e => { if (selected !== p.id) e.currentTarget.style.background = 'var(--surface)'; }}
              onMouseLeave={e => { if (selected !== p.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', marginBottom: 2 }}>{p.title}</div>
              <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--muted-foreground)', alignItems: 'center' }}>
                <span style={{ color: PACK_STATUS_COLOR[p.status] || 'var(--muted-foreground)', fontWeight: 600 }}>
                  {p.status === 'needs_review' ? 'needs review' : p.status}
                </span>
                {p.mastery != null && <span>{Math.round(p.mastery * 100)}%</span>}
                {ev && <span style={{ marginLeft: 'auto' }}>📅 {ev.event_date}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--background)', overflowY: 'auto' }}>
        {pack ? (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>{pack.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                  {[pack.subject, pack.topic].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button onClick={() => deletePack(pack.id)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 12, padding: '4px 12px', cursor: 'pointer', flexShrink: 0 }}>Delete</button>
            </div>

            {/* Linked event picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 12, color: 'var(--muted-foreground)' }}>
              <span>Linked to:</span>
              <select
                value={pack.linked_event_id || ''}
                onChange={e => linkPackToEvent(pack.id, e.target.value)}
                style={{ flex: 1, maxWidth: 320, background: 'var(--surface)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontFamily: 'var(--font-ui)', fontSize: 12 }}
              >
                <option value="">— no calendar event —</option>
                {(events || []).map(ev => (
                  <option key={ev.id} value={ev.id}>{ev.title} ({ev.event_date})</option>
                ))}
              </select>
              {linkedEvent && <span style={{ color: 'var(--primary)' }}>due {linkedEvent.event_date}</span>}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
              {[
                { id: 'summary', label: 'Summary' },
                { id: 'flashcards', label: `Flashcards (${flashcards.length})` },
                { id: 'quiz', label: `Quiz (${quiz.length})` },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 'var(--radius-full,999px)', cursor: 'pointer', border: `1px solid ${tab === t.id ? 'var(--primary)' : 'var(--border)'}`, background: tab === t.id ? 'var(--muted)' : 'transparent', color: tab === t.id ? 'var(--primary)' : 'var(--muted-foreground)' }}>{t.label}</button>
              ))}
            </div>

            {tab === 'summary' && (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--foreground)' }}>
                {(summary.bullets || []).map((b, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0' }}><span style={{ color: 'var(--primary)' }}>•</span>{b}</div>
                ))}
                {(summary.key_concepts || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                    {summary.key_concepts.map((c, i) => (
                      <span key={i} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 'var(--radius-full,999px)', background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>{c}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'flashcards' && flashcards.length > 0 && (
              <div style={{ maxWidth: 420 }}>
                <div
                  onClick={() => setFlipped(f => !f)}
                  style={{ minHeight: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 14, color: 'var(--foreground)' }}
                >
                  {flipped ? (flashcards[fcIdx]?.a) : (flashcards[fcIdx]?.q)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                  <button onClick={() => { setFcIdx(i => Math.max(0, i - 1)); setFlipped(false); }} disabled={fcIdx === 0} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--foreground)', borderRadius: 'var(--radius-sm)', padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>Prev</button>
                  <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{fcIdx + 1} / {flashcards.length} · tap to flip</span>
                  <button onClick={() => { setFcIdx(i => Math.min(flashcards.length - 1, i + 1)); setFlipped(false); }} disabled={fcIdx === flashcards.length - 1} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--foreground)', borderRadius: 'var(--radius-sm)', padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>Next</button>
                </div>
              </div>
            )}

            {tab === 'quiz' && quiz.length > 0 && (
              <div style={{ maxWidth: 460 }}>
                {packAttempts.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 12 }}>
                    Past scores: {packAttempts.map(a => `${Math.round(Number(a.mastery) * 100)}%`).join(' → ')}
                  </div>
                )}
                {qDone ? (
                  <div style={{ textAlign: 'center', padding: 20 }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)' }}>{qScore} / {quiz.length}</div>
                    <div style={{ fontSize: 13, color: 'var(--muted-foreground)', margin: '6px 0 14px' }}>
                      Mastery updated to {Math.round((qScore / quiz.length) * 100)}%
                    </div>
                    <button onClick={() => { setQIdx(0); setQSel(null); setQRevealed(false); setQScore(0); setQDone(false); }} style={{ background: 'var(--primary)', border: 'none', color: 'white', borderRadius: 'var(--radius)', padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}>Retake</button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', marginBottom: 10 }}>{quiz[qIdx]?.q}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(quiz[qIdx]?.choices || []).map((choice, i) => {
                        const isAnswer = choice === quiz[qIdx].answer;
                        let bg = 'var(--surface)', bd = 'var(--border)';
                        if (qRevealed && isAnswer) { bg = 'color-mix(in srgb, hsl(150,55%,45%) 18%, transparent)'; bd = 'hsl(150,55%,45%)'; }
                        else if (qRevealed && choice === qSel) { bg = 'color-mix(in srgb, hsl(8,70%,55%) 18%, transparent)'; bd = 'hsl(8,70%,55%)'; }
                        else if (!qRevealed && choice === qSel) { bd = 'var(--primary)'; }
                        return (
                          <button key={i} onClick={() => { if (!qRevealed) setQSel(choice); }} style={{ textAlign: 'left', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: `1px solid ${bd}`, background: bg, color: 'var(--foreground)', cursor: qRevealed ? 'default' : 'pointer', fontSize: 13 }}>{choice}</button>
                        );
                      })}
                    </div>
                    {qRevealed && quiz[qIdx]?.explanation && (
                      <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 8 }}>{quiz[qIdx].explanation}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                      {!qRevealed && (
                        <button onClick={() => { setQRevealed(true); if (qSel === quiz[qIdx].answer) setQScore(s => s + 1); }} disabled={!qSel} style={{ background: 'var(--primary)', border: 'none', color: 'white', borderRadius: 'var(--radius)', padding: '6px 16px', cursor: qSel ? 'pointer' : 'not-allowed', opacity: qSel ? 1 : 0.5, fontSize: 13 }}>Check</button>
                      )}
                      {qRevealed && (
                        <button onClick={() => {
                          if (qIdx < quiz.length - 1) { setQIdx(i => i + 1); setQSel(null); setQRevealed(false); }
                          else { setQDone(true); finishQuiz(pack.id, qScore, quiz.length); }
                        }} style={{ background: 'var(--primary)', border: 'none', color: 'white', borderRadius: 'var(--radius)', padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}>
                          {qIdx < quiz.length - 1 ? 'Next' : 'Finish'}
                        </button>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted-foreground)' }}>{qIdx + 1}/{quiz.length} · {qScore} correct</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)', fontSize: 14 }}>
            Select a study pack to review
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
  const [activeView, setActiveView] = useState('study-packs');

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

  async function handleLogout() {
    await sb.auth.signOut();
    navigate('/');
  }

  const views = [
    { id: 'study-packs', label: 'Study Packs', icon: '📚' },
    { id: 'notes',       label: 'Notes',       icon: '⊡' },
    { id: 'study-plans', label: 'Study Plans', icon: '📋' },
    { id: 'flashcards',  label: 'Flashcards',  icon: '🃏' },
    { id: 'schedule',    label: 'Schedule',    icon: '📅' },
    { id: 'proofread',   label: 'Proofread',   icon: '✦' },
  ];

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
          onProofread={() => setActiveView('proofread')}
          aiThinking={false}
          syncStatus="saved"
          tasks={tasks}
          events={events}
          notes={notes}
        />
      </div>

      <div className="studio-center-col">
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeView === 'study-packs' && <StudyPacksContent user={user} events={events} />}
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

        {/* Bottom view switcher */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '7px 16px', borderTop: '1px solid var(--line)', background: 'var(--bg-2)', flexWrap: 'wrap' }}>
          {views.map(v => (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id)}
              style={{
                background: activeView === v.id ? 'var(--bg-3)' : 'transparent',
                border: activeView === v.id ? '1px solid var(--accent)' : '1px solid transparent',
                color: activeView === v.id ? 'var(--accent)' : 'var(--fg-2)',
                borderRadius: 999,
                padding: '4px 14px',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all 0.15s ease-out',
                whiteSpace: 'nowrap',
              }}
            >
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
