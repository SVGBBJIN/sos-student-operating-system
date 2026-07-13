import { Onboarding } from 'sos-student-operating-system';

const noop = () => {};

export const FirstRun = () => (
  <div style={{ height: 560, background: '#0f1115', overflow: 'hidden' }}>
    <Onboarding firstName="Alex" onComplete={noop} onSkip={noop} />
  </div>
);
