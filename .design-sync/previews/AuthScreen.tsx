import { AuthScreen } from 'sos-student-operating-system';

const noop = () => {};

// AuthScreen is a full-surface screen; frame it at a realistic size.
export const SignIn = () => (
  <div style={{ height: 560, background: '#0f1115', overflow: 'hidden' }}>
    <AuthScreen onLogin={noop} />
  </div>
);
