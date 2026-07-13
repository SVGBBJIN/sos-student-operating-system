import { ScheduleWidget } from 'sos-student-operating-system';

const noop = () => {};
const d = new Date();
const TODAY = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// .schedule-widget is position:absolute with max-height: calc(100% - 220px);
// give it a relative, fixed-height parent so the timeline has room.
export const Today = () => (
  <div style={{ position: 'relative', height: 480, width: 300, background: '#0f1115', color: '#d9e4ff' }}>
    <ScheduleWidget
      solo
      onClose={noop}
      events={[
        { id: 'e1', title: 'Calc 201', date: TODAY, time: '07:30', end_time: '08:45', subject: 'Calculus', event_type: 'class', location: 'Huxley 102' },
        { id: 'e2', title: 'Bio lab', date: TODAY, time: '09:15', end_time: '11:00', subject: 'Biology', event_type: 'lab' },
        { id: 'e3', title: 'Study group', date: TODAY, time: '13:00', end_time: '14:00', subject: 'Calculus' },
        { id: 'e4', title: 'Swim meet', date: TODAY, time: '17:30', end_time: '19:00', event_type: 'match' },
      ]}
      blocks={{ recurring: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '15:30', end: '16:30', name: 'Homework block', category: 'school' }] }}
    />
  </div>
);
