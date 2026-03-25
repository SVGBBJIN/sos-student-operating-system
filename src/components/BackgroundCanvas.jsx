import { useState, useEffect } from 'react';
import CloudLayer from './CloudLayer';
import StarLayer from './StarLayer';

/**
 * Time-of-day engine + atmospheric gradient background.
 * Wraps the entire app in a continuous sky canvas.
 */

function getTimeMode() {
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return 'morning';
  if (h >= 10 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'sunset';
  return 'night';
}

const GRADIENTS = {
  morning:   'radial-gradient(circle at 50% 30%, #C3E8F7, #BFD8F2, #A8C9E8)',
  afternoon: 'radial-gradient(circle at 50% 30%, #C3B1E1, #A78BCF, #7A6FA3)',
  sunset:    'radial-gradient(circle at 50% 40%, #F7B7A3, #C3A0C8, #7A6FA3)',
  night:     'radial-gradient(circle at 50% 30%, #2A2A5A, #1B1B40, #0D0D25)',
};

export default function BackgroundCanvas({ children }) {
  const [mode, setMode] = useState(getTimeMode);

  // Re-check time every 5 minutes
  useEffect(() => {
    const id = setInterval(() => setMode(getTimeMode()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const isNight = mode === 'night';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        background: GRADIENTS[mode],
        transition: 'background 1.5s ease-in-out',
        overflow: 'hidden',
      }}
    >
      {/* Atmospheric depth layers */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: mode === 'afternoon'
            ? 'radial-gradient(ellipse at 80% 10%, rgba(195,177,225,0.3), transparent 50%)'
            : mode === 'sunset'
              ? 'radial-gradient(ellipse at 20% 80%, rgba(247,183,163,0.25), transparent 50%)'
              : mode === 'morning'
                ? 'radial-gradient(ellipse at 30% 20%, rgba(195,232,247,0.3), transparent 50%)'
                : 'radial-gradient(ellipse at 70% 10%, rgba(42,42,90,0.4), transparent 50%)',
          pointerEvents: 'none',
          transition: 'background 1.5s ease-in-out',
        }}
      />

      {/* Cloud or Star layer */}
      <div className="bg-canvas-clouds" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {isNight ? <StarLayer /> : <CloudLayer mode={mode} />}
      </div>

      {/* App content sits above the background */}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}
