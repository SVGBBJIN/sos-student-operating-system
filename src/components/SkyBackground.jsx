import { useState, useEffect, useMemo } from 'react';

// ─── Sky state configuration ────────────────────────────────────────
const SKY_STATES = {
  sunrise: {
    gradient: 'linear-gradient(180deg, #1a1c2e 0%, #2d2040 20%, #7a3a2a 55%, #d4713a 78%, #f0a855 92%, #ffd49e 100%)',
    rainCount: 3,
  },
  midday: {
    gradient: 'linear-gradient(180deg, #2c4a6e 0%, #87CEEB 25%, #b8dff5 55%, #e8f4fb 85%, #f5f0e0 100%)',
    rainCount: 0,
  },
  night: {
    gradient: 'linear-gradient(180deg, #050810 0%, #0a0c18 35%, #0d1020 65%, #141828 100%)',
    rainCount: 6,
  },
};

function getSkyState(hour) {
  if (hour >= 5 && hour < 10) return 'sunrise';
  if (hour >= 10 && hour < 16) return 'midday';
  return 'night';
}

// ─── Deterministic star positions (seeded, not random on each render) ─
const STAR_POSITIONS = [
  { x: '8%',  y: '6%',  size: 1.5 },
  { x: '19%', y: '3%',  size: 1 },
  { x: '34%', y: '8%',  size: 2 },
  { x: '52%', y: '4%',  size: 1 },
  { x: '63%', y: '9%',  size: 1.5 },
  { x: '77%', y: '5%',  size: 1 },
  { x: '88%', y: '7%',  size: 2 },
];

// ─── Building window layout (deterministic pattern) ─────────────────
// Each building: { x, y (top), w, h, windows: [{dx, dy}] }
const BUILDINGS = [
  { x: 0,    w: 88,  h: 130, windows: [{dx:10,dy:15},{dx:22,dy:15},{dx:34,dy:15},{dx:10,dy:30},{dx:22,dy:30},{dx:10,dy:45},{dx:34,dy:45},{dx:22,dy:60}] },
  { x: 100,  w: 60,  h: 100, windows: [{dx:10,dy:12},{dx:22,dy:12},{dx:34,dy:12},{dx:10,dy:27},{dx:34,dy:27},{dx:22,dy:42}] },
  { x: 172,  w: 105, h: 150, windows: [{dx:10,dy:12},{dx:24,dy:12},{dx:38,dy:12},{dx:52,dy:12},{dx:10,dy:27},{dx:24,dy:27},{dx:38,dy:27},{dx:10,dy:42},{dx:38,dy:42},{dx:52,dy:42},{dx:24,dy:57},{dx:52,dy:57}] },
  { x: 290,  w: 72,  h: 115, windows: [{dx:10,dy:12},{dx:24,dy:12},{dx:38,dy:12},{dx:10,dy:27},{dx:38,dy:27},{dx:24,dy:42},{dx:10,dy:57}] },
  { x: 378,  w: 125, h: 140, windows: [{dx:10,dy:10},{dx:26,dy:10},{dx:42,dy:10},{dx:58,dy:10},{dx:74,dy:10},{dx:10,dy:25},{dx:26,dy:25},{dx:42,dy:25},{dx:74,dy:25},{dx:10,dy:40},{dx:42,dy:40},{dx:58,dy:40},{dx:26,dy:55},{dx:74,dy:55}] },
  { x: 516,  w: 90,  h: 125, windows: [{dx:10,dy:12},{dx:24,dy:12},{dx:38,dy:12},{dx:52,dy:12},{dx:10,dy:27},{dx:38,dy:27},{dx:24,dy:42},{dx:52,dy:42},{dx:10,dy:57}] },
  { x: 618,  w: 72,  h: 105, windows: [{dx:10,dy:12},{dx:24,dy:12},{dx:38,dy:12},{dx:10,dy:27},{dx:38,dy:27},{dx:24,dy:42}] },
  { x: 704,  w: 138, h: 160, windows: [{dx:10,dy:10},{dx:26,dy:10},{dx:42,dy:10},{dx:58,dy:10},{dx:74,dy:10},{dx:90,dy:10},{dx:10,dy:25},{dx:26,dy:25},{dx:58,dy:25},{dx:90,dy:25},{dx:42,dy:40},{dx:74,dy:40},{dx:10,dy:55},{dx:58,dy:55},{dx:90,dy:55},{dx:26,dy:70}] },
  { x: 856,  w: 85,  h: 130, windows: [{dx:10,dy:12},{dx:24,dy:12},{dx:38,dy:12},{dx:52,dy:12},{dx:10,dy:27},{dx:38,dy:27},{dx:24,dy:42},{dx:52,dy:42},{dx:10,dy:57},{dx:38,dy:57}] },
  { x: 954,  w: 112, h: 148, windows: [{dx:10,dy:10},{dx:26,dy:10},{dx:42,dy:10},{dx:58,dy:10},{dx:74,dy:10},{dx:10,dy:25},{dx:42,dy:25},{dx:74,dy:25},{dx:26,dy:40},{dx:58,dy:40},{dx:10,dy:55},{dx:74,dy:55},{dx:42,dy:70}] },
  { x: 1080, w: 70,  h: 110, windows: [{dx:10,dy:12},{dx:24,dy:12},{dx:38,dy:12},{dx:10,dy:27},{dx:38,dy:27},{dx:24,dy:42},{dx:10,dy:57}] },
  { x: 1164, w: 105, h: 138, windows: [{dx:10,dy:12},{dx:24,dy:12},{dx:40,dy:12},{dx:56,dy:12},{dx:72,dy:12},{dx:10,dy:27},{dx:40,dy:27},{dx:72,dy:27},{dx:24,dy:42},{dx:56,dy:42},{dx:10,dy:57},{dx:72,dy:57}] },
  { x: 1284, w: 80,  h: 122, windows: [{dx:10,dy:12},{dx:24,dy:12},{dx:38,dy:12},{dx:52,dy:12},{dx:10,dy:27},{dx:38,dy:27},{dx:24,dy:42},{dx:10,dy:57},{dx:52,dy:42}] },
  { x: 1378, w: 62,  h: 108, windows: [{dx:10,dy:12},{dx:24,dy:12},{dx:38,dy:12},{dx:10,dy:27},{dx:38,dy:27},{dx:24,dy:42},{dx:10,dy:57}] },
];

