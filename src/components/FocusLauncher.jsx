// FocusLauncher — the one-tap entry into a focus session.
//
// The task list lives here now, inline — not a separate floating widget.
// Picking what to work on and starting the timer are the same motion: tap a
// task's Start pill and the session ignites immediately with that task
// active. No second click, no ambient soft-timer standing in for the real
// thing. Marathon still supports a blind Top-N goal (priority engine drives
// order, no hand-picking) alongside the same list for "Pick tasks".
//
// Presentational: App ranks the pool and runs the session. Dry, no praise.

import React, { useState } from 'react';

const SPRINT_DURATIONS = [
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '25 min', ms: 25 * 60 * 1000 },
  { label: '45 min', ms: 45 * 60 * 1000 },
  { label: '60 min', ms: 60 * 60 * 1000 },
];
const COUNT_GOALS = [3, 5, 8];

const wrapStyle = {
  position: 'fixed', inset: 0, zIndex: 810, overflow: 'hidden',
  background: 'radial-gradient(circle at 50% 30%, #0c1020 0%, #06070f 70%, #040509 100%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: 32, textAlign: 'center', gap: 22, animation: 'gateFadeIn 320ms ease-out',
};
const labelStyle = { fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontWeight: 500 };
const segBtn = (on) => ({
  padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600,
  border: on ? '1px solid rgba(94,234,212,0.5)' : '1px solid rgba(255,255,255,0.12)',
  background: on ? 'rgba(94,234,212,0.12)' : 'rgba(255,255,255,0.03)',
  color: on ? 'rgba(170,245,230,0.95)' : 'rgba(255,255,255,0.66)',
});
const chip = (on) => ({
  padding: '8px 16px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 500,
  border: on ? '1px solid rgba(94,234,212,0.5)' : '1px solid rgba(255,255,255,0.12)',
  background: on ? 'rgba(94,234,212,0.12)' : 'rgba(255,255,255,0.03)',
  color: on ? 'rgba(170,245,230,0.95)' : 'rgba(255,255,255,0.6)',
});

