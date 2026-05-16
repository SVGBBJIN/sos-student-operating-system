import React, { useEffect, useMemo, useRef, useState } from 'react';

/* ── Schedule Widget ───────────────────────────────────────────
   Floating day-schedule card pinned below the FocusWidget on the
   right edge of the chat column. Renders today's events on a
   7am–10pm timeline with a live "now" indicator and scrollable
   body. Mirrors the studio kit ScheduleWidget.
*/

const DAY_START_H = 7;
const DAY_END_H   = 22;
const HOUR_PX     = 38;

function parseHM(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}
function toY(hhmm) {
  const mins = parseHM(hhmm);
  if (mins == null) return 0;
  return ((mins - DAY_START_H * 60) / 60) * HOUR_PX;
}
function fmtRange(a, b) {
  const conv = (s) => {
    if (!s || typeof s !== 'string') return '?';
    const [h, m] = s.split(':').map(Number);
    if (Number.isNaN(h)) return '?';
    const ap = h >= 12 ? 'p' : 'a';
    const hh = ((h + 11) % 12) + 1;
    return m ? `${hh}:${String(m).padStart(2,'0')}${ap}` : `${hh}${ap}`;
  };
  return `${conv(a)} – ${conv(b)}`;
}
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dayLabel() {
  const d = new Date();
  const wk = ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
  const mo = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][d.getMonth()];
  return `${wk} · ${mo} ${d.getDate()}`;
}

function toneForEvent(ev) {
  const t = (ev.type || ev.event_type || '').toLowerCase();
  if (t === 'test' || t === 'exam') return 'danger';
  if (t === 'quiz') return 'warning';
  if (t === 'practice' || t === 'match' || t === 'game' || t === 'meet' || t === 'tournament') return 'mint';
  if (t === 'event') return 'blue';
  return 'idle';
}

function blockBandsForToday(blocks, dateStr) {
  if (!blocks) return [];
  const dow = new Date(dateStr + 'T12:00:00').getDay();
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
  return bands.map(b => {
    const [eh, em] = b.end.split(':').map(Number);
    let nh = eh, nm = em + 30;
    if (nm >= 60) { nh++; nm = 0; }
    return { ...b, end: String(nh).padStart(2, '0') + ':' + String(nm).padStart(2, '0') };
  });
}

export default function ScheduleWidget({ events = [], blocks = null, solo = false, onClose }) {
  const bodyRef = useRef(null);
  const [now, setNow] = useState(nowHHMM());

  useEffect(() => {
    const iv = setInterval(() => setNow(nowHHMM()), 60_000);
    return () => clearInterval(iv);
  }, []);

  const todayKey = todayStr();
  const todayEvents = useMemo(() => {
    const fromEvents = (events || [])
      .filter(e => e.date === todayKey && e.time)
      .map(e => {
        const start = e.time;
        const end = e.end_time || addMinutes(e.time, 60);
        return {
          id: e.id,
          start, end,
          title: e.title || 'event',
          meta: e.subject || (e.location ? e.location : null) || fmtRange(start, end),
          tone: toneForEvent(e),
        };
      });
    const fromBlocks = blockBandsForToday(blocks, todayKey).map((b, i) => ({
      id: `b-${i}-${b.start}`,
      start: b.start, end: b.end,
      title: b.name || 'block',
      meta: b.category || fmtRange(b.start, b.end),
      tone: 'idle',
    }));
    return [...fromEvents, ...fromBlocks].sort((a,b) => (parseHM(a.start) ?? 0) - (parseHM(b.start) ?? 0));
  }, [events, blocks, todayKey]);

  // mark a live event if "now" sits inside
  const nowMins = parseHM(now);
  const liveId = useMemo(() => {
    if (nowMins == null) return null;
    const live = todayEvents.find(e => {
      const s = parseHM(e.start), en = parseHM(e.end);
      return s != null && en != null && nowMins >= s && nowMins < en;
    });
    return live?.id ?? null;
  }, [todayEvents, nowMins]);

  const hours = useMemo(() => {
    const arr = [];
    for (let h = DAY_START_H; h <= DAY_END_H; h++) arr.push(h);
    return arr;
  }, []);
  const nowY = toY(now);
  const totalH = (DAY_END_H - DAY_START_H) * HOUR_PX;

  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTo({ top: Math.max(0, nowY - 80) });
  }, [nowY]);

  return (
    <div className={'schedule-widget' + (solo ? ' solo-top' : '')} role="complementary" aria-label="Today's schedule">
      <div className="sw-head">
        <span className="sw-dot" />
        <span className="sw-label">today · {dayLabel()}</span>
        <span className="sw-count">{todayEvents.length}</span>
        {onClose && (
          <button className="sw-close" onClick={onClose} aria-label="Close schedule">×</button>
        )}
      </div>

      <div className="sw-body" ref={bodyRef}>
        <div className="sw-timeline" style={{ height: totalH + 12 }}>
          {hours.map((h, i) => {
            const ap = h >= 12 ? 'p' : 'a';
            const hh = ((h + 11) % 12) + 1;
            return (
              <div key={h} className="sw-hour" style={{ top: i * HOUR_PX }}>
                <span className="sw-hour-label">{hh}{ap}</span>
                <span className="sw-hour-line" />
              </div>
            );
          })}

          {todayEvents.length === 0 && (
            <div className="sw-empty">no events on the books today</div>
          )}

          {todayEvents.map(ev => {
            const top = toY(ev.start);
            const h   = Math.max(20, toY(ev.end) - top - 2);
            const isLive = ev.id === liveId;
            return (
              <div
                key={ev.id}
                className={'sw-event' + (isLive ? ' live' : '')}
                data-tone={ev.tone || 'idle'}
                style={{ top, height: h }}
                title={`${ev.title} · ${fmtRange(ev.start, ev.end)}`}
              >
                <div className="sw-event-title">{ev.title}</div>
                {h >= 36 && <div className="sw-event-meta">{ev.meta}</div>}
                {isLive && <span className="sw-event-pulse" />}
              </div>
            );
          })}

          {nowMins != null && nowMins >= DAY_START_H * 60 && nowMins <= DAY_END_H * 60 && (
            <div className="sw-now" style={{ top: nowY }}>
              <span className="sw-now-dot" />
              <span className="sw-now-line" />
              <span className="sw-now-time">{now}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function addMinutes(hhmm, mins) {
  const t = parseHM(hhmm);
  if (t == null) return hhmm;
  const nt = Math.min(24 * 60 - 1, t + mins);
  return `${String(Math.floor(nt / 60)).padStart(2,'0')}:${String(nt % 60).padStart(2,'0')}`;
}
