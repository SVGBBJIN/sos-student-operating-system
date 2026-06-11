// DecisionRollup — the once-a-day batched pass that replaces the standing
// review rail.
//
// Two parts:
//   1. "Already done today" — high-confidence items that auto-applied. Each is
//      a single line with an undo, so there is visibility without a queue.
//   2. The review — sub-threshold items, one at a time, fast keep/drop. The
//      whole accepted set is applied as one undoable snapshot.
//
// Skipping is always allowed; skipped items roll into the next day's batch.
// Copy is terse and dry. No counts framed as achievement, no celebration.

import React, { useState } from 'react';

function summarize(action) {
  const name = action.task_name || action.title || action.name || action.event_name || '';
  const verb = (action.type || 'action').replace(/_/g, ' ');
  return name ? `${verb} — ${name}` : verb;
}

export default function DecisionRollup({ items = [], auto = [], onApply, onUndoAuto, onDismiss }) {
  const [idx, setIdx] = useState(0);
  const [accepted, setAccepted] = useState([]);

  const total = items.length;
  const current = items[idx];

  function decide(keep) {
    const nextAccepted = keep && current ? [...accepted, current.action] : accepted;
    if (keep && current) setAccepted(nextAccepted);
    if (idx + 1 >= total) {
      onApply?.(nextAccepted);
      return;
    }
    setIdx(idx + 1);
  }

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 820,
    background: 'rgba(4,6,12,0.92)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    animation: 'rollupFadeIn 240ms ease-out',
  };
  const card = {
    width: 'min(460px, 92vw)', maxHeight: '84vh', overflowY: 'auto',
    background: '#0c1020', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18,
    padding: 24, display: 'flex', flexDirection: 'column', gap: 18,
    color: 'rgba(255,255,255,0.9)',
  };
  const headLabel = { fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontWeight: 600 };

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={headLabel}>Today's rollup</div>
          <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 13 }}>Later</button>
        </div>

        {auto.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ ...headLabel, fontSize: 11 }}>Already done</div>
            {auto.map((a, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.summary || summarize(a.action)}</span>
                <button
                  onClick={() => onUndoAuto?.(a)}
                  style={{ flexShrink: 0, border: '1px solid rgba(255,255,255,0.16)', background: 'transparent', color: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: '2px 10px', fontSize: 12, cursor: 'pointer' }}
                >undo</button>
              </div>
            ))}
          </div>
        )}

        {total > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ ...headLabel, fontSize: 11 }}>To review · {idx + 1} of {total}</div>
            <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}>
              {current ? summarize(current.action) : ''}
            </div>
            {current && (current.reason || typeof current.confidence === 'number') && (
              <div style={{ fontSize: 12, color: 'rgba(255,165,2,0.9)' }}>
                {current.reason === 'tentative' ? 'tentative' : 'low confidence'}
                {typeof current.confidence === 'number' ? ` · ${Math.round(current.confidence * 100)}%` : ''}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => decide(false)}
                style={{ flex: 1, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
              >Drop</button>
              <button
                onClick={() => decide(true)}
                style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: 'rgba(94,234,212,0.92)', color: '#05231f', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >Keep</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => onApply?.([])}
            style={{ padding: '12px', borderRadius: 12, border: 'none', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >Done</button>
        )}
      </div>
      <style>{`@keyframes rollupFadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }`}</style>
    </div>
  );
}
