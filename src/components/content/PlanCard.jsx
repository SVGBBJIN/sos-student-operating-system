import { useState } from 'react';
import Icon from '../../lib/icons';

/* ─── Plan Templates (co-located) ─────────────────────────────── */
export const PLAN_TEMPLATES = [
  {
    id: 'weekly_study', name: 'Weekly Study Plan', iconFn: Icon.calendar,
    description: 'Plan your study sessions for the week',
    skeleton: { summary: 'A structured weekly study plan to stay on top of your coursework.', steps: [{ title: 'Review notes from last week', estimated_minutes: 30 }, { title: 'Read new chapter material', estimated_minutes: 45 }, { title: 'Practice problems / exercises', estimated_minutes: 40 }, { title: 'Study group / peer review', estimated_minutes: 30 }, { title: 'Self-quiz / flashcard review', estimated_minutes: 20 }] }
  },
  {
    id: 'exam_prep', name: 'Exam Prep Plan', iconFn: Icon.target,
    description: '3-5 day countdown to exam day',
    skeleton: { summary: 'A focused exam preparation plan to maximize your study time.', steps: [{ title: 'Gather all study materials and past notes', estimated_minutes: 20 }, { title: 'Review key concepts and make a cheat sheet', estimated_minutes: 45 }, { title: 'Practice with past exams / sample questions', estimated_minutes: 60 }, { title: 'Focus on weak areas identified from practice', estimated_minutes: 45 }, { title: 'Final review and light practice', estimated_minutes: 30 }] }
  },
  {
    id: 'essay_plan', name: 'Essay Writing Plan', iconFn: Icon.fileText,
    description: 'Research, outline, draft, revise',
    skeleton: { summary: 'Step-by-step plan to write a polished essay.', steps: [{ title: 'Research and gather sources', estimated_minutes: 45 }, { title: 'Create outline with thesis and key points', estimated_minutes: 25 }, { title: 'Write first draft', estimated_minutes: 60 }, { title: 'Revise and strengthen arguments', estimated_minutes: 40 }, { title: 'Proofread and final edits', estimated_minutes: 20 }] }
  },
  {
    id: 'project_timeline', name: 'Project Timeline', iconFn: Icon.hammer,
    description: 'Break a big project into phases',
    skeleton: { summary: 'A phased timeline to complete your project on schedule.', steps: [{ title: 'Define project scope and requirements', estimated_minutes: 30 }, { title: 'Research and plan approach', estimated_minutes: 45 }, { title: 'Build / create core deliverables', estimated_minutes: 90 }, { title: 'Test, review, and iterate', estimated_minutes: 45 }, { title: 'Polish and submit final version', estimated_minutes: 30 }] }
  },
  {
    id: 'research_paper', name: 'Research Paper Plan', iconFn: Icon.search,
    description: 'Literature review through final draft',
    skeleton: { summary: 'A structured approach to writing a thorough research paper.', steps: [{ title: 'Choose topic and narrow focus', estimated_minutes: 20 }, { title: 'Literature review — find and read sources', estimated_minutes: 60 }, { title: 'Create annotated bibliography', estimated_minutes: 40 }, { title: 'Write introduction and methodology', estimated_minutes: 45 }, { title: 'Write body sections and analysis', estimated_minutes: 90 }, { title: 'Write conclusion and format citations', estimated_minutes: 30 }] }
  },
];

