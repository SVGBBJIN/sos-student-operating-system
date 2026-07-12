import React from 'react';
import { Card, CardHeader, CardBody, CardActions, Button, Badge } from '@sos/design-system';

export function ProposalCard() {
  return (
    <Card accent="teal">
      <CardHeader icon={<span>📅</span>} title="Add event" subtitle="Chemistry · Fri Jul 17" />
      <CardBody>Lab report due — proposing a 2-hour work block Thursday evening.</CardBody>
      <CardActions>
        <Button size="sm">Add to calendar</Button>
        <Button size="sm" variant="ghost">
          Dismiss
        </Button>
      </CardActions>
    </Card>
  );
}

export function ConfirmationCard() {
  return (
    <Card accent="amber">
      <CardHeader
        icon={<span>⚠️</span>}
        title="Confirm task"
        subtitle={<Badge tone="warning">Needs review</Badge>}
      />
      <CardBody>Mark "Finish problem set 4" as complete?</CardBody>
      <CardActions>
        <Button size="sm">Yes, complete it</Button>
        <Button size="sm" variant="ghost">
          Not yet
        </Button>
      </CardActions>
    </Card>
  );
}
