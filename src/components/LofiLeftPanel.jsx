import React, { useMemo, useState, useEffect } from 'react';

const SUBJECT_COLORS = {
  math:     { fill: 'var(--lofi-lavender)', tag: 'study-tag-math',    label: 'MTH' },
  english:  { fill: 'var(--lofi-rose)',     tag: 'study-tag-english', label: 'ENG' },
  cs:       { fill: 'var(--lofi-sage)',     tag: 'study-tag-cs',      label: 'CS'  },
  science:  { fill: 'var(--lofi-sky)',      tag: 'study-tag-science', label: 'SCI' },
};

function getSubjectKey(subject) {
  if (!subject) return 'other';
  const s = subject.toLowerCase();
  if (s.includes('math') || s.includes('calc') || s.includes('algebra') || s.includes('geometry')) return 'math';
  if (s.includes('eng') || s.includes('lit') || s.includes('write') || s.includes('read')) return 'english';
  if (s.includes('cs') || s.includes('comp') || s.includes('prog') || s.includes('code') || s.includes('data')) return 'cs';
  if (s.includes('sci') || s.includes('bio') || s.includes('chem') || s.includes('phys')) return 'science';
  return 'other';
}

function getTagClass(subject) {
  const key = getSubjectKey(subject);
  return SUBJECT_COLORS[key]?.tag || 'study-tag-other';
}

function getTagLabel(subject) {
  if (!subject) return '—';
  const key = getSubjectKey(subject);
  if (key === 'other') return subject.slice(0, 4).toUpperCase();
  return SUBJECT_COLORS[key].label;
}

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function useSrsDueCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    try {
      const schedule = JSON.parse(localStorage.getItem('sos-fc-schedule') || '{}');
      const today = getTodayStr();
      const due = Object.values(schedule).filter(v => !v.nextReview || v.nextReview <= today).length;
      setCount(due);
    } catch(_) {}
  }, []);
  return count;
}

export default function LofiLeftPanel({ tasks, onToggleTask }) {
  const today = getTodayStr();
  const srsDue = useSrsDueCount();

  // show tasks due today or not yet completed, up to 10
  const visibleTasks = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];
    const active = tasks.filter(t => {
      if (t.status === 'done') {
        // show done tasks only if completed today
        return t.completed_at && t.completed_at.slice(0, 10) === today;
      }
      return true;
    });
    return active.slice(0, 10);
  }, [tasks, today]);

  // compute subject progress
  const subjectProgress = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];
    const groups = {};
    tasks.forEach(t => {
      const key = getSubjectKey(t.subject);
      if (key === 'other') return;
      if (!groups[key]) groups[key] = { done: 0, total: 0 };
      groups[key].total++;
      if (t.status === 'done') groups[key].done++;
    });
    return Object.entries(groups).map(([key, { done, total }]) => ({
      key,
      label: SUBJECT_COLORS[key]?.label || key,
      fill: SUBJECT_COLORS[key]?.fill || 'var(--lofi-text-muted)',
      pct: Math.round((done / total) * 100),
    })).sort((a, b) => b.pct - a.pct);
  }, [tasks]);

  return (
    <div className="study-left study-glass">
      <div className="study-section-label">Today</div>

      {visibleTasks.length === 0 ? (
        <div className="study-left-empty">Nothing on your plate yet —<br/>what's coming up?</div>
      ) : (
        <div className="study-task-list">
          {visibleTasks.map(task => {
            const isDone = task.status === 'done';
            return (
              <div
                key={task.id}
                className={'study-task-item' + (isDone ? ' done' : '')}
                onClick={() => onToggleTask && onToggleTask(task)}
              >
                <div className="study-task-check" aria-label={isDone ? 'Mark incomplete' : 'Mark done'}>
                  {isDone ? '✓' : ''}
                </div>
                <span className="study-task-label" title={task.title}>{task.title}</span>
                {task.subject && (
                  <span className={'study-task-tag ' + getTagClass(task.subject)}>
                    {getTagLabel(task.subject)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {srsDue > 0 && (
        <div className="study-section-label" style={{marginTop:4,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>Due for review</span>
          <span style={{background:'rgba(253,164,175,0.2)',color:'#fda4af',borderRadius:999,padding:'1px 7px',fontSize:'0.7rem',fontWeight:700}}>{srsDue}</span>
        </div>
      )}

      {subjectProgress.length > 0 && (
        <>
          <div className="study-section-label" style={{ marginTop: 4 }}>Subjects</div>
          <div className="study-subject-list">
            {subjectProgress.map(({ key, label, fill, pct }) => (
              <div key={key} className="study-subject-row">
                <span className="study-subject-name">{label}</span>
                <div className="study-progress-track">
                  <div
                    className="study-progress-fill"
                    style={{ width: pct + '%', background: fill }}
                  />
                </div>
                <span className="study-progress-pct">{pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
