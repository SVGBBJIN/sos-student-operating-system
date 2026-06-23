import React, { useState } from 'react';

/* ── Start Widget ──────────────────────────────────────────────
   Floating card pinned on the right edge of the chat column. Lists
   up to FIVE startable tasks (priority-engine order, never a new
   ranking) as options, but exposes exactly ONE call-to-action so the
   list never becomes five competing decisions.

   The system auto-selects the best option (top quick-start rank) by
   default; the student can pick a different row, but there's always a
   single Start CTA — same pill format as before, stating the
   trajectory of whichever option is selected.

   Presentational only: App ranks the tasks and computes the chips,
   so this never touches the priority engine or Supabase directly.
*/

// Five is the ceiling — enough to feel like a real choice, few enough to
// glance without paralysis.
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
  const [selectedId, setSelectedId] = useState(null);

  // The system auto-selects the best option (top rank) until the student picks
  // another; if the selected task drops out of the list, fall back to the best.
  const selected = rows.find(t => t.id === selectedId) || rows[0] || null;
  const selectedIdx = rows.findIndex(t => t === selected);
  const selectedChip = selectedIdx >= 0 ? chips[selectedIdx] : null;
  const fit = selectedChip?.tone === 'fit';
  const incentive = incentiveLine(selectedChip);

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

      <div className="stw-body" role="radiogroup" aria-label="Pick a task to start">
        {rows.length === 0 && (
          <div className="stw-empty">nothing to start right now</div>
        )}
        {rows.map((task) => {
          const isSel = task === selected;
          return (
            <button
              key={task.id}
              type="button"
              role="radio"
              aria-checked={isSel}
              className={'stw-row' + (isSel ? ' selected' : '')}
              onClick={() => setSelectedId(task.id)}
            >
              <span className={'stw-pick' + (isSel ? ' on' : '')} aria-hidden="true" />
              <span className="stw-rowtext">
                <span className="stw-title" title={task.title}>{task.title}</span>
                <span className="stw-meta">
                  {[dueLabel(task), task.subject].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="stw-foot">
          <button
            className={'stw-cta' + (fit ? ' fit' : '')}
            onClick={() => onStart?.(selected)}
          >
            {ctaLabel(selectedChip)}
          </button>
          {incentive && <div className="stw-incentive">{incentive}</div>}
        </div>
      )}
    </div>
  );
}
