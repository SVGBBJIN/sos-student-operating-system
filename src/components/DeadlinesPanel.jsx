import React, { useMemo, useState } from 'react';
import Icon from '../lib/icons';
import { daysUntil, getNudge, today } from '../lib/dateUtils';

const dayAbbrev = { Sunday: 'Su', Monday: 'M', Tuesday: 'Tu', Wednesday: 'W', Thursday: 'Th', Friday: 'F', Saturday: 'Sa' };

function fixedCommitmentLines(recurring) {
  return (recurring || []).map((rb, i) => {
    const days = Array.isArray(rb.days)
      ? rb.days.map(d => (typeof d === 'number' ? ['Su','M','Tu','W','Th','F','Sa'][d] : dayAbbrev[d] || d)).join('/')
      : '';
    return { key: rb.name + i, label: rb.name || rb.category || 'block', days, time: rb.start && rb.end ? `${rb.start}–${rb.end}` : '', category: rb.category };
  });
}

// Deadlines absorb the calendar: due-date tasks/events get day-by-day
// breakdown cards; recurring blocks (school/sleep/swim/...) show as a
// read-only strip used only to gauge how much free time is actually left —
// they're not independently manageable from here (block CRUD stays chat-only,
// same as most other actions in this app).
export default function DeadlinesPanel({ tasks = [], events = [], blocks = null, ongoing = [], onClose, onBreakTask, onOpenChat }) {
  const [tab, setTab] = useState('deadlines');

  const upcoming = useMemo(() => {
    const horizon = 30;
    const items = [];
    tasks.forEach(t => {
      if (t.status === 'done') return;
      const d = daysUntil(t.dueDate);
      if (d > horizon) return;
      const subtasks = tasks.filter(st => st.id !== t.id && st.subject === t.title && st.status !== 'done');
      items.push({ kind: 'task', id: t.id, title: t.title, subject: t.subject, dueDate: t.dueDate, daysAway: d, obj: t, subtasks });
    });
    events.forEach(ev => {
      if (!ev.date) return;
      const d = daysUntil(ev.date);
      if (d > horizon || d < 0) return;
      items.push({ kind: 'event', id: ev.id, title: ev.title, subject: ev.subject, dueDate: ev.date, daysAway: d, obj: ev, subtasks: [] });
    });
    return items.sort((a, b) => a.daysAway - b.daysAway);
  }, [tasks, events]);

  const commitments = useMemo(() => fixedCommitmentLines(blocks?.recurring), [blocks]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 400, maxWidth: '95vw', height: '100vh', background: 'var(--surface)', borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.4)' }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>{Icon.calendar ? Icon.calendar(16) : null}</span>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)', flex: 1 }}>Deadlines</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}>{Icon.x(16)}</button>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          {['deadlines', 'ongoing'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '6px 0', borderRadius: 8, border: 'none', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
              background: tab === t ? 'rgba(108,99,255,0.15)' : 'rgba(255,255,255,0.04)',
              color: tab === t ? 'var(--accent)' : 'var(--text-dim)',
            }}>{t === 'deadlines' ? 'Deadlines' : 'Ongoing'}</button>
          ))}
        </div>

        {commitments.length > 0 && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Fixed commitments</div>
            {commitments.map(c => (
              <span key={c.key} style={{ display: 'inline-block', fontSize: '0.74rem', color: 'var(--text-dim)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '3px 8px', marginRight: 6 }}>
                {c.label} · {c.days} {c.time}
              </span>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {tab === 'deadlines' && (
            upcoming.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>Nothing due in the next 30 days.</div>
            ) : upcoming.map(item => {
              const nudge = item.kind === 'task' ? getNudge(item.obj) : null;
              return (
                <div key={item.kind + item.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, marginBottom: 8, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 2 }}>{item.subject || (item.kind === 'event' ? 'Event' : 'Task')} · {item.dueDate}</div>
                    </div>
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700, padding: '3px 9px', borderRadius: 7, flexShrink: 0,
                      background: item.daysAway <= 0 ? 'rgba(255,80,80,0.15)' : item.daysAway <= 3 ? 'rgba(255,165,2,0.15)' : 'rgba(108,99,255,0.1)',
                      color: item.daysAway <= 0 ? '#ff5050' : item.daysAway <= 3 ? 'var(--orange)' : 'var(--accent)',
                    }}>{nudge ? nudge.text : (item.daysAway <= 0 ? 'today' : `${item.daysAway}d left`)}</span>
                  </div>
                  {item.kind === 'task' && item.subtasks.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      {item.subtasks
                        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                        .map(st => (
                          <div key={st.id} style={{ display: 'flex', gap: 8, fontSize: '0.78rem', color: 'var(--text-dim)', padding: '2px 0' }}>
                            <span style={{ flex: 1 }}>{st.title}</span>
                            <span>{st.dueDate === today() ? 'today' : st.dueDate}</span>
                          </div>
                        ))}
                    </div>
                  )}
                  {item.kind === 'task' && item.subtasks.length === 0 && (
                    <button onClick={() => onBreakTask?.(item.obj)} style={{
                      marginTop: 8, background: 'rgba(108,99,255,0.08)', border: '1px solid rgba(108,99,255,0.2)', color: 'var(--accent)',
                      borderRadius: 7, padding: '5px 10px', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer',
                    }}>Break this down</button>
                  )}
                </div>
              );
            })
          )}

          {tab === 'ongoing' && (
            ongoing.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                Nothing ranked yet — ask "what should I work on" in chat, or add tasks with due dates.
              </div>
            ) : ongoing.map(r => (
              <div key={r.taskId} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, marginBottom: 8, padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--teal)' }}>{Math.round(r.score * 100)}</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-dim)', marginTop: 3 }}>
                  {r.daysUntilDue <= 0 ? 'overdue' : `${Math.ceil(r.daysUntilDue)}d left`} · {r.explanation}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={() => { onClose(); onOpenChat?.(); }} style={{
            width: '100%', background: 'rgba(108,99,255,0.08)', border: '1px solid rgba(108,99,255,0.2)', color: 'var(--accent)',
            borderRadius: 9, padding: '9px 0', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
          }}>Ask about a deadline in chat</button>
        </div>
      </div>
    </div>
  );
}
