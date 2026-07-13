import { WelcomeBox } from 'sos-student-operating-system';

const noop = () => {};
const Studio = ({ children, w }: any) => (
  <div className="studio" style={{ display: 'block', height: 'auto', minHeight: 0, background: 'var(--bg)', color: 'var(--fg-1)', padding: 24, maxWidth: w || 460 }}>{children}</div>
);

export const Welcome = () => (
  <Studio w={560}>
    <WelcomeBox user={{ email: 'alex@school.edu' }} onAsk={noop} onGrow={noop} onSkip={noop} onUploadSyllabus={noop} syllabusBusy={false} />
  </Studio>
);
