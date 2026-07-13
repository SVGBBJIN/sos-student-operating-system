import { StudioHomeView } from 'sos-student-operating-system';

const noop = () => {};

// Default view = the "Home" dash ("Let's set up your week").
export const Home = () => (
  <div className="studio" style={{ height: 600, background: 'var(--bg)', color: 'var(--fg-1)', overflow: 'hidden', padding: 24 }}>
    <StudioHomeView view="home" user={{ email: 'alex@school.edu' }} onAsk={noop} level={1} onGrow={noop} />
  </div>
);
