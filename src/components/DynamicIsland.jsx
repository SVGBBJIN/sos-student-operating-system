import React, { useState, useEffect } from 'react';

/* ── Dynamic Island ───────────────────────────────────────────────
   Black pill at the top of the sidebar. Always shows the clock on
   the left. Right side reflects real AI / app state:
     - aiThinking=true  → "sos is thinking" (locked, no cycling)
     - deadlineWarning  → "due soon" with warning text
     - nextEvent        → "next up" with event name/time
     - else             → "all clear" (idle)
   Tap to expand contextual detail.
*/

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

function ThinkingDots() {
  return (
    <span className="di-dots">
      <span/><span/><span/>
    </span>
  );
}

const miniBtn = {
  border: '1px solid rgba(255,255,255,0.22)',
  background: 'rgba(255,255,255,0.08)',
  color: 'inherit',
  borderRadius: 8,
  padding: '2px 8px',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

function fmtRemaining(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ':' + String(sec).padStart(2, '0');
}

export default function DynamicIsland({
  aiThinking = false,
  syncStatus,
  nextEvent,
  deadlineWarning,
  focusSession = null,
  onFocusContinue,
  onFocusStop,
}) {
  const [expanded, setExpanded] = useState(false);

  // Live tick for the focus-session countdown (only while running).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!focusSession || focusSession.status !== 'running') return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [focusSession]);

  // Collapse when AI starts thinking
  useEffect(() => {
    if (aiThinking) setExpanded(false);
  }, [aiThinking]);

  // Derive mode from props. Focus session sits just below "thinking" — it is
  // the student's active work, so it outranks ambient deadline/next hints.
  let mode;
  if (aiThinking) {
    mode = { id: 'thinking', label: 'sos is thinking', accent: 'accent' };
  } else if (focusSession) {
    mode = { id: 'focus', accent: focusSession.status === 'expired' ? 'warning' : 'success' };
  } else if (deadlineWarning) {
    mode = { id: 'deadline', label: deadlineWarning, accent: 'warning' };
  } else if (nextEvent) {
    mode = { id: 'next', label: nextEvent.name || nextEvent.title || 'upcoming', accent: 'success', time: nextEvent.time || nextEvent.startTime || '' };
  } else {
    mode = { id: 'idle', label: 'all clear', accent: 'idle' };
  }

  const expandable = mode.id !== 'idle' && mode.id !== 'thinking' && mode.id !== 'focus';

  function renderFocus() {
    const remaining = focusSession.endsAt - Date.now();
    const expired = focusSession.status === 'expired' || remaining <= 0;
    return (
      <div className="di-stack" style={{ minWidth: 0 }}>
        <span className="di-label">{expired ? '10 min up' : 'focusing'}</span>
        {expired ? (
          <span className="di-focus-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="di-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90, whiteSpace: 'nowrap' }}>{focusSession.title}</span>
            <button
              className="di-mini-btn"
              onClick={(e) => { e.stopPropagation(); onFocusContinue && onFocusContinue(); }}
              style={miniBtn}
            >keep going</button>
            <button
              className="di-mini-btn"
              onClick={(e) => { e.stopPropagation(); onFocusStop && onFocusStop(); }}
              style={{ ...miniBtn, opacity: 0.7 }}
            >stop</button>
          </span>
        ) : (
          <span className="di-title">
            {focusSession.title}
            <span style={{ marginLeft: 8, fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>{fmtRemaining(remaining)}</span>
          </span>
        )}
      </div>
    );
  }

  function renderPayload() {
    switch (mode.id) {
      case 'focus':
        return renderFocus();
      case 'idle':
        return <span className="di-status">{mode.label}</span>;
      case 'thinking':
        return (
          <div className="di-stack">
            <span className="di-label">{mode.label}</span>
            <ThinkingDots />
          </div>
        );
      case 'next':
        return (
          <div className="di-stack">
            <span className="di-label">next up</span>
            <span className="di-title">{mode.label}{mode.time ? ' · ' + mode.time : ''}</span>
          </div>
        );
      case 'deadline':
        return (
          <div className="di-stack">
            <span className="di-label warn">due soon</span>
            <span className="di-title">{mode.label}</span>
          </div>
        );
      default:
        return <span className="di-status">{mode.label}</span>;
    }
  }

  function renderExpanded() {
    switch (mode.id) {
      case 'next':
        return (
          <div className="di-row">
            <span className="di-label">upcoming</span>
            <span className="di-title">{nextEvent?.name || nextEvent?.title}</span>
            {nextEvent?.time && <span className="di-sub">{nextEvent.time}</span>}
          </div>
        );
      case 'deadline':
        return (
          <div className="di-row">
            <span className="di-label warn">deadline</span>
            <span className="di-title">{deadlineWarning}</span>
          </div>
        );
      default:
        return (
          <div className="di-row">
            <span className="di-sub">all clear — no upcoming deadlines</span>
          </div>
        );
    }
  }

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
            {renderPayload()}
          </div>
          {expandable && <span className="di-chev" aria-hidden>{expanded ? '⌄' : '⌃'}</span>}
        </div>
        {expanded && (
          <div className="di-expanded">
            {renderExpanded()}
          </div>
        )}
      </div>
    </div>
  );
}
