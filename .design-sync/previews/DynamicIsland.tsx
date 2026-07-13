import { DynamicIsland } from 'sos-student-operating-system';

const noop = () => {};
const Studio = ({ children }: any) => (
  <div className="studio" style={{ display: 'block', height: 'auto', minHeight: 0, background: 'var(--bg)', color: 'var(--fg-1)', padding: 32 }}>
    <div style={{ display: 'flex', justifyContent: 'center' }}>{children}</div>
  </div>
);

export const FocusRunning = () => (
  <Studio>
    <DynamicIsland
      focusSession={{ status: 'running', title: 'Calc problem set', endsAt: Date.now() + 20 * 60 * 1000 }}
      onFocusContinue={noop}
      onFocusStop={noop}
    />
  </Studio>
);

export const NextEvent = () => (
  <Studio>
    <DynamicIsland nextEvent={{ title: 'Bio lab', start: '1:00 PM' }} />
  </Studio>
);
