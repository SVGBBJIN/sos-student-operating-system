import React, { useState, useRef, useCallback, useEffect } from 'react';
import { sb } from '../lib/supabase.js';

const SWATCHES = [
  { name: 'Sage',     hex: '#5fa882' },
  { name: 'Teal',     hex: '#0D9488' },
  { name: 'Amber',    hex: '#D97706' },
  { name: 'Coral',    hex: '#E11D48' },
  { name: 'Sky',      hex: '#0284C7' },
  { name: 'Lavender', hex: '#7C3AED' },
];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const bigint = parseInt(h, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function mix(hex, ratio, toward = 255) {
  const { r, g, b } = hexToRgb(hex);
  const rr = Math.round(r + (toward - r) * ratio);
  const gg = Math.round(g + (toward - g) * ratio);
  const bb = Math.round(b + (toward - b) * ratio);
  return `rgb(${rr}, ${gg}, ${bb})`;
}

function applyAccent(hex) {
  const light = mix(hex, 0.35, 255);
  const highlight = mix(hex, 0.55, 255);
  const dark = mix(hex, 0.35, 0);
  const muted = mix(hex, 0.65, 40);
  const { r, g, b } = hexToRgb(hex);

  document.documentElement.style.setProperty('--primary', hex);
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--teal', hex);
  document.documentElement.style.setProperty('--accent-new', hex);
  document.documentElement.style.setProperty('--accent-light', light);
  document.documentElement.style.setProperty('--accent-highlight', highlight);
  document.documentElement.style.setProperty('--accent-dark', dark);
  document.documentElement.style.setProperty('--accent-muted', muted);
  document.documentElement.style.setProperty('--accent-dim', `rgba(${r}, ${g}, ${b}, 0.34)`);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.28)`);
  document.documentElement.style.setProperty('--primary-glow', `rgba(${r}, ${g}, ${b}, 0.2)`);
  document.documentElement.style.setProperty('--soft-blue', `rgba(${clamp(r + 35, 0, 255)}, ${clamp(g + 20, 0, 255)}, ${clamp(b + 60, 0, 255)}, 0.2)`);
  document.documentElement.style.setProperty('--border', `rgba(${r}, ${g}, ${b}, 0.26)`);
  document.documentElement.style.setProperty('--border-mid', `rgba(${r}, ${g}, ${b}, 0.4)`);
}

export default function AppearanceSettings({ user }) {
  const [activeHex, setActiveHex] = useState(
    () => localStorage.getItem('sos_accent') || '#5fa882'
  );
  const [hexInput, setHexInput] = useState(
    () => localStorage.getItem('sos_accent') || '#5fa882'
  );
  const debounceRef = useRef(null);

  useEffect(() => {
    applyAccent(activeHex);
  }, [activeHex]);

  const persistAccent = useCallback((hex, userId) => {
    localStorage.setItem('sos_accent', hex);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (userId) {
        sb.from('profiles')
          .upsert({ id: userId, accent_color: hex }, { onConflict: 'id' })
          .then(() => {});
      }
    }, 800);
  }, []);

  function handleSwatch(hex) {
    setActiveHex(hex);
    setHexInput(hex);
    applyAccent(hex);
    persistAccent(hex, user?.id);
  }

  function handleHexChange(e) {
    const val = e.target.value;
    setHexInput(val);
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      setActiveHex(val);
      applyAccent(val);
      persistAccent(val, user?.id);
    }
  }

  return (
    <div className="settings-card" style={{ marginTop: 14 }}>
      {/* Eyebrow */}
      <div style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--muted-foreground)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginBottom: 6,
      }}>
        Personalization
      </div>

      {/* Heading */}
      <div className="settings-title" style={{ fontFamily: 'var(--font-heading)', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
        Appearance
      </div>
      <div className="settings-sub">
        Choose an accent color that will be applied across the app.
      </div>

      {/* Color picker row */}
      <div className="settings-row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--muted-foreground)' }}>
          Accent color
        </div>

        {/* Swatches */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {SWATCHES.map(sw => {
            const isActive = activeHex.toLowerCase() === sw.hex.toLowerCase();
            return (
              <button
                key={sw.hex}
                title={sw.name}
                onClick={() => handleSwatch(sw.hex)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 'var(--radius-full)',
                  background: sw.hex,
                  border: 'none',
                  cursor: 'pointer',
                  transform: isActive ? 'scale(1.15)' : 'scale(1)',
                  boxShadow: isActive ? 'var(--shadow-focus)' : '0 0 0 1px var(--border)',
                  transition: `transform var(--duration-fast) ease-out,
                               box-shadow var(--duration-fast) ease-out`,
                  flexShrink: 0,
                }}
              />
            );
          })}

          {/* Hex input */}
          <input
            type="text"
            value={hexInput}
            onChange={handleHexChange}
            maxLength={7}
            placeholder="#5fa882"
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              width: 88,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '5px 8px',
              color: 'var(--foreground)',
              outline: 'none',
            }}
            onFocus={e => { e.target.style.boxShadow = 'var(--shadow-focus)'; }}
            onBlur={e => { e.target.style.boxShadow = 'none'; }}
          />
        </div>
      </div>
    </div>
  );
}
