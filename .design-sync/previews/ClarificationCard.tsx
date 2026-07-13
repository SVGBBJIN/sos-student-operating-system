import { ClarificationCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460 }}>{children}</div>
);

export const SingleChoice = () => (
  <Dark>
    <ClarificationCard
      clarification={{
        question: 'Which class is this assignment for?',
        options: [
          { id: 'calc', label: 'Calculus', description: 'MWF 9:15am' },
          { id: 'bio', label: 'Biology', description: 'TR 11am' },
          { id: 'eng', label: 'English Lit', description: 'MW 2pm' },
        ],
      }}
      onSubmit={noop}
      onSkip={noop}
    />
  </Dark>
);

export const MultiSelect = () => (
  <Dark>
    <ClarificationCard
      clarification={{
        question: 'Which days do you want to study?',
        multiSelect: true,
        options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      }}
      onSubmit={noop}
      onSkip={noop}
    />
  </Dark>
);
