import { StudyTopBar } from 'sos-student-operating-system';

const noop = () => {};

export const TopBar = () => (
  <div className="studio" style={{ background: 'var(--bg)', color: 'var(--fg-1)', padding: '0 0 24px' }}>
    <StudyTopBar
      user={{ email: 'alex@school.edu' }}
      syncStatus="saved"
      theme="dark"
      onTheme={noop}
      onNewChat={noop}
      onSettings={noop}
      onAuthAction={noop}
      onHome={noop}
      onChat={noop}
      onDashboard={noop}
      homeEnabled
      queueCount={2}
      onToggleNav={noop}
    />
  </div>
);
