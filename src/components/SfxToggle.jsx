import { useState, useEffect } from 'react';
import { isEnabled, toggle, tap } from '../lib/sfx';

export default function SfxToggle() {
  const [enabled, setEnabled] = useState(() => isEnabled());

  useEffect(() => {
    const handler = () => setEnabled(isEnabled());
    window.addEventListener('sos:sfx-change', handler);
    return () => window.removeEventListener('sos:sfx-change', handler);
  }, []);

  function handleClick() {
    const next = toggle();
    setEnabled(next);
    if (next) tap(); // play a tap to confirm sounds are on
    window.dispatchEvent(new Event('sos:sfx-change'));
  }

  return (
    <button
      className="sfx-toggle"
      onClick={handleClick}
      title={enabled ? 'Mute UI sounds' : 'Enable UI sounds'}
      aria-label={enabled ? 'Mute UI sounds' : 'Enable UI sounds'}
      aria-pressed={enabled}
    >
      {enabled ? (
        // Speaker with waves
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
        </svg>
      ) : (
        // Speaker muted
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/>
          <line x1="17" y1="9" x2="23" y2="15"/>
        </svg>
      )}
    </button>
  );
}
