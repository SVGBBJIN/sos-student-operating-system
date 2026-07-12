import React, { useState } from 'react';
import Icon from '../lib/icons';
import { fmt } from '../lib/dateUtils';

/* ─── Plan Templates ─── */
export const PLAN_TEMPLATES = [
  {
    id: 'weekly_study', name: 'Weekly Study Plan', iconFn: Icon.calendar,
    description: 'Plan your study sessions for the week',
    skeleton: {
      summary: 'A structured weekly study plan to stay on top of your coursework.',
      steps: [
        { title: 'Review notes from last week', estimated_minutes: 30 },
        { title: 'Read new chapter material', estimated_minutes: 45 },
        { title: 'Practice problems / exercises', estimated_minutes: 40 },
        { title: 'Study group / peer review', estimated_minutes: 30 },
        { title: 'Self-quiz / flashcard review', estimated_minutes: 20 },
      ]
    }
  },
  {
    id: 'exam_prep', name: 'Exam Prep Plan', iconFn: Icon.target,
    description: '3-5 day countdown to exam day',
    skeleton: {
      summary: 'A focused exam preparation plan to maximize your study time.',
      steps: [
        { title: 'Gather all study materials and past notes', estimated_minutes: 20 },
        { title: 'Review key concepts and make a cheat sheet', estimated_minutes: 45 },
        { title: 'Practice with past exams / sample questions', estimated_minutes: 60 },
        { title: 'Focus on weak areas identified from practice', estimated_minutes: 45 },
        { title: 'Final review and light practice', estimated_minutes: 30 },
      ]
    }
  },
  {
    id: 'essay_plan', name: 'Essay Writing Plan', iconFn: Icon.fileText,
    description: 'Research, outline, draft, revise',
    skeleton: {
      summary: 'Step-by-step plan to write a polished essay.',
      steps: [
        { title: 'Research and gather sources', estimated_minutes: 45 },
        { title: 'Create outline with thesis and key points', estimated_minutes: 25 },
        { title: 'Write first draft', estimated_minutes: 60 },
        { title: 'Revise and strengthen arguments', estimated_minutes: 40 },
        { title: 'Final edits and polish', estimated_minutes: 20 },
      ]
    }
  },
  {
    id: 'project_timeline', name: 'Project Timeline', iconFn: Icon.hammer,
    description: 'Break a big project into phases',
    skeleton: {
      summary: 'A phased timeline to complete your project on schedule.',
      steps: [
        { title: 'Define project scope and requirements', estimated_minutes: 30 },
        { title: 'Research and plan approach', estimated_minutes: 45 },
        { title: 'Build / create core deliverables', estimated_minutes: 90 },
        { title: 'Test, review, and iterate', estimated_minutes: 45 },
        { title: 'Polish and submit final version', estimated_minutes: 30 },
      ]
    }
  },
  {
    id: 'research_paper', name: 'Research Paper Plan', iconFn: Icon.search,
    description: 'Literature review through final draft',
    skeleton: {
      summary: 'A structured approach to writing a thorough research paper.',
      steps: [
        { title: 'Choose topic and narrow focus', estimated_minutes: 20 },
        { title: 'Literature review — find and read sources', estimated_minutes: 60 },
        { title: 'Create annotated bibliography', estimated_minutes: 40 },
        { title: 'Write introduction and methodology', estimated_minutes: 45 },
        { title: 'Write body sections and analysis', estimated_minutes: 90 },
        { title: 'Write conclusion and format citations', estimated_minutes: 30 },
      ]
    }
  },
];

