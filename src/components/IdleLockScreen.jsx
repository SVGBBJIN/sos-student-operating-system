import { useState, useEffect, useRef } from 'react';
import { usePresence } from '../context/PresenceContext';

export default function IdleLockScreen() {
  const { presenceState, STATES } = usePresence();
  const [visible, setVisible]   = useState(false);
  const [exiting, setExiting]   = useState(false);
  const exitTimerRef             = useRef(null);

  // Show overlay when LOCKED
  useEffect(() => {
    if (presenceState === STATES.LOCKED) {
      setExiting(false);
      setVisible(true);
    }
  }, [presenceState, STATES.LOCKED]);

  // Listen for return event to trigger exit animation
  useEffect(() => {
    const onReturn = () => {
      if (!visible) return;
      setExiting(true);
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = setTimeout(() => {
        setVisible(false);
        setExiting(false);
      }, 620);
    };
    window.addEventListener('sos:presence-return', onReturn);
    return () => {
      window.removeEventListener('sos:presence-return', onReturn);
      clearTimeout(exitTimerRef.current);
    };
  }, [visible]);

  const handleCTA = () => {
    window.dispatchEvent(new MouseEvent('mousemove'));
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  };

  if (!visible) return null;

  return (
    <div
      className={`idle-lock-overlay${exiting ? ' exiting' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Session paused"
    >
      <div className="idle-lock-wordmark" aria-hidden="true">SOS</div>
      <div className="idle-lock-sub">Ready when you are.</div>
      <button className="idle-lock-cta neon-primary" onClick={handleCTA}>
        Let&apos;s get to work
      </button>
    </div>
  );
}
