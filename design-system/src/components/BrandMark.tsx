import React from 'react';

function BulbSvg({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path d="M9 21h6M12 3a6 6 0 0 1 6 6c0 2.5-1.5 4.5-3 6H9c-1.5-1.5-3-3.5-3-6a6 6 0 0 1 6-6z" />
      <path d="M9 17h6" />
    </svg>
  );
}

export interface BrandMarkProps {
  /** Font size in px, drives the whole mark's scale. @default 20 */
  fontSize?: number;
}

/**
 * SOS wordmark — "S" + lightbulb + "S". Self-contained (inline SVG, no external asset).
 * Used in the sidebar header and auth screens.
 */
export function BrandMark({ fontSize = 20 }: BrandMarkProps) {
  return (
    <span className="sos-ds-brand-mark">
      <span className="sos-ds-brand-mark-text" style={{ fontSize }}>
        <span>S</span>
        <span className="sos-ds-brand-mark-bulb">
          <BulbSvg size={fontSize} />
        </span>
        <span>S</span>
      </span>
    </span>
  );
}
