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

export default function DynamicIsland({
  aiThinking = false,
  syncStatus,
  nextEvent,
  deadlineWarning,
  ambient = null,          // AmbientStatus | null — the ambient status surface
  onAmbientAction,         // (action) => void
  onAmbientDismiss,        // (ambient) => void
}) {
  const [expanded, setExpanded] = useState(false);

  // Collapse when AI starts thinking
  useEffect(() => {
    if (aiThinking) setExpanded(false);
  }, [aiThinking]);

  // Derive mode from props.
  // Precedence: thinking > push-tier ambient > deadline > next > ambient > idle.
  // A push-tier ambient item is time-critical, so it is the only ambient surface
  // allowed to outrank an explicit deadline/next; ambient-tier sits just above
  // idle so it never shouts over those.
  let mode;
  if (aiThinking) {
    mode = { id: 'thinking', label: 'sos is thinking', accent: 'accent' };
  } else if (ambient && ambient.tier === 'push') {
    mode = { id: 'ambient', label: ambient.text, accent: 'warning', ambient };
  } else if (deadlineWarning) {
    mode = { id: 'deadline', label: deadlineWarning, accent: 'warning' };
  } else if (nextEvent) {
    mode = { id: 'next', label: nextEvent.name || nextEvent.title || 'upcoming', accent: 'success', time: nextEvent.time || nextEvent.startTime || '' };
  } else if (ambient) {
    mode = { id: 'ambient', label: ambient.text, accent: 'accent', ambient };
  } else {
    mode = { id: 'idle', label: 'all clear', accent: 'idle' };
  }

  // Ambient is already terse; it carries its own action, so it does not expand.
  const expandable = mode.id !== 'idle' && mode.id !== 'thinking' && mode.id !== 'ambient';

  function renderPayload() {
    switch (mode.id) {
      case 'idle':
        return <span className="di-status">{mode.label}</span>;
      case 'ambient': {
        const a = mode.ambient;
        return (
          <div className="di-stack">
            <span className="di-title">{a.text}</span>
            <div className="di-actions">
              {a.action && (
                <button
                  onClick={e => { e.stopPropagation(); onAmbientAction && onAmbientAction(a.action); }}
                >
                  {a.action.label}
                </button>
              )}
              <button
                aria-label="dismiss"
                onClick={e => { e.stopPropagation(); onAmbientDismiss && onAmbientDismiss(a); }}
              >
                dismiss
              </button>
            </div>
          </div>
        );
      }
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
