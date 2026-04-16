/* ─── Shared UI utilities ─────────────────────────────────────────── */
import { daysUntil } from './dateUtils';
import Icon from './icons';

export const CAT_COLORS = {
  school: 'var(--accent)', swim: 'var(--teal)', debate: 'var(--orange)',
  'free time': 'var(--green)', sleep: 'var(--blue)', other: 'var(--pink)',
  homework: 'var(--accent)', test: 'var(--danger)', practice: 'var(--teal)',
  event: 'var(--orange)',
};

export function catColor(cat) {
  return CAT_COLORS[cat?.toLowerCase()] || 'var(--accent)';
}

export function weatherEmoji(code) {
  if (code <= 1) return Icon.sun(18);
  if (code <= 3) return Icon.cloud(18);
  if (code <= 48) return Icon.cloudFog(18);
  if (code <= 67) return Icon.cloudRain(18);
  if (code <= 77) return Icon.cloudSnow(18);
  if (code <= 82) return Icon.cloudDrizzle(18);
  return Icon.cloudLightning(18);
}

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

export function getPriority(task) {
  if (task.status === 'done') return 999;
  const d = daysUntil(task.dueDate);
  let score = d;
  if (task.status === 'not_started') score -= 2;
  if (task.status === 'in_progress') score -= 1;
  return score;
}
