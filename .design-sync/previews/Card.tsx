import React from 'react';
import { Card, CardHeader, CardBody, CardActions, Button, Badge } from '@sos/design-system';

/** add_event — real ConfirmationCard accent for this action type is 'teal'. */
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

/** complete_task — real ConfirmationCard accent for this action type is 'success'. */
export function ConfirmationCard() {
  return (
    <Card accent="success">
      <CardHeader icon={<span>✅</span>} title="Complete task" subtitle={<Badge tone="success">done</Badge>} />
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

/** add_block — real ConfirmationCard accent for this action type is 'blue'. */
export function BlockCard() {
  return (
    <Card accent="blue">
      <CardHeader icon={<span>🕐</span>} title="Schedule block" subtitle={<Badge tone="blue">block</Badge>} />
      <CardBody>Swim practice — today, 5:00–6:30 PM.</CardBody>
      <CardActions>
        <Button size="sm">Add to schedule</Button>
        <Button size="sm" variant="ghost">
          Dismiss
        </Button>
      </CardActions>
    </Card>
  );
}
