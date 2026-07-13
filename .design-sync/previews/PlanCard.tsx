import { PlanCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 480 }}>{children}</div>
);

export const StudyPlan = () => (
  <Dark>
    <PlanCard
      data={{
        title: 'Finals Week — Calculus',
        steps: [
          { title: 'Review lecture notes + flag weak spots', estimated_minutes: 30, date: '2026-07-14', time: '4:00 PM' },
          { title: 'Work through past exam #1', estimated_minutes: 60, date: '2026-07-15', time: '5:00 PM' },
          { title: 'Office hours — bring flagged problems', estimated_minutes: 45, date: '2026-07-16', time: '11:00 AM' },
          { title: 'Final light review + flashcards', estimated_minutes: 30, date: '2026-07-17', time: '7:00 PM' },
        ],
      }}
      onApply={noop}
      onSave={noop}
      onDismiss={noop}
      onStartTask={noop}
      onExportGoogleDocs={noop}
    />
  </Dark>
);
