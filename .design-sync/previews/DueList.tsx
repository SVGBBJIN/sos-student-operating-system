import { DueList } from 'sos-student-operating-system';

const noop = () => {};
const Studio = ({ children, w }: any) => (
  <div className="studio" style={{ display: 'block', height: 'auto', minHeight: 0, background: 'var(--bg)', color: 'var(--fg-1)', padding: 24, maxWidth: w || 460 }}>{children}</div>
);

export const Deadlines = () => (
  <Studio w={420}><DueList /></Studio>
);
