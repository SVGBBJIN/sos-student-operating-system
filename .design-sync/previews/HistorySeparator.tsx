import React from 'react';
import { HistorySeparator, UserBubble, AiBubble } from '@sos/design-system';

export function BetweenDays() {
  return (
    <div style={{ width: 360 }}>
      <UserBubble text="What's due tomorrow?" time="9:02 AM" />
      <AiBubble text="Just the Chemistry lab report." time="9:02 AM" />
      <HistorySeparator label="Yesterday" />
      <UserBubble text="Add a swim practice block for 5pm." time="4:58 PM" />
    </div>
  );
}
