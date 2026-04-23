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

  // Full Mon–Sun week so students with weekend classes, sports, or tutoring
  // actually see them on the schedule instead of silently missing days.
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return DAYS.map((abbr, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      abbr,
      num: d.getDate(),
      dateStr: d.toISOString().slice(0, 10),
      isWeekend: i >= 5,
    };
  });
}

export default function LofiLeftPanel({ events, tasks, notes, onCreateNote, onSendChatMessage, onNoteClick, tutorMode, lofiTutorTabActive, onCloseTutorTab }) {
  const today = getTodayStr();
  const weekDays = useMemo(() => getCurrentWeekDays(), []);

  const eventsByDay = useMemo(() => {
    const map = {};
    (events || []).forEach(e => {
      // Events come in multiple shapes depending on source (Supabase, Google, AI).
      // Check all the places the day can be stored so none slip through.
      const day = (e.event_date || e.start_date || e.date || '')?.slice(0, 10);
      if (day) {
        if (!map[day]) map[day] = [];
        map[day].push(e);
      }
    });
    return map;
  }, [events]);

  const openTasks = useMemo(
    () => (tasks || []).filter(t => t.status !== 'done'),
    [tasks]
  );

  const tasksByDay = useMemo(() => {
    const map = {};
    openTasks.forEach(t => {
      const day = t.dueDate?.slice(0, 10);
      if (day) {
        if (!map[day]) map[day] = [];
        map[day].push(t);
      }
    });
    return map;
  }, [openTasks]);

  // Tasks that have no due date (or a blank/invalid one) — otherwise they would
  // be invisible to the student since the week grid only renders dated items.
  const undatedTasks = useMemo(
    () => openTasks.filter(t => !t.dueDate || !/^\d{4}-\d{2}-\d{2}/.test(t.dueDate)),
    [openTasks]
  );

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
        <div className="study-week-grid study-week-grid-7">
          {weekDays.map(({ abbr, num, dateStr, isWeekend }) => {
            const dayEvents = (eventsByDay[dateStr] || []).slice(0, 2);
            const dayTasks = (tasksByDay[dateStr] || []).slice(0, Math.max(0, 2 - dayEvents.length));
            const isToday = dateStr === today;
            return (
              <div
                key={dateStr}
                className={'study-week-col' + (isToday ? ' today' : '') + (isWeekend ? ' weekend' : '')}
                onClick={() => onSendChatMessage?.(`What's on my schedule for ${abbr} ${num}? (date: ${dateStr})`)}
                style={{ cursor: onSendChatMessage ? 'pointer' : 'default' }}
              >
                <div className="study-week-day">{abbr}</div>
                <div className="study-week-num">{num}</div>
                <div className="study-week-events">
                  {dayEvents.map(e => (
                    <div key={e.id} className="study-week-event" title={e.title}>
                      {e.title}
                    </div>
                  ))}
                  {dayTasks.map(t => (
                    <div key={t.id} className="study-week-task" title={t.title}>
                      {t.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {undatedTasks.length > 0 && (
          <div className="study-undated-tasks">
            <div className="study-undated-tasks-label">
              No due date <span className="study-undated-count">({undatedTasks.length})</span>
            </div>
            <div className="study-undated-tasks-list">
              {undatedTasks.slice(0, 4).map(t => (
                <button
                  key={t.id}
                  type="button"
                  className="study-week-task study-undated-task"
                  title={t.title}
                  onClick={() => onSendChatMessage?.(`Set a due date for "${t.title}"`)}
                >
                  {t.title}
                </button>
              ))}
              {undatedTasks.length > 4 && (
                <button
                  type="button"
                  className="study-undated-more"
                  onClick={() => onSendChatMessage?.(`Show all my tasks without a due date`)}
                >
                  +{undatedTasks.length - 4} more
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="study-left-divider" />

      {/* ── Notes / Studio section ── */}
      <div className="study-left-section">
        <div className="study-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{lofiTutorTabActive ? 'Studio' : 'Notes'}</span>
          {!lofiTutorTabActive && (onSendChatMessage || onCreateNote) && (
            <button
              className="study-notes-add-btn"
              onClick={() => {
                if (onSendChatMessage) {
                  onSendChatMessage('Create a new note');
                } else {
                  onCreateNote('Quick note', '');
                }
              }}
            >
              Add Note
            </button>
          )}
        </div>

        {lofiTutorTabActive ? (
          <div className="study-notes-list lofi-tutor-panel">
            <div style={{ fontSize: '10px', color: 'var(--lofi-amber)', fontFamily: 'var(--lofi-font-mono)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Skill Hub</div>
            {['Ask a question', 'Show flashcards', 'Quiz me', 'Explain this topic'].map(action => (
              <button
                key={action}
                className="study-widget-btn"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() => onSendChatMessage?.(action)}
              >
                {action}
              </button>
            ))}
            <button className="study-notes-add-btn" style={{ marginTop: 4 }} onClick={onCloseTutorTab}>
              Exit tutor
            </button>
          </div>
        ) : (
          <div className="study-notes-list">
            {recentNotes.length === 0 ? (
              <div className="study-left-empty">No notes yet</div>
            ) : (
              recentNotes.map(note => (
                <div
                  key={note.id}
                  className="study-note-item"
                  onClick={() => onNoteClick?.(note)}
                  style={{ cursor: onNoteClick ? 'pointer' : 'default' }}
                >
                  <div className="study-note-title">{note.name || 'Untitled'}</div>
                  <div className="study-note-snippet">
                    {(note.content || '').replace(/<[^>]+>/g, '').slice(0, 60)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
