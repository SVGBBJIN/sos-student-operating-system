import React from 'react';

function TutorWorkspace({
  chatPanel,
  onBackToPlanner,
  onOpenSettings,
  onQuickAction,
  onOpenNotes,
  onOpenSchedule,
  onImport,
  messageCount,
  Icon,
}) {
  const actions = [
    'Teach me this',
    'Quiz me',
    'Make flashcards',
    'Explain step by step',
    'Review my notes',
  ];

  return (
    <div className="tutor-workspace">
      <div className="tutor-header">
        <div>
          <div className="tutor-eyebrow">Tutor workspace</div>
          <h1>Study with a dedicated learning coach.</h1>
          <p>Switch out of planner mode and into a focused tutoring flow with guided study actions, notes review, and step-by-step help.</p>
        </div>
        <div className="tutor-header-actions">
          <button className="g-hdr-btn" onClick={onBackToPlanner}>{Icon.chevronLeft(14)} Planner workspace</button>
          <button className="g-hdr-btn" onClick={onOpenSettings}>{Icon.edit(14)} Settings</button>
        </div>
      </div>

      <div className="tutor-hero-grid">
        <section className="tutor-hero-card tutor-hero-primary">
          <div className="tutor-hero-kicker">Tutor tools</div>
          <h2>{messageCount === 0 ? 'Start with a study move.' : 'Keep the learning session going.'}</h2>
          <p>{messageCount === 0 ? 'Choose a study action to begin a tutoring session. Each action nudges the assistant toward teaching, quizzing, reviewing notes, and building study materials.' : 'Use a study tool to steer the conversation without losing the context from your current tutoring session.'}</p>
          <div className="tutor-action-grid">
            {actions.map((action) => (
              <button key={action} className="tutor-action-btn" onClick={() => onQuickAction(action)}>{action}</button>
            ))}
          </div>
        </section>

        <section className="tutor-hero-card">
          <div className="tutor-hero-kicker">Study tools</div>
          <div className="tutor-tool-list">
            <button className="tutor-tool-btn" onClick={onOpenNotes}>
              <span>{Icon.fileText(16)}</span>
              <div><strong>Review notes</strong><span>Open your notes library and pull details into the tutoring session.</span></div>
            </button>
            <button className="tutor-tool-btn" onClick={onOpenSchedule}>
              <span>{Icon.clipboard(16)}</span>
              <div><strong>See study schedule</strong><span>Check deadlines and available time before you dive into a topic.</span></div>
            </button>
            <button className="tutor-tool-btn" onClick={onImport}>
              <span>{Icon.link(16)}</span>
              <div><strong>Import material</strong><span>Bring in docs, PDFs, or calendar context to ground the lesson.</span></div>
            </button>
          </div>
        </section>
      </div>

      <div className="tutor-chat-shell">
        {chatPanel}
      </div>
    </div>
  );
}

export default TutorWorkspace;
