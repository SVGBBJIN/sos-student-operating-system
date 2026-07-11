// FocusSession — the collapsed single-task home surface for a running focus
// session (Sprint or Marathon).
//
// Reuses the gated-home full-screen treatment rather than a separate surface.
// The home collapses to EXACTLY ONE task: no board, no visible queue, no
// notifications. The next task surfaces quietly "on deck" before the current
// one closes, so the seam has no gap. Duration shows as a quiet background
// progress bar (Sprint), never a countdown clock.
//
// Presentational only: App owns the engine, the queue, the timers and all
// persistence. Voice stays Jarvis — terse, dry, no praise, no streaks.

import React, { useEffect, useState } from 'react';

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

function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

const wrapStyle = {
  position: 'fixed', inset: 0, zIndex: 820, overflow: 'hidden',
  background: 'radial-gradient(circle at 50% 28%, #0c1020 0%, #06070f 70%, #040509 100%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: 32, textAlign: 'center', gap: 22,
  animation: 'gateFadeIn 320ms ease-out',
};
const labelStyle = {
  fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.4)', fontWeight: 500,
};
const ghostBtn = {
  padding: '8px 22px', borderRadius: 12, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
  color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 500,
};

function ProgressBar({ startedAt, durationMs }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!startedAt || !durationMs) return null;
  const frac = Math.min(1, Math.max(0, (Date.now() - startedAt) / durationMs));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'rgba(255,255,255,0.05)' }}>
      <div style={{
        height: '100%', width: `${frac * 100}%`,
        background: 'rgba(94,234,212,0.45)', transition: 'width 1s linear',
      }} />
    </div>
  );
}

function ActiveTask({ task }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 'min(560px, 90vw)' }}>
      <div style={{
        fontSize: 'clamp(24px, 5vw, 38px)', fontWeight: 600,
        color: 'rgba(255,255,255,0.96)', lineHeight: 1.15, letterSpacing: '-0.02em',
      }}>
        {task.title}
      </div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.42)' }}>
        {[dueLabel(task), task.subject].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

function OnDeck({ task }) {
  if (!task) return null;
  return (
    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.32)' }}>
      on deck · {task.title}
    </div>
  );
}

