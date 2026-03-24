import React, { useMemo } from 'react';

/* ─────────────────────────────────────────────────────────────────
   BackgroundMotif — Lo-Fi Sky theme atmospheric background layer.
   Renders time-of-day sky elements (clouds / sunset / stars) as a
   fixed, pointer-events-none overlay behind all app content.
   All visual animation is driven by CSS classes in lofi-sky-theme.css.
   ───────────────────────────────────────────────────────────────── */

/* Deterministic pseudo-random seeded from index (no Math.random on render) */
function seed(i, salt = 0) {
  const x = Math.sin(i * 9301 + salt * 49297 + 233) * 93847;
  return x - Math.floor(x);
}

/* ── Day Clouds — 3 depth layers (v2) ── */
function DayClouds() {
  // layer classes: bg-layer (faint/blurry), mid-layer, fg-layer (crisp)
  // dur is set per layer in CSS; only animationDelay is set inline
  const clouds = useMemo(() => [
    // Background layer — large, barely visible, very slow
    { id: 0, layer: 'bg-layer', size: 'large', top: '6%',  left: '8%',  delay: '0s'  },
    { id: 1, layer: 'bg-layer', size: 'large', top: '20%', left: '55%', delay: '12s' },
    // Mid layer — default opacity/blur
    { id: 2, layer: 'mid-layer', size: '',     top: '12%', left: '30%', delay: '4s'  },
    { id: 3, layer: 'mid-layer', size: '',     top: '38%', left: '70%', delay: '8s'  },
    // Foreground layer — small, crispest, fastest
    { id: 4, layer: 'fg-layer',  size: 'small', top: '18%', left: '82%', delay: '6s'  },
    { id: 5, layer: 'fg-layer',  size: 'small', top: '48%', left: '22%', delay: '15s' },
  ], []);

  return (
    <>
      {clouds.map(({ id, layer, size, top, left, delay }) => (
        <div
          key={id}
          className={`sky-cloud ${layer}${size ? ' ' + size : ''}`}
          style={{ top, left, animationDelay: delay }}
        />
      ))}
    </>
  );
}

/* ── Sunset Layer ── */
function SunsetLayer() {
  const outlineClouds = useMemo(() => [
    { id: 0, top: '18%', left: '10%', width: 70, height: 22, delay: '0s' },
    { id: 1, top: '35%', left: '60%', width: 50, height: 16, delay: '3s' },
    { id: 2, top: '12%', left: '78%', width: 38, height: 12, delay: '6s' },
  ], []);

  return (
    <>
      <div className="sky-sunset-layer" />
      {outlineClouds.map(({ id, top, left, width, height, delay }) => (
        <div
          key={id}
          className="sky-sunset-cloud"
          style={{ top, left, width, height, animationDelay: delay }}
        />
      ))}
    </>
  );
}

/* ── Night Stars ── */
function NightStars() {
  const stars = useMemo(() => {
    const items = [];
    // 32 small twinkling stars
    for (let i = 0; i < 32; i++) {
      const top  = seed(i, 0) * 85 + 2;   // 2–87%
      const left = seed(i, 1) * 96 + 1;   // 1–97%
      const size = seed(i, 2) * 3 + 1.5;  // 1.5–4.5px
      const dim  = seed(i, 3) > 0.6;
      const delay = (seed(i, 4) * 4).toFixed(2) + 's';
      const dur   = (seed(i, 5) * 3 + 2).toFixed(1) + 's';
      items.push({ id: i, top: top + '%', left: left + '%', size, dim, delay, dur });
    }
    return items;
  }, []);

  // Shooting star — one element, repeated via CSS animation-delay trick
  const shootingStars = useMemo(() => [
    { id: 's0', top: '12%', left: '15%', delay: '8s',  dur: '6s' },
    { id: 's1', top: '28%', left: '55%', delay: '22s', dur: '5s' },
  ], []);

  return (
    <>
      {stars.map(({ id, top, left, size, dim, delay, dur }) => (
        <div
          key={id}
          className={`sky-star${dim ? ' dim' : ''}`}
          style={{
            top,
            left,
            width: size,
            height: size,
            animationDelay: delay,
            animationDuration: dur,
          }}
        />
      ))}
      {shootingStars.map(({ id, top, left, delay, dur }) => (
        <div
          key={id}
          className="sky-shooting-star"
          style={{ top, left, animationDelay: delay, animationDuration: dur }}
        />
      ))}
    </>
  );
}

/* ── Main Export ── */
export default function BackgroundMotif({ skyTime }) {
  if (!skyTime) return null;

  return (
    <div
      className="sky-motif"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
      }}
    >
      {skyTime === 'day'    && <DayClouds />}
      {skyTime === 'sunset' && <SunsetLayer />}
      {skyTime === 'night'  && <NightStars />}
    </div>
  );
}
