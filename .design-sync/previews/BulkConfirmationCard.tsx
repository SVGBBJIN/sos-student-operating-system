import { BulkConfirmationCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460 }}>{children}</div>
);

export const Batch = () => (
  <Dark>
    <BulkConfirmationCard
      actions={[
        { action: { type: 'add_task', title: 'Read Chapter 8', due: '2026-07-15' } },
        { action: { type: 'add_event', title: 'Study group', date: '2026-07-16' } },
        { action: { type: 'add_block', activity: 'Swim practice', date: '2026-07-15' } },
        { action: { type: 'add_task', title: 'Lab report draft', due: '2026-07-18' } },
        { action: { type: 'delete_event', title: 'Cancelled review session' } },
      ]}
      onConfirmSelected={noop}
      onCancel={noop}
    />
  </Dark>
);
