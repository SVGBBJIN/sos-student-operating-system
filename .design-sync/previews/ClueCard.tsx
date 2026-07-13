import { ClueCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460 }}>{children}</div>
);

export const Clue = () => (
  <Dark>
    <ClueCard
      data={{
        content_type: 'procedure',
        clue: "You're solving for the derivative of a product. Think about which rule applies when two functions are multiplied together — you don't need to expand first.",
        next_if_stuck: "It's the product rule: (fg)' = f'g + fg'. Identify your f and g first.",
        deep_fallback: { parallel_problem: "Try d/dx[x²·sin(x)] as a warm-up before returning to your problem." },
      }}
      onDismiss={noop}
    />
  </Dark>
);
