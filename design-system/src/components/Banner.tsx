import React from 'react';

export interface BannerProps {
  /** Banner tone. @default 'info' */
  tone?: 'info' | 'warning' | 'danger';
  /** Main banner message. */
  message: React.ReactNode;
  /** Optional trailing action, e.g. a countdown label or link. */
  action?: React.ReactNode;
}

/**
 * Full-width inline notice — used for rate-limit warnings and sync-status banners.
 */
export function Banner({ tone = 'info', message, action }: BannerProps) {
  return (
    <div className={`sos-ds-banner sos-ds-banner--${tone}`}>
      <span className="sos-ds-banner-message">{message}</span>
      {action && <span className="sos-ds-banner-action">{action}</span>}
    </div>
  );
}
