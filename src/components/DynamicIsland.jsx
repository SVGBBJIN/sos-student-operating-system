import React, { useState, useEffect } from 'react';

/* ── Dynamic Island ───────────────────────────────────────────────
   Black pill at the top of the sidebar. Always shows the clock on
   the left. Right side morphs based on context: idle, focus timer,
   AI thinking, next-up, deadline, or captured note.
   Tap to expand contextual actions.
*/

const MODES = [
  { id: 'idle',     label: 'all clear',              accent: 'idle' },
  { id: 'focus',    label: 'pset 4 · focus',          accent: 'accent' },
  { id: 'next',     label: 'calc lecture · 11:00',    accent: 'success' },
  { id: 'deadline', label: 'essay due in 4h',         accent: 'warning' },
  { id: 'thinking', label: 'sos is thinking',         accent: 'accent' },
  { id: 'captured', label: 'note saved',              accent: 'success' },
];

function Clock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  useEffect(() => {
    const t = setInterval(() =>
      setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      15000
    );
    return () => clearInterval(t);
  }, []);
  return <span className="di-clock">{time}</span>;
}

function FocusRing() {
  const TOTAL = 25 * 60;
  const [secs, setSecs] = useState(TOTAL);
  useEffect(() => {
    const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const r = 9, C = 2 * Math.PI * r;
  const pct = secs / TOTAL;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return (
    <div className="di-focus">
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--success)" strokeWidth="2.5"
                strokeLinecap="round" strokeDasharray={C}
                strokeDashoffset={C - C * pct}
                transform="rotate(-90 12 12)" />
      </svg>
      <span className="di-mono">{mm}:{ss}</span>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="di-dots">
      <span/><span/><span/>
    </span>
  );
}

function Payload({ mode }) {
  switch (mode.id) {
    case 'idle':
      return <span className="di-status">{mode.label}</span>;
    case 'focus':
      return <FocusRing />;
    case 'next':
      return (
        <div className="di-stack">
          <span className="di-label">next up</span>
          <span className="di-title">{mode.label}</span>
        </div>
      );
    case 'deadline':
      return (
        <div className="di-stack">
          <span className="di-label warn">due soon</span>
          <span className="di-title">{mode.label}</span>
        </div>
      );
    case 'thinking':
      return (
        <div className="di-stack">
          <span className="di-label">{mode.label}</span>
          <ThinkingDots />
        </div>
      );
    case 'captured':
      return (
        <div className="di-stack">
          <span className="di-label success">✓ {mode.label}</span>
          <span className="di-title">"the chain rule lives in chapter 4"</span>
        </div>
      );
    default:
      return null;
  }
}

function ExpandedBody({ mode }) {
  switch (mode.id) {
    case 'focus':
      return (
        <>
          <div className="di-row">
            <span className="di-label">working on</span>
            <span className="di-title">pset 4 · problem 5</span>
          </div>
          <div className="di-actions">
            <button>pause</button>
            <button>finish early</button>
          </div>
        </>
      );
    case 'next':
      return (
        <>
          <div className="di-row">
            <span className="di-label">in 47 minutes</span>
            <span className="di-title">calc 201 · derivatives</span>
            <span className="di-sub">room 304 · prof. liang</span>
          </div>
          <div className="di-actions">
            <button>notify me 10 min before</button>
          </div>
        </>
      );
    case 'deadline':
      return (
        <>
          <div className="di-row">
            <span className="di-label warn">essay 2 · faulkner</span>
            <span className="di-title">3rd paragraph remaining</span>
            <span className="di-sub">turn in by 17:00 today</span>
          </div>
          <div className="di-actions">
            <button>open draft</button>
            <button>plan 1hr</button>
          </div>
        </>
      );
    case 'captured':
      return (
        <>
          <div className="di-row">
            <span className="di-label">saved to · calc 201</span>
            <span className="di-title">"the chain rule lives in chapter 4"</span>
          </div>
          <div className="di-actions">
            <button>open note</button>
            <button>undo</button>
          </div>
        </>
      );
    default:
      return (
        <div className="di-row">
          <span className="di-sub">tap pills below to switch modes</span>
        </div>
      );
  }
}

export default function DynamicIsland({ aiThinking = false }) {
  const [modeIdx, setModeIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // If AI is thinking, lock to thinking mode
  useEffect(() => {
    if (aiThinking) {
      setModeIdx(MODES.findIndex(m => m.id === 'thinking'));
      setExpanded(false);
    }
  }, [aiThinking]);

  // Auto-cycle when not expanded and not locked to thinking
  useEffect(() => {
    if (expanded || aiThinking) return;
    const t = setInterval(() => {
      setModeIdx(i => (i + 1) % MODES.length);
    }, 5000);
    return () => clearInterval(t);
  }, [expanded, aiThinking]);

  const mode = MODES[modeIdx];
  const expandable = mode.id !== 'idle';

  return (
    <div className="di-wrap">
      <div
        className={'di' + (expanded ? ' expanded' : '')}
        data-accent={mode.accent}
        onClick={() => expandable && setExpanded(e => !e)}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        onKeyDown={e => e.key === 'Enter' && expandable && setExpanded(v => !v)}
      >
        <div className="di-pill">
          <Clock />
          <span className="di-sep" />
          <div className="di-payload" key={mode.id}>
            <Payload mode={mode} />
          </div>
          {expandable && <span className="di-chev" aria-hidden>{expanded ? '⌄' : '⌃'}</span>}
        </div>
        {expanded && (
          <div className="di-expanded">
            <ExpandedBody mode={mode} />
          </div>
        )}
      </div>

      <div className="di-dots-nav" role="tablist" aria-label="island mode">
        {MODES.map((m, i) => (
          <button
            key={m.id}
            className={'di-dot' + (i === modeIdx ? ' on' : '')}
            onClick={() => { setModeIdx(i); setExpanded(false); }}
            title={m.id}
          />
        ))}
      </div>
    </div>
  );
}
