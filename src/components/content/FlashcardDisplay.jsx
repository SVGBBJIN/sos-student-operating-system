import { useState } from 'react';
import Icon from '../../lib/icons';
import { srsCardKey, srsRate } from '../../lib/srsUtils';
import ContentCard from './ContentCard';

export default function FlashcardDisplay({ data, onSave, onDismiss }) {
  const cards = data.cards || [];
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [lastInterval, setLastInterval] = useState(null);

  if (cards.length === 0) {
    return (
      <ContentCard icon={Icon.layers(16)} title={data.title || 'Flashcards'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)">
        <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>No cards yet — tell me what you're studying</div>
      </ContentCard>
    );
  }

  function goNext() { if (idx < cards.length - 1) { setFlipped(false); setLastInterval(null); setTimeout(() => setIdx(i => i + 1), 100); } }
  function goPrev() { if (idx > 0) { setFlipped(false); setLastInterval(null); setTimeout(() => setIdx(i => i - 1), 100); } }
  function rate(rating) {
    const key = srsCardKey(data.title, cards[idx]?.q);
    const interval = srsRate(key, rating);
    setLastInterval(interval);
    setTimeout(() => { setLastInterval(null); goNext(); }, 900);
  }

  return (
    <ContentCard icon={Icon.layers(16)} title={data.title || 'Flashcards'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)">
      <div className="fc-container" onClick={() => setFlipped(f => !f)}>
        <div className={'fc-inner' + (flipped ? ' flipped' : '')}>
          <div className="fc-front"><div>{cards[idx]?.q || 'No question'}</div></div>
          <div className="fc-back"><div>{cards[idx]?.a || 'No answer'}</div></div>
        </div>
      </div>
      {lastInterval !== null && (
        <div style={{ textAlign: 'center', fontSize: '0.76rem', color: 'var(--teal)', animation: 'fadeIn .2s ease', marginTop: 4, fontStyle: 'italic' }}>
          {lastInterval === 0 ? "Back in the queue — you'll see this again today" : `Next review: in ${lastInterval} day${lastInterval === 1 ? '' : 's'}`}
        </div>
      )}
      <div className="fc-nav">
        <button className="fc-nav-btn" onClick={e => { e.stopPropagation(); goPrev(); }} disabled={idx === 0}>{Icon.chevronLeft(16)}</button>
        <span className="fc-counter">{idx + 1} / {cards.length}</span>
        <button className="fc-nav-btn" onClick={e => { e.stopPropagation(); goNext(); }} disabled={idx === cards.length - 1}>{Icon.chevronRight(16)}</button>
      </div>
      {flipped && lastInterval === null && (
        <div className="fc-chips">
          <button className="fc-chip chip-know" onClick={e => { e.stopPropagation(); rate('know'); }}>✓ Got it</button>
          <button className="fc-chip chip-unsure" onClick={e => { e.stopPropagation(); rate('unsure'); }}>~ Almost</button>
          <button className="fc-chip chip-nope" onClick={e => { e.stopPropagation(); rate('nope'); }}>✗ Nope</button>
        </div>
      )}
      <div className="fc-hint">tap card to flip</div>
    </ContentCard>
  );
}
