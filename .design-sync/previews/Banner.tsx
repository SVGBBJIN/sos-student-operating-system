import React from 'react';
import { Banner } from '@sos/design-system';

export function Tones() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 340 }}>
      <Banner tone="info" message="Synced 12 assignments from Google Classroom." />
      <Banner tone="warning" message="3 of 5 daily content generations used." action="Resets in 4h" />
      <Banner tone="danger" message="Rate limit reached — try again tomorrow." />
    </div>
  );
}
