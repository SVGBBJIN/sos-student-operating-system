import React, { useState, useEffect } from 'react';
import { FieldInput } from './FieldInput';
import { valueForAssumption, FIELD_LABELS } from '../lib/actionSchemaHelpers';

export function MultiFieldClarificationCard({ clarification, onSubmit, onSkip, savedAnswers, onAnswersChange }) {
  const { context_action, known_fields = {}, missing_fields = [], question, suggested_defaults = {}, checklist = [] } = clarification || {};
  const optionsFor = (field) => {
    const fromChecklist = checklist.find(c => c.field === field)?.options;
    return Array.isArray(fromChecklist) && fromChecklist.length > 0 ? fromChecklist.slice(0, 6) : null;
  };
  const initialValues = () => {
    const init = {};
    if (missing_fields.includes('time')) { init.time = '17:00'; init.endTime = '18:00'; }
    for (const [k, v] of Object.entries(suggested_defaults || {})) {
      if (missing_fields.includes(k) && !(k in init) && v !== undefined && v !== null && v !== '') init[k] = v;
    }
    return init;
  };
  const [fieldValues, setFieldValues] = useState(() =>
    (savedAnswers && typeof savedAnswers === 'object' && !Array.isArray(savedAnswers))
      ? savedAnswers : initialValues()
  );
  const [fieldStatuses, setFieldStatuses] = useState(() => {
    const s = {};
    for (const f of missing_fields) s[f] = 'pending';
    return s;
  });
  const [stepIdx, setStepIdx] = useState(0);
  const ctxKey = `${context_action}|${missing_fields.join(',')}`;
  useEffect(() => {
    if (savedAnswers && typeof savedAnswers === 'object' && !Array.isArray(savedAnswers)) return;
    setFieldValues(initialValues());
    const s = {}; for (const f of missing_fields) s[f] = 'pending'; setFieldStatuses(s);
    setStepIdx(0);
  }, [ctxKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField(name, value, secondary) {
    setFieldValues(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'time' && secondary !== undefined) next.endTime = secondary;
      if (onAnswersChange) onAnswersChange(next);
      return next;
    });
    setFieldStatuses(prev => ({ ...prev, [name]: 'answered' }));
  }

  const totalSteps = missing_fields.length;
  const currentField = missing_fields[stepIdx];
  const currentValue = fieldValues[currentField];
  const currentFilled = currentValue !== undefined && currentValue !== null && String(currentValue).trim().length > 0;
  const isLast = stepIdx === totalSteps - 1;

  function submitAll(values) {
    onSubmit({ context_action, known_fields, field_values: values, statuses: fieldStatuses, multi_field: true });
  }

  function handleNext() {
    if (!currentFilled) return;
    if (isLast) submitAll(fieldValues);
    else setStepIdx(i => i + 1);
  }

  function handleAssume() {
    const v = valueForAssumption(currentField, clarification);
    const next = { ...fieldValues, [currentField]: v == null ? '' : v };
    if (currentField === 'time' && (v == null || v === '')) {
      next.time = '17:00'; next.endTime = '18:00';
    }
    setFieldValues(next);
    setFieldStatuses(prev => ({ ...prev, [currentField]: 'assumed' }));
    if (onAnswersChange) onAnswersChange(next);
    if (isLast) submitAll(next);
    else setStepIdx(i => i + 1);
  }

  const assumeAvailable = (() => {
    const v = valueForAssumption(currentField, clarification);
    return v !== null && v !== undefined;
  })();

  const labelFor = (f) => FIELD_LABELS[f] || f.replace(/_/g, ' ');

  const dots = missing_fields.map((_, i) => {
    const f = missing_fields[i];
    const status = fieldStatuses[f] || 'pending';
    const v = fieldValues[f];
    const filled = v !== undefined && v !== null && String(v).trim().length > 0;
    const active = i === stepIdx;
    let bg = 'rgba(255,255,255,0.12)';
    if (active) bg = 'var(--accent)';
    else if (status === 'assumed') bg = 'rgba(108,99,255,0.45)';
    else if (filled) bg = 'rgba(255,255,255,0.35)';
    return (
      <button key={i} onClick={() => setStepIdx(i)} style={{
        width: active ? 20 : 7, height:7,
        borderRadius:4, border:'none', padding:0, cursor:'pointer',
        background: bg, transition:'width 0.2s, background 0.2s',
      }}/>
    );
  });

  return (
    <div className="sos-clarification-card sos-clarification-card-multi" role="dialog" style={{
      background:'rgba(22,22,36,0.98)', border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:18, padding:0, maxWidth:460, width:'100%',
      boxShadow:'0 8px 32px rgba(0,0,0,0.4)', overflow:'hidden',
    }}>
      {/* Header */}
      <div style={{padding:'18px 20px 10px', display:'flex', alignItems:'flex-start', gap:12}}>
        <div style={{flex:1}}>
          <div style={{fontSize:'0.7rem', color:'var(--text-dim)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4}}>
            {question || 'A few quick details'} · {stepIdx + 1} of {totalSteps}
          </div>
          <div style={{fontSize:'1.05rem', fontWeight:700, color:'var(--text)', lineHeight:1.3}}>
            {labelFor(currentField)}
          </div>
        </div>
        <button onClick={onSkip} style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)', padding:'2px 6px', fontSize:'1.1rem', lineHeight:1}}>×</button>
      </div>

      {/* Known fields summary chips */}
      {Object.keys(known_fields).length > 0 && (
        <div style={{padding:'0 20px 8px', display:'flex', flexWrap:'wrap', gap:5}}>
          {Object.entries(known_fields).map(([k, v]) => (
            <span key={k} style={{
              fontSize:'0.68rem', color:'var(--text-dim)', background:'rgba(255,255,255,0.04)',
              padding:'2px 7px', borderRadius:10, border:'1px solid rgba(255,255,255,0.06)',
            }}>{labelFor(k)}: <span style={{color:'var(--text)'}}>{String(v)}</span></span>
          ))}
        </div>
      )}

      {/* Completed steps summary */}
      {stepIdx > 0 && (
        <div style={{padding:'0 20px 8px', display:'flex', flexWrap:'wrap', gap:5}}>
          {missing_fields.slice(0, stepIdx).map(f => {
            const v = fieldValues[f];
            if (v === undefined || v === null || String(v).trim().length === 0) return null;
            return (
              <button key={f} onClick={() => setStepIdx(missing_fields.indexOf(f))} style={{
                fontSize:'0.68rem', color:'rgba(255,255,255,0.6)', background:'rgba(255,255,255,0.06)',
                padding:'2px 7px', borderRadius:10, border:'1px solid rgba(255,255,255,0.10)',
                cursor:'pointer', fontFamily:'inherit',
              }}>{labelFor(f)}: <span style={{color:'var(--text)'}}>{f === 'time' ? `${v}${fieldValues.endTime ? ' — ' + fieldValues.endTime : ''}` : String(v)}</span> ✎</button>
            );
          })}
        </div>
      )}

      <div style={{padding:'10px 20px 18px', borderTop:'1px solid rgba(255,255,255,0.06)'}}>
        <FieldInput
          field={currentField}
          value={currentValue}
          secondaryValue={currentField === 'time' ? fieldValues.endTime : undefined}
          onChange={(v, secondary) => setField(currentField, v, secondary)}
          options={optionsFor(currentField)}
        />
        {assumeAvailable && (
          <button onClick={handleAssume} style={{
            marginTop:10, background:'transparent', border:'1px dashed rgba(255,255,255,0.18)',
            borderRadius:8, padding:'6px 10px', color:'var(--text-dim)', fontSize:'0.78rem',
            fontWeight:600, cursor:'pointer',
          }}>Let AI decide</button>
        )}
      </div>

      <div style={{display:'flex', alignItems:'center', gap:8, padding:'8px 16px 14px', borderTop:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{display:'flex', alignItems:'center', gap:4, flex:'0 0 auto'}}>
          {dots}
        </div>
        <div style={{flex:1}}/>
        {stepIdx > 0 && (
          <button onClick={() => setStepIdx(i => i - 1)} style={{
            background:'transparent', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'8px 14px', color:'var(--text-dim)', fontSize:'0.84rem', fontWeight:600, cursor:'pointer',
          }}>← Back</button>
        )}
        <button onClick={onSkip} style={{
          background:'transparent', border:'1px solid rgba(255,255,255,0.1)',
          borderRadius:8, padding:'8px 14px', color:'var(--text-dim)', fontSize:'0.84rem', fontWeight:600, cursor:'pointer',
        }}>Skip</button>
        <button onClick={handleNext} disabled={!currentFilled} style={{
          background: currentFilled ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
          border: currentFilled ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
          borderRadius:8, padding:'8px 18px',
          color: currentFilled ? '#fff' : 'rgba(255,255,255,0.3)',
          fontSize:'0.86rem', fontWeight:700, cursor: currentFilled ? 'pointer' : 'default',
        }}>{isLast ? 'Add it →' : 'Next →'}</button>
      </div>
    </div>
  );
}

export function SubjectChipGroup({ subjects, value, otherText, onPick, onOtherText }) {
  const [expanded, setExpanded] = useState(false);
  const list = subjects.filter(s => s.toLowerCase() !== 'other');
  const visible = expanded ? list : list.slice(0, 6);
  const isOther = value === 'other';
  return (
    <div style={{flex:1, display:'flex', flexDirection:'column', gap:6}}>
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {visible.map(s => {
          const selected = String(value || '').toLowerCase() === s.toLowerCase();
          return (
            <button key={s} onClick={() => onPick(s)} style={{
              background: selected ? 'rgba(108,99,255,0.18)' : 'rgba(255,255,255,0.05)',
              border: selected ? '1px solid rgba(108,99,255,0.45)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, padding: '4px 10px', fontSize: '0.76rem', fontWeight: 600,
              color: selected ? 'var(--accent)' : 'var(--text)', cursor: 'pointer',
            }}>{s}</button>
          );
        })}
        {!expanded && list.length > 6 && (
          <button onClick={() => setExpanded(true)} style={{
            background:'transparent', border:'1px dashed rgba(255,255,255,0.18)',
            borderRadius:16, padding:'4px 10px', fontSize:'0.76rem', fontWeight:600,
            color:'var(--text-dim)', cursor:'pointer',
          }}>More…</button>
        )}
        <button onClick={() => onPick('other')} style={{
          background: isOther ? 'rgba(108,99,255,0.18)' : 'rgba(255,255,255,0.05)',
          border: isOther ? '1px solid rgba(108,99,255,0.45)' : '1px dashed rgba(255,255,255,0.18)',
          borderRadius: 16, padding: '4px 10px', fontSize: '0.76rem', fontWeight: 600,
          color: isOther ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer',
        }}>Other</button>
      </div>
      {isOther && (
        <input type="text" value={otherText || ''} onChange={(e) => onOtherText(e.target.value)}
          placeholder="Type the subject"
          style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, color:'var(--text)', fontSize:'0.84rem', padding:'6px 10px', outline:'none'}}/>
      )}
    </div>
  );
}

