import React from 'react';
import { Banner } from '@sos/design-system';

/** Matches RateLimitBanner exactly — the only real banner in the app: one style, dismissible. */
export function RateLimitNotice() {
  return <Banner icon="🐙" message="Charles is resting — AI is temporarily unavailable" onDismiss={() => {}} />;
}

export function WithoutDismiss() {
  return <Banner icon="🐙" message="Charles is resting — AI is temporarily unavailable" />;
}