export function PlanTemplateSelector({ onSelectTemplate, onCustomPlan, onDismiss }) {
  return (
    <div style={{
      background:'linear-gradient(135deg, rgba(26,26,46,0.98), rgba(15,15,26,0.95))',
      border:'1px solid rgba(108,99,255,0.2)',
      borderRadius:18,
      padding:0,
      maxWidth:480,
      width:'100%',
      boxShadow:'0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(108,99,255,0.08)',
    }}>
      {/* Header */}
      <div style={{
        background:'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(43,203,186,0.1))',
        padding:'16px 20px',
        borderBottom:'1px solid rgba(108,99,255,0.1)',
        display:'flex',
        alignItems:'center',
        gap:10
      }}>
        <div style={{
          width:36, height:36, borderRadius:10,
          background:'linear-gradient(135deg, var(--accent), var(--teal))',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 12px rgba(108,99,255,0.3)'
        }}>
          {Icon.listTree(18)}
        </div>
        <div style={{flex:1}}>
          <div style={{fontWeight:800, fontSize:'1rem', color:'var(--text)', letterSpacing:'-0.3px'}}>Choose a Plan Template</div>
          <div style={{fontSize:'0.72rem', color:'var(--text-dim)', marginTop:1}}>Pick a starting point or create your own</div>
        </div>
        <button onClick={onDismiss} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',padding:4,display:'flex'}}>{Icon.x(14)}</button>
      </div>

      {/* Templates */}
      <div style={{padding:'12px 16px'}}>
        {PLAN_TEMPLATES.map(tmpl => (
          <div key={tmpl.id}
            onClick={() => onSelectTemplate(tmpl)}
            style={{
              display:'flex', alignItems:'center', gap:12,
              padding:'12px 14px',
              marginBottom:6,
              borderRadius:12,
              cursor:'pointer',
              border:'1px solid rgba(255,255,255,0.06)',
              background:'rgba(255,255,255,0.02)',
              transition:'all .15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(108,99,255,0.08)'; e.currentTarget.style.borderColor='rgba(108,99,255,0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.06)'; }}>
            <div style={{
              width:32, height:32, borderRadius:8,
              background:'rgba(108,99,255,0.1)',
              border:'1px solid rgba(108,99,255,0.2)',
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'var(--accent)', flexShrink:0
            }}>
              {tmpl.iconFn(16)}
            </div>
            <div>
              <div style={{fontSize:'0.86rem', fontWeight:600, color:'var(--text)'}}>{tmpl.name}</div>
              <div style={{fontSize:'0.74rem', color:'var(--text-dim)', marginTop:1}}>{tmpl.description}</div>
            </div>
          </div>
        ))}

        {/* Custom Plan option */}
        <div
          onClick={onCustomPlan}
          style={{
            display:'flex', alignItems:'center', gap:12,
            padding:'12px 14px',
            borderRadius:12,
            cursor:'pointer',
            border:'1px solid rgba(43,203,186,0.15)',
            background:'rgba(43,203,186,0.04)',
            transition:'all .15s'
          }}
          onMouseEnter={e => { e.currentTarget.style.background='rgba(43,203,186,0.1)'; e.currentTarget.style.borderColor='rgba(43,203,186,0.3)'; }}
          onMouseLeave={e => { e.currentTarget.style.background='rgba(43,203,186,0.04)'; e.currentTarget.style.borderColor='rgba(43,203,186,0.15)'; }}>
          <div style={{
            width:32, height:32, borderRadius:8,
            background:'rgba(43,203,186,0.1)',
            border:'1px solid rgba(43,203,186,0.2)',
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'var(--teal)', flexShrink:0
          }}>
            {Icon.sparkles(16)}
          </div>
          <div>
            <div style={{fontSize:'0.86rem', fontWeight:600, color:'var(--teal)'}}>Custom Plan</div>
            <div style={{fontSize:'0.74rem', color:'var(--text-dim)', marginTop:1}}>AI generates a unique plan from your description</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PlanCard({ data, onApply, onSave, onDismiss, onStartTask, onExportGoogleDocs, googleConnected }) {
  const [checked, setChecked] = useState(() => (data.steps||[]).map(() => true));
  const [mode, setMode] = useState(data._propose_mode ? 'propose' : 'breakdown');
  const [editSteps, setEditSteps] = useState(() => (data.steps||[]).map(s => ({...s})));
  const [editingIdx, setEditingIdx] = useState(null);
  const [critiqueOpen, setCritiqueOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [docSyncing, setDocSyncing] = useState(false);
  const rawSteps = data.steps || [];
  const steps = mode === 'breakdown' && data._propose_mode ? editSteps : rawSteps;
  const toggle = i => setChecked(prev => prev.map((v,j) => j===i ? !v : v));
  const checkedCount = checked.filter(Boolean).length;

  function updateEditStep(idx, field, value) {
    setEditSteps(prev => prev.map((s, i) => i === idx ? {...s, [field]: value} : s));
  }

  function startTask(i) {
    if (!steps[i]) return;
    setActiveIdx(i);
    if (!checked[i]) toggle(i);
    onStartTask?.(steps[i], i);
  }

  function startNextTask() {
    const nextIdx = steps.findIndex((_, i) => checked[i] && i !== activeIdx);
    if (nextIdx >= 0) startTask(nextIdx);
  }

  async function handleExportDocs() {
    if (!onExportGoogleDocs) return;
    setDocSyncing(true);
    try { await onExportGoogleDocs(data); } finally { setDocSyncing(false); }
  }

  const hasDocId = !!data.googleDocId;

  if (rawSteps.length === 0) {
    return (
      <div style={{background:'rgba(255,107,107,0.06)', border:'1px solid rgba(255,107,107,0.2)', borderRadius:14, padding:'14px 16px', marginBottom:8, maxWidth:480, width:'100%'}}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
          <span style={{color:'var(--danger)', display:'flex'}}>{Icon.zap(14)}</span>
          <span style={{fontWeight:700, fontSize:'0.88rem', color:'var(--text)'}}>Couldn't build a plan</span>
        </div>
        <p style={{fontSize:'0.82rem', color:'var(--text-dim)', margin:'0 0 10px', lineHeight:1.5}}>
          I didn't come back with anything concrete — try again, or be more specific about what you need scheduled.
        </p>
        <button onClick={onDismiss} style={{padding:'8px 14px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'var(--text-dim)', borderRadius:8, fontSize:'0.82rem', cursor:'pointer'}}>
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div style={{
      background:'linear-gradient(135deg, rgba(26,26,46,0.98), rgba(15,15,26,0.95))',
      border:'1px solid rgba(108,99,255,0.2)',
      borderRadius:18,
      padding:0,
      maxWidth:480,
      width:'100%',
      maxHeight:'70vh',
      overflowY:'auto',
      overflowX:'hidden',
      boxShadow:'0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(108,99,255,0.08)',
    }}>
      {/* Header */}
      <div style={{
        background:'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(43,203,186,0.1))',
        padding:'16px 20px',
        borderBottom:'1px solid rgba(108,99,255,0.1)',
        display:'flex',
        alignItems:'center',
        gap:10
      }}>
        <div style={{
          width:36, height:36, borderRadius:10,
          background:'linear-gradient(135deg, var(--accent), var(--teal))',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 12px rgba(108,99,255,0.3)'
        }}>
          {Icon.listTree(18)}
        </div>
        <div style={{flex:1}}>
          <div style={{fontWeight:800, fontSize:'1rem', color:'var(--text)', letterSpacing:'-0.3px'}}>{data.title||'Plan'}</div>
          {data.templateName && (
            <div style={{fontSize:'0.68rem', color:'var(--accent)', marginTop:1, fontWeight:600}}>
              {data.templateName}
            </div>
          )}
        </div>
        <span style={{fontSize:'0.7rem',fontWeight:700,padding:'3px 10px',borderRadius:8,background:'rgba(43,203,186,0.1)',color:'var(--teal)',letterSpacing:'0.5px'}}>{checkedCount}/{steps.length}</span>
        <button onClick={onDismiss} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',padding:4,display:'flex'}}>{Icon.x(14)}</button>
      </div>

      {/* Summary */}
      {data.summary && (
        <div style={{
          padding:'12px 20px',
          background:'rgba(108,99,255,0.04)',
          borderBottom:'1px solid rgba(255,255,255,0.04)',
          fontSize:'0.86rem',
          color:'var(--text)',
          lineHeight:1.5,
          fontWeight:500
        }}>
          {data.summary}
        </div>
      )}

      {/* Propose mode: critique + accept/edit/reject */}
      {mode === 'propose' && (
        <>
          {data._critique && (
            <div style={{padding:'10px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
              <button onClick={() => setCritiqueOpen(o => !o)} style={{
                background:'none', border:'none', cursor:'pointer',
                fontSize:'0.72rem', fontWeight:700, color:'var(--text-dim)',
                display:'flex', alignItems:'center', gap:4, padding:0
              }}>
                {critiqueOpen ? Icon.arrowRight(10) : Icon.arrowRight(10)} AI review {critiqueOpen ? '▲' : '▼'}
              </button>
              {critiqueOpen && (
                <div style={{marginTop:6, fontSize:'0.78rem', color:'var(--text-dim)', lineHeight:1.5, fontStyle:'italic'}}>
                  {data._critique}
                </div>
              )}
            </div>
          )}
          <div style={{padding:'10px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)', display:'flex', gap:6}}>
            <button onClick={() => { onApply(rawSteps); onDismiss?.(); }} style={{
              flex:2, padding:'8px 12px', borderRadius:8, border:'none', fontSize:'0.82rem', fontWeight:700, cursor:'pointer',
              background:'rgba(43,203,186,0.15)', color:'var(--teal)', transition:'all .15s'
            }}>✓ Accept</button>
            <button onClick={() => { setMode('breakdown'); setEditSteps(rawSteps.map(s=>({...s}))); }} style={{
              flex:1, padding:'8px 12px', borderRadius:8, border:'none', fontSize:'0.82rem', fontWeight:700, cursor:'pointer',
              background:'rgba(108,99,255,0.12)', color:'var(--accent)', transition:'all .15s'
            }}>Edit</button>
            <button onClick={() => onDismiss?.()} style={{
              flex:1, padding:'8px 12px', borderRadius:8, border:'none', fontSize:'0.82rem', fontWeight:700, cursor:'pointer',
              background:'rgba(255,255,255,0.05)', color:'var(--text-dim)', transition:'all .15s'
            }}>✕</button>
          </div>
        </>
      )}

      {/* Mode Toggle (not shown in propose mode) */}
      {mode !== 'propose' && (
      <div style={{padding:'10px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)', display:'flex', gap:6}}>
        {data._propose_mode && (
          <button onClick={() => { onApply(editSteps.filter((_,i) => checked[i])); onDismiss?.(); }} style={{
            flex:2, padding:'6px 12px', borderRadius:8, border:'none', fontSize:'0.78rem', fontWeight:700, cursor:'pointer',
            background:'rgba(43,203,186,0.15)', color:'var(--teal)', transition:'all .15s'
          }}>✓ Accept {checkedCount}</button>
        )}
        <button onClick={() => setMode('breakdown')} style={{
          flex:1, padding:'6px 12px', borderRadius:8, border:'none', fontSize:'0.78rem', fontWeight:700, cursor:'pointer',
          background: mode === 'breakdown' ? 'rgba(108,99,255,0.15)' : 'rgba(255,255,255,0.04)',
          color: mode === 'breakdown' ? 'var(--accent)' : 'var(--text-dim)',
          transition:'all .15s'
        }}>Breakdown</button>
        <button onClick={() => setMode('start')} style={{
          flex:1, padding:'6px 12px', borderRadius:8, border:'none', fontSize:'0.78rem', fontWeight:700, cursor:'pointer',
          background: mode === 'start' ? 'rgba(43,203,186,0.15)' : 'rgba(255,255,255,0.04)',
          color: mode === 'start' ? 'var(--teal)' : 'var(--text-dim)',
          transition:'all .15s'
        }}>Start task</button>
      </div>
      )}

      {/* Steps */}
      <div style={{padding:'8px 20px'}}>
        <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8}}>Steps</div>
        {steps.map((step,i) => {
          const isActive = activeIdx === i;
          const isChecked = checked[i];
          return (
            <div key={i}
              onClick={() => mode === 'start' ? startTask(i) : toggle(i)}
              style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'8px 0',
                borderBottom: i < steps.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                cursor:'pointer',
                opacity: isChecked ? 1 : 0.5,
              }}>
              <span style={{
                width:24, height:24, borderRadius:7, flexShrink:0,
                background: isActive ? 'rgba(43,203,186,0.15)' : isChecked ? 'rgba(108,99,255,0.1)' : 'rgba(255,255,255,0.04)',
                border: isActive ? '1.5px solid var(--teal)' : isChecked ? '1.5px solid rgba(108,99,255,0.3)' : '1.5px solid rgba(255,255,255,0.1)',
                color: isActive ? 'var(--teal)' : 'var(--accent)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:'0.72rem', fontWeight:700,
                transition:'all .15s'
              }}>{isActive ? Icon.arrowRight(11) : isChecked ? (i + 1) : Icon.x(10)}</span>
              <div style={{flex:1}} onClick={mode === 'breakdown' && data._propose_mode ? (e) => { e.stopPropagation(); setEditingIdx(editingIdx === i ? null : i); } : undefined}>
                {mode === 'breakdown' && data._propose_mode && editingIdx === i ? (
                  <input
                    autoFocus
                    value={step.title}
                    onChange={e => updateEditStep(i, 'title', e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => setEditingIdx(null)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingIdx(null); }}
                    style={{
                      width:'100%', background:'rgba(108,99,255,0.08)', border:'1px solid rgba(108,99,255,0.3)',
                      borderRadius:6, padding:'3px 7px', fontSize:'0.84rem', color:'var(--text)', outline:'none'
                    }}
                  />
                ) : (
                  <div style={{fontSize:'0.84rem', color:'var(--text)', fontWeight: isActive ? 600 : 400, textDecoration: isChecked ? 'none' : 'line-through'}}>
                    {step.title}
                    {mode === 'breakdown' && data._propose_mode && <span style={{fontSize:'0.65rem', color:'rgba(108,99,255,0.5)', marginLeft:5}}>✎</span>}
                  </div>
                )}
                <div style={{display:'flex', gap:8, marginTop:2}}>
                  {step.date && <span style={{fontSize:'0.72rem', color:'var(--teal)', fontWeight:600}}>{Icon.calendar(10)} {fmt(step.date)}</span>}
                  {step.time && <span style={{fontSize:'0.72rem', color:'var(--text-dim)'}}>{Icon.clock(10)} {step.time}</span>}
                  {step.estimated_minutes && <span style={{fontSize:'0.72rem', color:'var(--text-dim)'}}>{step.estimated_minutes}min</span>}
                </div>
              </div>
              {mode === 'start' && (
                <span style={{
                  fontSize:'0.72rem', fontWeight:700, padding:'3px 10px', borderRadius:6,
                  background: isActive ? 'rgba(43,203,186,0.15)' : 'rgba(108,99,255,0.08)',
                  color: isActive ? 'var(--teal)' : 'var(--accent)',
                }}>{isActive ? 'In progress' : 'Start'}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick Actions Dropdown */}
      <div style={{padding:'10px 20px', borderTop:'1px solid rgba(255,255,255,0.04)', position:'relative'}}>
        <button onClick={() => setActionsOpen(!actionsOpen)} style={{
          width:'100%',
          background:'rgba(108,99,255,0.08)',
          border:'1px solid rgba(108,99,255,0.2)',
          borderRadius:10,
          padding:'10px 14px',
          color:'var(--accent)',
          fontSize:'0.84rem',
          fontWeight:600,
          cursor:'pointer',
          display:'flex',
          alignItems:'center',
          justifyContent:'space-between',
          transition:'all .15s'
        }}>
          <span style={{display:'flex',alignItems:'center',gap:6}}>
            {Icon.zap(14)} Actions
          </span>
          <span style={{
            display:'inline-flex',
            transform: actionsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition:'transform .2s'
          }}>
            {Icon.arrowRight(12)}
          </span>
        </button>
        {actionsOpen && (
          <div style={{
            marginTop:6,
            borderRadius:10,
            overflow:'hidden',
            border:'1px solid rgba(108,99,255,0.15)',
            background:'rgba(15,15,26,0.95)'
          }}>
            {mode === 'breakdown' ? (
              <button onClick={() => { setActionsOpen(false); onApply(steps.filter((_,i) => checked[i])); }} style={{
                width:'100%', background:'transparent', border:'none',
                borderBottom:'1px solid rgba(255,255,255,0.04)',
                padding:'10px 14px', color:'var(--text)', fontSize:'0.82rem', cursor:'pointer', textAlign:'left',
                display:'flex', alignItems:'center', gap:8, transition:'background .15s'
              }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(108,99,255,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <span style={{color:'var(--teal)',display:'flex'}}>{Icon.check(13)}</span>
                Add {checkedCount} as tasks
              </button>
            ) : (
              <button onClick={() => { setActionsOpen(false); startNextTask(); }} style={{
                width:'100%', background:'transparent', border:'none',
                borderBottom:'1px solid rgba(255,255,255,0.04)',
                padding:'10px 14px', color:'var(--text)', fontSize:'0.82rem', cursor:'pointer', textAlign:'left',
                display:'flex', alignItems:'center', gap:8, transition:'background .15s'
              }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(108,99,255,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <span style={{color:'var(--teal)',display:'flex'}}>{Icon.arrowRight(13)}</span>
                Start next task
              </button>
            )}
            <button onClick={() => { setActionsOpen(false); onSave(); }} style={{
              width:'100%', background:'transparent', border:'none',
              borderBottom:'1px solid rgba(255,255,255,0.04)',
              padding:'10px 14px', color:'var(--text)', fontSize:'0.82rem', cursor:'pointer', textAlign:'left',
              display:'flex', alignItems:'center', gap:8, transition:'background .15s'
            }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(108,99,255,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              <span style={{color:'var(--accent)',display:'flex'}}>{Icon.fileText(13)}</span>
              Save to notes
            </button>
            <button onClick={() => { setActionsOpen(false); handleExportDocs(); }} disabled={docSyncing} style={{
              width:'100%', background:'transparent', border:'none',
              padding:'10px 14px', color: googleConnected ? 'var(--text)' : 'var(--text-dim)', fontSize:'0.82rem',
              cursor: docSyncing ? 'wait' : 'pointer', textAlign:'left',
              display:'flex', alignItems:'center', gap:8, transition:'background .15s',
              opacity: docSyncing ? 0.5 : 1
            }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(108,99,255,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              <span style={{color:'var(--accent)',display:'flex'}}>{Icon.externalLink(13)}</span>
              {docSyncing ? 'Syncing...' : hasDocId ? 'Sync to Google Docs' : 'Export to Google Docs'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function detectPlanConflicts(proposedBlocks, existingRecurring) {
  const dayIdx = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
  const toMins = hhmm => { const [h,m] = (hhmm||'00:00').split(':').map(Number); return h*60+m; };
  const overlaps = (as, ae, bs, be) => as < be && bs < ae;
  const conflicts = [];
  for (const proposed of proposedBlocks) {
    const propDays = new Set((proposed.days||[]).map(d => dayIdx[d]));
    const ps = toMins(proposed.start), pe = toMins(proposed.end);
    for (const existing of existingRecurring) {
      const existDays = new Set((existing.days||[]).map(d => (typeof d === 'number' ? d : dayIdx[d])));
      const es = toMins(existing.start), ee = toMins(existing.end);
      if ([...propDays].some(d => existDays.has(d)) && overlaps(ps, pe, es, ee)) {
        conflicts.push({ activity: proposed.activity, conflictsWith: existing.name, time: `${existing.start}–${existing.end}` });
        break;
      }
    }
  }
  return conflicts;
}

export function IntentPlanCard({ data, onApply, onApplyWithoutConflicts, onDismiss, conflicts = [] }) {
  const blocks = data.recurring_blocks || [];
  const tasks = data.milestone_tasks || [];
  const reviewBlock = data.review_cadence?.review_block;
  const totalBlocks = blocks.length + (reviewBlock ? 1 : 0);
  const dayMap = { Monday:'M', Tuesday:'Tu', Wednesday:'W', Thursday:'Th', Friday:'F', Saturday:'Sa', Sunday:'Su' };
  const fmtDays = (days) => (days || []).map(d => dayMap[d] || d).join('/');
  const conflictSet = new Set(conflicts.map(c => c.activity));
  if (totalBlocks === 0 && tasks.length === 0) {
    return (
      <div style={{background:'rgba(255,107,107,0.06)', border:'1px solid rgba(255,107,107,0.2)', borderRadius:14, padding:'14px 16px', marginBottom:8}}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
          <span style={{color:'var(--danger)', display:'flex'}}>{Icon.zap(14)}</span>
          <span style={{fontWeight:700, fontSize:'0.88rem', color:'var(--text)'}}>Couldn't build a plan</span>
        </div>
        <p style={{fontSize:'0.82rem', color:'var(--text-dim)', margin:'0 0 10px', lineHeight:1.5}}>
          I didn't come back with anything concrete — try again, or break the ask into smaller pieces (e.g. "block off study time for calc this week" instead of "plan my week").
        </p>
        <button onClick={onDismiss} style={{padding:'8px 14px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'var(--text-dim)', borderRadius:8, fontSize:'0.82rem', cursor:'pointer'}}>
          Dismiss
        </button>
      </div>
    );
  }
  return (
    <div style={{background:'rgba(108,99,255,0.06)', border:'1px solid rgba(108,99,255,0.18)', borderRadius:14, overflow:'hidden', marginBottom:8}}>
      <div style={{padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
          <span style={{color:'var(--accent)', display:'flex'}}>{Icon.zap(14)}</span>
          <span style={{fontWeight:700, fontSize:'0.88rem', color:'var(--text)'}}>Study Plan</span>
          <span style={{fontSize:'0.72rem', color:'var(--text-dim)', marginLeft:'auto'}}>{totalBlocks} block{totalBlocks!==1?'s':''} · {tasks.length} task{tasks.length!==1?'s':''}</span>
        </div>
        {data.summary && <p style={{fontSize:'0.82rem', color:'var(--text-dim)', margin:0, lineHeight:1.5}}>{data.summary}</p>}
      </div>
      {blocks.length > 0 && (
        <div style={{padding:'8px 16px', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
          <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--accent)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em'}}>Recurring Blocks</div>
          {blocks.map((b, i) => (
            <div key={i} style={{display:'flex', gap:8, fontSize:'0.8rem', color: conflictSet.has(b.activity) ? 'var(--orange)' : 'var(--text)', padding:'3px 0', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
              <span style={{fontWeight:600, flex:1}}>{b.activity}{conflictSet.has(b.activity) ? ' ⚠' : ''}</span>
              <span style={{color:'var(--text-dim)'}}>{fmtDays(b.days)}</span>
              <span style={{color: conflictSet.has(b.activity) ? 'var(--orange)' : 'var(--teal)'}}>{b.start}–{b.end}</span>
            </div>
          ))}
          {reviewBlock && (
            <div style={{display:'flex', gap:8, fontSize:'0.8rem', color:'var(--text)', padding:'3px 0'}}>
              <span style={{fontWeight:600, flex:1}}>{reviewBlock.activity} (review)</span>
              <span style={{color:'var(--text-dim)'}}>{fmtDays(reviewBlock.days)}</span>
              <span style={{color:'var(--teal)'}}>{reviewBlock.start}–{reviewBlock.end}</span>
            </div>
          )}
        </div>
      )}
      {tasks.length > 0 && (
        <div style={{padding:'8px 16px', borderBottom:'1px solid rgba(255,255,255,0.04)', maxHeight:160, overflowY:'auto'}}>
          <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--teal)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em'}}>Milestones</div>
          {tasks.slice(0,10).map((t, i) => (
            <div key={i} style={{display:'flex', gap:8, fontSize:'0.8rem', color:'var(--text)', padding:'2px 0'}}>
              <span style={{flex:1}}>{t.task_name}</span>
              {t.due_date && <span style={{color:'var(--text-dim)', fontSize:'0.73rem'}}>{t.due_date}</span>}
            </div>
          ))}
          {tasks.length > 10 && <div style={{fontSize:'0.72rem', color:'var(--text-dim)', marginTop:2}}>+{tasks.length-10} more…</div>}
        </div>
      )}
      {conflicts.length > 0 && (
        <div style={{padding:'8px 16px', borderBottom:'1px solid rgba(255,255,255,0.04)', background:'rgba(255,140,0,0.06)'}}>
          <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--orange)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em'}}>
            {conflicts.length} scheduling conflict{conflicts.length!==1?'s':''} detected
          </div>
          {conflicts.map((c, i) => (
            <div key={i} style={{fontSize:'0.78rem', color:'var(--text-dim)', padding:'2px 0'}}>
              "{c.activity}" overlaps with "{c.conflictsWith}" ({c.time})
            </div>
          ))}
        </div>
      )}
      <div style={{display:'flex', gap:8, padding:'10px 16px', flexWrap:'wrap'}}>
        {conflicts.length === 0 ? (
          <button onClick={() => onApply(data)} style={{flex:1, background:'rgba(43,203,186,0.15)', border:'1px solid rgba(43,203,186,0.3)', color:'var(--teal)', borderRadius:8, padding:'8px 0', fontSize:'0.82rem', fontWeight:700, cursor:'pointer'}}>
            Apply Plan
          </button>
        ) : (
          <>
            <button onClick={() => onApply(data)} style={{flex:1, background:'rgba(43,203,186,0.12)', border:'1px solid rgba(43,203,186,0.25)', color:'var(--teal)', borderRadius:8, padding:'8px 0', fontSize:'0.82rem', fontWeight:600, cursor:'pointer'}}>
              Apply Anyway
            </button>
            <button onClick={() => onApplyWithoutConflicts(data)} style={{flex:1, background:'rgba(43,203,186,0.18)', border:'1px solid rgba(43,203,186,0.4)', color:'var(--teal)', borderRadius:8, padding:'8px 0', fontSize:'0.82rem', fontWeight:700, cursor:'pointer'}}>
              Skip Conflicts
            </button>
          </>
        )}
        <button onClick={onDismiss} style={{padding:'8px 14px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'var(--text-dim)', borderRadius:8, fontSize:'0.82rem', cursor:'pointer'}}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
