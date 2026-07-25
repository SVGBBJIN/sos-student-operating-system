import { GenericContentDisplay } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
);

export const Outline = () => (
  <Dark>
    <GenericContentDisplay
      label="Outline"
      accentColor="var(--accent)"
      data={{
        type: 'create_outline',
        title: 'Essay Outline — The Great Gatsby',
        subject: 'English Lit',
        sections: [
          { heading: 'Introduction', points: ['Hook: the green light', 'Thesis: the American Dream as illusion'] },
          { heading: 'Body', points: ['Gatsby vs. Tom', 'Symbolism of the valley of ashes', 'Nick as unreliable narrator'] },
          { heading: 'Conclusion', points: ['Restate thesis', 'Broader significance'] },
        ],
      }}
      onSave={noop}
      onDismiss={noop}
    />
  </Dark>
);
