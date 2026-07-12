import React from 'react';
import { BrandMark } from '@sos/design-system';

export function Sizes() {
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
      <BrandMark fontSize={16} />
      <BrandMark fontSize={24} />
      <BrandMark fontSize={36} />
    </div>
  );
}
