import React from 'react';

export interface BannerProps {
  /** Leading icon/emoji, e.g. the app's mascot. */
  icon?: React.ReactNode;
  /** Main banner message. */
  message: React.ReactNode;
  /** Called when the dismiss (×) button is clicked. Omit to hide the button. */
  onDismiss?: () => void;
}

/**
 * Status toast — matches RateLimitBanner exactly (the "Charles is resting"
 * AI-unavailable notice). This is the only real banner-like element in the
 * app: single dark style, icon + message + optional dismiss, no tone
 * variants — an earlier version of this component invented info/warning/
 * danger tones that don't correspond to anything real, so they were removed.
 */
export function Banner({ icon, message, onDismiss }: BannerProps) {
  return (
    <div className="sos-ds-banner" role="alert">
      {icon && <span className="sos-ds-banner-icon">{icon}</span>}
      <span className="sos-ds-banner-message">{message}</span>
      {onDismiss && (
        <button type="button" className="sos-ds-banner-dismiss" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}
