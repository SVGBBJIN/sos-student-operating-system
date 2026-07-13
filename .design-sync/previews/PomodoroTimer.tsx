import { PomodoroTimer } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 340 }}>{children}</div>
);

export const Pomodoro = () => (
  <Dark>
    <PomodoroTimer sessionType="pomodoro" onSessionType={noop} aiTimers={[]} onDismissAiTimer={noop} onClose={noop} />
  </Dark>
);
