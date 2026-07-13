import { StudioSidebar } from 'sos-student-operating-system';

const noop = () => {};

export const Sidebar = () => (
  <div className="studio" style={{ height: 600, width: 280, background: 'var(--bg)', color: 'var(--fg-1)', overflow: 'hidden' }}>
    <StudioSidebar
      user={{ email: 'alex@school.edu' }}
      savedChats={[
        { id: 'c1', title: 'Finals study plan', savedAt: new Date().toISOString() },
        { id: 'c2', title: 'Bio flashcards', savedAt: new Date(Date.now() - 864e5).toISOString() },
        { id: 'c3', title: 'Essay outline help', savedAt: new Date(Date.now() - 2 * 864e5).toISOString() },
      ]}
      onPick={noop}
      onNew={noop}
      onDelete={noop}
      onAuthAction={noop}
      tasks={[]}
      events={[]}
      notes={[]}
      nextEvent={{ title: 'Calc 201', start: '9:15a' }}
      syncStatus="saved"
    />
  </div>
);
