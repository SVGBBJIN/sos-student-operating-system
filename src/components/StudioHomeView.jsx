import React from 'react';
import { StudioIcon } from './StudioIcons';
import {
  Panel, AskBar, QuickActions, UpNext, AgendaList, DueList,
  CourseGrid, ReviewDecks, StatStrip, WeekStrip, WelcomeBox, AddCard,
  SOS_EVENTS, SOS_DEADLINES,
} from './StudioPanels';

function ViewHead({ eyebrow, title, sub, right }) {
  return (
    <div className="view-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="view-title">{title}</h1>
        {sub && <div className="view-sub">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function HomeDash({ user, onAsk, level = 0, onGrow }) {
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();
  const nextEv = SOS_EVENTS.find(e => e.next) || SOS_EVENTS[0];

  if (level <= 0) {
    return (
      <div className="home home-new">
        <WelcomeBox user={user} onAsk={onAsk} onGrow={onGrow} />
      </div>
    );
  }

  const head = (
    <header className="home-head">
      <div className="eyebrow">tue · dec 17</div>
      <h1 className="home-greeting">{greeting}, <span>{user?.name || 'friend'}</span></h1>
      <AskBar onSubmit={onAsk} />
      <QuickActions onPick={onAsk} />
    </header>
  );

  if (level === 1) {
    return (
      <div className="home fade-up">
        {head}
        <StatStrip compact />
        <div className="grow-grid">
          <Panel title="Today" icon="calendar" count={4} action="Calendar">
            <AgendaList events={SOS_EVENTS.slice(0, 4)} />
          </Panel>
          <div className="grow-adds">
            <div className="grow-hint">Add more and your dashboard fills in.</div>
            <AddCard icon="book"  title="Add a course"  sub="track progress + deadlines" onClick={onGrow} />
            <AddCard icon="cards" title="Create a deck"  sub="review with flashcards"     onClick={onGrow} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="home fade-up">
      {head}
      <StatStrip />
      <div className="bento">
        <div className="bento-agenda">
          <Panel title="Today" icon="calendar" count={SOS_EVENTS.length} action="Calendar">
            <AgendaList />
          </Panel>
        </div>
        <div className="bento-upnext">
          <Panel title="Up next" icon="clock">
            <UpNext event={nextEv} />
          </Panel>
        </div>
        <div className="bento-due">
          <Panel title="Due soon" icon="bell" count={SOS_DEADLINES.length}>
            <DueList />
          </Panel>
        </div>
        <div className="bento-courses">
          <Panel title="Courses" icon="book" action="All">
            <CourseGrid />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function CalendarView({ onAsk }) {
  return (
    <div className="view fade-up">
      <ViewHead eyebrow="december 2025" title="Calendar"
        right={<button className="btn-mint" onClick={() => onAsk('Add an event')}><StudioIcon name="plus" size={14} />Add event</button>} />
      <WeekStrip />
      <div className="two-col">
        <Panel title="Tuesday · Dec 17" icon="calendar" count={SOS_EVENTS.length}>
          <AgendaList />
        </Panel>
        <Panel title="Due soon" icon="bell" count={SOS_DEADLINES.length}>
          <DueList />
        </Panel>
      </div>
    </div>
  );
}

function CoursesView() {
  return (
    <div className="view fade-up">
      <ViewHead eyebrow="fall term" title="Courses" sub="4 active · 10 open tasks this week" />
      <Panel pad={false}>
        <CourseGrid />
      </Panel>
      <Panel title="Due soon" icon="bell" count={SOS_DEADLINES.length}>
        <DueList />
      </Panel>
    </div>
  );
}

function ReviewView({ onAsk }) {
  return (
    <div className="view fade-up">
      <ViewHead eyebrow="spaced repetition" title="Review"
        right={<button className="btn-mint" onClick={() => onAsk('Quiz me on what is due today')}><StudioIcon name="play" size={13} />Start session</button>} />
      <div className="review-hero">
        <div>
          <div className="review-big">17</div>
          <div className="review-lbl">cards due across 3 decks</div>
        </div>
        <button className="btn-mint lg" onClick={() => onAsk('Quiz me on what is due today')}>
          <StudioIcon name="play" size={14} />Review all
        </button>
      </div>
      <Panel title="Decks" icon="cards" count={3}>
        <ReviewDecks />
      </Panel>
    </div>
  );
}

const PROOF_SAMPLE = `The themes of memory and time in Faulkner's work is central to understanding his characters. He use a fractured timeline to show how the past intrudes upon the present, and it effects every decision the family makes.`;

function ProofreadView({ onAsk }) {
  const suggestions = [
    { type: 'grammar', from: 'is central', to: 'are central', note: 'subject–verb agreement' },
    { type: 'grammar', from: 'He use', to: 'He uses', note: 'verb form' },
    { type: 'word', from: 'it effects', to: 'it affects', note: 'commonly confused' },
    { type: 'style', from: 'the past intrudes upon the present', to: 'the past intrudes on the present', note: 'tighter phrasing' },
  ];
  return (
    <div className="view fade-up">
      <ViewHead eyebrow="english 110 · essay 2" title="Proofread"
        right={<button className="btn-mint" onClick={() => onAsk('Apply all proofreading fixes')}><StudioIcon name="check" size={14} />Apply all</button>} />
      <div className="two-col proof">
        <Panel title="Your draft" icon="edit">
          <p className="proof-text">{PROOF_SAMPLE}</p>
        </Panel>
        <Panel title="Suggestions" icon="sparkles" count={suggestions.length}>
          <div className="sug-list">
            {suggestions.map((s, i) => (
              <div key={i} className="sug-row" data-type={s.type}>
                <span className="sug-type">{s.type}</span>
                <span className="sug-change"><s className="sug-from">{s.from}</s> → <span className="sug-to">{s.to}</span></span>
                <span className="sug-note">{s.note}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function CenterView({ view, user, onAsk, level, onGrow }) {
  switch (view) {
    case 'calendar':  return <CalendarView onAsk={onAsk} />;
    case 'courses':   return <CoursesView />;
    case 'review':    return <ReviewView onAsk={onAsk} />;
    case 'proofread': return <ProofreadView onAsk={onAsk} />;
    default:          return <HomeDash user={user} onAsk={onAsk} level={level} onGrow={onGrow} />;
  }
}
