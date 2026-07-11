import React, { useState } from 'react';
import Icon from '../lib/icons';

export default function MyPlansPanel({ plans, tasks, onClose, onRevise, onArchive }) {
  const [expandedId, setExpandedId] = useState(null);
  const activePlans = plans.filter(p => p.status === 'active');
  const archivedPlans = plans.filter(p => p.status === 'archived');
  const getPlanProgress = (plan) => {
    const planTasks = tasks.filter(t => t.study_plan_id === plan.id);
    const total = plan.total_tasks || planTasks.length;
    const completed = planTasks.filter(t => t.completedAt).length;
    return { total, completed };
  };
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
  const renderPlanCard = (plan) => {
    const { total, completed } = getPlanProgress(plan);
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const isExpanded = expandedId === plan.id;
    const planData = plan.plan_json || {};
    return (
      <div key={plan.id} style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:10, marginBottom:8, overflow:'hidden'}}>
        <div onClick={() => setExpandedId(isExpanded ? null : plan.id)} style={{padding:'10px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:10}}>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontWeight:600, fontSize:'0.85rem', color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{plan.title}</div>
            <div style={{fontSize:'0.73rem', color:'var(--text-dim)', marginTop:2}}>Applied {fmtDate(plan.applied_at)} · {completed}/{total} tasks done</div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:8, flexShrink:0}}>
            <div style={{fontSize:'0.75rem', fontWeight:700, color: pct === 100 ? 'var(--teal)' : 'var(--accent)'}}>{pct}%</div>
            <span style={{color:'var(--text-dim)', fontSize:'0.75rem'}}>{isExpanded ? '▲' : '▼'}</span>
          </div>
        </div>
        {total > 0 && (
          <div style={{height:3, background:'rgba(255,255,255,0.06)', margin:'0 14px 0'}}>
            <div style={{height:'100%', width:`${pct}%`, background: pct === 100 ? 'var(--teal)' : 'var(--accent)', borderRadius:2, transition:'width .3s ease'}}/>
          </div>
        )}
        {isExpanded && (
          <div style={{padding:'10px 14px', borderTop:'1px solid rgba(255,255,255,0.04)'}}>
            {planData.summary && <p style={{fontSize:'0.8rem', color:'var(--text-dim)', margin:'0 0 8px', lineHeight:1.5}}>{planData.summary}</p>}
            {(planData.recurring_blocks||[]).length > 0 && (
              <div style={{marginBottom:8}}>
                <div style={{fontSize:'0.7rem', fontWeight:700, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4}}>Blocks</div>
                {(planData.recurring_blocks||[]).map((b,i) => (
                  <div key={i} style={{fontSize:'0.78rem', color:'var(--text-dim)', padding:'1px 0'}}>{b.activity} — {(b.days||[]).join('/')} {b.start}–{b.end}</div>
                ))}
              </div>
            )}
            {(planData.milestone_tasks||[]).length > 0 && (
              <div style={{marginBottom:8}}>
                <div style={{fontSize:'0.7rem', fontWeight:700, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4}}>Milestones</div>
                {(planData.milestone_tasks||[]).slice(0,8).map((t,i) => {
                  const done = tasks.find(task => task.study_plan_id === plan.id && task.title === t.task_name && task.completedAt);
                  return (
                    <div key={i} style={{fontSize:'0.78rem', color: done ? 'var(--teal)' : 'var(--text-dim)', padding:'1px 0', textDecoration: done ? 'line-through' : 'none'}}>{t.task_name} — {t.due_date}</div>
                  );
                })}
                {(planData.milestone_tasks||[]).length > 8 && <div style={{fontSize:'0.72rem', color:'var(--text-dim)', marginTop:2}}>+{(planData.milestone_tasks||[]).length-8} more…</div>}
              </div>
            )}
            <div style={{display:'flex', gap:8, marginTop:8}}>
              <button onClick={() => onRevise(plan.id)} style={{flex:1, background:'rgba(108,99,255,0.12)', border:'1px solid rgba(108,99,255,0.25)', color:'var(--accent)', borderRadius:7, padding:'6px 0', fontSize:'0.78rem', fontWeight:600, cursor:'pointer'}}>
                Revise Plan
              </button>
              {plan.status === 'active' && (
                <button onClick={() => onArchive(plan.id)} style={{padding:'6px 12px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'var(--text-dim)', borderRadius:7, fontSize:'0.78rem', cursor:'pointer'}}>
                  Archive
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };
  return (
    <div style={{position:'fixed', inset:0, zIndex:200, display:'flex', alignItems:'flex-start', justifyContent:'flex-end'}} onClick={e => { if(e.target === e.currentTarget) onClose(); }}>
      <div style={{width:360, maxWidth:'95vw', height:'100vh', background:'var(--surface)', borderLeft:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', boxShadow:'-8px 0 32px rgba(0,0,0,0.4)'}}>
        <div style={{padding:'16px 16px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', gap:10}}>
          <span style={{color:'var(--accent)', display:'flex'}}>{Icon.zap(16)}</span>
          <span style={{fontWeight:700, fontSize:'0.95rem', color:'var(--text)', flex:1}}>My Study Plans</span>
          <button onClick={onClose} style={{background:'none', border:'none', color:'var(--text-dim)', cursor:'pointer', padding:4}}>{Icon.x(16)}</button>
        </div>
        <div style={{flex:1, overflowY:'auto', padding:12}}>
          {plans.length === 0 && (
            <div style={{textAlign:'center', padding:'40px 20px', color:'var(--text-dim)', fontSize:'0.85rem'}}>
              No study plans yet. Ask the AI to help you plan for a goal like "survive finals week" or "improve my GPA".
            </div>
          )}
          {activePlans.length > 0 && (
            <>
              <div style={{fontSize:'0.7rem', fontWeight:700, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8}}>Active</div>
              {activePlans.map(renderPlanCard)}
            </>
          )}
          {archivedPlans.length > 0 && (
            <>
              <div style={{fontSize:'0.7rem', fontWeight:700, color:'var(--text-dim)', textTransform:'uppercase', letterSpacing:'0.06em', margin:'16px 0 8px'}}>Archived</div>
              {archivedPlans.map(renderPlanCard)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
