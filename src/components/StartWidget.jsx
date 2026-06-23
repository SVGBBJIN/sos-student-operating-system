import React from 'react';

/* ── Start Widget ──────────────────────────────────────────────
   Floating card pinned on the right edge of the chat column. Shows
   up to FIVE startable tasks (priority-engine order, never a new
   ranking) — five is the ceiling so the list reads at a glance
   without choice paralysis.

   Each task carries exactly ONE call-to-action: a single Start pill
   stating the strongest trajectory incentive for that task —
   "Start on pace to finish by Thursday" or "Start · clears ~30%
   today" — built from real allocator math, never a fabricated number.

   Presentational only: App ranks the tasks and computes the chips,
   so this never touches the priority engine or Supabase directly.
*/

const MAX_ROWS = 5;

function dueLabel(task) {
  if (!task?.dueDate) return task?.subject || '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(task.dueDate + 'T00:00:00');
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days}d`;
}

// One CTA per task, one fact per CTA. Lead with the concrete workload the start
// clears (the strongest pull); fall back to the pace-to-deadline when there's
// no meaningful share to clear. Both are real allocator facts; gain-framed only.
function ctaText(chip) {
  if (!chip) return 'Start';
  if (typeof chip.reductionPct === 'number') return `Start · clears ~${chip.reductionPct}% today`;
  if (chip.label) return `Start ${chip.label}`;
  return 'Start';
}

export default function StartWidget({ tasks = [], chips = [], solo = false, onStart, onClose }) {
  const rows = tasks.slice(0, MAX_ROWS);

  return (
    <div className={'start-widget' + (solo ? ' solo-top' : '')} role="complementary" aria-label="Tasks you can start">
      <div className="stw-head">
        <span className="stw-dot" />
        <span className="stw-label">start one</span>
        <span className="stw-count">{rows.length}</span>
        {onClose && (
          <button className="stw-close" onClick={onClose} aria-label="Close start widget">×</button>
        )}
      </div>

      <div className="stw-body">
        {rows.length === 0 && (
          <div className="stw-empty">nothing to start right now</div>
        )}
        {rows.map((task, i) => {
          const chip = chips[i];
          const fit = chip?.tone === 'fit';
          return (
            <div key={task.id} className="stw-row">
              <div className="stw-title" title={task.title}>{task.title}</div>
              <div className="stw-meta">
                {[dueLabel(task), task.subject].filter(Boolean).join(' · ')}
              </div>
              <button
                className={'stw-cta' + (fit ? ' fit' : '')}
                onClick={() => onStart?.(task)}
              >
                {ctaText(chip)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
