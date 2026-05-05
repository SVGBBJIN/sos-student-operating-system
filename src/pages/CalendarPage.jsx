import React, { useState, useEffect } from 'react';
import { sb } from '../lib/supabase.js';
import { useNavigate } from 'react-router-dom';
import CalendarWindow from '../components/CalendarWindow/CalendarWindow.jsx';
import { dbEventToApp, appEventToDb } from '../lib/eventShape.js';

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [user,   setUser]   = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      const u = data?.session?.user;
      if (u) {
        setUser(u);
        sb.from('events')
          .select('*')
          .eq('user_id', u.id)
          .then(({ data: ev }) => { if (ev) setEvents(ev.map(dbEventToApp)); });
      }
    });
  }, []);

  function handleEventUpdate(updated) {
    setEvents(prev => prev.map(e => e.id === updated.id ? updated : e));
  }

  return (
    <CalendarWindow
      defaultSize="fullscreen"
      events={events}
      onEventUpdate={handleEventUpdate}
      onClose={() => navigate('/studio')}
      userId={user?.id}
    />
  );
}
