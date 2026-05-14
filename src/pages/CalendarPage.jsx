import React, { useState, useEffect } from 'react';
import { sb } from '../lib/supabase.js';
import { useNavigate } from 'react-router-dom';
import CalendarWindow from '../components/CalendarWindow/CalendarWindow.jsx';
import { dbEventToApp } from '../lib/eventShape.js';

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [blocks, setBlocks] = useState({ recurring: [], dates: {} });
  const [user,   setUser]   = useState(null);
  const [newEventId, setNewEventId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onNew(e) {
      const id = e.detail?.id;
      if (!id) return;
      setNewEventId(id);
    }
    window.addEventListener('sos:calendar:new-event', onNew);
    return () => window.removeEventListener('sos:calendar:new-event', onNew);
  }, []);

  useEffect(() => {
    let evChan, rbChan, dbChan;
    sb.auth.getSession().then(({ data }) => {
      const u = data?.session?.user;
      if (!u) return;
      setUser(u);
      const userId = u.id;

      // Initial load: events + blocks in parallel
      Promise.all([
        sb.from('events').select('*').eq('user_id', userId),
        sb.from('recurring_blocks').select('*').eq('user_id', userId),
        sb.from('date_blocks').select('*').eq('user_id', userId),
      ]).then(([evRes, rbRes, dbRes]) => {
        if (evRes.data) setEvents(evRes.data.map(dbEventToApp));
        const recurring = (rbRes.data || []).map(rb => ({
          name: rb.name, category: rb.category,
          start: rb.start_time?.slice(0, 5), end: rb.end_time?.slice(0, 5),
          days: rb.days || [],
        }));
        const dates = {};
        (dbRes.data || []).forEach(db => {
          const d = db.block_date;
          if (!dates[d]) dates[d] = {};
          dates[d][db.time_slot?.slice(0, 5)] = db.cleared
            ? null
            : { name: db.name, category: db.category };
        });
        setBlocks({ recurring, dates });
      });

      // Realtime: refresh on any insert/update/delete to events or blocks
      const refreshEvents = () => {
        sb.from('events').select('*').eq('user_id', userId).then(({ data }) => {
          if (data) setEvents(data.map(dbEventToApp));
        });
      };
      const refreshBlocks = () => {
        Promise.all([
          sb.from('recurring_blocks').select('*').eq('user_id', userId),
          sb.from('date_blocks').select('*').eq('user_id', userId),
        ]).then(([rbRes, dbRes]) => {
          const recurring = (rbRes.data || []).map(rb => ({
            name: rb.name, category: rb.category,
            start: rb.start_time?.slice(0, 5), end: rb.end_time?.slice(0, 5),
            days: rb.days || [],
          }));
          const dates = {};
          (dbRes.data || []).forEach(db => {
            const d = db.block_date;
            if (!dates[d]) dates[d] = {};
            dates[d][db.time_slot?.slice(0, 5)] = db.cleared
              ? null
              : { name: db.name, category: db.category };
          });
          setBlocks({ recurring, dates });
        });
      };

      evChan = sb.channel(`cal-events-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `user_id=eq.${userId}` }, refreshEvents)
        .subscribe();
      rbChan = sb.channel(`cal-rb-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_blocks', filter: `user_id=eq.${userId}` }, refreshBlocks)
        .subscribe();
      dbChan = sb.channel(`cal-db-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'date_blocks', filter: `user_id=eq.${userId}` }, refreshBlocks)
        .subscribe();
    });

    return () => {
      try { evChan && sb.removeChannel(evChan); } catch (_) {}
      try { rbChan && sb.removeChannel(rbChan); } catch (_) {}
      try { dbChan && sb.removeChannel(dbChan); } catch (_) {}
    };
  }, []);

  function handleEventUpdate(updated) {
    setEvents(prev => prev.map(e => e.id === updated.id ? updated : e));
  }

  async function handleEventDelete(ev) {
    if (!ev?.id) return;
    setEvents(prev => prev.filter(e => e.id !== ev.id));
    try {
      if (user?.id) await sb.from('events').delete().eq('id', ev.id).eq('user_id', user.id);
    } catch (_) {}
  }

  return (
    <CalendarWindow
      defaultSize="fullscreen"
      events={events}
      blocks={blocks}
      onEventUpdate={handleEventUpdate}
      onEventDelete={handleEventDelete}
      newEventId={newEventId}
      onClose={() => navigate('/studio')}
      userId={user?.id}
    />
  );
}
