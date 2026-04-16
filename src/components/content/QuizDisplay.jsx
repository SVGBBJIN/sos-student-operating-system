import { useState } from 'react';
import Icon from '../../lib/icons';
import ContentCard from './ContentCard';

export default function QuizDisplay({ data, onSave, onDismiss }) {
  const questions = data.questions || [];
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  if (questions.length === 0) {
    return (
      <ContentCard icon={Icon.fileText(16)} title={data.title || 'Quiz'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--orange)">
        <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>No questions generated.</div>
      </ContentCard>
    );
  }

  const q = questions[qIdx];

  function checkAnswer() {
    if (!selected || revealed) return;
    setRevealed(true);
    if (selected === q.answer) setScore(s => s + 1);
  }
  function nextQuestion() {
    if (qIdx < questions.length - 1) { setQIdx(i => i + 1); setSelected(null); setRevealed(false); }
    else setFinished(true);
  }

  return (
    <ContentCard icon={Icon.fileText(16)} title={data.title || 'Quiz'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--orange)">
      {finished ? (
        <div className="quiz-score">
          <div style={{ marginBottom: 8, color: score === questions.length ? 'var(--success)' : score >= questions.length * 0.7 ? 'var(--accent)' : 'var(--text-dim)', display: 'flex', justifyContent: 'center' }}>
            {score === questions.length ? Icon.trophy(32) : score >= questions.length * 0.7 ? Icon.thumbsUp(32) : Icon.bookOpen(32)}
          </div>
          <div>{score} / {questions.length} correct</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', fontWeight: 400, marginTop: 4 }}>
            {score === questions.length ? 'Perfect score!' : score >= questions.length * 0.7 ? 'Nice job!' : 'Keep studying, you got this!'}
          </div>
          <button className="quiz-btn" style={{ marginTop: 12 }} onClick={() => { setQIdx(0); setSelected(null); setRevealed(false); setScore(0); setFinished(false); }}>Try Again</button>
        </div>
      ) : (
        <>
          <div className="quiz-progress">
            <span>{qIdx + 1}/{questions.length}</span>
            <div className="quiz-progress-bar"><div className="quiz-progress-fill" style={{ width: ((qIdx + 1) / questions.length * 100) + '%' }} /></div>
            <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 2 }}>{score} {Icon.check(12)}</span>
          </div>
          <div className="quiz-question">{q?.q || 'No question'}</div>
          <div className="quiz-choices">
            {(q?.choices || []).map((choice, i) => {
              let cls = 'quiz-choice';
              if (revealed && choice === q.answer) cls += ' correct';
              else if (revealed && choice === selected && choice !== q.answer) cls += ' wrong';
              else if (!revealed && choice === selected) cls += ' selected';
              if (revealed && choice === q.answer && choice !== selected) cls += ' reveal-correct';
              return (
                <button key={i} className={cls} onClick={() => { if (!revealed) setSelected(choice); }}>{choice}</button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!revealed && <button className="quiz-btn" onClick={checkAnswer} disabled={!selected}>Check Answer</button>}
            {revealed && <button className="quiz-btn" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={nextQuestion}>{qIdx < questions.length - 1 ? <>Next {Icon.arrowRight(14)}</> : 'See Score'}</button>}
          </div>
        </>
      )}
    </ContentCard>
  );
}
