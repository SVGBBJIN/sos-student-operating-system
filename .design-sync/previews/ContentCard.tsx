import { ContentCard } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460 }}>{children}</div>
);

export const Summary = () => (
  <Dark>
    <ContentCard title="Photosynthesis — key points" subject="Biology" onSave={noop} onDismiss={noop} accentColor="var(--accent)">
      <div style={{ fontSize: '0.88rem', lineHeight: 1.6, color: 'var(--text)' }}>
        <div>• Light reactions occur in the thylakoid membrane and produce ATP + NADPH.</div>
        <div>• The Calvin cycle fixes CO₂ into glucose using that ATP + NADPH.</div>
        <div>• Chlorophyll absorbs red and blue light, reflecting green.</div>
      </div>
    </ContentCard>
  </Dark>
);
