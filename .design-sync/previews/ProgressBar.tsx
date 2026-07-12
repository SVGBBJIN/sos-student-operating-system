import React from 'react';
import { ProgressBar } from '@sos/design-system';

export function Determinate() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 260 }}>
      <ProgressBar value={30} />
      <ProgressBar value={65} />
      <ProgressBar value={100} />
    </div>
  );
}

export function Indeterminate() {
  return (
    <div style={{ width: 260 }}>
      <ProgressBar />
    </div>
  );
}
