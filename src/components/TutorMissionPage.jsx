import Icon from '../lib/icons';
import { fmt, daysUntil } from '../lib/dateUtils';
import TutorIndicator from './TutorIndicator';

export default function TutorMissionPage({ tutorMode, tasks, events, notes, onBack, onToggleTutorMode, onPrompt, onOpenNotes, onOpenSchedule, onOpenSettings }) {
  const activeTasks = tasks.filter(t => t.status !== 'done');
  const overdueTasks = activeTasks.filter(t => daysUntil(t.dueDate) < 0);
  const dueSoon = activeTasks.filter(t => { const d = daysUntil(t.dueDate); return d >= 0 && d <= 3; });
  const upcomingEvents = events.filter(e => { const d = daysUntil(e.date); return d >= 0 && d <= 7; });
  const hasNotes = notes.length > 0;
  const primaryFocus = overdueTasks[0] || dueSoon[0] || activeTasks[0] || null;
  const prompts = [
    { label: 'Teach me from my notes', msg: hasNotes ? `Teach me the most important ideas from my notes and quiz me one question at a time.` : 'Help me study a topic step by step and quiz me one question at a time.' },
    { label: 'Build a study sprint', msg: 'Plan a focused 45-minute study sprint for my highest-priority work.' },
    { label: 'Explain this simply', msg: 'Explain this like I am learning it for the first time, then check my understanding with one question.' },
    { label: 'Make flashcards', msg: hasNotes ? 'Make flashcards from my notes for the topic I need most right now.' : 'Make me flashcards for the topic I need to study.' },
  ];
  const integrations = [
    { title: 'Notes-aware tutoring', description: hasNotes ? `Pulls from ${notes.length} saved note${notes.length === 1 ? '' : 's'} so explanations can cite your actual material.` : 'Import notes or PDFs and tutor mode will teach from them instead of starting from scratch.', action: onOpenNotes, cta: hasNotes ? 'Open notes' : 'Add notes', icon: Icon.fileText(16) },
    { title: 'Schedule-aware coaching', description: primaryFocus ? `Your next likely focus is ${primaryFocus.title}${primaryFocus.subject ? ` in ${primaryFocus.subject}` : ''}. Tutor mode can turn that into a plan without losing track of due dates.` : 'Tutor mode can turn explanations into realistic study blocks that fit around your calendar.', action: onOpenSchedule, cta: 'Open schedule', icon: Icon.calendarClock(16) },
    { title: 'One-click study actions', description: 'Jump from tutoring into flashcards, quizzes, plans, and task support without leaving the workspace.', action: onPrompt, cta: 'Start guided help', icon: Icon.sparkles(16), prompt: 'Help me study step by step using tutor mode.' },
  ];

  return (
    <div className="tutor-page">
      <section className="tutor-hero">
        <div className="tutor-hero-copy">
          <div className="tutor-eyebrow">Dedicated tutor workspace</div>
          <h1>Make tutor mode feel like its own page.</h1>
          <p>Tutor mode now has a home base for guided explanations, note-aware studying, and schedule-aware next steps. Turn it on when you want SOS to teach, coach, and keep you moving.</p>
          <div className="tutor-hero-actions">
            <button className="tutor-primary-btn" onClick={() => onToggleTutorMode(!tutorMode)}>{tutorMode ? 'Tutor mode on' : 'Turn tutor mode on'}</button>
            <button className="tutor-secondary-btn" onClick={() => onPrompt(prompts[0].msg)}>Try a guided session</button>
            <button className="tutor-secondary-btn" onClick={onBack}>Back to chat</button>
          </div>
        </div>
        <div className="tutor-hero-card">
          <div className="tutor-hero-card-top">
            <TutorIndicator active={tutorMode} />
            <span>{hasNotes ? 'Notes connected' : 'Bring in notes for better tutoring'}</span>
          </div>
          <div className="tutor-focus-label">Current mission</div>
          <div className="tutor-focus-title">{primaryFocus ? primaryFocus.title : 'Get clear on what to study next'}</div>
          <div className="tutor-focus-meta">
            {primaryFocus
              ? `${primaryFocus.subject || 'General study'} • due ${fmt(primaryFocus.dueDate)}`
              : `${upcomingEvents.length} event${upcomingEvents.length === 1 ? '' : 's'} this week • ${notes.length} note${notes.length === 1 ? '' : 's'} ready`}
          </div>
          <div className="tutor-hero-checklist">
            <div>{tutorMode ? '✓ Guided teaching voice is active' : '• Guided teaching voice is waiting for you to turn it on'}</div>
            <div>{hasNotes ? '✓ Can cite your notes while explaining' : '• Add notes to unlock note-grounded explanations'}</div>
            <div>✓ Can turn help into plans, blocks, flashcards, and quizzes</div>
          </div>
        </div>
      </section>

      <section className="tutor-stats">
        <div className="tutor-stat-card"><span>Active tasks</span><strong>{activeTasks.length}</strong><small>{overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : 'Nothing overdue right now'}</small></div>
        <div className="tutor-stat-card"><span>Due soon</span><strong>{dueSoon.length}</strong><small>Tasks due in the next 3 days</small></div>
        <div className="tutor-stat-card"><span>Study sources</span><strong>{notes.length}</strong><small>{hasNotes ? 'Notes + docs available for reference' : 'Import PDFs or docs to ground answers'}</small></div>
        <div className="tutor-stat-card"><span>This week</span><strong>{upcomingEvents.length}</strong><small>Upcoming events tutor mode can plan around</small></div>
      </section>

      <section className="tutor-section">
        <div className="tutor-section-head">
          <div>
            <div className="tutor-section-eyebrow">Start here</div>
            <h2>Quick tutor workflows</h2>
          </div>
          <button className="tutor-text-btn" onClick={() => onPrompt('Help me study step by step using tutor mode and my current workload.')}>Open in chat</button>
        </div>
        <div className="tutor-prompt-grid">
          {prompts.map(prompt => (
            <button key={prompt.label} className="tutor-prompt-card" onClick={() => onPrompt(prompt.msg)}>
              <div className="tutor-prompt-icon">{Icon.sparkles(15)}</div>
              <div>
                <div className="tutor-prompt-title">{prompt.label}</div>
                <div className="tutor-prompt-copy">{prompt.msg}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="tutor-section">
        <div className="tutor-section-head">
          <div>
            <div className="tutor-section-eyebrow">Integration upgrades</div>
            <h2>Tutor mode is connected to the rest of SOS</h2>
          </div>
          <button className="tutor-text-btn" onClick={onOpenSettings}>Tune settings</button>
        </div>
        <div className="tutor-integration-grid">
          {integrations.map(item => (
            <div key={item.title} className="tutor-integration-card">
              <div className="tutor-integration-icon">{item.icon}</div>
              <div className="tutor-integration-title">{item.title}</div>
              <p>{item.description}</p>
              <button className="tutor-secondary-btn" onClick={() => item.prompt ? item.action(item.prompt) : item.action()}>{item.cta}</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
