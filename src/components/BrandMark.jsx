import React from 'react';

// Inline bulb path so this component works on any route (no svg defs dependency).
function BulbSvg({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M9 21h6M12 3a6 6 0 0 1 6 6c0 2.5-1.5 4.5-3 6H9c-1.5-1.5-3-3.5-3-6a6 6 0 0 1 6-6z"/>
      <path d="M9 17h6"/>
    </svg>
  );
}

export default function BrandMark({ fontSize = 20 }) {
  return (
    <span className="sos-brand-mark" style={{ borderRadius: 6, padding: 3 }}>
      <span className="sos-mark" style={{ fontSize }}>
        <span className="sos-mark-s">S</span>
        <span className="sos-mark-bulb"><BulbSvg size={fontSize} /></span>
        <span className="sos-mark-s">S</span>
      </span>
    </span>
  );
}
