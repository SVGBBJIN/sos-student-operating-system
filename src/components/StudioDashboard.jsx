import React, { useMemo } from 'react';
import { StudioIcon } from './StudioIcons';
import { Panel, AskBar, QuickActions, WelcomeBox } from './StudioPanels';
import FocusSessionWidget from './FocusSessionWidget';

/* ── helpers ──────────────────────────────────────────────────── */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function parseHM(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}
function fmtClock(hhmm) {
  const mins = parseHM(hhmm);
  if (mins == null) return '';
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? 'p' : 'a';
  h = h % 12; if (h === 0) h = 12;
  return m === 0 ? `${h}:00${ap}` : `${h}:${String(m).padStart(2, '0')}${ap}`;
}
function addMinutes(hhmm, delta) {
  const mins = parseHM(hhmm);
  if (mins == null) return hhmm;
  const t = mins + delta;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function dateEyebrow() {
  const d = new Date();
  const wk = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];
  const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][d.getMonth()];
  return `${wk} · ${mo} ${d.getDate()}`;
}
const TONES = ['mint', 'blue', 'purple', 'warning', 'pink', 'danger'];
function toneFor(key) {
  if (!key) return 'idle';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}
function relativeDue(dueDate) {
  if (!dueDate) return { label: 'no date', level: 'idle' };
  const due = new Date(dueDate);
  const now = new Date();
  const startOfDay = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c; };
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  const time = due.getHours() || due.getMinutes()
    ? ` · ${fmtClock(`${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`)}`
    : '';
  if (days < 0) return { label: 'overdue', level: 'danger' };
  if (days === 0) return { label: `today${time}`, level: 'danger' };
  if (days === 1) return { label: 'tomorrow', level: 'warning' };
  if (days <= 6) return { label: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][due.getDay()], level: 'idle' };
  return { label: `${days}d`, level: 'idle' };
}

/* ── normalized data ──────────────────────────────────────────── */
function useDashboardData(tasks, events) {
  return useMemo(() => {
    const tk = todayKey();
    const now = nowMinutes();

    // Today's events → agenda rows
    const agenda = (events || [])
      .filter(e => e.date === tk && e.time)
      .map(e => {
        const start = e.time;
        const end = e.end_time || addMinutes(start, 60);
        const endMin = parseHM(end);
        return {
          id: e.id ?? `${start}-${e.title}`,
          start, end,
          startMin: parseHM(start),
          title: e.title || 'event',
          meta: e.subject || e.location || '',
          tone: toneFor(e.subject || e.title),
          done: endMin != null && endMin < now,
        };
      })
      .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));

    // Mark the next upcoming event + minutes until it starts
    const upcoming = agenda.find(a => (a.startMin ?? 0) >= now && !a.done) || null;
    if (upcoming) {
      upcoming.next = true;
      upcoming.inMin = Math.max(0, (upcoming.startMin ?? now) - now);
    }

    // Open tasks → due soon (sorted by dueDate)
    const open = (tasks || [])
      .filter(t => t.status !== 'done')
      .map(t => ({
        id: t.id,
        title: t.title || t.task_name || 'task',
        course: t.subject || '',
        ...relativeDue(t.dueDate || t.due_date),
        dueTs: (t.dueDate || t.due_date) ? new Date(t.dueDate || t.due_date).getTime() : Infinity,
      }))
      .sort((a, b) => a.dueTs - b.dueTs);

    // Courses derived from subjects
    const bySubject = new Map();
    (tasks || []).forEach(t => {
      const s = t.subject;
      if (!s) return;
      if (!bySubject.has(s)) bySubject.set(s, { name: s, total: 0, done: 0, nextTitle: null, nextTs: Infinity });
      const c = bySubject.get(s);
      c.total += 1;
      if (t.status === 'done') { c.done += 1; return; }
      // track the soonest-due open task → "next milestone" hint
      const due = t.dueDate || t.due_date;
      const ts = due ? new Date(due).getTime() : Infinity;
      if (ts < c.nextTs) {
        c.nextTs = ts;
        c.nextTitle = t.title || t.task_name || null;
      }
    });
    const courses = [...bySubject.values()]
      .map(c => {
        const next = c.nextTitle
          ? `${c.nextTitle} · ${relativeDue(c.nextTs === Infinity ? null : c.nextTs).label}`
          : null;
        return {
          id: c.name,
          name: c.name,
          tone: toneFor(c.name),
          prog: c.total ? c.done / c.total : 0,
          tasks: c.total - c.done,
          next,
        };
      })
      .sort((a, b) => b.tasks - a.tasks)
      .slice(0, 6);

    // Stats
    const today = new Date().toDateString();
    const completedToday = (tasks || []).filter(t =>
      t.status === 'done' && t.completedAt && new Date(t.completedAt).toDateString() === today
    );
    const doneToday = completedToday.length;
    const totalToday = open.length + doneToday;
    const progress = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;

    // Focused time today — sum focusMinutes across tasks worked today
    const focusedMin = completedToday.reduce((sum, t) => sum + (t.focusMinutes || t.focus_minutes || 0), 0);
    const focused = focusedMin >= 60
      ? `${(focusedMin / 60).toFixed(1)}h`
      : `${focusedMin}m`;

    // Day streak — consecutive calendar days with at least one completed task.
    // Today doesn't break the streak before it's done: counting starts from
    // today if it already has a completion, otherwise from yesterday.
    const doneDates = new Set(
      (tasks || [])
        .filter(t => t.status === 'done' && t.completedAt)
        .map(t => new Date(t.completedAt).toDateString())
    );
    let streakDays = 0;
    if (doneDates.size) {
      const cursor = new Date();
      if (!doneDates.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
      while (doneDates.has(cursor.toDateString())) {
        streakDays++;
        cursor.setDate(cursor.getDate() - 1);
      }
    }

    return { agenda, upcoming, open, courses, doneToday, eventsToday: agenda.length, progress, focused, streakDays };
  }, [tasks, events]);
}

