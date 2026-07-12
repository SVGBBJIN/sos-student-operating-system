import React from 'react';
import { Card, CardHeader } from '@sos/design-system';

export function InCard() {
  return (
    <Card>
      <CardHeader icon={<span>📚</span>} title="Study pack ready" subtitle="Biology · Unit 4" />
    </Card>
  );
}
