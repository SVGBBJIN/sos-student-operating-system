import React, { useState, useRef, useEffect, useCallback } from 'react';
import './CalendarWindow.css';
import { useCalendarSize } from './useCalendarSize.js';
import { useDraggable }    from './useDraggable.js';
import EventEditPopover    from './EventEditPopover.jsx';

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS    = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 56;
const DAY_MINUTES = 24 * 60;
const DEFAULT_EVENT_MINUTES = 60;

function formatHour(h) {
  if (h === 0)  return '12 AM';
  if (h < 12)  return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function getWeekDates(baseDate) {
  const start = new Date(baseDate);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function toISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDateString(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : toISODate(d);
}

function parseTimeToMinutes(value) {
  if (!value) return null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  const twentyFourHour = trimmed.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (twentyFourHour) {
    const hours = Number(twentyFourHour[1]);
    const minutes = Number(twentyFourHour[2] || 0);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return hours * 60 + minutes;
    }
  }

  const twelveHour = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
  if (twelveHour) {
    let hours = Number(twelveHour[1]);
    const minutes = Number(twelveHour[2] || 0);
    const period = twelveHour[3].toLowerCase();
    if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59) {
      if (period === 'p' && hours !== 12) hours += 12;
      if (period === 'a' && hours === 12) hours = 0;
      return hours * 60 + minutes;
    }
  }

  return null;
}

function minutesToLabel(minutes) {
  const bounded = Math.max(0, Math.min(minutes, DAY_MINUTES));
  const hours = Math.floor(bounded / 60);
  const mins = bounded % 60;
  const displayHour = hours % 12 || 12;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${displayHour}:${String(mins).padStart(2, '0')} ${suffix}`;
}

function getEventDate(ev) {
  return normalizeDateString(ev.date || ev.start_date || ev.start?.date || ev.start?.dateTime);
}

function getEventTimeRange(ev) {
  const startCandidates = [ev.start_time, ev.startTime, ev.start, ev.time];
  const endCandidates = [ev.end_time, ev.endTime, ev.end];
  const start = startCandidates.map(parseTimeToMinutes).find(v => v !== null);
  const parsedEnd = endCandidates.map(parseTimeToMinutes).find(v => v !== null);

  if (start === null) {
    return { startMin: 8 * 60, endMin: 9 * 60, hasTime: false };
  }

  const end = parsedEnd !== null && parsedEnd > start
    ? parsedEnd
    : Math.min(start + DEFAULT_EVENT_MINUTES, DAY_MINUTES);

  return { startMin: start, endMin: end, hasTime: true };
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
        <div className="cw-grid-scroll-content">
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
            const eventDate = getEventDate(ev);
            const colIdx = weekDates.findIndex(d => toISODate(d) === eventDate);
            if (colIdx < 0) return null;

            const { startMin, endMin, hasTime } = getEventTimeRange(ev);
            const topPx = (startMin / 60) * HOUR_HEIGHT;
            const heightPx = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 28);
            const isNew = ev.id === newEventId;

            return (
              <div
                key={ev.id}
                className={'cw-event' + (isNew ? ' cw-event-new' : '') + (!hasTime ? ' cw-event-all-day' : '')}
                style={{
                  top: `${topPx}px`,
                  left: `calc(56px + ${colIdx} * ((100% - 56px) / 7) + 2px)`,
                  width: `calc((100% - 56px) / 7 - 4px)`,
                  height: `${heightPx}px`,
                  background: ev.color || 'var(--primary)',
                }}
                onClick={e => onEventClick(ev, e.currentTarget.getBoundingClientRect())}
              >
                <span className="cw-event-title">{ev.title}</span>
                <span className="cw-event-time">
                  {hasTime ? `${minutesToLabel(startMin)}–${minutesToLabel(endMin)}` : 'No time set'}
                </span>
                {isNew && (
                  <span className="cw-ai-chip">✦ Added by Charles</span>
                )}
              </div>
            );
          })}
        </div>
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
}) {
  const { size, setSize } = useCalendarSize(defaultSize);
  const containerRef = useRef(null);
  const headerRef    = useRef(null);

  const [weekOffset,   setWeekOffset]   = useState(0);
  const [popover,      setPopover]      = useState(null);  // { event, rect }
  const [newEventId,   setNewEventId]   = useState(null);
  const [localEvents,  setLocalEvents]  = useState(events);
  const [nativeFS,     setNativeFS]     = useState(false);

  // Sync prop changes
  useEffect(() => { setLocalEvents(events); }, [events]);

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

  // External: expose method to animate a newly added event
  useEffect(() => {
    function onNewEvent(e) {
      const { id } = e.detail || {};
      if (!id) return;
      setNewEventId(id);
      setTimeout(() => setNewEventId(null), 4000);
    }
    window.addEventListener('sos:calendar:new-event', onNewEvent);
    return () => window.removeEventListener('sos:calendar:new-event', onNewEvent);
  }, []);

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
