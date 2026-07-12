import React from 'react';
import { Chip } from '@sos/design-system';

export function SubjectPicker() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Chip selected>Math</Chip>
      <Chip>Chemistry</Chip>
      <Chip>English</Chip>
      <Chip>History</Chip>
    </div>
  );
}