export default function FocusSession({
  mode = 'sprint',
  status = 'running',
  activeTask = null,
  onDeckTask = null,
  sprintStartedAt = null,
  sprintDurationMs = null,
  clockExpired = false,
  remaining = 0,
  goalLabel = '',
  breakOffer = null,        // { line } when a break is offered at this seam
  breakEndsAt = null,       // ms — when on break
  summary = '',             // factual end line
  onComplete, onSkip, onTakeBreak, onSkipBreak, onResumeNow, onEnd, onClose,
}) {
  // Live tick for the break countdown.
  const [, setT] = useState(0);
  useEffect(() => {
    if (status !== 'break') return;
    const id = setInterval(() => setT(t => t + 1), 500);
    return () => clearInterval(id);
  }, [status]);

  // ── Ended: one factual line, one door out. ──
  if (status === 'ended') {
    return (
      <div style={wrapStyle}>
        <FocusBg />
        <div style={labelStyle}>{mode === 'marathon' ? 'marathon done' : 'sprint done'}</div>
        <div style={{ fontSize: 'clamp(20px, 4vw, 28px)', fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>
          {summary || 'Session closed.'}
        </div>
        <button onClick={onClose} style={{ ...ghostBtn, color: 'rgba(255,255,255,0.78)' }}>Close</button>
        <Keyframes />
      </div>
    );
  }

  // ── Break: a short timed pause, auto-igniting the next sprint at zero. ──
  if (status === 'break') {
    const remainMs = breakEndsAt ? breakEndsAt - Date.now() : 0;
    return (
      <div style={wrapStyle}>
        <FocusBg />
        <div style={labelStyle}>break</div>
        <div style={{ fontSize: 'clamp(40px, 9vw, 72px)', fontWeight: 200, color: 'rgba(255,255,255,0.9)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {fmtClock(remainMs)}
        </div>
        <OnDeck task={activeTask} />
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.34)' }}>next sprint starts on its own</div>
        <button onClick={onResumeNow} style={{ ...ghostBtn, color: 'rgba(255,255,255,0.78)' }}>Resume now</button>
        <Keyframes />
      </div>
    );
  }

  // ── Break offer: one plain line at the seam. Declining is the default. ──
  if (breakOffer) {
    return (
      <div style={wrapStyle}>
        <FocusBg />
        <div style={labelStyle}>seam</div>
        <div style={{ fontSize: 'clamp(20px, 4vw, 28px)', fontWeight: 600, color: 'rgba(255,255,255,0.92)', maxWidth: 'min(480px, 90vw)' }}>
          {breakOffer.line}
        </div>
        <OnDeck task={activeTask} />
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            onClick={onTakeBreak}
            style={{
              padding: '10px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'rgba(94,234,212,0.92)', color: '#05231f', fontSize: 14, fontWeight: 700,
            }}
          >
            Five minutes
          </button>
          <button onClick={onSkipBreak} style={{ ...ghostBtn, color: 'rgba(255,255,255,0.7)' }}>
            Skip
          </button>
        </div>
        <Keyframes />
      </div>
    );
  }

  // ── Running: exactly one task. ──
  if (!activeTask) {
    return (
      <div style={wrapStyle}>
        <FocusBg />
        <div style={labelStyle}>{mode}</div>
        <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.7)' }}>Queue's clear.</div>
        <button onClick={onEnd} style={{ ...ghostBtn, color: 'rgba(255,255,255,0.78)' }}>Close</button>
        <Keyframes />
      </div>
    );
  }

  const topLabel = mode === 'marathon'
    ? (goalLabel ? `marathon · ${goalLabel}` : `marathon · ${remaining} left`)
    : (clockExpired ? 'sprint · clock up' : 'sprint');

  return (
    <div style={wrapStyle}>
      <FocusBg />
      <div style={labelStyle}>{topLabel}</div>

      <ActiveTask task={activeTask} />

      {clockExpired && mode === 'sprint' && (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.36)' }}>finish this one and the session closes</div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button
          onClick={() => onComplete?.(activeTask)}
          style={{
            padding: '11px 30px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'rgba(94,234,212,0.92)', color: '#05231f', fontSize: 15, fontWeight: 700,
          }}
        >
          Done
        </button>
        <button onClick={() => onSkip?.(activeTask)} style={{ ...ghostBtn, color: 'rgba(255,255,255,0.64)' }}>
          Skip
        </button>
      </div>

      <OnDeck task={onDeckTask} />

      <button onClick={onEnd} style={{ ...ghostBtn, padding: '6px 18px', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
        End session
      </button>

      {mode === 'sprint' && <ProgressBar startedAt={sprintStartedAt} durationMs={sprintDurationMs} />}
      <Keyframes />
    </div>
  );
}

// A slow, low-opacity drifting glow — reads as "breathing" rather than
// decoration. Off entirely under prefers-reduced-motion.
function FocusBg() {
  return <div className="fs-bg" aria-hidden="true" />;
}

function Keyframes() {
  return (
    <style>{`
      @keyframes gateFadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
      @keyframes fsDrift {
        0%   { transform: translate(-4%, -3%) scale(1); }
        50%  { transform: translate(3%, 4%) scale(1.08); }
        100% { transform: translate(-4%, -3%) scale(1); }
      }
      .fs-bg {
        position: absolute; inset: -10%; z-index: -1; pointer-events: none;
        background: radial-gradient(circle at 30% 32%, rgba(94,234,212,0.06), transparent 55%),
                    radial-gradient(circle at 70% 65%, rgba(94,234,212,0.045), transparent 60%);
        animation: fsDrift 30s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .fs-bg { animation: none; }
      }
    `}</style>
  );
}
