import { StudyPackCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 480 }}>{children}</div>
);

export const Pack = () => (
  <Dark>
    <StudyPackCard
      data={{
        title: 'Unit 4 Exam Prep',
        topic: 'Thermodynamics',
        subject: 'Physics',
        summary: [
          'The laws of thermodynamics govern how energy moves and transforms.',
          'The first law is conservation; the second law is the arrow of entropy.',
          'Heat engines convert thermal energy to work, bounded by efficiency limits.',
        ],
        key_concepts: ['First law (energy conservation)', 'Second law (entropy increases)', 'Heat engines & efficiency', 'Enthalpy vs. entropy'],
        flashcards: [
          { q: 'State the first law of thermodynamics.', a: 'Energy cannot be created or destroyed, only transferred.' },
          { q: 'What does entropy measure?', a: 'The disorder or number of accessible microstates of a system.' },
        ],
        quiz: [
          { q: 'Entropy of an isolated system always…', choices: ['decreases', 'increases or stays constant', 'stays constant'], answer: 'increases or stays constant' },
        ],
      }}
      onDismiss={noop}
    />
  </Dark>
);
