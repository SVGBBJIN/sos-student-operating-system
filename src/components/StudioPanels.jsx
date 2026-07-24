import React from 'react';
import { StudioIcon } from './StudioIcons';

const SOS_EVENTS = [
  { id: 'e1', start: '8:00a',  end: '9:00a',  title: 'Morning routine',  meta: 'breakfast · stretch', tone: 'idle' },
  { id: 'e2', start: '9:00a',  end: '10:30a', title: 'Calc 201',         meta: 'Huxley 102',          tone: 'mint', done: true },
  { id: 'e3', start: '11:00a', end: '12:00p', title: 'Office hours',     meta: 'Prof. Nguyen',        tone: 'blue', next: true },
  { id: 'e4', start: '12:30p', end: '1:30p',  title: 'Lunch + reading',  meta: 'Faulkner · ch. 4',    tone: 'idle' },
  { id: 'e5', start: '2:00p',  end: '3:30p',  title: 'Study group',      meta: 'Library lvl 2',       tone: 'purple' },
  { id: 'e6', start: '4:00p',  end: '4:45p',  title: 'Piano',            meta: '45 min · Chopin',     tone: 'warning' },
  { id: 'e7', start: '6:00p',  end: '7:00p',  title: 'Gym',              meta: 'pull day',            tone: 'idle' },
  { id: 'e8', start: '7:30p',  end: '9:30p',  title: 'Midterm review',   meta: 'calc + linear',       tone: 'danger' },
];

const SOS_DEADLINES = [
  { id: 'd1', title: 'Faulkner essay — draft 2', course: 'English 110', due: 'today · 5:00p', level: 'danger' },
  { id: 'd2', title: 'PSet 4 — derivatives',     course: 'Calc 201',    due: 'tomorrow',       level: 'warning' },
  { id: 'd3', title: 'Lab writeup',              course: 'Physics 101', due: 'fri',            level: 'idle' },
];

const SOS_COURSES = [
  { id: 'c1', name: 'Calc 201',    tone: 'mint',   prog: 0.72, next: 'Midterm · thu', tasks: 3 },
  { id: 'c2', name: 'English 110', tone: 'pink',   prog: 0.45, next: 'Essay due today', tasks: 2 },
  { id: 'c3', name: 'Physics 101', tone: 'warning',prog: 0.60, next: 'Lab · fri', tasks: 1 },
  { id: 'c4', name: 'Linear Alg',  tone: 'blue',   prog: 0.30, next: 'Quiz · mon', tasks: 4 },
];

const SOS_THREADS = [
  { id: 't1', title: 'Calc midterm plan',          meta: 'now' },
  { id: 't2', title: 'Add thursday study group',   meta: '2h' },
  { id: 't3', title: 'Faulkner essay outline',     meta: 'yest' },
  { id: 't4', title: 'Linear algebra cheat sheet', meta: 'mon' },
];

const SOS_DECKS = [
  { id: 'k1', name: 'Derivatives',      course: 'Calc 201',    cards: 24, due: 12 },
  { id: 'k2', name: 'Faulkner themes',  course: 'English 110', cards: 18, due: 5  },
  { id: 'k3', name: 'Kinematics',       course: 'Physics 101', cards: 30, due: 0  },
];

export { SOS_EVENTS, SOS_DEADLINES, SOS_COURSES, SOS_THREADS, SOS_DECKS };

export function Panel({ title, icon, count, action, onAction, children, span, pad = true }) {
  return (
    <section className="panel" style={span ? { gridColumn: `span ${span}` } : undefined}>
      {title && (
        <header className="panel-head">
          {icon && <StudioIcon name={icon} size={14} />}
          <span className="panel-title">{title}</span>
          {count != null && <span className="panel-count">{count}</span>}
          <span style={{ flex: 1 }} />
          {action && (
            <button className="panel-action" onClick={onAction}>
              {action}<StudioIcon name="chevronRight" size={12} />
            </button>
          )}
        </header>
      )}
      <div className={pad ? 'panel-body' : 'panel-body flush'}>{children}</div>
    </section>
  );
}

export function AskBar({ onSubmit, autoFocus }) {
  const [v, setV] = React.useState('');
  const ref = React.useRef(null);
  React.useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  function go() { const q = v.trim(); if (!q) return; setV(''); onSubmit && onSubmit(q); }
  return (
    <div className="ask-bar">
      <span className="ask-spark"><StudioIcon name="sparkles" size={16} /></span>
      <input
        ref={ref}
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
        placeholder="ask sos to plan, add an event, quiz you, or proofread…"
      />
      <button className="ask-send" onClick={go} disabled={!v.trim()} aria-label="Ask">
        <StudioIcon name="arrowUp" size={15} />
      </button>
    </div>
  );
}

