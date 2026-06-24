// FocusLauncher — the one-tap entry into a focus session.
//
// Removes activation energy and choice overload: pick a mode (Sprint or
// Marathon), then either a duration (Sprint) or a goal (Marathon — a count off
// the top of the queue, zero config, or a hand-tapped selection). That's the
// whole decision. Tasks themselves are never hand-picked in Sprint or in a
// count-based Marathon — the priority engine drives the order.
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
  position: 'fixed', inset: 0, zIndex: 810,
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

export default function FocusLauncher({ tasks = [], onLaunch, onClose }) {
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

  const canLaunch = !empty && (mode === 'sprint' || goalKind === 'count' || selected.length > 0);

  return (
    <div style={wrapStyle} role="dialog" aria-label="Start a focus session">
      <div style={labelStyle}>Head down</div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button style={segBtn(mode === 'sprint')} onClick={() => setMode('sprint')}>Sprint</button>
        <button style={segBtn(mode === 'marathon')} onClick={() => setMode('marathon')}>Marathon</button>
      </div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', maxWidth: 360, lineHeight: 1.4 }}>
        {mode === 'sprint'
          ? 'One timed window. Top of the queue, task to task, no gap.'
          : 'Bound by a goal, not a clock. Looped sprints with a break in the seams.'}
      </div>

      {empty && (
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Nothing on the board to run.</div>
      )}

      {!empty && mode === 'sprint' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {SPRINT_DURATIONS.map(d => (
            <button key={d.ms} style={chip(durationMs === d.ms)} onClick={() => setDurationMs(d.ms)}>{d.label}</button>
          ))}
        </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '40vh', overflowY: 'auto', width: 'min(420px, 88vw)' }}>
              {tasks.map(t => (
                <button
                  key={t.id}
                  onClick={() => toggleSel(t.id)}
                  style={{
                    textAlign: 'left', padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
                    border: selected.includes(t.id) ? '1px solid rgba(94,234,212,0.5)' : '1px solid rgba(255,255,255,0.08)',
                    background: selected.includes(t.id) ? 'rgba(94,234,212,0.10)' : 'rgba(255,255,255,0.02)',
                    color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 500,
                  }}
                >
                  {selected.includes(t.id) ? '✓ ' : ''}{t.title}
                </button>
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
          Start
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

      <style>{`@keyframes gateFadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }`}</style>
    </div>
  );
}