function dueLabel(task) {
  if (!task?.dueDate) return task?.subject || '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(task.dueDate + 'T00:00:00');
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days}d`;
}

// One CTA per task, one fact per CTA — the strongest real allocator signal,
// gain-framed, never a fabricated number.
function ctaText(taskChip) {
  if (!taskChip) return 'Start';
  if (typeof taskChip.reductionPct === 'number') return `Start · clears ~${taskChip.reductionPct}% today`;
  if (taskChip.label) return `Start ${taskChip.label}`;
  return 'Start';
}

function TaskRow({ task, chip: taskChip, mode, selected, onStart, onToggle }) {
  const fit = taskChip?.tone === 'fit';
  const isSelect = mode === 'select';
  return (
    <div
      className="fl-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 12,
        border: selected ? '1px solid rgba(94,234,212,0.5)' : '1px solid rgba(255,255,255,0.08)',
        background: selected ? 'rgba(94,234,212,0.10)' : 'rgba(255,255,255,0.02)',
        textAlign: 'left', cursor: isSelect ? 'pointer' : 'default',
      }}
      onClick={isSelect ? onToggle : undefined}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.9)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {selected ? '✓ ' : ''}{task.title}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
          {[dueLabel(task), task.subject].filter(Boolean).join(' · ')}
        </div>
      </div>
      {mode === 'start' && (
        <button
          onClick={(e) => { e.stopPropagation(); onStart?.(task); }}
          style={{
            flexShrink: 0, padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
            background: fit ? 'rgba(94,234,212,0.92)' : 'rgba(255,255,255,0.08)',
            color: fit ? '#05231f' : 'rgba(255,255,255,0.85)',
            fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
          }}
        >
          {ctaText(taskChip)}
        </button>
      )}
    </div>
  );
}

export default function FocusLauncher({ tasks = [], chips = [], onLaunch, onClose }) {
  const [mode, setMode] = useState('sprint');
  const [durationMs, setDurationMs] = useState(SPRINT_DURATIONS[1].ms);
  const [goalKind, setGoalKind] = useState('count');
  const [count, setCount] = useState(5);
  const [selected, setSelected] = useState([]); // task ids

  const empty = tasks.length === 0;

  function toggleSel(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function launch() {
    if (empty) return;
    if (mode === 'sprint') {
      onLaunch?.({ mode: 'sprint', durationMs });
      return;
    }
    const goal = goalKind === 'count'
      ? { kind: 'count', count: Math.max(1, Math.min(count, tasks.length)) }
      : { kind: 'selection', taskIds: selected };
    onLaunch?.({ mode: 'marathon', goal });
  }

  // Tapping a task's own Start pill launches immediately — the timer starts
  // on this click, no separate confirm step. Sprint always: a one-task jump
  // in mid-Marathon-setup shouldn't require abandoning the goal picker first.
  function startOne(task) {
    onLaunch?.({ mode: 'sprint', durationMs, startTaskId: task.id });
  }

  const canLaunch = !empty && (mode === 'sprint' || goalKind === 'count' || selected.length > 0);

  return (
    <div style={wrapStyle} role="dialog" aria-label="Start a focus session">
      <div className="fl-bg" aria-hidden="true" />

      <div style={labelStyle}>Head down</div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button style={segBtn(mode === 'sprint')} onClick={() => setMode('sprint')}>Sprint</button>
        <button style={segBtn(mode === 'marathon')} onClick={() => setMode('marathon')}>Marathon</button>
      </div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', maxWidth: 360, lineHeight: 1.4 }}>
        {mode === 'sprint'
          ? 'Tap a task to start now, or take the top of the queue blind.'
          : 'Bound by a goal, not a clock. Looped sprints with a break in the seams.'}
      </div>

      {empty && (
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Nothing on the board to run.</div>
      )}

      {!empty && mode === 'sprint' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {SPRINT_DURATIONS.map(d => (
              <button key={d.ms} style={chip(durationMs === d.ms)} onClick={() => setDurationMs(d.ms)}>{d.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '38vh', overflowY: 'auto', width: 'min(440px, 90vw)' }}>
            {tasks.map((t, i) => (
              <TaskRow key={t.id} task={t} chip={chips[i]} mode="start" onStart={startOne} />
            ))}
          </div>
        </>
      )}

      {!empty && mode === 'marathon' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={segBtn(goalKind === 'count')} onClick={() => setGoalKind('count')}>Top N</button>
            <button style={segBtn(goalKind === 'selection')} onClick={() => setGoalKind('selection')}>Pick tasks</button>
          </div>
          {goalKind === 'count' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {COUNT_GOALS.filter(n => n <= tasks.length).map(n => (
                <button key={n} style={chip(count === n)} onClick={() => setCount(n)}>{n}</button>
              ))}
              {tasks.length > 0 && !COUNT_GOALS.includes(tasks.length) && (
                <button style={chip(count === tasks.length)} onClick={() => setCount(tasks.length)}>all {tasks.length}</button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '40vh', overflowY: 'auto', width: 'min(440px, 90vw)' }}>
              {tasks.map((t, i) => (
                <TaskRow key={t.id} task={t} chip={chips[i]} mode="select" selected={selected.includes(t.id)} onToggle={() => toggleSel(t.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button
          onClick={launch}
          disabled={!canLaunch}
          style={{
            padding: '11px 32px', borderRadius: 12, border: 'none',
            cursor: canLaunch ? 'pointer' : 'default', opacity: canLaunch ? 1 : 0.4,
            background: 'rgba(94,234,212,0.92)', color: '#05231f', fontSize: 15, fontWeight: 700,
          }}
        >
          {mode === 'sprint' ? 'Start top of queue' : 'Start'}
        </button>
        <button
          onClick={onClose}
          style={{
            padding: '11px 24px', borderRadius: 12, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
            color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: 500,
          }}
        >
          Cancel
        </button>
      </div>

      <style>{`
        @keyframes gateFadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes flDrift {
          0%   { transform: translate(-4%, -3%) scale(1); }
          50%  { transform: translate(3%, 4%) scale(1.08); }
          100% { transform: translate(-4%, -3%) scale(1); }
        }
        .fl-bg {
          position: absolute; inset: -10%; z-index: -1; pointer-events: none;
          background: radial-gradient(circle at 30% 30%, rgba(94,234,212,0.07), transparent 55%),
                      radial-gradient(circle at 72% 68%, rgba(94,234,212,0.05), transparent 60%);
          animation: flDrift 26s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .fl-bg { animation: none; }
        }
      `}</style>
    </div>
  );
}
