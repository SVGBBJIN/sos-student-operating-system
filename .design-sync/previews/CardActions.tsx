import React from 'react';
import { Card, CardHeader, CardBody, CardActions, Button } from '@sos/design-system';

export function InCard() {
  return (
    <Card>
      <CardHeader title="Flashcards ready" />
      <CardBody>24 cards generated from your Chemistry notes.</CardBody>
      <CardActions>
        <Button size="sm">Save deck</Button>
        <Button size="sm" variant="ghost">
          Discard
        </Button>
      </CardActions>
    </Card>
  );
}