/* ── presentational pieces (data-driven) ──────────────────────── */
function StatStrip({ progress, doneToday, eventsToday, focused, streakDays }) {
  const stats = [
    { id: 'streak', icon: 'flame', big: String(streakDays), label: 'day streak', accent: true },
    { id: 'progress', icon: 'target', big: `${progress}%`, label: "today's progress" },
    { id: 'done', icon: 'check', big: String(doneToday), label: 'done today' },
    { id: 'events', icon: 'calendar', big: String(eventsToday), label: 'events' },
    { id: 'focused', icon: 'clock', big: focused, label: 'focused' },
  ];
  return (
    <div className="stat-strip" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
      {stats.map(s => (
        <div key={s.id} className={'stat' + (s.accent ? ' stat-accent' : '')}>
          <span className="stat-ic"><StudioIcon name={s.icon} size={14} /></span>
          <span className="stat-big">{s.big}</span>
          <span className="stat-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function AgendaList({ events }) {
  if (!events.length) {
    return <div className="dash-empty">nothing scheduled today — ask sos to add an event.</div>;
  }
  return (
    <div className="agenda">
      {events.map(ev => (
        <div key={ev.id} className={'agenda-row' + (ev.next ? ' is-next' : '') + (ev.done ? ' is-done' : '')} data-tone={ev.tone}>
          <span className="agenda-time">{fmtClock(ev.start)}</span>
          <span className="agenda-stripe" />
          <span className="agenda-body">
            <span className="agenda-title">{ev.title}</span>
            {ev.meta && <span className="agenda-meta">{ev.meta}</span>}
          </span>
          {ev.next && <span className="agenda-flag">next</span>}
          {ev.done && <span className="agenda-check"><StudioIcon name="check" size={12} /></span>}
        </div>
      ))}
    </div>
  );
}

function UpNext({ event, onAsk }) {
  if (!event) {
    return <div className="dash-empty">no more events today. nice — go rest or get ahead.</div>;
  }
  const rel = event.inMin != null && event.inMin > 0
    ? ` · in ${event.inMin >= 60 ? `${Math.round(event.inMin / 60)}h` : `${event.inMin} min`}`
    : event.inMin === 0 ? ' · now' : '';
  return (
    <div className="upnext">
      <div className="upnext-top">
        <span className="upnext-label"><span className="upnext-dot" />up next{rel}</span>
        <span className="upnext-time">{fmtClock(event.start)}</span>
      </div>
      <div className="upnext-title">{event.title}</div>
      {event.meta && <div className="upnext-meta">{event.meta}</div>}
      <div className="upnext-actions">
        <button className="btn-mint" onClick={() => onAsk(`Start a focus session for ${event.title}`)}>
          <StudioIcon name="play" size={13} />Start focus
        </button>
        <button className="btn-ghost" onClick={() => onAsk(`Remind me about ${event.title}`)}>
          <StudioIcon name="bell" size={13} />Remind me
        </button>
      </div>
    </div>
  );
}

function DueList({ items }) {
  if (!items.length) {
    return <div className="dash-empty">all caught up — no open deadlines.</div>;
  }
  return (
    <div className="due">
      {items.slice(0, 5).map(d => (
        <div key={d.id} className="due-row" data-level={d.level}>
          <span className="due-mark" />
          <span className="due-body">
            <span className="due-title">{d.title}</span>
            {d.course && <span className="due-course">{d.course}</span>}
          </span>
          <span className="due-when">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function CourseGrid({ courses }) {
  if (!courses.length) {
    return <div className="dash-empty">no courses yet — ask sos to set one up.</div>;
  }
  return (
    <div className="course-grid">
      {courses.map(c => (
        <button key={c.id} className="course-card" data-tone={c.tone}>
          <div className="course-top">
            <span className="course-name">{c.name}</span>
            <span className="course-pct">{Math.round(c.prog * 100)}%</span>
          </div>
          <div className="course-bar"><span style={{ width: (c.prog * 100) + '%' }} /></div>
          <div className="course-next">{c.tasks} open{c.next ? ` · ${c.next}` : ''}</div>
        </button>
      ))}
    </div>
  );
}

/* ── the dashboard ────────────────────────────────────────────── */
export default function StudioDashboard({ user, tasks = [], events = [], onAsk, onUploadSyllabus, syllabusBusy, onOpenFocusLauncher }) {
  const [skipWelcome, setSkipWelcome] = React.useState(() => {
    try {
      return localStorage.getItem(`sos_skip_welcome_${user?.id}`) === '1';
    } catch (_) {
      return false;
    }
  });

  const data = useDashboardData(tasks, events);
  const name = user?.email ? user.email.split('@')[0] : (user?.user_metadata?.full_name || 'friend');

  const hasData = tasks.length > 0 || events.length > 0;
  const isNew = !hasData && !skipWelcome;

  const handleSkipWelcome = () => {
    try {
      localStorage.setItem(`sos_skip_welcome_${user?.id}`, '1');
    } catch (_) {}
    setSkipWelcome(true);
  };

  if (isNew) {
    return (
      <div className="center-scroll">
        <div className="home home-new">
          <WelcomeBox user={{ name }} onAsk={onAsk} onSkip={handleSkipWelcome} onUploadSyllabus={onUploadSyllabus} syllabusBusy={syllabusBusy} />
        </div>
      </div>
    );
  }

  return (
    <div className="center-scroll">
      <div className="home fade-up">
        <header className="home-head">
          <div className="eyebrow">{dateEyebrow()}</div>
          <h1 className="home-greeting">{greeting()}, <span>{name}</span></h1>
          <AskBar onSubmit={onAsk} />
          <QuickActions onPick={onAsk} />
        </header>

        <StatStrip progress={data.progress} doneToday={data.doneToday} eventsToday={data.eventsToday} focused={data.focused} streakDays={data.streakDays} />

        <div className="bento">
          <div className="bento-agenda">
            <Panel title="Today" icon="calendar" count={data.eventsToday}
              action="Calendar" onAction={() => onAsk('Show my full calendar for today')}>
              <AgendaList events={data.agenda} />
            </Panel>
          </div>
          <div className="bento-upnext">
            <Panel title="Up next" icon="clock">
              <UpNext event={data.upcoming} onAsk={onAsk} />
            </Panel>
          </div>
          <div className="bento-focus">
            <Panel title="Focus" icon="zap">
              <FocusSessionWidget onLaunch={onOpenFocusLauncher} />
            </Panel>
          </div>
          <div className="bento-due">
            <Panel title="Due soon" icon="bell" count={data.open.length}>
              <DueList items={data.open} />
            </Panel>
          </div>
          <div className="bento-courses">
            <Panel title="Courses" icon="book"
              action="All" onAction={() => onAsk('Show all my courses and their progress')}>
              <CourseGrid courses={data.courses} />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
