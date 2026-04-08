import React, { useState } from 'react';

/**
 * SocraticButtons — single reusable interaction component for all three modes.
 *
 * Props:
 *   mode         — 'cause-effect' | 'interpretation' | 'study'
 *   socratic     — parsed JSON from AI (for cause-effect): { question, options, correct, hint, analogy }
 *   buttons      — parsed button suggestions (for interpretation): { defend, concede, example }
 *   disabled     — disable all buttons (while AI is responding)
 *   onSelect     — (value, isCorrect?) => void  — called when user picks an option
 *   onHint       — () => void  — hint button click (study/cause-effect)
 *   onAnalogy    — () => void  — analogy button click (cause-effect)
 */
export default function SocraticButtons({ mode, socratic, buttons, disabled, onSelect, onHint, onAnalogy }) {
  const [selected, setSelected]   = useState(null);  // option key, e.g. "A"
  const [showHint, setShowHint]   = useState(false);
  const [showAnalogy, setShowAnalogy] = useState(false);

  function handleSelect(key) {
    if (disabled || selected !== null) return;
    setSelected(key);
    const isCorrect = socratic ? key === socratic.correct : undefined;
    onSelect(key, isCorrect);
  }

  function handleDefend(type, text) {
    if (disabled) return;
    setSelected(type);
    onSelect(text);
  }

  function handleRecall(action) {
    if (disabled) return;
    setSelected(action);
    onSelect(action, action === 'got-it');
  }

  // ── Cause & Effect ─────────────────────────────────────────────────────────
  if (mode === 'cause-effect') {
    if (!socratic) return null;
    const optEntries = Object.entries(socratic.options || {});

    return (
      <div className="sh-socratic-wrap">
        <div className="sh-mc-grid">
          {optEntries.map(([key, text], i) => {
            let btnClass = 'sh-mc-btn';
            if (selected === key) {
              btnClass += key === socratic.correct ? ' correct' : ' wrong';
            }
            return (
              <button
                key={key}
                className={btnClass}
                style={{ '--delay': `${i * 60}ms` }}
                disabled={disabled || selected !== null}
                onClick={() => handleSelect(key)}
              >
                <span className="sh-mc-btn-label">{key}</span>
                {text}
              </button>
            );
          })}
        </div>
        <div className="sh-hint-row">
          {socratic.hint && (
            <button
              className="sh-hint-btn"
              disabled={disabled}
              onClick={() => {
                setShowHint(v => !v);
                if (!showHint) onHint?.();
              }}
            >
              💡 Hint
            </button>
          )}
          {socratic.analogy && (
            <button
              className="sh-hint-btn"
              disabled={disabled}
              onClick={() => {
                setShowAnalogy(v => !v);
                if (!showAnalogy) onAnalogy?.();
              }}
            >
              🔄 Analogy
            </button>
          )}
        </div>
        {showHint && socratic.hint && (
          <div className="sh-hint-text">💡 {socratic.hint}</div>
        )}
        {showAnalogy && socratic.analogy && (
          <div className="sh-hint-text">🔄 {socratic.analogy}</div>
        )}
      </div>
    );
  }

  // ── Interpretation ─────────────────────────────────────────────────────────
  if (mode === 'interpretation') {
    if (!buttons) return null;
    const options = [
      { key: 'defend',  icon: '🗣', label: 'I still think…',       text: buttons.defend  },
      { key: 'concede', icon: '🤔', label: "You're right, but…",    text: buttons.concede },
      { key: 'example', icon: '📖', label: 'Give me an example',    text: buttons.example },
    ].filter(o => o.text);

    return (
      <div className="sh-socratic-wrap">
        <div className="sh-defend-row">
          {options.map((opt, i) => (
            <button
              key={opt.key}
              className="sh-defend-btn"
              style={{ '--delay': `${i * 60}ms` }}
              disabled={disabled || selected !== null}
              onClick={() => handleDefend(opt.key, opt.text)}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Study ──────────────────────────────────────────────────────────────────
  if (mode === 'study') {
    return (
      <div className="sh-socratic-wrap">
        <div className="sh-recall-row">
          <button
            className="sh-recall-btn got-it"
            disabled={disabled || selected !== null}
            onClick={() => handleRecall('got-it')}
          >
            ✓ Got it
          </button>
          <button
            className="sh-recall-btn missed-it"
            disabled={disabled || selected !== null}
            onClick={() => handleRecall('missed-it')}
          >
            ✗ Missed it
          </button>
          <button
            className="sh-recall-btn hint-it"
            disabled={disabled}
            onClick={() => {
              setShowHint(v => !v);
              if (!showHint) onHint?.();
            }}
          >
            💡 Hint
          </button>
        </div>
        {showHint && (
          <div className="sh-hint-text">Asking for a hint…</div>
        )}
      </div>
    );
  }

  return null;
}
