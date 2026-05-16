import React, { useEffect } from 'react';

/* Floating notification card — mirrors the landing-page float.notif.
   "just now" mono label + a single-line body with an optional bold accent. */
export default function SosNotification({ label = 'just now', body, accent, duration = 4200, onDismiss }) {
  useEffect(() => {
    if (!duration) return;
    const t = setTimeout(() => onDismiss?.(), duration);
    return () => clearTimeout(t);
  }, [duration, onDismiss]);

  return (
    <div className="sos-notif" role="status" aria-live="polite">
      <div className="icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      </div>
      <div className="stack">
        <div className="top">{label}</div>
        <div className="bot">
          {accent ? <>{body} <strong>{accent}</strong></> : body}
        </div>
      </div>
      <button className="close" onClick={() => onDismiss?.()} aria-label="Dismiss">×</button>
    </div>
  );
}
