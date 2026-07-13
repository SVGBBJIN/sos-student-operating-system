import { AddCard } from 'sos-student-operating-system';

const noop = () => {};
const Studio = ({ children, w }: any) => (
  <div className="studio" style={{ display: 'block', height: 'auto', minHeight: 0, background: 'var(--bg)', color: 'var(--fg-1)', padding: 24, maxWidth: w || 460 }}>{children}</div>
);

export const Add = () => (
  <Studio w={280}>
    <AddCard icon="plus" title="Add a class" sub="Set up your weekly calendar" onClick={noop} />
  </Studio>
);
