import { AgendaList } from 'sos-student-operating-system';

const Studio = ({ children }: any) => (
  <div className="studio" style={{ display: 'block', height: 'auto', minHeight: 0, background: 'var(--bg)', color: 'var(--fg-1)', padding: 24, maxWidth: 460 }}>{children}</div>
);

// Built-in demo agenda (component ships SOS_EVENTS as the default).
export const Today = () => (
  <Studio><AgendaList /></Studio>
);

export const Custom = () => (
  <Studio>
    <AgendaList
      events={[
        { id: 'e1', start: '8:00a', end: '9:00a', title: 'Morning routine', meta: 'breakfast + stretch', tone: 'mint', done: true },
        { id: 'e2', start: '9:15a', end: '10:30a', title: 'Calc 201', meta: 'Huxley 102', tone: 'blue' },
        { id: 'e3', start: '1:00p', end: '2:00p', title: 'Study group', meta: 'library level 3', tone: 'purple' },
        { id: 'e4', start: '7:30p', end: '8:30p', title: 'Midterm review', meta: 'linear algebra', tone: 'warning' },
      ]}
    />
  </Studio>
);