const QUICK_ACTIONS = [
  { icon: 'calendar', label: 'Add event',   q: 'Add an event thursday 3pm — calc study group' },
  { icon: 'target',   label: 'Make a plan', q: 'Make me a 5-day plan to study for the calc midterm' },
  { icon: 'cards',    label: 'Quiz me',     q: 'Quiz me on derivatives' },
  { icon: 'edit',     label: 'Proofread',   q: 'Proofread my Faulkner essay intro' },
];

export function QuickActions({ onPick }) {
  return (
    <div className="qa-row">
      {QUICK_ACTIONS.map(it => (
        <button key={it.label} className="qa-chip" onClick={() => onPick && onPick(it.q)}>
          <StudioIcon name={it.icon} size={14} />
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/* One entry point: a single ask box with the quick actions folded in as
   suggestion chips beneath it, instead of a separate text box + pill row. */
export function AskComposer({ onSubmit, suggestions = QUICK_ACTIONS, autoFocus }) {
  const [v, setV] = React.useState('');
  const ref = React.useRef(null);
  React.useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  function go() { const q = v.trim(); if (!q) return; setV(''); onSubmit && onSubmit(q); }
  return (
    <div className="ask-composer">
      <div className="ask-bar">
        <span className="ask-spark"><StudioIcon name="sparkles" size={16} /></span>
        <input
          ref={ref}
          value={v}
          onChange={e => setV(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
          placeholder="ask sos to plan, add an event, quiz you, or proofread…"
        />
        <button className="ask-send" onClick={go} disabled={!v.trim()} aria-label="Ask">
          <StudioIcon name="arrowUp" size={15} />
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="ask-suggestions" role="group" aria-label="Quick actions">
          {suggestions.map(it => (
            <button key={it.label} className="qa-chip" onClick={() => onSubmit && onSubmit(it.q)}>
              <StudioIcon name={it.icon} size={14} />
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function UpNext({ event }) {
  return (
    <div className="upnext">
      <div className="upnext-top">
        <span className="upnext-label"><span className="upnext-dot" />up next · in 47 min</span>
        <span className="upnext-time">{event.start}</span>
      </div>
      <div className="upnext-title">{event.title}</div>
      <div className="upnext-meta">{event.meta} · derivatives review</div>
      <div className="upnext-actions">
        <button className="btn-mint"><StudioIcon name="play" size={13} />Start focus</button>
        <button className="btn-ghost"><StudioIcon name="bell" size={13} />Remind me</button>
      </div>
    </div>
  );
}

export function AgendaList({ events = [] }) {
  return (
    <div className="agenda">
      {events.map(ev => (
        <div key={ev.id} className={'agenda-row' + (ev.next ? ' is-next' : '') + (ev.done ? ' is-done' : '')} data-tone={ev.tone}>
          <span className="agenda-time">{ev.start}</span>
          <span className="agenda-stripe" />
          <span className="agenda-body">
            <span className="agenda-title">{ev.title}</span>
            <span className="agenda-meta">{ev.meta}</span>
          </span>
          {ev.next && <span className="agenda-flag">next</span>}
          {ev.done && <span className="agenda-check"><StudioIcon name="check" size={12} /></span>}
        </div>
      ))}
    </div>
  );
}

export function DueList({ items = [] }) {
  return (
    <div className="due">
      {items.map(d => (
        <div key={d.id} className="due-row" data-level={d.level}>
          <span className="due-mark" />
          <span className="due-body">
            <span className="due-title">{d.title}</span>
            <span className="due-course">{d.course}</span>
          </span>
          <span className="due-when">{d.due}</span>
        </div>
      ))}
    </div>
  );
}

export function CourseGrid({ courses = [] }) {
  return (
    <div className="course-grid">
      {courses.map(c => (
        <button key={c.id} className="course-card" data-tone={c.tone}>
          <div className="course-top">
            <span className="course-name">{c.name}</span>
            <span className="course-pct">{Math.round(c.prog * 100)}%</span>
          </div>
          <div className="course-bar"><span style={{ width: (c.prog * 100) + '%' }} /></div>
          <div className="course-next">{c.tasks} open · {c.next}</div>
        </button>
      ))}
    </div>
  );
}

export function ReviewDecks({ decks = [] }) {
  return (
    <div className="deck-list">
      {decks.map(d => (
        <button key={d.id} className="deck-row">
          <span className="deck-icon"><StudioIcon name="cards" size={16} /></span>
          <span className="deck-body">
            <span className="deck-name">{d.name}</span>
            <span className="deck-course">{d.course} · {d.cards} cards</span>
          </span>
          {d.due > 0
            ? <span className="deck-due">{d.due} due</span>
            : <span className="deck-due done"><StudioIcon name="check" size={12} />clear</span>}
        </button>
      ))}
    </div>
  );
}

export function StatStrip({ compact }) {
  const all = [
    { id: 'progress', icon: 'target',   big: '62%',  label: 'today’s progress', accent: true },
    { id: 'done',     icon: 'check',    big: '4',    label: 'done today' },
    { id: 'events',   icon: 'calendar', big: '8',    label: 'events' },
    { id: 'focused',  icon: 'clock',    big: '2.5h', label: 'focused' },
  ];
  const stats = compact ? all.slice(0, 3) : all;
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

export function WelcomeBox({ user, onAsk, onGrow, onSkip, onUploadSyllabus, syllabusBusy }) {
  const fileRef = React.useRef(null);
  const starts = [
    { icon: 'calendar', t: 'Add your classes',    s: 'build your weekly calendar', q: 'Help me add my classes to my calendar' },
    { icon: 'book',     t: 'Set up a course',      s: 'track work + deadlines',     q: 'Help me set up a course with deadlines' },
    { icon: 'edit',     t: 'Drop in an essay',     s: 'proofread + outline',         q: 'Help me proofread and outline my essay' },
    { icon: 'cards',    t: 'Make a flashcard set', s: 'review what you learn',       q: 'Help me make a flashcard set' },
  ];
  const handleStart = (q) => onAsk ? onAsk(q) : onGrow?.();
  const handleSkip = () => onSkip ? onSkip() : (onGrow ? onGrow() : onAsk?.('Show me around SOS'));
  return (
    <div className="welcome fade-up">
      <div className="welcome-eyebrow"><StudioIcon name="sparkles" size={13} />welcome to sos</div>
      <h1 className="welcome-title">Let's set up your week, <span>{user?.name || 'friend'}</span></h1>
      <p className="welcome-lead">Tell me what's on your plate — a class, a deadline, an essay — and I'll build your day around it. Start with one thing.</p>
      <AskBar onSubmit={onAsk} autoFocus />
      {onUploadSyllabus && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,text/plain,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onUploadSyllabus(f);
            }}
          />
          <button
            key="upload-syllabus"
            className="start-card start-card-highlight"
            disabled={syllabusBusy}
            onClick={() => fileRef.current?.click()}
          >
            <span className="start-ic"><StudioIcon name="upload" size={17} /></span>
            <span className="start-body">
              <span className="start-t">{syllabusBusy ? 'reading your syllabus…' : 'upload a syllabus'}</span>
              <span className="start-s">parse a whole semester in one go — assignments, exams, class schedule</span>
            </span>
            <StudioIcon name="chevronRight" size={13} />
          </button>
        </>
      )}
      <div className="welcome-starts">
        {starts.map(x => (
          <button key={x.t} className="start-card" onClick={() => handleStart(x.q)}>
            <span className="start-ic"><StudioIcon name={x.icon} size={17} /></span>
            <span className="start-body">
              <span className="start-t">{x.t}</span>
              <span className="start-s">{x.s}</span>
            </span>
            <StudioIcon name="chevronRight" size={13} />
          </button>
        ))}
      </div>
      <button className="welcome-skip" onClick={handleSkip}>or take a look around <StudioIcon name="arrowRight" size={13} /></button>
    </div>
  );
}

export function AddCard({ icon, title, sub, onClick }) {
  return (
    <button className="add-card" onClick={onClick}>
      <span className="add-plus"><StudioIcon name="plus" size={16} /></span>
      <span className="add-body">
        <span className="add-t">{title}</span>
        <span className="add-s">{sub}</span>
      </span>
      <span className="add-ic"><StudioIcon name={icon} size={15} /></span>
    </button>
  );
}

export function WeekStrip() {
  const days = [
    { d: 'mon', n: 15, count: 5 }, { d: 'tue', n: 16, count: 8, today: true },
    { d: 'wed', n: 17, count: 6 }, { d: 'thu', n: 18, count: 4 },
    { d: 'fri', n: 19, count: 7 }, { d: 'sat', n: 20, count: 1 }, { d: 'sun', n: 21, count: 0 },
  ];
  return (
    <div className="week-strip">
      {days.map(x => (
        <button key={x.n} className={'week-day' + (x.today ? ' today' : '')}>
          <span className="week-dow">{x.d}</span>
          <span className="week-num">{x.n}</span>
          <span className="week-dots">{Array.from({ length: Math.min(x.count, 4) }).map((_, i) => <i key={i} />)}</span>
        </button>
      ))}
    </div>
  );
}
