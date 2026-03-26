import { useEffect, useRef } from 'react';
import { usePresence } from '../context/PresenceContext';

// Fires the neon-strike flicker on all .neon-primary elements
function triggerNeonStrike() {
  const els = document.querySelectorAll('.neon-primary');
  els.forEach(el => {
    el.classList.remove('neon-striking');
    // Force reflow so re-adding the class re-triggers the animation
    void el.offsetWidth;
    el.classList.add('neon-striking');
    setTimeout(() => el.classList.remove('neon-striking'), 250);
  });
}

export default function PresenceDetector() {
  const { presenceState, trackingEnabled, toggleTracking, STATES } = usePresence();
  const prevStateRef   = useRef(presenceState);

  // ── Listen for RETURN custom event ──────────────────────────────
  useEffect(() => {
    const onReturn = () => {
      triggerNeonStrike();
    };
    window.addEventListener('sos:presence-return', onReturn);
    return () => window.removeEventListener('sos:presence-return', onReturn);
  }, []);

  // ── Drive pill text from presenceState ───────────────────────────
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = presenceState;

    if (presenceState === STATES.PRESENT && (prev === STATES.AWAY || prev === STATES.ABSENT)) triggerNeonStrike();
  }, [presenceState, STATES]);

  const isAway    = presenceState === STATES.AWAY;
  const isAbsent  = presenceState === STATES.ABSENT;
  const dotColor  = !trackingEnabled
    ? 'rgba(232,234,240,0.2)'
    : isAbsent
      ? 'var(--neon-amber)'
      : isAway
        ? 'var(--neon-amber)'
        : 'var(--neon-cyan)';

  const dotGlow   = !trackingEnabled
    ? 'none'
    : isAway || isAbsent
      ? '0 0 6px var(--neon-amber)'
      : '0 0 6px var(--neon-cyan)';

  const tooltip   = trackingEnabled
    ? 'Activity tracking is on. Click to disable.'
    : 'Activity tracking off. Click to enable.';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {/* ── Activity tracking dot ─────────────────────────────────── */}
      <button
        title={tooltip}
        onClick={toggleTracking}
        style={{
          pointerEvents: 'auto',
          width: 28,
          height: 28,
          background: 'rgba(6, 8, 18, 0.82)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '50%',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'border-color 300ms ease',
        }}
        aria-label={tooltip}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
            boxShadow: dotGlow,
            transition: 'background 600ms ease, box-shadow 600ms ease',
            display: 'block',
          }}
        />
      </button>
    </div>
  );
}
