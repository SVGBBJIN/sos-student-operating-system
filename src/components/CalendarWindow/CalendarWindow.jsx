import React, { useState, useRef, useEffect, useCallback } from 'react';
import './CalendarWindow.css';
import { useCalendarSize } from './useCalendarSize.js';
import { useDraggable }    from './useDraggable.js';
import EventEditPopover    from './EventEditPopover.jsx';

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS    = Array.from({ length: 24 }, (_, i) => i);

function formatHour(h) {
  if (h === 0)  return '12 AM';
  if (h < 12)  return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function getWeekDates(baseDate) {
  const start = new Date(baseDate);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function getWeekOffsetForDate(dateStr, baseDate = new Date()) {
  const target = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(target.valueOf())) return 0;

  const currentWeekStart = getWeekDates(baseDate)[0];
  const targetWeekStart = getWeekDates(target)[0];
  return Math.round((targetWeekStart - currentWeekStart) / (7 * 24 * 60 * 60 * 1000));
}

function toISODate(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function normalizeDateValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return toISODate(value);
  const raw = String(value).trim();
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? '' : toISODate(parsed);
}

function normalizeTimeValue(value, fallback = '00:00') {
  if (!value) return fallback;
  const raw = String(value).trim();
  const isoTime = raw.match(/T(\d{2}:\d{2})/);
  if (isoTime) return isoTime[1];
  const clock = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!clock) return fallback;

  let hours = Number(clock[1]);
  const minutes = Number(clock[2] || 0);
  const meridiem = clock[3]?.toUpperCase();

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return fallback;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function addMinutes(time, minutesToAdd) {
  const [hours, minutes] = normalizeTimeValue(time).split(':').map(Number);
  const total = Math.max(0, hours * 60 + minutes + minutesToAdd);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatEventTime(ev) {
  const start = normalizeTimeValue(ev.start_time, '00:00');
  const end = normalizeTimeValue(ev.end_time, addMinutes(start, 60));
  if (start === '00:00' && (!ev.start_time || ev.allDay)) return 'All day';
  return `${start}${end ? `–${end}` : ''}`;
}

function normalizeEvent(event) {
  const date = normalizeDateValue(event?.date || event?.event_date || event?.start_date || event?.start?.date || event?.start?.dateTime);
  const startTime = normalizeTimeValue(
    event?.start_time || event?.startTime || event?.start || event?.time || event?.start?.dateTime,
    '00:00'
  );
  const endTime = normalizeTimeValue(
    event?.end_time || event?.endTime || event?.end || event?.end?.dateTime,
    addMinutes(startTime, 60)
  );

  return {
    ...event,
    id: event?.id || event?.googleId || `${date}-${event?.title || 'event'}-${startTime}`,
    title: event?.title || event?.summary || 'Untitled event',
    date,
    start_time: startTime,
    end_time: endTime,
  };
}

/* ─── Widget Mode: 7-day strip ──────────────────────────────────── */
function WeekStrip({ weekDates, events, onDayClick }) {
  const today = toISODate(new Date());
  return (
    <div className="cw-strip">
      {weekDates.map(day => {
        const dateStr = toISODate(day);
        const isToday = dateStr === today;
        const dayEvents = events.filter(e => e.date === dateStr);
        const dotsToShow = dayEvents.slice(0, 3);
        const overflow   = dayEvents.length - 3;
        return (
          <div
            key={dateStr}
            className={'cw-strip-day' + (isToday ? ' cw-strip-today' : '')}
            onClick={() => onDayClick()}
          >
            <span className="cw-strip-abbr">{DAY_ABBR[day.getDay()]}</span>
            <span className="cw-strip-num">{day.getDate()}</span>
            {isToday && <span className="cw-strip-dot-today" />}
            <div className="cw-strip-events">
              {dotsToShow.map((ev, i) => (
                <span
                  key={i}
                  className="cw-strip-event-dot"
                  style={{ background: ev.color || 'var(--primary)' }}
                />
              ))}
              {overflow > 0 && (
                <span className="cw-strip-overflow">+{overflow}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Full Week Grid ─────────────────────────────────────────────── */
function WeekGrid({ weekDates, events, onEventClick, newEventId }) {
  const today = toISODate(new Date());

  return (
    <div className="cw-grid">
      {/* Day header row */}
      <div className="cw-grid-header">
        <div className="cw-time-gutter" />
        {weekDates.map(day => {
          const dateStr = toISODate(day);
          const isToday = dateStr === today;
          return (
            <div key={dateStr} className={'cw-grid-day-header' + (isToday ? ' cw-today' : '')}>
              <span className="cw-day-abbr">{DAY_ABBR[day.getDay()]}</span>
              <span className="cw-day-num">{day.getDate()}</span>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div className="cw-grid-body">
        {/* Hour rows */}
        {HOURS.map(h => (
          <div key={h} className="cw-hour-row">
            <div className="cw-time-label">{formatHour(h)}</div>
            {weekDates.map(day => (
              <div key={toISODate(day)} className="cw-time-cell" />
            ))}
          </div>
        ))}

        {/* Events overlay */}
        {events.map(ev => {
          const colIdx = weekDates.findIndex(d => toISODate(d) === ev.date);
          if (colIdx < 0) return null;

          const [sh, sm] = (ev.start_time || '00:00').split(':').map(Number);
          const [eh, em] = (ev.end_time   || '01:00').split(':').map(Number);
          const startMin = sh * 60 + sm;
          const endMin   = eh * 60 + em;
          const topPct   = (startMin / (24 * 60)) * 100;
          const heightPct = Math.max(((endMin - startMin) / (24 * 60)) * 100, 4.17); // min ~1 hour tall

          const isNew = ev.id === newEventId;

          return (
            <div
              key={ev.id}
              className={'cw-event' + (isNew ? ' cw-event-new' : '')}
              style={{
                top:    `calc(${topPct}% + 40px)`,
                left:   `calc(${(colIdx + 1) * (100 / 8)}% + 2px)`,
                width:  `calc(${100 / 8}% - 4px)`,
                height: `${heightPct}%`,
                background: ev.color || 'var(--primary)',
              }}
              onClick={e => onEventClick(ev, e.currentTarget.getBoundingClientRect())}
            >
              <span className="cw-event-title">{ev.title}</span>
              {isNew && (
                <span className="cw-ai-chip">✦ Added by Charles</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

}

/* ─── Embedded Sidebar Agenda ────────────────────────────────────── */
function WeekAgenda({ weekDates, events, onEventClick, newEventId }) {
  const today = toISODate(new Date());
  const eventsByDate = new Map(weekDates.map(day => [toISODate(day), []]));

  events.forEach(ev => {
    if (!eventsByDate.has(ev.date)) return;
    eventsByDate.get(ev.date).push(ev);
  });

  eventsByDate.forEach(dayEvents => {
    dayEvents.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  });

  const visibleEvents = Array.from(eventsByDate.values()).flat();

  return (
    <div className="cw-agenda" aria-label="Calendar events this week">
      <WeekStrip weekDates={weekDates} events={events} onDayClick={() => {}} />

      <div className="cw-agenda-list">
        {visibleEvents.length === 0 && (
          <div className="cw-agenda-empty">No events this week</div>
        )}

        {weekDates.map(day => {
          const dateStr = toISODate(day);
          const dayEvents = eventsByDate.get(dateStr) || [];
          if (!dayEvents.length) return null;
          const isToday = dateStr === today;

          return (
            <section key={dateStr} className="cw-agenda-day">
              <div className={'cw-agenda-day-label' + (isToday ? ' cw-agenda-today' : '')}>
                <span>{DAY_ABBR[day.getDay()]}</span>
                <span>{day.getDate()}</span>
              </div>

              <div className="cw-agenda-day-events">
                {dayEvents.map(ev => {
                  const isNew = ev.id === newEventId;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      className={'cw-agenda-event' + (isNew ? ' cw-event-new' : '')}
                      onClick={e => onEventClick(ev, e.currentTarget.getBoundingClientRect())}
                    >
                      <span
                        className="cw-agenda-event-color"
                        style={{ background: ev.color || 'var(--primary)' }}
                      />
                      <span className="cw-agenda-event-copy">
                        <span className="cw-agenda-event-title">{ev.title}</span>
                        <span className="cw-agenda-event-time">{formatEventTime(ev)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ─── CalendarWindow ─────────────────────────────────────────────── */
export default function CalendarWindow({
  defaultSize = 'fullscreen',
  embedded    = false,
  events      = [],
  onEventUpdate,
  onClose,
  userId,
  focusEvent,
}) {
  const { size, setSize } = useCalendarSize(defaultSize);
  const containerRef = useRef(null);
  const headerRef    = useRef(null);

  const [weekOffset,   setWeekOffset]   = useState(0);
  const [popover,      setPopover]      = useState(null);  // { event, rect }
  const [newEventId,   setNewEventId]   = useState(null);
  const [localEvents,  setLocalEvents]  = useState(() => events.map(normalizeEvent));
  const [nativeFS,     setNativeFS]     = useState(false);

  // Sync prop changes
  useEffect(() => { setLocalEvents(events.map(normalizeEvent)); }, [events]);

  // Drag — only when not fullscreen and not embedded
  useDraggable(headerRef, containerRef, size);

  const weekDates = getWeekDates(new Date(
    Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000
  ));

  function handleEventClick(ev, rect) {
    setPopover({ event: ev, rect });
  }

  function handleEventSave(updated) {
    setLocalEvents(prev => prev.map(e => e.id === updated.id ? updated : e));
    onEventUpdate?.(updated);
    setPopover(null);
  }

  // Track native fullscreen state
  useEffect(() => {
    const onChange = () => setNativeFS(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleBrowserFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  const focusCalendarEvent = useCallback((detail = {}) => {
    const { id, date } = detail;
    if (!id) return;

    const eventDate = normalizeDateValue(date);
    if (eventDate) setWeekOffset(getWeekOffsetForDate(eventDate));

    setNewEventId(id);
    setTimeout(() => setNewEventId(null), 4000);
  }, []);

  // Focus events that happened before this embedded calendar mounted.
  useEffect(() => {
    focusCalendarEvent(focusEvent);
  }, [focusEvent, focusCalendarEvent]);

  // External: expose method to animate a newly added event
  useEffect(() => {
    function onNewEvent(e) {
      focusCalendarEvent(e.detail || {});
    }
    window.addEventListener('sos:calendar:new-event', onNewEvent);
    return () => window.removeEventListener('sos:calendar:new-event', onNewEvent);
  }, [focusCalendarEvent]);

  const sizeButtons = [
    { id: 'fullscreen', label: 'Full',   icon: '⛶' },
    { id: 'half-left',  label: 'Left',   icon: '◧' },
    { id: 'half-right', label: 'Right',  icon: '◨' },
    { id: 'widget',     label: 'Widget', icon: '▣' },
  ];

  const isWidget = size === 'widget';

  return (
    <>
      <div
        ref={containerRef}
        className={[
          'cw-container',
          `cw-size-${size}`,
          embedded ? 'cw-embedded' : '',
        ].join(' ')}
      >
        {/* Header */}
        <div ref={headerRef} className="cw-header">
          {size !== 'fullscreen' && (
            <span className="cw-drag-handle" title="Drag to move">⠿</span>
          )}
          <span className="cw-title">Calendar</span>
          {!isWidget && (
            <div className="cw-nav">
              <button className="cw-nav-btn" onClick={() => setWeekOffset(o => o - 1)}>‹</button>
              <button className="cw-nav-btn" onClick={() => setWeekOffset(0)}>Today</button>
              <button className="cw-nav-btn" onClick={() => setWeekOffset(o => o + 1)}>›</button>
            </div>
          )}
        </div>

        {/* Body */}
        {isWidget ? (
          <WeekStrip
            weekDates={weekDates}
            events={localEvents}
            onDayClick={() => setSize('half-left')}
          />
        ) : embedded ? (
          <WeekAgenda
            weekDates={weekDates}
            events={localEvents}
            onEventClick={handleEventClick}
            newEventId={newEventId}
          />
        ) : (
          <WeekGrid
            weekDates={weekDates}
            events={localEvents}
            onEventClick={handleEventClick}
            newEventId={newEventId}
          />
        )}

        {/* Bottom toggle bar — hidden when embedded (host provides navigation) */}
        {!embedded && <div className="cw-size-bar">
          {sizeButtons.map(btn => (
            <button
              key={btn.id}
              className={'cw-size-btn' + (size === btn.id ? ' cw-size-btn-active' : '')}
              onClick={() => setSize(btn.id)}
            >
              {btn.icon} {btn.label}
            </button>
          ))}
          <button
            className={'cw-size-btn' + (nativeFS ? ' cw-size-btn-active' : '')}
            onClick={toggleBrowserFullscreen}
            title={nativeFS ? 'Exit browser fullscreen' : 'Browser fullscreen (hides browser chrome)'}
          >
            {nativeFS ? '⊡ Exit FS' : '⛶ Full FS'}
          </button>
          {onClose && (
            <button className="cw-size-btn" onClick={onClose}>✕ Close</button>
          )}
        </div>}
      </div>

      {/* Event edit popover */}
      {popover && (
        <EventEditPopover
          event={popover.event}
          anchorRect={popover.rect}
          onSave={handleEventSave}
          onClose={() => setPopover(null)}
          userId={userId}
        />
      )}
    </>
  );
}
