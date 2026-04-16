import { useState, useEffect } from 'react';

export default function ClarificationCard({ clarification, onSubmit, onSkip, savedAnswers, onAnswersChange }) {
  const clarifications = Array.isArray(clarification) ? clarification : [clarification];
  const questionCount = clarifications.length;

  const [currentQIdx, setCurrentQIdx] = useState(0);
  const [answers, setAnswers] = useState(() =>
    savedAnswers && savedAnswers.length === clarifications.length
      ? savedAnswers
      : clarifications.map(() => ({ selected: [], otherText: '' }))
  );

  const clarificationKey = clarifications.map(c => c.question).join('|||');

  useEffect(() => {
    if (!savedAnswers || savedAnswers.length !== clarifications.length) {
      setAnswers(clarifications.map(() => ({ selected: [], otherText: '' })));
    }
    setCurrentQIdx(0);
  }, [clarificationKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function normalizeOption(option, idx) {
    if (typeof option === 'string') return { id: 'opt_' + idx, label: option };
    return {
      id: option?.id || 'opt_' + idx,
      label: option?.label || option?.text || option?.value || ('Option ' + (idx + 1)),
      description: option?.description || '',
      allowOther: !!option?.allowOther,
      metadata: option?.metadata,
    };
  }

  function updateAnswer(qIdx, updater) {
    setAnswers(prev => {
      const next = [...prev];
      next[qIdx] = updater(next[qIdx]);
      if (onAnswersChange) onAnswersChange(next);
      return next;
    });
  }

  function setOtherText(qIdx, text) {
    updateAnswer(qIdx, cur => ({ ...cur, otherText: text }));
  }

  function buildPayloads(answersArr) {
    return clarifications.map((c, i) => {
      const opts = Array.isArray(c?.options) ? c.options.map(normalizeOption) : [];
      return {
        selected: answersArr[i].selected,
        options: opts,
        otherText: answersArr[i].otherText,
        question: c?.question || '',
      };
    });
  }

  function advance(updatedAnswers) {
    const ans = updatedAnswers || answers;
    if (currentQIdx < questionCount - 1) {
      setCurrentQIdx(i => i + 1);
    } else {
      onSubmit(buildPayloads(ans));
    }
  }

  function handleOptionClick(optId, multiSelect) {
    let nextAnswers;
    setAnswers(prev => {
      const next = [...prev];
      const cur = { ...next[currentQIdx] };
      if (!multiSelect) {
        cur.selected = [optId];
      } else {
        cur.selected = cur.selected.includes(optId)
          ? cur.selected.filter(v => v !== optId)
          : [...cur.selected, optId];
      }
      next[currentQIdx] = cur;
      nextAnswers = next;
      if (onAnswersChange) onAnswersChange(next);
      return next;
    });
    if (!multiSelect) {
      setTimeout(() => advance(nextAnswers), 160);
    }
  }

  function handleSkipQuestion() {
    if (currentQIdx < questionCount - 1) {
      setCurrentQIdx(i => i + 1);
    } else {
      onSubmit(buildPayloads(answers));
    }
  }

  function handleClose() {
    if (onSkip) onSkip();
    else onSubmit(buildPayloads(answers));
  }

  const c = clarifications[currentQIdx] || {};
  const options = Array.isArray(c?.options) ? c.options : [];
  const multiSelect = !!c?.multiSelect || !!c?.multi_select;
  const normalizedOptions = options.map(normalizeOption).filter(
    opt => !/^(other|something else|other\.\.\.|\.\.\.)$/i.test(opt.label.trim())
  );
  const answer = answers[currentQIdx] || { selected: [], otherText: '' };
  const currentAnswered = answer.selected.length > 0 || !!answer.otherText.trim();

  return (
    <div style={{
      background:'rgba(22,22,36,0.98)',
      border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:18,
      padding:0,
      maxWidth:440,
      width:'100%',
      boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
      overflow:'hidden',
    }}>
      <div style={{
        padding:'20px 20px 16px',
        display:'flex',
        alignItems:'flex-start',
        gap:12,
      }}>
        <div style={{
          flex:1,
          fontSize:'1.05rem',
          fontWeight:700,
          color:'var(--text)',
          lineHeight:1.4,
          letterSpacing:'-0.2px',
        }}>
          {c?.question || 'Can you clarify?'}
        </div>
        <div style={{display:'flex', alignItems:'center', gap:4, flexShrink:0, marginTop:2}}>
          {questionCount > 1 && (
            <>
              <button
                onClick={() => setCurrentQIdx(i => Math.max(0, i - 1))}
                disabled={currentQIdx === 0}
                style={{
                  background:'none', border:'none', cursor: currentQIdx === 0 ? 'default' : 'pointer',
                  color: currentQIdx === 0 ? 'rgba(255,255,255,0.2)' : 'var(--text-dim)',
                  padding:'2px 4px', fontSize:'1rem', lineHeight:1,
                }}
              >‹</button>
              <span style={{fontSize:'0.78rem', color:'var(--text-dim)', whiteSpace:'nowrap', padding:'0 2px'}}>
                {currentQIdx + 1} of {questionCount}
              </span>
              <button
                onClick={() => advance()}
                disabled={currentQIdx === questionCount - 1 && !currentAnswered}
                style={{
                  background:'none', border:'none',
                  cursor:(currentQIdx === questionCount - 1 && !currentAnswered) ? 'default' : 'pointer',
                  color:(currentQIdx === questionCount - 1 && !currentAnswered) ? 'rgba(255,255,255,0.2)' : 'var(--text-dim)',
                  padding:'2px 4px', fontSize:'1rem', lineHeight:1,
                }}
              >›</button>
            </>
          )}
          <button
            onClick={handleClose}
            style={{
              background:'none', border:'none', cursor:'pointer',
              color:'var(--text-dim)', padding:'2px 6px', fontSize:'1.1rem', lineHeight:1,
              marginLeft:4,
            }}
          >×</button>
        </div>
      </div>

      {normalizedOptions.length > 0 && (
        <div style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          {normalizedOptions.map((opt, i) => {
            const isSelected = answer.selected.includes(opt.id);
            return (
              <div
                key={opt.id}
                onClick={() => handleOptionClick(opt.id, multiSelect)}
                style={{
                  display:'flex', alignItems:'center', gap:14,
                  padding:'14px 20px',
                  borderBottom:'1px solid rgba(255,255,255,0.05)',
                  cursor:'pointer',
                  background: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                  transition:'background .12s',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background='rgba(255,255,255,0.03)'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background='transparent'; }}
              >
                <div style={{
                  width:32, height:32, borderRadius:8, flexShrink:0,
                  background: isSelected ? 'rgba(43,203,186,0.2)' : 'rgba(255,255,255,0.07)',
                  border: isSelected ? '1px solid rgba(43,203,186,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:'0.82rem', fontWeight:700,
                  color: isSelected ? 'var(--teal)' : 'var(--text-dim)',
                  transition:'all .12s',
                }}>
                  {i + 1}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:'0.88rem', color:'var(--text)', fontWeight:500, lineHeight:1.4}}>{opt.label}</div>
                  {opt.description && (
                    <div style={{fontSize:'0.74rem', color:'var(--text-dim)', marginTop:2, lineHeight:1.4}}>{opt.description}</div>
                  )}
                </div>
                {isSelected && (
                  <div style={{color:'var(--teal)', fontSize:'1rem', flexShrink:0}}>›</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{
        display:'flex', alignItems:'center', gap:10,
        padding:'10px 16px 12px',
        borderTop: normalizedOptions.length > 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{color:'var(--text-dim)', flexShrink:0, opacity:0.6, display:'flex', alignItems:'center'}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </div>
        <input
          type="text"
          value={answer.otherText}
          onChange={(e) => setOtherText(currentQIdx, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && currentAnswered) advance(); }}
          placeholder={c?.otherPlaceholder || 'Something else…'}
          style={{
            flex:1,
            background:'transparent',
            border:'none',
            color:'var(--text-dim)',
            fontSize:'0.84rem',
            outline:'none',
            padding:'4px 0',
          }}
        />
        <button
          onClick={handleSkipQuestion}
          style={{
            background:'rgba(255,255,255,0.07)',
            border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:8,
            padding:'6px 14px',
            color:'var(--text-dim)',
            fontSize:'0.82rem',
            fontWeight:600,
            cursor:'pointer',
            flexShrink:0,
            transition:'all .12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background='rgba(255,255,255,0.12)'; e.currentTarget.style.color='var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.07)'; e.currentTarget.style.color='var(--text-dim)'; }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
