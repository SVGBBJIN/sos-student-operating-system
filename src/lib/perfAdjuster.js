// src/lib/perfAdjuster.js
// Adaptive performance adjuster for SOS
// Sets data-perf="low|mid|full" on <html> based on live device scoring.
// Tiers:
//   full — all effects on (default for fast devices)
//   mid  — backdrop-filter off, box-shadows reduced, transitions at .2s
//   low  — all animations off, flat backgrounds, no will-change (Chromebook safe)

const STORAGE_KEY = 'sos-perf-override';
const FPS_SAMPLE_MS = 2000;       // measure FPS over this window
const FPS_LOW_THRESHOLD = 30;     // below this → drop a tier
const FPS_HIGH_THRESHOLD = 55;    // above this for N consecutive windows → raise a tier
const CONSECUTIVE_HIGH_TO_PROMOTE = 3; // windows of good FPS before promoting
const MAX_CALIBRATION_WINDOWS = 6; // stop the rAF loop after ~12s of calibration
const TIER_ORDER = ['low', 'mid', 'full'];

let currentTier = 'full';
let consecutiveHighWindows = 0;
let windowsSampled = 0;
let calibrationDone = false;
let rafId = null;
let lastFrameTime = null;
let frameCount = 0;
let sampleStart = null;
let active = false;

// ─── Static detection (runs once at init) ──────────────────────────────────
function staticScore() {
  let score = 100;
  if (/CrOS/.test(navigator.userAgent))                             score -= 40;
  if (navigator.hardwareConcurrency != null && navigator.hardwareConcurrency <= 2) score -= 30;
  if (navigator.deviceMemory != null && navigator.deviceMemory <= 2)              score -= 20;
  if (navigator.deviceMemory != null && navigator.deviceMemory <= 1)              score -= 20;
  return score;
}

function scoreToTier(score) {
  if (score < 40) return 'low';
  if (score < 70) return 'mid';
  return 'full';
}

// ─── Apply a tier ──────────────────────────────────────────────────────────
function applyTier(tier, source = 'auto') {
  if (tier === currentTier && source !== 'init') return;
  currentTier = tier;
  document.documentElement.setAttribute('data-perf', tier);
  // Dispatch event so React components can react without polling the DOM
  window.dispatchEvent(new CustomEvent('sos:perf-tier', { detail: { tier, source } }));
}

// ─── FPS monitor ───────────────────────────────────────────────────────────
function tick(ts) {
  if (!active) return;

  if (lastFrameTime === null) {
    lastFrameTime = ts;
    sampleStart = ts;
    frameCount = 0;
    rafId = requestAnimationFrame(tick);
    return;
  }

  frameCount++;
  const elapsed = ts - sampleStart;

  if (elapsed >= FPS_SAMPLE_MS) {
    const fps = (frameCount / elapsed) * 1000;
    evaluateFPS(fps);
    sampleStart = ts;
    frameCount = 0;
    windowsSampled++;
    // Calibration is a startup task, not a forever-loop: once we've sampled
    // enough windows to correct any mis-detection, stop the rAF monitor so it
    // costs nothing for the rest of the session.
    if (windowsSampled >= MAX_CALIBRATION_WINDOWS) {
      calibrationDone = true;
      stopPerfAdjuster();
      return;
    }
  }

  lastFrameTime = ts;
  rafId = requestAnimationFrame(tick);
}

function evaluateFPS(fps) {
  const tierIndex = TIER_ORDER.indexOf(currentTier);

  if (fps < FPS_LOW_THRESHOLD && tierIndex > 0) {
    // Struggling — drop a tier immediately
    consecutiveHighWindows = 0;
    applyTier(TIER_ORDER[tierIndex - 1]);
    return;
  }

  if (fps >= FPS_HIGH_THRESHOLD) {
    consecutiveHighWindows++;
    if (consecutiveHighWindows >= CONSECUTIVE_HIGH_TO_PROMOTE && tierIndex < TIER_ORDER.length - 1) {
      // Sustained good performance — promote a tier
      consecutiveHighWindows = 0;
      applyTier(TIER_ORDER[tierIndex + 1]);
    }
  } else {
    consecutiveHighWindows = 0;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Start the adjuster. Call once after React mounts. */
export function startPerfAdjuster() {
  // 1. Check for user override in localStorage. When the tier is pinned we never
  //    auto-adjust, so there's no reason to run the FPS monitor at all.
  const override = localStorage.getItem(STORAGE_KEY);
  if (override && TIER_ORDER.includes(override)) {
    applyTier(override, 'override');
    calibrationDone = true;
    return;
  }

  // 2. Static score → initial tier (avoids flash of full-quality on slow devices)
  const score = staticScore();
  const initialTier = scoreToTier(score);
  applyTier(initialTier, 'init');

  // 3. Start the FPS monitor for a short calibration window, then it self-stops.
  windowsSampled = 0;
  consecutiveHighWindows = 0;
  calibrationDone = false;
  active = true;
  rafId = requestAnimationFrame(tick);
}

/** Stop monitoring (call on app unmount or when backgrounded). */
export function stopPerfAdjuster() {
  active = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  lastFrameTime = null;
}

/** Get current tier: 'low' | 'mid' | 'full' */
export function getPerfTier() {
  return currentTier;
}

/**
 * Manually override the tier. Persists to localStorage.
 * Pass null to clear override and return to auto-adjustment.
 */
export function setPerfOverride(tier) {
  if (tier === null) {
    localStorage.removeItem(STORAGE_KEY);
    // Re-run static detection
    const score = staticScore();
    applyTier(scoreToTier(score), 'auto');
  } else if (TIER_ORDER.includes(tier)) {
    localStorage.setItem(STORAGE_KEY, tier);
    applyTier(tier, 'override');
  }
}

/** Returns true if the current tier was set by user override, not auto. */
export function isPerfOverridden() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

// ─── Pause/resume on visibility change (saves battery on Chromebooks) ──────
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPerfAdjuster();
  } else if (!calibrationDone) {
    // Only resume the monitor if we're still calibrating; once calibration is
    // done the loop stays off for the rest of the session.
    active = true;
    lastFrameTime = null;
    rafId = requestAnimationFrame(tick);
  }
});
