import React from 'react';
import { Badge } from '@sos/design-system';

export function Tones() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Badge tone="neutral">Draft</Badge>
      <Badge tone="accent">AP Calculus</Badge>
      <Badge tone="success">On track</Badge>
      <Badge tone="warning">Due soon</Badge>
      <Badge tone="danger">Overdue</Badge>
    </div>
  );
}
