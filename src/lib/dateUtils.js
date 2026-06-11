// Pure date/time + due-date helpers shared across the app. No React/app state.

export function fmt(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtFull(d) {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function toDateStr(d) {
  const dt = new Date(d);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

export function today() { return toDateStr(new Date()); }

export function daysUntil(dateStr) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - now) / 86400000);
}

export function fmtTime(h, m) {
  const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return hr + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

/* ─── Nudge Engine: human-readable due-date status for a task ─── */
export function getNudge(task) {
  if (task.status === 'done') return { emoji: 'done', text: 'Done! Nice work.' };
  const d = daysUntil(task.dueDate);
  if (d < 0) return { emoji: 'overdue', text: 'Overdue by ' + Math.abs(d) + ' day' + (Math.abs(d) > 1 ? 's' : '') };
  if (d === 0) return { emoji: 'today', text: 'Due today' };
  if (d === 1) return { emoji: 'tomorrow', text: 'Due tomorrow' };
  if (d <= 3) return { emoji: 'soon', text: d + ' days left' };
  if (d <= 7) return { emoji: 'week', text: d + ' days left' };
  return { emoji: 'chill', text: d + ' days left' };
}

/* ─── Sort key: lower = more urgent; done tasks sink ─── */
export function getPriority(task) {
  if (task.status === 'done') return 999;
  const d = daysUntil(task.dueDate);
  let score = d;
  if (task.status === 'not_started') score -= 2;
  if (task.status === 'in_progress') score -= 1;
  return score;
}
