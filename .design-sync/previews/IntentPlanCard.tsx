import { IntentPlanCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 480 }}>{children}</div>
);

export const SurviveFinals = () => (
  <Dark>
    <IntentPlanCard
      data={{
        summary: 'A week of steady study blocks and checkpoints to get you through finals.',
        recurring_blocks: [
          { activity: 'Morning review', days: ['Mon', 'Wed', 'Fri'], start: '8:00 AM', end: '9:00 AM' },
          { activity: 'Evening practice problems', days: ['Tue', 'Thu'], start: '7:00 PM', end: '8:30 PM' },
        ],
        milestone_tasks: [
          { task_name: 'Finish Calc practice exam', due_date: '2026-07-16' },
          { task_name: 'Bio flashcards — units 4–6', due_date: '2026-07-18' },
          { task_name: 'English essay final draft', due_date: '2026-07-19' },
        ],
        review_cadence: 3,
      }}
      onApply={noop}
      onApplyWithoutConflicts={noop}
      onDismiss={noop}
      conflicts={[]}
    />
  </Dark>
);
