import React from 'react';
import CalendarWindow from './CalendarWindow/CalendarWindow.jsx';

export default function LofiLeftPanel({ events, userId, onEventUpdate }) {
  return (
    <div className="study-left study-glass" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <CalendarWindow
        embedded
        defaultSize="fullscreen"
        events={events || []}
        onEventUpdate={onEventUpdate}
        userId={userId}
      />
    </div>
  );
}
