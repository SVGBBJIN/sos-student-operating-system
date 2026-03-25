import { useMemo } from 'react';

/**
 * Night sky star layer.
 * ~60 procedurally-placed stars with random twinkle animations.
 */

// Simple deterministic pseudo-random for consistent star positions
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export default function StarLayer() {
  const stars = useMemo(() => {
    const rng = seededRandom(42);
    return Array.from({ length: 60 }, (_, i) => ({
      id: i,
      top: `${rng() * 100}%`,
      left: `${rng() * 100}%`,
      size: 1.5 + rng() * 1.5,
      opacity: 0.15 + rng() * 0.25,
      duration: 2 + rng() * 3,
      delay: rng() * 4,
    }));
  }, []);

  return (
    <>
      {stars.map(s => (
        <div
          key={s.id}
          style={{
            position: 'absolute',
            top: s.top,
            left: s.left,
            width: s.size,
            height: s.size,
            borderRadius: '50%',
            background: '#fff',
            opacity: s.opacity,
            animation: `twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
    </>
  );
}
