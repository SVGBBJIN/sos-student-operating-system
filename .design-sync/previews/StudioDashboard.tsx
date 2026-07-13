import { StudioDashboard } from 'sos-student-operating-system';

const noop = () => {};
const d = new Date();
const TODAY = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Full dashboard surface (renders the rich grid when there's real data).
export const Dashboard = () => (
  <div className="studio" style={{ display: 'block', height: 680, background: 'var(--bg)', color: 'var(--fg-1)', overflow: 'hidden', padding: 24 }}>
    <StudioDashboard
      user={{ email: 'alex@school.edu' }}
      tasks={[
        { id: 't1', task_name: 'Calc problem set 7', due_date: TODAY, subject: 'Calculus', status: 'todo' },
        { id: 't2', task_name: 'Read Gatsby ch. 5', due_date: TODAY, subject: 'English', status: 'todo' },
        { id: 't3', task_name: 'Bio lab write-up', due_date: TODAY, subject: 'Biology', status: 'done' },
      ]}
      events={[
        { id: 'e1', title: 'Calc 201', date: TODAY, time: '09:15', end_time: '10:30', subject: 'Calculus', location: 'Huxley 102' },
        { id: 'e2', title: 'Bio lab', date: TODAY, time: '13:00', end_time: '15:00', subject: 'Biology', location: 'Science B' },
        { id: 'e3', title: 'Swim practice', date: TODAY, time: '17:30', end_time: '19:00', subject: 'Athletics' },
      ]}
      onAsk={noop}
      onUploadSyllabus={noop}
      syllabusBusy={false}
      onOpenFocusLauncher={noop}
    />
  </div>
);
