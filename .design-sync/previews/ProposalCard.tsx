import { ProposalCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
);

export const Event = () => (
  <Dark>
    <ProposalCard proposal={{ action_type: 'add_event', summary: 'add your Chem lab to Thursday at 2pm' }} onApprove={noop} onDismiss={noop} />
  </Dark>
);

export const Task = () => (
  <Dark>
    <ProposalCard proposal={{ action_type: 'add_task', summary: 'remind you to submit the FAFSA by Friday' }} onApprove={noop} onDismiss={noop} />
  </Dark>
);
