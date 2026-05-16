import React, { useState, useEffect } from 'react';

/* ── Focus Widget ─────────────────────────────────────────────────
   Compact floating pomodoro timer pinned to the top-right of the
   chat column. Mirrors the timer pop-up shown on the landing hero.
*/
export default function FocusWidget({ onClose }) {
  const [running, setRunning] = useState(false);
  const [secs, setSecs] = useState(25 * 60);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      setSecs(s => {
        if (s <= 0) { setRunning(false); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [running]);

  const fmt = n =>
    `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

  return (
    <div className={'focus-widget' + (running ? ' live' : '')}>
      {onClose && (
        <button className="fw-close" onClick={onClose} aria-label="Close timer">×</button>
      )}
      <div className="fw-head">
        <span className="fw-dot" />
        <span className="fw-label">{running ? 'focus' : 'pomodoro'}</span>
      </div>
      <div className="fw-row">
        <div className="fw-ring" />
        <div className="fw-num">{fmt(secs)}</div>
      </div>
      <div className="fw-meta">25-min session</div>
      <div className="fw-actions">
        {running ? (
          <button className="fw-btn" onClick={() => setRunning(false)}>Pause</button>
        ) : (
          <button className="fw-btn primary" onClick={() => setRunning(true)}>Start →</button>
        )}
        <button
          className="fw-btn ghost"
          onClick={() => { setRunning(false); setSecs(25 * 60); }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
