import React from 'react';
import { AiBubble, Button, Card, CardHeader, CardBody, CardActions } from '@sos/design-system';

export function LongResponse() {
  return (
    <AiBubble
      text="Here's a finals-week plan: I've blocked three 90-minute review sessions for Chemistry, spaced two days apart so spaced repetition keeps the material fresh, plus a shorter daily 30-minute pass for AP Calculus problem sets. I moved your existing swim practice blocks so nothing overlaps, and left Friday evening open since you mentioned wanting a break before the exam."
      time="4:13 PM"
    />
  );
}

export function WithActionCard() {
  return (
    <AiBubble text="I found a conflict — want me to move the Chemistry block?" time="4:14 PM">
      <Card accent="teal">
        <CardHeader icon={<span>📅</span>} title="Move event" subtitle="Chemistry review · Thu 7–8:30 PM" />
        <CardBody>Conflicts with Swim practice. Move to 8:30–10 PM instead?</CardBody>
        <CardActions>
          <Button size="sm">Move it</Button>
          <Button size="sm" variant="ghost">
            Leave as-is
          </Button>
        </CardActions>
      </Card>
    </AiBubble>
  );
}

export function Loading() {
  return <AiBubble loading />;
}