const SKYLINE_HEIGHT = 160;

export default function SkyBackground() {
  const [skyState, setSkyState] = useState(() => getSkyState(new Date().getHours()));

  // ── Update sky state every 60 seconds ───────────────────────────
  useEffect(() => {
    function tick() {
      const next = getSkyState(new Date().getHours());
      setSkyState(prev => {
        if (prev !== next) return next;
        return prev;
      });
    }
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Write data-sky onto <html> to drive CSS variable overrides ──
  useEffect(() => {
    document.documentElement.setAttribute('data-sky', skyState);
    return () => document.documentElement.removeAttribute('data-sky');
  }, [skyState]);

  const config = SKY_STATES[skyState];
  const isNight   = skyState === 'night';
  const isMidday  = skyState === 'midday';
  const isSunrise = skyState === 'sunrise';
  const showClouds = !isNight;

  // ── Rain streaks (CSS-only diagonal lines) ───────────────────────
  const rainStreaks = useMemo(() => {
    const streaks = [];
    for (let i = 0; i < config.rainCount; i++) {
      const left  = 8 + i * (100 / Math.max(config.rainCount, 1)) + '%';
      const delay = (i * 0.4).toFixed(1) + 's';
      const dur   = (1.8 + i * 0.25).toFixed(2) + 's';
      streaks.push({ left, delay, dur });
    }
    return streaks;
  }, [config.rainCount]);

  return (
    <>
      {/* ── Layer 0: Placeholder city image ──────────────────────── */}
      <img
        src="/city-bg.svg"
        className="sky-layer sky-city-img"
        aria-hidden="true"
        alt=""
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'bottom center',
          opacity: 0.35,
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />

      {/* ── Layer 0: Sky gradient ────────────────────────────────── */}
      <div
        className="sky-layer sky-gradient"
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: config.gradient,
          transition: 'background 4s ease-in-out',
        }}
      />

      {/* ── Layer 0: Sun (midday only) ───────────────────────────── */}
      {isMidday && (
        <div
          className="sky-layer sky-sun"
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: 36,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #FFF9C4 20%, #FFE082 50%, transparent 80%)',
            boxShadow: '0 0 60px 30px rgba(255, 236, 100, 0.22)',
            zIndex: 0,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* ── Layer 0: Stars (night only) ──────────────────────────── */}
      {isNight && (
        <div
          className="sky-layer sky-stars"
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
        >
          {STAR_POSITIONS.map((s, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: s.x,
                top: s.y,
                width: s.size,
                height: s.size,
                borderRadius: '50%',
                background: '#fff',
                opacity: 0.7 + (i % 3) * 0.1,
                boxShadow: `0 0 ${s.size * 2}px rgba(255,255,255,0.6)`,
                animation: `star-twinkle ${8 + i * 2}s ease-in-out ${i * 0.7}s infinite`,
              }}
            />
          ))}
        </div>
      )}

      {/* ── Layer 0.5: Cloud drift (day/sunrise) ─────────────────── */}
      {showClouds && (
        <div
          className="sky-layer sky-clouds"
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}
        >
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(50% 28% at 20% 24%, rgba(255,255,255,0.2), transparent 70%), radial-gradient(42% 24% at 68% 28%, rgba(255,255,255,0.16), transparent 70%)',
            filter: 'blur(28px)',
            opacity: isSunrise ? 0.22 : 0.18,
            animation: 'cloud-drift-slow 38s ease-in-out infinite',
          }}/>
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(40% 22% at 34% 32%, rgba(255,255,255,0.22), transparent 68%), radial-gradient(46% 26% at 78% 36%, rgba(255,255,255,0.18), transparent 70%)',
            filter: 'blur(18px)',
            opacity: isSunrise ? 0.26 : 0.2,
            animation: 'cloud-drift-mid 26s ease-in-out infinite',
          }}/>
        </div>
      )}

      {/* ── Layer 1: City skyline SVG ────────────────────────────── */}
      <svg
        className="sky-layer sky-skyline"
        aria-hidden="true"
        viewBox={`0 0 1440 ${SKYLINE_HEIGHT}`}
        preserveAspectRatio="xMidYMax meet"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          width: '100%',
          height: `${SKYLINE_HEIGHT}px`,
          zIndex: 1,
          pointerEvents: 'none',
        }}
      >
        {BUILDINGS.map((b, bi) => {
          const top = SKYLINE_HEIGHT - b.h;
          return (
            <g key={bi}>
              {/* Building silhouette */}
              <rect
                x={b.x}
                y={top}
                width={b.w}
                height={b.h}
                fill="rgba(0,0,0,0.75)"
                stroke="rgba(20,25,45,0.8)"
                strokeWidth="1"
              />
              {/* Windows */}
              {b.windows.map((w, wi) => {
                // Alternate lit/dark in a deterministic pattern
                const isLit = (bi + wi) % 3 !== 2;
                return (
                  <rect
                    key={wi}
                    x={b.x + w.dx}
                    y={top + w.dy}
                    width={4}
                    height={6}
                    fill={isLit ? 'var(--win-lit, #00E5CC)' : 'var(--win-dark, rgba(0,0,0,0.6))'}
                    opacity={isLit ? 0.7 : 0.4}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* ── Layer 1: Japanese text overlay ───────────────────────── */}
      <div
        className="sky-layer sky-jp-text"
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {/* 集中 — focus */}
        <span style={{
          position: 'absolute',
          top: '4%',
          right: '-2%',
          fontFamily: 'var(--font-jp)',
          fontSize: 160,
          fontWeight: 300,
          color: '#fff',
          opacity: 'var(--jp-opacity, 0.05)',
          lineHeight: 1,
          userSelect: 'none',
          transition: 'opacity 4s ease-in-out',
          letterSpacing: '-0.02em',
        }}>集中</span>

        {/* 勉強 — study */}
        <span style={{
          position: 'absolute',
          bottom: '10%',
          left: '-2%',
          fontFamily: 'var(--font-jp)',
          fontSize: 160,
          fontWeight: 300,
          color: '#fff',
          opacity: 'var(--jp-opacity, 0.05)',
          lineHeight: 1,
          userSelect: 'none',
          transition: 'opacity 4s ease-in-out',
          letterSpacing: '-0.02em',
        }}>勉強</span>

        {/* 時間 — time */}
        <span style={{
          position: 'absolute',
          top: '38%',
          right: '6%',
          fontFamily: 'var(--font-jp)',
          fontSize: 160,
          fontWeight: 300,
          color: '#fff',
          opacity: 'var(--jp-opacity, 0.05)',
          lineHeight: 1,
          userSelect: 'none',
          transition: 'opacity 4s ease-in-out',
          letterSpacing: '-0.02em',
        }}>時間</span>
      </div>

      {/* ── Layer 2: Rain streaks (CSS-only) ─────────────────────── */}
      {config.rainCount > 0 && (
        <div
          className="sky-layer sky-rain"
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2,
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          {rainStreaks.map((s, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: s.left,
                top: '-120px',
                width: '1px',
                height: '80px',
                background: 'linear-gradient(180deg, transparent 0%, rgba(180,210,255,0.3) 40%, rgba(200,225,255,0.22) 100%)',
                transform: 'rotate(8deg)',
                animation: `rain-fall ${s.dur} linear ${s.delay} infinite`,
                opacity: isSunrise ? 0.25 : 0.42,
              }}
            />
          ))}
        </div>
      )}

      {/* Inline keyframe for rain since it's dynamic */}
      <style>{`
        @keyframes rain-fall {
          0%   { transform: rotate(8deg) translateY(0); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: rotate(8deg) translateY(110vh); opacity: 0; }
        }
        @keyframes cloud-drift-slow {
          0%,100% { transform: translateX(0px) translateY(0px); }
          50% { transform: translateX(18px) translateY(-6px); }
        }
        @keyframes cloud-drift-mid {
          0%,100% { transform: translateX(0px) translateY(0px); }
          50% { transform: translateX(-20px) translateY(-4px); }
        }
        @keyframes star-twinkle {
          0%,100% { opacity: 0.2; }
          50% { opacity: 0.58; }
        }
      `}</style>
    </>
  );
}
