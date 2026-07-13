import { PlanTemplateSelector } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 520 }}>{children}</div>
);

// Uses the component's built-in PLAN_TEMPLATES (weekly study, exam prep,
// essay, project timeline, research paper). The exam-prep template uses
// Icon.target, which now exists in src/lib/icons.jsx.
export const Templates = () => (
  <Dark>
    <PlanTemplateSelector onSelectTemplate={noop} onCustomPlan={noop} onDismiss={noop} />
  </Dark>
);
