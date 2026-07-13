import { HomeScreen } from 'sos-student-operating-system';

const noop = () => {};

export const Home = () => (
  <div style={{ height: 560, overflow: 'hidden' }}>
    <HomeScreen
      prefs={{ background: 'aurora', focus: 'task', message: '' }}
      tasks={[
        { id: 't1', title: 'Calc problem set', due_date: '2026-07-14', subject: 'Calculus', priority: 3 },
        { id: 't2', title: 'Read Gatsby ch. 5', due_date: '2026-07-15', subject: 'English' },
      ]}
      events={[
        { id: 'e1', title: 'Bio lab', event_date: '2026-07-14', start: '1:00 PM' },
      ]}
      onOpenChat={noop}
    />
  </div>
);
