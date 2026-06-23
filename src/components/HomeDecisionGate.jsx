// HomeDecisionGate — the home surface the student passes through to reach SOS.
//
// A full-screen gate that surfaces AT MOST TWO tasks (chosen globally by the
// priority engine, never a new ranking) and never forces work. Each surfaced
// task carries a trajectory chip — what acting now buys toward the deadline —
// and offers three doors:
//   Start  → run the Start primitive on this task
//   Swap   → replace just this task with the next-ranked one (the other stays
//            put; the pair never reshuffles under the student)
//   Defer  → push this task aside for now (logged as a postpone)
//
// Two doors out live in the footer and always exist, so the gate never traps:
//   I did my own work → credit self-directed work and pass (no forced complete)
//   Nothing right now → quiet dismissal
//
// If the board is genuinely clear, the gate degrades to a single line and one
// external escape. Copy is terse and dry: no celebration, no streaks, no
// nudging, no loss framing.

import React from 'react';

// One truthful escape when there is genuinely nothing on the board.
const ESCAPE_URL = 'https://www.youtube.com';

function dueLabel(task) {
  if (!task?.dueDate) return task?.subject || '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(task.dueDate + 'T00:00:00');
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return `overdue · was due ${task.dueDate}`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

function TrajectoryChip({ chip }) {
  if (!chip) return null;
  const fit = chip.tone === 'fit';
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
        padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
        letterSpacing: '0.01em', marginTop: 2,
        border: `1px solid ${fit ? 'rgba(94,234,212,0.32)' : 'rgba(255,255,255,0.16)'}`,
        background: fit ? 'rgba(94,234,212,0.10)' : 'rgba(255,255,255,0.04)',
        color: fit ? 'rgba(170,245,230,0.92)' : 'rgba(255,255,255,0.6)',
      }}
    >
      <span>{chip.label}</span>
      {typeof chip.reductionPct === 'number' && (
        <span style={{ opacity: 0.8 }}>· clears ~{chip.reductionPct}% today</span>
      )}
      {typeof chip.probabilityPct === 'number' && (
        <span style={{ opacity: 0.7 }}>· {chip.probabilityPct}% on time</span>
      )}
    </div>
  );
}

function TaskRow({ task, chip, single, onStart, onSwap, onDefer, canSwap }) {
  const doorBtn = {
    padding: '9px 0', borderRadius: 11, cursor: 'pointer', flex: 1,
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.035)',
    color: 'rgba(255,255,255,0.74)', fontSize: 13, fontWeight: 500,
  };
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: 18, borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.025)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
        <div style={{
          fontSize: single ? 'clamp(22px, 4vw, 32px)' : 'clamp(18px, 3vw, 24px)',
          fontWeight: 600, color: 'rgba(255,255,255,0.95)', lineHeight: 1.2, letterSpacing: '-0.02em',
        }}>
          {task.title}
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.42)' }}>
          {[dueLabel(task), task.subject].filter(Boolean).join(' · ')}
        </div>
        <TrajectoryChip chip={chip} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onStart?.(task)}
          style={{
            padding: '10px 0', borderRadius: 11, border: 'none', cursor: 'pointer', flex: 1.4,
            background: 'rgba(94,234,212,0.92)', color: '#05231f', fontSize: 14, fontWeight: 700,
          }}
        >
          Start
        </button>
        <button
          onClick={() => onSwap?.(task)}
          disabled={!canSwap}
          style={{ ...doorBtn, opacity: canSwap ? 1 : 0.4, cursor: canSwap ? 'pointer' : 'default' }}
        >
          Swap
        </button>
        <button onClick={() => onDefer?.(task)} style={doorBtn}>
          Defer
        </button>
      </div>
    </div>
  );
}

export default function HomeDecisionGate({
  tasks = [],
  chips = [],
  clearBoard = false,
  canSwap = false,
  onStart,
  onSwap,
  onDefer,
  onEscape,
  onDismiss,
  onAddEvent,
}) {
  const wrapStyle = {
    position: 'fixed', inset: 0, zIndex: 800,
    background: 'radial-gradient(circle at 50% 30%, #0c1020 0%, #06070f 70%, #040509 100%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: 32, textAlign: 'center', gap: 24,
    animation: 'gateFadeIn 360ms ease-out',
  };
  const labelStyle = { fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontWeight: 500 };

  // ── Clear board: one line, two doors out. ──
  if (clearBoard || tasks.length === 0) {
    const ghostBtn = {
      padding: '12px 28px', borderRadius: 999, cursor: 'pointer',
      border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.05)',
      color: 'rgba(255,255,255,0.82)', fontSize: 14, fontWeight: 500, letterSpacing: '0.02em',
    };
    return (
      <div style={wrapStyle}>
        <div style={labelStyle}>Nothing on the board.</div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <a
            href={ESCAPE_URL}
            target="_blank"
            rel="noreferrer noopener"
            onClick={onDismiss}
            style={{ ...ghostBtn, textDecoration: 'none' }}
          >
            yt
          </a>
          <button onClick={() => { onDismiss?.(); onAddEvent?.(); }} style={ghostBtn}>
            Add event
          </button>
        </div>
        <GateKeyframes />
      </div>
    );
  }

  const single = tasks.length === 1;

  return (
    <div style={wrapStyle}>
      <div style={labelStyle}>{single ? 'On the board' : 'Two on the board'}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 'min(440px, 88vw)' }}>
        {tasks.map((task, i) => (
          <TaskRow
            key={task.id}
            task={task}
            chip={chips[i]}
            single={single}
            canSwap={canSwap}
            onStart={onStart}
            onSwap={(t) => onSwap?.(t, i)}
            onDefer={(t) => onDefer?.(t, i)}
          />
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
        <button
          onClick={onEscape}
          style={{
            padding: '10px 24px', borderRadius: 12, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
            color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 500,
          }}
        >
          I did my own work
        </button>
        <button
          onClick={onDismiss}
          style={{
            padding: '8px 24px', borderRadius: 12, cursor: 'pointer',
            border: 'none', background: 'transparent',
            color: 'rgba(255,255,255,0.34)', fontSize: 12, fontWeight: 500,
          }}
        >
          Nothing right now
        </button>
      </div>

      <GateKeyframes />
    </div>
  );
}

function GateKeyframes() {
  return (
    <style>{`
      @keyframes gateFadeIn {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
    `}</style>
  );
}
