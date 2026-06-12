import React, { useState, useRef, useEffect, useMemo } from 'react';
import './CalendarWindow.css';
import { useCalendarSize } from './useCalendarSize.js';
import { useDraggable }    from './useDraggable.js';
import EventEditPopover    from './EventEditPopover.jsx';
import EventDetailModal    from './EventDetailModal.jsx';

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
      {weekDates.map((day, dayIdx) => {
        const dateStr = toISODate(day);
        const isToday = dateStr === today;
        const dayEvents = events.filter(e => e.date === dateStr);
        const dotsToShow = dayEvents.slice(0, 3);
        const overflow   = dayEvents.length - 3;
        return (
          <div
            key={dateStr}
            className={'cw-strip-day' + (isToday ? ' cw-strip-today' : '')}
            style={{ '--cw-day-hue': `${195 + (dayIdx * 24)}deg` }}
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

// Resolve the best available time string for an event (handles both field shapes).
function resolveEventTime(ev) {
  // Prefer explicit start_time (DB column once migration lands), then single `time` field.
  return ev.start_time || ev.time || null;
}

function resolveEventEndTime(ev) {
  return ev.end_time || null;
}

// Compute block bands for a given date from the App's blocks state shape
// `{ recurring: [], dates: {"YYYY-MM-DD": {"HH:MM": {name,category} | null}} }`.
// Returns an array of `{ start: "HH:MM", end: "HH:MM", name, category }` rows.
function blockBandsForDate(blocks, dateStr, dow) {
  if (!blocks || (typeof blocks !== 'object')) return [];
  // Build a 30-minute slot map for this day from recurring + dated overrides.
  const slots = {};
  (blocks.recurring || []).forEach(rb => {
    if (!Array.isArray(rb?.days) || !rb.days.includes(dow)) return;
    const [sh, sm] = (rb.start || '00:00').split(':').map(Number);
    const [eh, em] = (rb.end || '00:00').split(':').map(Number);
    let ch = sh, cm = sm;
    while (ch < eh || (ch === eh && cm < em)) {
      const k = String(ch).padStart(2, '0') + ':' + String(cm).padStart(2, '0');
      slots[k] = { name: rb.name, category: rb.category };
      cm += 30; if (cm >= 60) { ch++; cm = 0; }
    }
  });
  const overrides = blocks.dates?.[dateStr] || {};
  Object.entries(overrides).forEach(([k, v]) => {
    if (v === null) delete slots[k];
    else slots[k] = v;
  });
  // Condense consecutive equal slots into bands.
  const sorted = Object.entries(slots).sort(([a], [b]) => a.localeCompare(b));
  const bands = [];
  let cur = null;
  sorted.forEach(([time, data]) => {
    if (cur && cur.name === data.name && cur.category === data.category) {
      cur.end = time;
    } else {
      if (cur) bands.push(cur);
      cur = { start: time, end: time, name: data.name, category: data.category };
    }
  });
  if (cur) bands.push(cur);
  // Each slot represents 30 minutes — bump the band's end-time forward by 30 min.
  return bands.map(b => {
    const [eh, em] = b.end.split(':').map(Number);
    let nh = eh, nm = em + 30;
    if (nm >= 60) { nh++; nm = 0; }
    return { ...b, end: String(nh).padStart(2, '0') + ':' + String(nm).padStart(2, '0') };
  });
}

const HOUR_PX = 56;
const minutesToTopPx = (mins) => (mins / 60) * HOUR_PX;
const minutesToHeightPx = (mins) => Math.max((mins / 60) * HOUR_PX, 20);

function WeekGrid({ weekDates, events, blocks, onEventClick, newEventId }) {
  const today = toISODate(new Date());

  const allDayEvents  = events.filter(ev => !resolveEventTime(ev));
  const timedEvents   = events.filter(ev => !!resolveEventTime(ev));

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

      {/* All-day event row — shown only when there are all-day events this week */}
      {allDayEvents.length > 0 && (
        <div className="cw-allday-row">
          <div className="cw-allday-gutter">all-day</div>
          {weekDates.map(day => {
            const dateStr = toISODate(day);
            const dayAllDay = allDayEvents.filter(ev => ev.date === dateStr);
            return (
              <div key={dateStr} className="cw-allday-cell">
                {dayAllDay.map(ev => {
                  const isNew = ev.id === newEventId;
                  const tentative = ev.status === 'tentative';
                  return (
                    <div
                      key={ev.id}
                      className={'cw-event cw-event-allday' + (isNew ? ' cw-event-new' : '') + (tentative ? ' cw-event-tentative' : '')}
                      style={{ background: ev.color || 'var(--primary)' }}
                      onClick={e => onEventClick(ev, e.currentTarget.getBoundingClientRect())}
                    >
                      <span className="cw-event-title">{ev.title}</span>
                      {tentative && <span className="cw-ai-chip">tentative</span>}
                      {isNew && !tentative && <span className="cw-ai-chip">✦ Added by Charles</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

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

        {weekDates.flatMap((day, colIdx) => {
          const bands = blockBandsForDate(blocks, toISODate(day), day.getDay());
          return bands.map((b, i) => {
            const [sh, sm] = b.start.split(':').map(Number);
            const [eh, em] = b.end.split(':').map(Number);
            const startMin = sh * 60 + sm;
            const endMin = eh * 60 + em;
            return (
              <div
                key={`block-${toISODate(day)}-${i}`}
                className="cw-block-band"
                title={b.name || b.category || 'block'}
                style={{
                  top:    `${minutesToTopPx(startMin)}px`,
                  left:   `calc(56px + ${colIdx} * ((100% - 56px) / 7) + 2px)`,
                  width:  `calc((100% - 56px) / 7 - 4px)`,
                  height: `${minutesToHeightPx(endMin - startMin)}px`,
                }}
              >
                <span className="cw-block-band-label">{b.name || b.category}</span>
              </div>
            );
          });
        })}

        {timedEvents.map(ev => {
          const colIdx = weekDates.findIndex(d => toISODate(d) === ev.date);
          if (colIdx < 0) return null;

          const startStr = resolveEventTime(ev);
          const endStr   = resolveEventEndTime(ev);
          const [sh, sm] = startStr.split(':').map(Number);
          const [eh, em] = endStr ? endStr.split(':').map(Number) : [sh + 1, sm];
          const startMin = sh * 60 + sm;
          const endMin   = eh * 60 + em;

          const isNew = ev.id === newEventId;

          const tentative = ev.status === 'tentative';
          return (
            <div
              key={ev.id}
              className={'cw-event' + (isNew ? ' cw-event-new' : '') + (tentative ? ' cw-event-tentative' : '')}
              style={{
                top:    `${minutesToTopPx(startMin)}px`,
                left:   `calc(56px + ${colIdx} * ((100% - 56px) / 7) + 2px)`,
                width:  `calc((100% - 56px) / 7 - 4px)`,
                height: `${minutesToHeightPx(endMin - startMin)}px`,
                background: ev.color || 'var(--primary)',
              }}
              onClick={e => onEventClick(ev, e.currentTarget.getBoundingClientRect())}
            >
              <span className="cw-event-title">{ev.title}</span>
              {tentative && <span className="cw-ai-chip">tentative</span>}
              {isNew && !tentative && (
                <span className="cw-ai-chip">✦ Added by Charles</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Month Grid ────────────────────────────────────────────────── */
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function MonthGrid({ monthDate, events, onDayClick }) {
  const today = toISODate(new Date());
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startDay = new Date(firstOfMonth);
  startDay.setDate(1 - startDay.getDay());

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(startDay);
    d.setDate(startDay.getDate() + i);
    return d;
  });

  return (
    <div className="cw-month">
      <div className="cw-month-dow-row">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="cw-month-dow">{d}</div>
        ))}
      </div>
      <div className="cw-month-cells">
        {cells.map((d, i) => {
          const dateStr = toISODate(d);
          const isThisMonth = d.getMonth() === month;
          const isToday = dateStr === today;
          const dayEvs = events.filter(e => e.date === dateStr);
          return (
            <div
              key={i}
              className={[
                'cw-month-cell',
                isThisMonth ? '' : 'cw-month-cell-other',
                isToday ? 'cw-month-cell-today' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onDayClick(d)}
            >
              <span className="cw-month-date-num">{d.getDate()}</span>
              <div className="cw-month-event-list">
                {dayEvs.slice(0, 3).map((ev, j) => (
                  <div
                    key={j}
                    className="cw-month-event-pill"
                    style={{ background: ev.color || 'var(--primary)' }}
                  >
                    {ev.title}
                  </div>
                ))}
                {dayEvs.length > 3 && (
                  <div className="cw-month-overflow">+{dayEvs.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Year Grid ─────────────────────────────────────────────────── */
function YearGrid({ year, events, onMonthClick }) {
  const today = toISODate(new Date());
  return (
    <div className="cw-year-grid">
      {Array.from({ length: 12 }, (_, mi) => {
        const firstDay = new Date(year, mi, 1);
        const startDow = firstDay.getDay(); // 0=Sun
        const daysInMonth = new Date(year, mi + 1, 0).getDate();
        const cells = Array.from({ length: startDow + daysInMonth }, (_, i) => i < startDow ? null : i - startDow + 1);
        return (
          <div key={mi} className="cw-year-month" onClick={() => onMonthClick(mi)}>
            <div className="cw-year-month-title">{MONTH_NAMES_SHORT[mi]}</div>
            <div className="cw-year-mini-grid">
              {['S','M','T','W','T','F','S'].map((d, i) => (
                <span key={i} className="cw-year-mini-hdr">{d}</span>
              ))}
              {cells.map((day, i) => {
                if (!day) return <span key={i} />;
                const dateStr = `${year}-${String(mi+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                const isToday = dateStr === today;
                const dayEvents = events.filter(e => e.date === dateStr);
                return (
                  <span key={i} className={'cw-year-mini-day' + (isToday ? ' cw-year-mini-today' : '')}>
                    {day}
                    {dayEvents.length > 0 && <span className="cw-year-mini-dot" />}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── CalendarWindow ─────────────────────────────────────────────── */
export default function CalendarWindow({
  defaultSize = 'fullscreen',
  embedded    = false,
  events      = [],
  blocks      = { recurring: [], dates: {} },
  onEventUpdate,
  onEventDelete,
  onClose,
  userId,
  newEventId: newEventIdProp = null,
}) {
  const { size, setSize } = useCalendarSize(defaultSize);
  const containerRef = useRef(null);
  const headerRef    = useRef(null);

  const [weekOffset,   setWeekOffset]   = useState(0);
  const [popover,      setPopover]      = useState(null);  // { event, rect }  (edit form)
  const [detail,       setDetail]       = useState(null);  // { event }        (read-only view)
  const [newEventId,   setNewEventId]   = useState(null);
  const [localEvents,  setLocalEvents]  = useState(events);
  const [nativeFS,     setNativeFS]     = useState(false);

  const [viewMode, setViewMode] = useState('week');
  const [monthOffset, setMonthOffset] = useState(0);
  const [yearOffset, setYearOffset] = useState(0);

  const monthDate = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + monthOffset, 1);
  }, [monthOffset]);

  const periodLabel = useMemo(() => {
    if (viewMode === 'year') {
      return String(new Date().getFullYear() + yearOffset);
    }
    if (viewMode === 'month') {
      return `${MONTH_NAMES[monthDate.getMonth()]} ${monthDate.getFullYear()}`;
    }
    if (!weekDates.length) return 'Calendar';
    const f = weekDates[0];
    const l = weekDates[6];
    const m1 = f.toLocaleString('en-US', { month: 'short' });
    const m2 = l.toLocaleString('en-US', { month: 'short' });
    return m1 === m2
      ? `${m1} ${f.getDate()}–${l.getDate()}`
      : `${m1} ${f.getDate()} – ${m2} ${l.getDate()}`;
  }, [viewMode, monthDate, weekDates, yearOffset]);

  function handleMonthDayClick(clickedDate) {
    const now = new Date();
    const todaySunday = new Date(now);
    todaySunday.setDate(now.getDate() - now.getDay());
    todaySunday.setHours(0, 0, 0, 0);
    const clickedSunday = new Date(clickedDate);
    clickedSunday.setDate(clickedDate.getDate() - clickedDate.getDay());
    clickedSunday.setHours(0, 0, 0, 0);
    const diffMs = clickedSunday.getTime() - todaySunday.getTime();
    const offset = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
    setWeekOffset(offset);
    setViewMode('week');
  }

  function handleYearMonthClick(monthIndex) {
    const now = new Date();
    const targetYear = now.getFullYear() + yearOffset;
    const targetMonth = monthIndex;
    const nowMonth = now.getMonth();
    const nowYear = now.getFullYear();
    const offset = (targetYear - nowYear) * 12 + (targetMonth - nowMonth);
    setMonthOffset(offset);
    setViewMode('month');
  }

  useEffect(() => { setLocalEvents(events); }, [events]);

  useDraggable(headerRef, containerRef, size);

  const weekDates = getWeekDates(new Date(
    Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000
  ));

  function handleEventClick(ev, rect) {
    setDetail({ event: ev, rect });
  }

  function handleEditFromDetail(ev) {
    const rect = detail?.rect || null;
    setDetail(null);
    setPopover({ event: ev, rect });
  }

  function handleDeleteFromDetail(ev) {
    if (!ev) return;
    setLocalEvents(prev => prev.filter(e => e.id !== ev.id));
    onEventDelete?.(ev);
    setDetail(null);
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

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const flag = (id) => {
      if (!id || cancelled) return;
      setNewEventId(id);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (!cancelled) setNewEventId(null); }, 5000);
    };
    function onNewEvent(e) { flag(e.detail?.id); }
    window.addEventListener('sos:calendar:new-event', onNewEvent);
    if (newEventIdProp) flag(newEventIdProp);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('sos:calendar:new-event', onNewEvent);
    };
  }, [newEventIdProp]);

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
          <span className="cw-title">{isWidget ? 'Calendar' : periodLabel}</span>
          {!isWidget && (
            <>
              <div className="cw-view-toggle">
                <button
                  className={'cw-view-btn' + (viewMode === 'week' ? ' cw-view-btn-active' : '')}
                  onClick={() => setViewMode('week')}
                >Week</button>
                <button
                  className={'cw-view-btn' + (viewMode === 'month' ? ' cw-view-btn-active' : '')}
                  onClick={() => setViewMode('month')}
                >Month</button>
                <button
                  className={'cw-view-btn' + (viewMode === 'year' ? ' cw-view-btn-active' : '')}
                  onClick={() => setViewMode('year')}
                >Year</button>
              </div>
              <div className="cw-nav">
                <button className="cw-nav-btn" onClick={() => {
                  if (viewMode === 'year') setYearOffset(o => o - 1);
                  else if (viewMode === 'month') setMonthOffset(o => o - 1);
                  else setWeekOffset(o => o - 1);
                }}>‹</button>
                <button className="cw-nav-btn" onClick={() => { setWeekOffset(0); setMonthOffset(0); setYearOffset(0); }}>Today</button>
                <button className="cw-nav-btn" onClick={() => {
                  if (viewMode === 'year') setYearOffset(o => o + 1);
                  else if (viewMode === 'month') setMonthOffset(o => o + 1);
                  else setWeekOffset(o => o + 1);
                }}>›</button>
              </div>
            </>
          )}
        </div>

        {/* Body */}
        {isWidget ? (
          <WeekStrip
            weekDates={weekDates}
            events={localEvents}
            onDayClick={() => setSize('half-left')}
          />
        ) : viewMode === 'year' ? (
          <YearGrid
            year={new Date().getFullYear() + yearOffset}
            events={localEvents}
            onMonthClick={handleYearMonthClick}
          />
        ) : viewMode === 'month' ? (
          <MonthGrid
            monthDate={monthDate}
            events={localEvents}
            onDayClick={handleMonthDayClick}
          />
        ) : (
          <WeekGrid
            weekDates={weekDates}
            events={localEvents}
            blocks={blocks}
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

      {detail && (
        <EventDetailModal
          event={detail.event}
          onClose={() => setDetail(null)}
          onEdit={handleEditFromDetail}
          onDelete={onEventDelete ? handleDeleteFromDetail : null}
        />
      )}

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
