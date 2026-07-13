import { FocusSessionWidget } from 'sos-student-operating-system';

const noop = () => {};
const Studio = ({ children }: any) => (
  <div className="studio" style={{ display: 'block', height: 'auto', minHeight: 0, background: 'var(--bg)', color: 'var(--fg-1)', padding: 24, maxWidth: 360 }}>{children}</div>
);

export const Launcher = () => (
  <Studio><FocusSessionWidget onLaunch={noop} /></Studio>
);
