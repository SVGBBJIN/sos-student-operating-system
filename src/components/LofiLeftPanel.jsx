import React, { useMemo } from 'react';

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentWeekDays() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  return DAYS.map((abbr, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      abbr,
      num: d.getDate(),
      dateStr: d.toISOString().slice(0, 10),
    };
  });
}

export default function LofiLeftPanel({ events, notes, onCreateNote }) {
  const today = getTodayStr();
  const weekDays = useMemo(() => getCurrentWeekDays(), []);

  const eventsByDay = useMemo(() => {
    const map = {};
    (events || []).forEach(e => {
      const day = e.event_date?.slice(0, 10) || e.start_date?.slice(0, 10);
      if (day) {
        if (!map[day]) map[day] = [];
        map[day].push(e);
      }
    });
    return map;
  }, [events]);

  const recentNotes = useMemo(() => {
    return (notes || [])
      .slice()
      .sort((a, b) =>
        (b.updated_at || b.created_at || '') > (a.updated_at || a.created_at || '') ? 1 : -1
      )
      .slice(0, 5);
  }, [notes]);

  return (
    <div className="study-left study-glass">
      {/* ── Schedule section ── */}
      <div className="study-left-section">
        <div className="study-section-label">Schedule</div>
        <div className="study-week-grid">
          {weekDays.map(({ abbr, num, dateStr }) => {
            const dayEvents = (eventsByDay[dateStr] || []).slice(0, 2);
            const isToday = dateStr === today;
            return (
              <div key={dateStr} className={'study-week-col' + (isToday ? ' today' : '')}>
                <div className="study-week-day">{abbr}</div>
                <div className="study-week-num">{num}</div>
                <div className="study-week-events">
                  {dayEvents.map(e => (
                    <div key={e.id} className="study-week-event" title={e.title}>
                      {e.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="study-left-divider" />

      {/* ── Notes section ── */}
      <div className="study-left-section">
        <div className="study-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Notes</span>
          {onCreateNote && (
            <button
              className="study-notes-add-btn"
              onClick={() => onCreateNote('Quick note', '')}
            >
              Add Note
            </button>
          )}
        </div>

        <div className="study-notes-list">
          {recentNotes.length === 0 ? (
            <div className="study-left-empty">No notes yet</div>
          ) : (
            recentNotes.map(note => (
              <div key={note.id} className="study-note-item">
                <div className="study-note-title">{note.name || 'Untitled'}</div>
                <div className="study-note-snippet">
                  {(note.content || '').replace(/<[^>]+>/g, '').slice(0, 60)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
