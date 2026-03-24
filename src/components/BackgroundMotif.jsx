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

/* ── Day Clouds ── */
function DayClouds() {
  const clouds = useMemo(() => [
    { id: 0, size: 'large', top: '8%',  left: '12%', delay: '0s',   dur: '28s' },
    { id: 1, size: '',      top: '22%', left: '58%', delay: '4s',   dur: '22s' },
    { id: 2, size: 'small', top: '14%', left: '80%', delay: '8s',   dur: '18s' },
    { id: 3, size: '',      top: '40%', left: '30%', delay: '2s',   dur: '25s' },
    { id: 4, size: 'small', top: '55%', left: '68%', delay: '11s',  dur: '20s' },
    { id: 5, size: 'large', top: '5%',  left: '42%', delay: '15s',  dur: '32s' },
  ], []);

  return (
    <>
      {clouds.map(({ id, size, top, left, delay, dur }) => (
        <div
          key={id}
          className={`sky-cloud${size ? ' ' + size : ''}`}
          style={{
            top,
            left,
            width: size === 'large' ? 90 : size === 'small' ? 44 : 64,
            height: size === 'large' ? 28 : size === 'small' ? 14 : 20,
            animationDelay: delay,
            animationDuration: dur,
          }}
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
