// HomeDecisionGate — the first thing on app open.
//
// A full-screen gate that forces ONE decision and never forces work.
// It shows the #1 task from the priority engine and exactly three doors:
//   Start            → run the Start primitive on this task
//   Not this one     → show the next-ranked task (logs a pass; 3 = fall through)
//   Nothing right now → dismiss the gate, app opens normally (logs a dismissal)
//
// The third door always exists. If the board is genuinely clear, the gate
// degrades to a single line and one external escape — no tasks, no guilt.
//
// Copy is terse and dry. No celebration, no streaks, no nudging.

import React, { useState } from 'react';

const MAX_PASSES = 3;

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

export default function HomeDecisionGate({
  rankedTasks = [],
  clearBoard = false,
  onStart,
  onPass,
  onDismiss,
  onFallThrough,
  onAddEvent,
}) {
  const [idx, setIdx] = useState(0);

  const wrapStyle = {
    position: 'fixed', inset: 0, zIndex: 800,
    background: 'radial-gradient(circle at 50% 30%, #0c1020 0%, #06070f 70%, #040509 100%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: 32, textAlign: 'center', gap: 28,
    animation: 'gateFadeIn 360ms ease-out',
  };
  const labelStyle = { fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontWeight: 500 };

  // ── Clear board: one line, two doors out. ──
  if (clearBoard || rankedTasks.length === 0) {
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
          <button
            onClick={() => { onDismiss?.(); onAddEvent?.(); }}
            style={ghostBtn}
          >
            Add event
          </button>
        </div>
        <GateKeyframes />
      </div>
    );
  }

  const task = rankedTasks[Math.min(idx, rankedTasks.length - 1)];

  function handlePass() {
    const passNo = idx + 1;
    onPass?.(task, passNo);
    if (passNo >= MAX_PASSES || passNo >= rankedTasks.length) {
      onFallThrough?.();
      return;
    }
    setIdx(passNo);
  }

  return (
    <div style={wrapStyle}>
      <div style={labelStyle}>{idx === 0 ? 'First up' : 'Next'}</div>

      <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 'clamp(26px, 5vw, 40px)', fontWeight: 600, color: 'rgba(255,255,255,0.95)', lineHeight: 1.2, letterSpacing: '-0.02em' }}>
          {task.title}
        </div>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)' }}>
          {[dueLabel(task), task.subject].filter(Boolean).join(' · ')}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 'min(340px, 80vw)', marginTop: 8 }}>
        <button
          onClick={() => onStart?.(task)}
          style={{
            padding: '14px 24px', borderRadius: 14, border: 'none', cursor: 'pointer',
            background: 'rgba(94,234,212,0.92)', color: '#05231f', fontSize: 15, fontWeight: 700, letterSpacing: '0.01em',
          }}
        >
          Start
        </button>
        <button
          onClick={handlePass}
          style={{
            padding: '12px 24px', borderRadius: 14, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.78)', fontSize: 14, fontWeight: 500,
          }}
        >
          Not this one
        </button>
        <button
          onClick={onDismiss}
          style={{
            padding: '12px 24px', borderRadius: 14, cursor: 'pointer',
            border: 'none', background: 'transparent',
            color: 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: 500,
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
