/**
 * SOS — Student Operating System
 * Performance Detection + Low-Perf Mode Activator
 *
 * Paste the IIFE (immediately invoked function) into your index.html <head>
 * BEFORE any other scripts so it runs synchronously and avoids a flash of
 * full-quality mode on slow hardware.
 *
 * Then call initPerfMode() from your React entry point (main.jsx) after mount.
 */

/* ─── 1. Paste this into index.html <head> (inline script) ──────────────── */
;(function detectPerf() {
  var slow = false;

  // Chromebook detection (Chrome OS user agent)
  if (/CrOS/.test(navigator.userAgent)) {
    slow = true;
  }

  // Very low core count
  if (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 2) {
    slow = true;
  }

  // Very low RAM (only available in Chrome/Edge)
  if (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 2) {
    slow = true;
  }

  if (slow) {
    document.documentElement.setAttribute('data-perf', 'low');
  }
})();


/* ─── 2. Call this from main.jsx / App.jsx after React mounts ────────────── */
export function initPerfMode() {
  const isLow = document.documentElement.getAttribute('data-perf') === 'low';

  // Show "lite mode" badge
  if (isLow) {
    const badge = document.createElement('div');
    badge.className = 'perf-badge';
    badge.title = 'Running in lite mode for smoother performance';
    badge.textContent = '⚡ lite mode';
    document.body.appendChild(badge);

    // Optional: expose a way for users to manually toggle
    window.__sosForceFullQuality = function () {
      document.documentElement.removeAttribute('data-perf');
      badge.remove();
      console.info('[SOS] Full quality mode enabled. Reload to re-detect.');
    };

    console.info(
      '[SOS] Low-performance mode active. ' +
      'Call window.__sosForceFullQuality() in the console to override.'
    );
  }

  // Also respect OS-level preference
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (prefersReduced.matches && !isLow) {
    // CSS handles this via media query, but log it
    console.info('[SOS] Animations disabled via prefers-reduced-motion.');
  }

  return isLow;
}


/* ─── 3. Optional: manual toggle UI in Settings ──────────────────────────── */
/**
 * Use this in your Settings component to let users override the auto-detection.
 *
 * import { getPerfMode, setPerfMode } from './sos-perf-detection';
 *
 * const isLow = getPerfMode();
 * <button onClick={() => setPerfMode(!isLow)}>
 *   {isLow ? '✨ Enable full quality' : '⚡ Switch to lite mode'}
 * </button>
 */
export function getPerfMode() {
  return document.documentElement.getAttribute('data-perf') === 'low';
}

export function setPerfMode(low) {
  if (low) {
    document.documentElement.setAttribute('data-perf', 'low');
    localStorage.setItem('sos-perf', 'low');
  } else {
    document.documentElement.removeAttribute('data-perf');
    localStorage.setItem('sos-perf', 'full');
  }
}

/* Check localStorage override on load (add to the IIFE above) */
export function applyStoredPerfPreference() {
  var stored = localStorage.getItem('sos-perf');
  if (stored === 'low') {
    document.documentElement.setAttribute('data-perf', 'low');
  } else if (stored === 'full') {
    document.documentElement.removeAttribute('data-perf');
  }
  // If nothing stored, auto-detection (above) takes over
}
