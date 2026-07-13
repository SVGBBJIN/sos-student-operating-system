import { WorkCheckCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460 }}>{children}</div>
);

export const Check = () => (
  <Dark>
    <WorkCheckCard
      data={{
        content_type: 'argument',
        coverage: { addressed: 2, total: 3 },
        error_class: 'unsupported claims',
        proofread: { round: 1, max: 2 },
        cards: [
          { kind: 'strength', lane: 'argument', text: 'Your thesis is clear and takes a defensible position.' },
          { kind: 'issue', lane: 'argument', hedged: true, text: 'The second paragraph asserts the policy "clearly failed" — can you cite the evidence you had in mind?' },
          { kind: 'issue', lane: 'grammar', text: 'Watch the comma splice in sentence 4 — split it into two sentences.' },
        ],
        needs_rubric_nudge: true,
      }}
      onDismiss={noop}
    />
  </Dark>
);
