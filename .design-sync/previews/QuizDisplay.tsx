import { QuizDisplay } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460 }}>{children}</div>
);

export const Quiz = () => (
  <Dark>
    <QuizDisplay
      data={{
        title: 'World War II — Quick Quiz',
        subject: 'History',
        questions: [
          {
            q: 'In which year did World War II end in Europe?',
            choices: ['1943', '1944', '1945', '1946'],
            answer: '1945',
          },
          {
            q: 'What was the codename for the D-Day invasion?',
            choices: ['Operation Torch', 'Operation Overlord', 'Operation Market Garden', 'Operation Husky'],
            answer: 'Operation Overlord',
          },
        ],
      }}
      onSave={noop}
      onDismiss={noop}
    />
  </Dark>
);