export function PlanTemplateSelector({ onSelectTemplate, onCustomPlan, onDismiss }) {
  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(26,26,46,0.98), rgba(15,15,26,0.95))', border: '1px solid rgba(108,99,255,0.2)', borderRadius: 18, padding: 0, maxWidth: 480, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(108,99,255,0.08)' }}>
      <div style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(43,203,186,0.1))', padding: '16px 20px', borderBottom: '1px solid rgba(108,99,255,0.1)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--accent), var(--teal))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(108,99,255,0.3)' }}>{Icon.listTree(18)}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)', letterSpacing: '-0.3px' }}>Choose a Plan Template</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 1 }}>Pick a starting point or create your own</div>
        </div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4, display: 'flex' }}>{Icon.x(14)}</button>
      </div>
      <div style={{ padding: '12px 16px' }}>
        {PLAN_TEMPLATES.map(tmpl => (
          <div key={tmpl.id} onClick={() => onSelectTemplate(tmpl)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 6, borderRadius: 12, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', transition: 'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(108,99,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(108,99,255,0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(108,99,255,0.1)', border: '1px solid rgba(108,99,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}>{tmpl.iconFn(16)}</div>
            <div>
              <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text)' }}>{tmpl.name}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: 1 }}>{tmpl.description}</div>
            </div>
          </div>
        ))}
        <div onClick={onCustomPlan}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, cursor: 'pointer', border: '1px solid rgba(43,203,186,0.15)', background: 'rgba(43,203,186,0.04)', transition: 'all .15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(43,203,186,0.1)'; e.currentTarget.style.borderColor = 'rgba(43,203,186,0.3)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(43,203,186,0.04)'; e.currentTarget.style.borderColor = 'rgba(43,203,186,0.15)'; }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(43,203,186,0.1)', border: '1px solid rgba(43,203,186,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--teal)', flexShrink: 0 }}>{Icon.sparkles(16)}</div>
          <div>
            <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--teal)' }}>Custom Plan</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: 1 }}>AI generates a unique plan from your description</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlanCard({ data, onApply, onSave, onDismiss, onStartTask, onExportGoogleDocs, googleConnected }) {
  const [checked, setChecked] = useState(() => (data.steps || []).map(() => true));
  const [mode, setMode] = useState('breakdown');
  const [activeIdx, setActiveIdx] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [docSyncing, setDocSyncing] = useState(false);
  const steps = data.steps || [];
  const toggle = i => setChecked(prev => prev.map((v, j) => j === i ? !v : v));
  const checkedCount = checked.filter(Boolean).length;

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

  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(26,26,46,0.98), rgba(15,15,26,0.95))', border: '1px solid rgba(108,99,255,0.2)', borderRadius: 18, padding: 0, maxWidth: 480, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(108,99,255,0.08)' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(43,203,186,0.1))', padding: '16px 20px', borderBottom: '1px solid rgba(108,99,255,0.1)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--accent), var(--teal))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(108,99,255,0.3)' }}>{Icon.listTree(18)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)', letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.title || 'Study Plan'}</div>
          {data.subject && <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 1 }}>{data.subject}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: 6 }}>{checkedCount}/{steps.length} steps</span>
        </div>
      </div>

      {/* Summary */}
      {data.summary && (
        <div style={{ padding: '12px 20px', background: 'rgba(108,99,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.84rem', color: 'var(--text)', lineHeight: 1.5 }}>
          {data.summary}
        </div>
      )}

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 4, padding: '10px 20px 0' }}>
        {['breakdown', 'focus'].map(m => (
          <button key={m} onClick={() => setMode(m)} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', transition: 'all .15s', borderColor: mode === m ? 'var(--accent)' : 'var(--border)', background: mode === m ? 'rgba(108,99,255,0.18)' : 'transparent', color: mode === m ? 'var(--accent)' : 'var(--text-dim)' }}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {/* Steps — breakdown mode */}
      {mode === 'breakdown' && (
        <div style={{ padding: '12px 20px', maxHeight: 280, overflowY: 'auto' }}>
          {steps.map((step, i) => {
            const isActive = activeIdx === i;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }} onClick={() => toggle(i)}>
                <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1, background: checked[i] ? 'rgba(108,99,255,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${checked[i] ? 'rgba(108,99,255,0.4)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}>
                  {checked[i] && <span style={{ color: 'var(--accent)', fontSize: '0.7rem' }}>✓</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.84rem', color: isActive ? 'var(--accent)' : checked[i] ? 'var(--text)' : 'var(--text-dim)', fontWeight: isActive ? 600 : 400, lineHeight: 1.4, textDecoration: !checked[i] ? 'line-through' : 'none', opacity: !checked[i] ? 0.5 : 1 }}>{step.title}</div>
                  {(step.estimated_minutes || step.description) && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 2 }}>
                      {step.estimated_minutes && <span>{step.estimated_minutes}min</span>}
                      {step.description && <span style={{ marginLeft: step.estimated_minutes ? 8 : 0 }}>{step.description}</span>}
                    </div>
                  )}
                </div>
                {isActive && <span style={{ fontSize: '0.68rem', color: 'var(--accent)', background: 'rgba(108,99,255,0.1)', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>active</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Focus mode */}
      {mode === 'focus' && (
        <div style={{ padding: '16px 20px' }}>
          {activeIdx !== null && steps[activeIdx] ? (
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginBottom: 8 }}>Current step {activeIdx + 1} of {steps.length}</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, marginBottom: 6 }}>{steps[activeIdx].title}</div>
              {steps[activeIdx].estimated_minutes && <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{steps[activeIdx].estimated_minutes} min</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => { toggle(activeIdx); startNextTask(); }} style={{ flex: 1, background: 'var(--accent)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: '0.82rem', padding: '8px', cursor: 'pointer' }}>Done → Next</button>
                <button onClick={() => setActiveIdx(null)} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-dim)', fontSize: '0.82rem', padding: '8px 12px', cursor: 'pointer' }}>Pause</button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: '0.88rem', color: 'var(--text-dim)', marginBottom: 12 }}>Pick a step to start with</div>
              {steps.filter((_, i) => checked[i]).map((step, i) => (
                <button key={i} onClick={() => startTask(i)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.15)', borderRadius: 10, padding: '8px 12px', marginBottom: 6, cursor: 'pointer', color: 'var(--text)', fontSize: '0.82rem' }}>
                  {step.title} {step.estimated_minutes && <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>· {step.estimated_minutes}min</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ padding: '10px 20px 14px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
        <button onClick={() => onApply(steps.filter((_, i) => checked[i]))} disabled={checkedCount === 0}
          style={{ flex: 1, minWidth: 100, background: 'var(--accent)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: '0.82rem', padding: '8px 14px', cursor: checkedCount === 0 ? 'not-allowed' : 'pointer', opacity: checkedCount === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {Icon.check(14)} Add {checkedCount} task{checkedCount !== 1 ? 's' : ''}
        </button>
        <button onClick={onSave} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'var(--text-dim)', fontSize: '0.82rem', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>{Icon.fileText(14)} Save</button>

        <div style={{ position: 'relative' }}>
          <button onClick={() => setActionsOpen(!actionsOpen)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'var(--text-dim)', fontSize: '0.82rem', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            {Icon.zap(13)} More
          </button>
          {actionsOpen && (
            <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, background: 'rgba(15,15,26,0.98)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, overflow: 'hidden', minWidth: 160, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: 10 }}>
              {googleConnected && (
                <button onClick={() => { setActionsOpen(false); handleExportDocs(); }} disabled={docSyncing}
                  style={{ width: '100%', background: 'transparent', border: 'none', padding: '10px 14px', color: googleConnected ? 'var(--text)' : 'var(--text-dim)', fontSize: '0.82rem', cursor: docSyncing ? 'wait' : 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, transition: 'background .15s', opacity: docSyncing ? 0.5 : 1 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(108,99,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ color: 'var(--accent)', display: 'flex' }}>{Icon.externalLink(13)}</span>
                  {docSyncing ? 'Syncing...' : hasDocId ? 'Sync to Google Docs' : 'Export to Google Docs'}
                </button>
              )}
            </div>
          )}
        </div>

        <button onClick={onDismiss} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: 'var(--text-dim)', fontSize: '0.82rem', padding: '8px 12px', cursor: 'pointer' }}>Dismiss</button>
      </div>
    </div>
  );
}
