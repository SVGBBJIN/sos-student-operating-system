import React, { useState } from 'react';
import SocraticButtons from './SocraticButtons.jsx';

/**
 * LessonPlayer — full-screen overlay that plays through lesson screens.
 *
 * Props:
 *   lesson      — { id, topic, subject, screens: [...], estimated_minutes }
 *   initialScreen — starting screen index (for resume)
 *   onClose     — () => void
 *   onComplete  — (lessonId, score) => void
 */
export default function LessonPlayer({ lesson, initialScreen = 0, onClose, onComplete }) {
  const [screenIndex, setScreenIndex] = useState(initialScreen);
  const [score, setScore] = useState({ correct: 0, incorrect: 0 });
  const [questionAnswered, setQuestionAnswered] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);

  const screens = lesson.screens || [];
  const screen  = screens[screenIndex];
  const total   = screens.length;
  const pct     = Math.round((screenIndex / total) * 100);
  const isLast  = screenIndex === total - 1;

  if (!screen) return null;

  function next() {
    if (isLast) {
      onComplete?.(lesson.id, score);
    } else {
      setScreenIndex(i => i + 1);
      setQuestionAnswered(false);
      setHintVisible(false);
    }
  }

  function handleQuestionSelect(key, isCorrect) {
    setQuestionAnswered(true);
    if (isCorrect) setScore(s => ({ ...s, correct: s.correct + 1 }));
    else            setScore(s => ({ ...s, incorrect: s.incorrect + 1 }));
  }

  return (
    <div className="sh-lesson-player" style={{ '--sh-accent': getAccent(lesson.mode) }}>
      {/* Top bar */}
      <div className="sh-player-header">
        <button className="sh-player-close" onClick={onClose} title="Close">✕</button>
        <span className="sh-player-title">{lesson.topic}</span>
        <span className="sh-player-progress-text">{screenIndex + 1} / {total}</span>
      </div>
      <div className="sh-player-progress-bar">
        <div className="sh-player-progress-fill" style={{ width: pct + '%' }} />
      </div>

      {/* Screen content */}
      <div className="sh-player-body">
        <div className="sh-player-screen" key={screenIndex}>
          {screen.type === 'concept' && (
            <>
              <div className="sh-player-screen-type">Concept</div>
              <div className="sh-player-concept">{screen.content}</div>
            </>
          )}

          {screen.type === 'example' && (
            <>
              <div className="sh-player-screen-type">Example</div>
              <div className="sh-player-example">{screen.content}</div>
              {screen.annotation && (
                <div className="sh-player-annotation">💡 {screen.annotation}</div>
              )}
            </>
          )}

          {screen.type === 'question' && (
            <>
              <div className="sh-player-screen-type">Question</div>
              <div className="sh-player-question-label">{screen.question}</div>
              <SocraticButtons
                mode="cause-effect"
                socratic={{
                  question: screen.question,
                  options:  screen.options || {},
                  correct:  screen.correct,
                  hint:     screen.hint,
                  analogy:  screen.analogy,
                }}
                disabled={questionAnswered}
                onSelect={handleQuestionSelect}
                onHint={() => setHintVisible(true)}
              />
              {hintVisible && screen.hint && (
                <div className="sh-hint-text">💡 {screen.hint}</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="sh-player-footer">
        <button
          className="sh-player-next"
          disabled={screen.type === 'question' && !questionAnswered}
          onClick={next}
        >
          {isLast ? '✓ Complete' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

function getAccent(mode) {
  if (mode === 'interpretation') return '#a78bfa';
  if (mode === 'study')          return '#34d399';
  return '#f5c842';
}
