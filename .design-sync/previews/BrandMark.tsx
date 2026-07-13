import { BrandMark } from 'sos-student-operating-system';

const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 28, display: 'flex', alignItems: 'center', gap: 32 }}>{children}</div>
);

export const Wordmark = () => (
  <Dark><BrandMark /></Dark>
);

export const Sizes = () => (
  <Dark>
    <BrandMark fontSize={16} />
    <BrandMark fontSize={24} />
    <BrandMark fontSize={40} />
  </Dark>
);
