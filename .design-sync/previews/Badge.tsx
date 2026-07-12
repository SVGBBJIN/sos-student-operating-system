import React from 'react';
import { Badge } from '@sos/design-system';

/**
 * The six tones match the real per-action-type accent vocabulary from
 * ConfirmationCard/ContentCard (see Card.tsx's SosCardAccent) — the same
 * set .notes-badge-pdf/-docs/-ai draw from for standalone tags.
 */
export function Tones() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Badge tone="accent">ai</Badge>
      <Badge tone="teal">event</Badge>
      <Badge tone="blue">docs</Badge>
      <Badge tone="orange">split</Badge>
      <Badge tone="success">done</Badge>
      <Badge tone="danger">pdf</Badge>
    </div>
  );
}
