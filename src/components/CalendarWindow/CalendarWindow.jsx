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
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
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
