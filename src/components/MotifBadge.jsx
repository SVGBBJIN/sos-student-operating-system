import React from 'react';

/* ─────────────────────────────────────────────────────────────
   MotifBadge — "Sky's the Limit" Lo-Fi motto badge.
   Rendered in the app header when the Lo-Fi Sky theme is active.
   Styled entirely via lofi-sky-theme.css (.lofi-motto-badge).
   ───────────────────────────────────────────────────────────── */
export default function MotifBadge({ visible }) {
  if (!visible) return null;

  return (
    <span
      className="lofi-motto-badge"
      title="Sky's the Limit"
      aria-hidden="true"
    >
      ✦ Sky's the Limit
    </span>
  );
}