export function ClarificationCard({ clarification, onSubmit, onSkip, savedAnswers, onAnswersChange }) {
  // Support both single clarification and array of clarifications
  const clarifications = Array.isArray(clarification) ? clarification : [clarification];
  const questionCount = clarifications.length;

  // 'form' = answering all questions at once; 'review' = confirming before submit
  const [phase, setPhase] = useState('form');

  // Per-question state: selected options and free-form text
  const [answers, setAnswers] = useState(() =>
    savedAnswers && savedAnswers.length === clarifications.length
      ? savedAnswers
      : clarifications.map(() => ({ selected: [], otherText: '', dateValue: '', subjectValue: '' }))
  );

  const clarificationKey = clarifications.map(c => c.question).join('|||');

  useEffect(() => {
    if (!savedAnswers || savedAnswers.length !== clarifications.length) {
      setAnswers(clarifications.map(() => ({ selected: [], otherText: '', dateValue: '', subjectValue: '' })));
    }
    setPhase('form');
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

  function toggleOption(qIdx, optId, multiSelect) {
    updateAnswer(qIdx, cur => {
      if (!multiSelect) return { ...cur, selected: [optId] };
      return {
        ...cur,
        selected: cur.selected.includes(optId)
          ? cur.selected.filter(v => v !== optId)
          : [...cur.selected, optId],
      };
    });
  }

  function setOtherText(qIdx, text) {
    updateAnswer(qIdx, cur => ({ ...cur, otherText: text }));
  }
  function setDateValue(qIdx, dateValue) {
    updateAnswer(qIdx, cur => ({ ...cur, dateValue }));
  }
  function setSubjectValue(qIdx, subjectValue) {
    updateAnswer(qIdx, cur => ({ ...cur, subjectValue, otherText: subjectValue === 'other' ? cur.otherText : '' }));
  }

  function buildPayloads(answersArr) {
    return clarifications.map((c, i) => {
      const opts = Array.isArray(c?.options) ? c.options.map(normalizeOption) : [];
      return {
        selected: answersArr[i].selected,
        options: opts,
        otherText: answersArr[i].subjectValue === 'other'
          ? answersArr[i].otherText
          : (answersArr[i].subjectValue || answersArr[i].dateValue || answersArr[i].otherText),
        question: c?.question || '',
      };
    });
  }

  function getAnswerLabel(qIdx) {
    const a = answers[qIdx] || {};
    const c = clarifications[qIdx] || {};
    const opts = Array.isArray(c?.options) ? c.options.map(normalizeOption) : [];
    const selectedLabels = (a.selected || []).map(id => (opts.find(o => o.id === id) || {}).label).filter(Boolean);
    if (selectedLabels.length > 0) return selectedLabels.join(', ');
    if (a.subjectValue && a.subjectValue !== 'other') return a.subjectValue;
    if (a.dateValue) return a.dateValue;
    if (a.otherText && a.otherText.trim()) return a.otherText.trim();
    return null;
  }

  function isAnswered(qIdx) { return !!getAnswerLabel(qIdx); }

  const anyAnswered = answers.some((_, i) => isAnswered(i));
  const allAnswered = answers.every((_, i) => isAnswered(i));

  function handleProceed() {
    if (questionCount === 1) {
      onSubmit(buildPayloads(answers));
    } else {
      setPhase('review');
    }
  }

  function handleSubmitFinal() {
    onSubmit(buildPayloads(answers));
  }

  function handleClose() {
    if (onSkip) onSkip();
  }

  const subjectOptions = ['Mathematics', 'English', 'Biology', 'Chemistry', 'Physics', 'History', 'Language Arts', 'Spanish', 'French', 'Economics', 'Psychology', 'Government', 'Computer Science', 'Calculus', 'Literature', 'Physical Education', 'Other'];

  // ── Review phase ──────────────────────────────────────────────────────────
  if (phase === 'review') {
    return (
      <div className="sos-clarification-card" role="dialog" style={{
        background:'rgba(22,22,36,0.98)', border:'1px solid rgba(255,255,255,0.08)',
        borderRadius:18, padding:0, maxWidth:440, width:'100%',
        boxShadow:'0 8px 32px rgba(0,0,0,0.4)', overflow:'hidden',
      }}>
        <div style={{padding:'18px 20px 12px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontSize:'0.7rem', color:'var(--text-dim)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px'}}>Review your answers</div>
          <button onClick={handleClose} style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)', padding:'2px 6px', fontSize:'1.1rem', lineHeight:1}}>×</button>
        </div>
        <div style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          {clarifications.map((c, i) => {
            const label = getAnswerLabel(i);
            return (
              <div key={i} style={{padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)', display:'flex', alignItems:'flex-start', gap:12}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:'0.75rem', color:'var(--text-dim)', marginBottom:3}}>{c?.question}</div>
                  <div style={{fontSize:'0.9rem', color: label ? 'var(--text)' : 'rgba(255,255,255,0.25)', fontWeight: label ? 600 : 400}}>
                    {label || '(skipped)'}
                  </div>
                </div>
                <button onClick={() => setPhase('form')} style={{
                  background:'none', border:'none', cursor:'pointer',
                  fontSize:'0.72rem', color:'var(--accent)', fontWeight:600, padding:'2px 6px', flexShrink:0, marginTop:1,
                }}>Edit</button>
              </div>
            );
          })}
        </div>
        <div style={{padding:'12px 16px', display:'flex', gap:8}}>
          <button onClick={() => setPhase('form')} style={{
            background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'7px 14px', color:'var(--text-dim)',
            fontSize:'0.82rem', fontWeight:600, cursor:'pointer', flex:1,
          }}>← Back</button>
          <button onClick={handleSubmitFinal} disabled={!anyAnswered} style={{
            background: anyAnswered ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
            border: anyAnswered ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'7px 14px',
            color: anyAnswered ? '#fff' : 'rgba(255,255,255,0.25)',
            fontSize:'0.82rem', fontWeight:700, cursor: anyAnswered ? 'pointer' : 'default', flex:2,
            transition:'all .12s',
          }}>Submit all answers</button>
        </div>
      </div>
    );
  }

  // ── Form phase: all questions at once ────────────────────────────────────
  return (
    <div className="sos-clarification-card" role="dialog" aria-label="A few quick details" style={{
      background:'rgba(22,22,36,0.98)',
      border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:18,
      padding:0,
      maxWidth:440,
      width:'100%',
      boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
      overflow:'hidden',
    }}>
      {/* Header */}
      <div style={{padding:'18px 20px 12px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{fontSize:'1rem', fontWeight:700, color:'var(--text)'}}>
          {questionCount === 1 ? (clarifications[0]?.question || 'Can you clarify?') : 'A few quick details'}
        </div>
        <button onClick={handleClose} style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)', padding:'2px 6px', fontSize:'1.1rem', lineHeight:1}}>×</button>
      </div>

      {/* All questions */}
      <div style={{borderTop:'1px solid rgba(255,255,255,0.06)', maxHeight:400, overflowY:'auto'}}>
        {clarifications.map((c, qIdx) => {
          const options = Array.isArray(c?.options) ? c.options : [];
          const multiSelect = !!c?.multiSelect || !!c?.multi_select;
          const inputType = (c?.inputType || c?.input_type || '').toLowerCase();
          const isDateInput = inputType === 'date' || /date|due|when/i.test(c?.question || '');
          const isSubjectInput = inputType === 'subject' || !!c?.subjectSelect || /subject|class/i.test(c?.question || '');
          const normalizedOpts = options.map(normalizeOption).filter(
            opt => !/^(other|something else|other\.\.\.|\.\.\.)$/i.test(opt.label.trim())
          );
          const answer = answers[qIdx] || { selected: [], otherText: '', dateValue: '', subjectValue: '' };
          const answered = isAnswered(qIdx);

          return (
            <div key={qIdx} style={{
              borderBottom: qIdx < questionCount - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              padding:'14px 20px',
            }}>
              {/* Question label (shown above for multi-question forms) */}
              {questionCount > 1 && (
                <div style={{
                  fontSize:'0.78rem', color: answered ? 'var(--teal)' : 'var(--text-dim)',
                  fontWeight:600, marginBottom:10, display:'flex', alignItems:'center', gap:6,
                }}>
                  {answered && <span style={{fontSize:'0.9rem'}}>✓</span>}
                  {c?.question || `Question ${qIdx + 1}`}
                </div>
              )}

              {/* Option chips */}
              {normalizedOpts.length > 0 && (
                <div style={{display:'flex', flexWrap:'wrap', gap:6, marginBottom: (isDateInput || isSubjectInput || c?.otherPlaceholder) ? 10 : 0}}>
                  {normalizedOpts.slice(0, 6).map(opt => {
                    const isSelected = answer.selected.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        onClick={() => toggleOption(qIdx, opt.id, multiSelect)}
                        style={{
                          background: isSelected ? 'rgba(43,203,186,0.15)' : 'rgba(255,255,255,0.06)',
                          border: isSelected ? '1px solid rgba(43,203,186,0.4)' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius:20, padding:'5px 12px',
                          fontSize:'0.82rem', fontWeight: isSelected ? 700 : 500,
                          color: isSelected ? 'var(--teal)' : 'var(--text-dim)',
                          cursor:'pointer', transition:'all .12s',
                        }}
                      >
                        {isSelected && '✓ '}{opt.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Text / date / subject input */}
              {isSubjectInput ? (
                <SubjectChipGroup
                  subjects={subjectOptions}
                  value={answer.subjectValue}
                  otherText={answer.otherText}
                  onPick={(v) => setSubjectValue(qIdx, v)}
                  onOtherText={(t) => setOtherText(qIdx, t)}
                />
              ) : (
                <input
                  type={isDateInput ? 'date' : 'text'}
                  value={isDateInput ? (answer.dateValue || '') : answer.otherText}
                  onChange={(e) => {
                    if (isDateInput) setDateValue(qIdx, e.target.value);
                    else setOtherText(qIdx, e.target.value);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && allAnswered) handleProceed(); }}
                  placeholder={isDateInput ? 'Select a date' : (c?.otherPlaceholder || (normalizedOpts.length > 0 ? 'Other…' : 'Type your answer…'))}
                  style={{
                    width:'100%', boxSizing:'border-box',
                    background:'rgba(255,255,255,0.04)',
                    border:'1px solid rgba(255,255,255,0.08)',
                    borderRadius:8, color:'var(--text-dim)',
                    fontSize:'0.84rem', outline:'none',
                    padding:'7px 10px', marginTop: normalizedOpts.length > 0 ? 0 : 0,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{padding:'10px 16px 12px', borderTop:'1px solid rgba(255,255,255,0.06)', display:'flex', gap:8}}>
        <button
          onClick={handleProceed}
          disabled={!anyAnswered}
          style={{
            background: anyAnswered ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
            border: anyAnswered ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'7px 16px',
            color: anyAnswered ? '#fff' : 'rgba(255,255,255,0.25)',
            fontSize:'0.82rem', fontWeight:700,
            cursor: anyAnswered ? 'pointer' : 'default',
            flex:2, transition:'all .12s',
          }}
        >
          {questionCount === 1 ? 'Submit' : (allAnswered ? 'Review answers →' : `Continue (${answers.filter((_,i) => isAnswered(i)).length}/${questionCount} answered)`)}
        </button>
        <button
          onClick={handleClose}
          style={{
            background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'7px 14px', color:'var(--text-dim)',
            fontSize:'0.82rem', fontWeight:600, cursor:'pointer', flex:1,
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
