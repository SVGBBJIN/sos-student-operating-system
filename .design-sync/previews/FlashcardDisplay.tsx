import { FlashcardDisplay } from 'sos-student-operating-system';

const noop = () => {};
const Dark = ({ children }: any) => (
  <div style={{ background: '#0f1115', color: '#d9e4ff', padding: 24, maxWidth: 460 }}>{children}</div>
);

export const Deck = () => (
  <Dark>
    <FlashcardDisplay
      data={{
        title: 'Cell Biology — Midterm',
        subject: 'Biology',
        cards: [
          { q: 'What organelle is the site of aerobic respiration?', a: 'The mitochondrion — it produces ATP through oxidative phosphorylation.' },
          { q: 'What is the function of the rough endoplasmic reticulum?', a: 'It synthesizes and folds proteins; its ribosomes give it the "rough" texture.' },
          { q: 'Define osmosis.', a: 'The net movement of water across a semipermeable membrane, from lower to higher solute concentration.' },
        ],
      }}
      onSave={noop}
      onDismiss={noop}
    />
  </Dark>
);
