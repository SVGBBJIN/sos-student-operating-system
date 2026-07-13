import { ConfirmationCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460 }}>{children}</div>
);

export const AddTask = () => (
  <Dark>
    <ConfirmationCard
      action={{ type: 'add_task', task_name: 'Finish Chapter 7 problem set', subject: 'Calculus', due_date: '2026-07-16', estimated_minutes: 45 }}
      onConfirm={noop}
      onCancel={noop}
    />
  </Dark>
);

export const AddEvent = () => (
  <Dark>
    <ConfirmationCard
      action={{ type: 'add_event', title: 'AP Bio Midterm', date: '2026-07-20', event_type: 'exam', subject: 'Biology', time: '9:00 AM', endTime: '10:30 AM' }}
      onConfirm={noop}
      onCancel={noop}
    />
  </Dark>
);

export const AddBlock = () => (
  <Dark>
    <ConfirmationCard
      action={{ type: 'add_block', activity: 'Swim practice', date: '2026-07-15', start: '6:00 AM', end: '7:30 AM', category: 'sport' }}
      onConfirm={noop}
      onCancel={noop}
    />
  </Dark>
);

export const DeleteTask = () => (
  <Dark>
    <ConfirmationCard
      action={{ type: 'delete_task', title: 'Old reading response' }}
      onConfirm={noop}
      onCancel={noop}
    />
  </Dark>
);

export const Fallback = () => (
  <Dark>
    <ConfirmationCard
      action={{ type: 'add_task', task_name: 'Email Professor Nguyen about extension', subject: 'English', due_date: '2026-07-14', estimated_minutes: 15 }}
      isFallback
      onConfirm={noop}
      onCancel={noop}
    />
  </Dark>
);
