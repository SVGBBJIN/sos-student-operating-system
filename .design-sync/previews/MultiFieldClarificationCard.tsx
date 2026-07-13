import { MultiFieldClarificationCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460 }}>{children}</div>
);

export const AddEventDetails = () => (
  <Dark>
    <MultiFieldClarificationCard
      clarification={{
        context_action: 'add_event',
        question: 'A couple details to lock in your study block',
        known_fields: { title: 'Group study — Calc' },
        missing_fields: ['date', 'time', 'subject'],
        suggested_defaults: { subject: 'Calculus' },
        checklist: [
          { field: 'subject', options: ['Calculus', 'Biology', 'English Lit'] },
        ],
      }}
      onSubmit={noop}
      onSkip={noop}
    />
  </Dark>
);
