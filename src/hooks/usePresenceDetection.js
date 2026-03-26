import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Thresholds (ms) ────────────────────────────────────────────────
const GLANCED_AWAY_MS = 5_000;   //  5s → subtle dim
const AWAY_MS         = 30_000;  // 30s → deeper dim + "Session paused"
const ABSENT_MS       = 90_000;  // 90s → city sleeps + "Waiting for you..."

// ─── Presence states ────────────────────────────────────────────────
// PRESENT      → active, city alive
// GLANCED_AWAY → idle < AWAY_MS, subtle 60% dim, timer still running
// AWAY         → idle 30s–90s, heavy dim, timer paused, pill shown
// ABSENT       → idle 90s+, city fully asleep
const STATES = {
  PRESENT:      'PRESENT',
  GLANCED_AWAY: 'GLANCED_AWAY',
  AWAY:         'AWAY',
  ABSENT:       'ABSENT',
};

// Activity events that reset the idle timer
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

export function usePresenceDetection() {
  const [presenceState, setPresenceState] = useState(STATES.PRESENT);
  const [trackingEnabled, setTrackingEnabled] = useState(true);

  const lastActivityRef = useRef(Date.now());
  const prevStateRef    = useRef(STATES.PRESENT);
  const trackingRef     = useRef(true); // mirror of state for use in closures

  // ── Sync trackingRef with state ────────────────────────────────
  useEffect(() => {
    trackingRef.current = trackingEnabled;
  }, [trackingEnabled]);

  // ── Reset idle timer on any user activity ──────────────────────
  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // ── Compute presence from elapsed idle time ────────────────────
  const computeState = useCallback(() => {
    if (!trackingRef.current) return STATES.PRESENT;
    const elapsed = Date.now() - lastActivityRef.current;
    if (elapsed < GLANCED_AWAY_MS) return STATES.PRESENT;
    if (elapsed < AWAY_MS)         return STATES.GLANCED_AWAY;
    if (elapsed < ABSENT_MS)       return STATES.AWAY;
    return STATES.ABSENT;
  }, []);

  // ── Update data-presence attribute on <html> ───────────────────
  const applyPresenceAttr = useCallback((state) => {
    const el = document.documentElement;
    if (state === STATES.PRESENT) {
      el.removeAttribute('data-presence');
    } else {
      el.setAttribute('data-presence', state.toLowerCase());
    }
  }, []);

  // ── Main tick loop (1s interval) ───────────────────────────────
  useEffect(() => {
    if (!trackingEnabled) {
      // Override: keep city alive when tracking is off
      setPresenceState(STATES.PRESENT);
      applyPresenceAttr(STATES.PRESENT);
      return;
    }

    // Register activity listeners (passive for perf)
    ACTIVITY_EVENTS.forEach(ev =>
      window.addEventListener(ev, handleActivity, { passive: true })
    );

    // Tab visibility: going hidden = immediate AWAY
    const handleVisibility = () => {
      if (document.hidden) {
        lastActivityRef.current = Date.now() - AWAY_MS;
      } else {
        // Returning to tab counts as activity
        lastActivityRef.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Window blur (switching apps) = GLANCED_AWAY hint
    const handleBlur  = () => { /* don't reset timer, let it drift */ };
    const handleFocus = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('blur',  handleBlur);
    window.addEventListener('focus', handleFocus);

    const intervalId = setInterval(() => {
      const next = computeState();

      setPresenceState(prev => {
        if (prev === next) return prev;

        // RETURN detection: was away/absent, now present
        const wasIdle    = prev === STATES.AWAY || prev === STATES.ABSENT;
        const nowPresent = next === STATES.PRESENT;
        if (wasIdle && nowPresent) {
          window.dispatchEvent(new CustomEvent('sos:presence-return'));
        }

        prevStateRef.current = next;
        applyPresenceAttr(next);
        return next;
      });
    }, 1_000);

    // Initial state
    applyPresenceAttr(STATES.PRESENT);

    return () => {
      clearInterval(intervalId);
      ACTIVITY_EVENTS.forEach(ev =>
        window.removeEventListener(ev, handleActivity)
      );
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur',  handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.documentElement.removeAttribute('data-presence');
    };
  }, [trackingEnabled, handleActivity, computeState, applyPresenceAttr]);

  // ── Toggle tracking on/off ──────────────────────────────────────
  const toggleTracking = useCallback(() => {
    setTrackingEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('sos-presence-tracking', String(next)); } catch (_) {}
      return next;
    });
  }, []);

  // ── Restore preference from localStorage ───────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sos-presence-tracking');
      if (saved === 'false') setTrackingEnabled(false);
    } catch (_) {}
  }, []);

  return {
    presenceState,
    trackingEnabled,
    toggleTracking,
    isTimerRunning: presenceState === STATES.PRESENT || presenceState === STATES.GLANCED_AWAY,
    STATES,
  };
}
