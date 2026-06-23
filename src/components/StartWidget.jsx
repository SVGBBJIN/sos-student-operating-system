import React from 'react';

/* ── Start Widget ──────────────────────────────────────────────
   Floating card pinned on the right edge of the chat column. Shows
   up to FOUR startable tasks (priority-engine order, never a new
   ranking), each with a Start CTA pill that states the trajectory
   benefit of acting now ("Start · fits before Thursday"). Unlike the
   home gate, this is always summonable — it's the resurfacing path
   the one-shot gate doesn't give you.

   Presentational only: App ranks the tasks and computes the chips,
   so this never touches the priority engine or Supabase directly.
*/

const MAX_ROWS = 4;

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

function ctaLabel(chip) {
  // The CTA reads as a sentence: "Start on pace to finish by Thursday".
  if (!chip?.label) return 'Start';
  return `Start ${chip.label}`;
}

// A gain-framed incentive line: what starting now buys. Never loss/guilt.
function incentiveLine(chip) {
  if (!chip) return null;
  const parts = [];
  if (typeof chip.reductionPct === 'number') parts.push(`clears ~${chip.reductionPct}% of it today`);
  if (typeof chip.probabilityPct === 'number') parts.push(`${chip.probabilityPct}% on time lately`);
  return parts.length ? parts.join(' · ') : null;
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
          const incentive = incentiveLine(chip);
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
                {ctaLabel(chip)}
              </button>
              {incentive && <div className="stw-incentive">{incentive}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
