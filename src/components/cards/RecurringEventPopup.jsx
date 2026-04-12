import { useState, useEffect } from 'react';
import Icon from '../../lib/icons';
import { fmt, toDateStr, today } from '../../lib/dateUtils';

export default function RecurringEventPopup({ action, onConfirm, onCancel }) {
  const [generatedEvents, setGeneratedEvents] = useState([]);
  const [selAll, setSelAll] = useState(true);

  useEffect(() => {
    const dayNameToIndex = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const dayIndices = (action.days || []).map(d => dayNameToIndex[d]).filter(d => d !== undefined);
    const start = new Date(action.start_date || today());
    const endDefault = new Date(); endDefault.setMonth(endDefault.getMonth() + 3);
    const end = new Date(action.end_date || toDateStr(endDefault));
    const generated = [];
    const cursor = new Date(start);
    while (cursor <= end && generated.length < 100) {
      if (dayIndices.includes(cursor.getDay())) {
        const ds = toDateStr(cursor);
        generated.push({ id: Math.random().toString(36).slice(2), title: action.title || 'Event', date: ds, event_type: action.event_type || 'event', subject: action.subject || '', checked: true });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    setGeneratedEvents(generated);
  }, [action]);

  function toggleEv(idx) { setGeneratedEvents(prev => prev.map((ev, i) => i === idx ? { ...ev, checked: !ev.checked } : ev)); }
  function toggleAllEv() { const v = !selAll; setSelAll(v); setGeneratedEvents(prev => prev.map(ev => ({ ...ev, checked: v }))); }
  const checkedCount = generatedEvents.filter(e => e.checked).length;

  return (
    <div className="confirm-card" style={{ maxWidth: 420, borderLeftColor: 'var(--teal)' }}>
      <div className="confirm-card-hdr">
        <div className="confirm-card-hdr-left">
          <div className="confirm-card-hdr-icon" style={{ background: 'rgba(43,203,186,0.1)', borderColor: 'rgba(43,203,186,0.2)', color: 'var(--teal)' }}>{Icon.calendar(16)}</div>
          <span className="confirm-card-hdr-title">Recurring: {action.title}</span>
        </div>
        <span className="confirm-card-hdr-badge" style={{ background: 'rgba(43,203,186,0.1)', color: 'var(--teal)', border: '1px solid rgba(43,203,186,0.2)' }}>{checkedCount} events</span>
      </div>
      <div className="confirm-card-body" style={{ maxHeight: 200, overflowY: 'auto' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <input type="checkbox" checked={selAll} onChange={toggleAllEv} /> Select All ({generatedEvents.length})
        </label>
        {generatedEvents.map((ev, idx) => (
          <label key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: '0.82rem' }}>
            <input type="checkbox" checked={ev.checked} onChange={() => toggleEv(idx)} />
            <span>{ev.title} — {fmt(ev.date)} ({new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })})</span>
          </label>
        ))}
      </div>
      <div className="confirm-card-actions">
        <button className="confirm-btn confirm-btn-yes" onClick={() => onConfirm(generatedEvents.filter(e => e.checked))} disabled={checkedCount === 0}>
          {Icon.check(14)} Add {checkedCount} Events
        </button>
        <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>{Icon.x(14)} Cancel</button>
      </div>
    </div>
  );
}
