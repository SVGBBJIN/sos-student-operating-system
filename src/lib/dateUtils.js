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

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ABBR = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Next calendar date (>= today) that falls on the given weekday name/abbreviation
// found in `text`, or null if no weekday is mentioned. "0 days ahead" (today is
// that weekday) resolves to the next week's occurrence, matching how students
// mean "due friday" when today already is Friday.
export function nextWeekdayFromText(text, todayStr = today()) {
  if (!text) return null;
  const lower = text.toLowerCase();
  let targetDow = null;
  for (const name of WEEKDAY_NAMES) {
    if (new RegExp('\\b' + name + '\\b').test(lower)) { targetDow = WEEKDAY_NAMES.indexOf(name); break; }
  }
  if (targetDow === null) {
    for (const [abbr, dow] of Object.entries(WEEKDAY_ABBR)) {
      if (new RegExp('\\b' + abbr + '\\b').test(lower)) { targetDow = dow; break; }
    }
  }
  if (targetDow === null) return null;
  const base = new Date(todayStr + 'T12:00:00');
  const todayDow = base.getDay();
  let diff = targetDow - todayDow;
  if (diff <= 0) diff += 7;
  const d = new Date(base);
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

// Cross-checks an AI-resolved date against an explicit weekday name mentioned in
// the student's own message. If the model resolved to the wrong occurrence (the
// class of off-by-one bug where "due friday" lands on Thursday), returns the
// corrected ISO date + human day name; otherwise returns null (no correction needed).
export function correctedDateForWeekdayMention(resolvedDateStr, sourceText, todayStr = today()) {
  const expected = nextWeekdayFromText(sourceText, todayStr);
  if (!expected || expected === resolvedDateStr) return null;
  const dayName = new Date(expected + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return { date: expected, dayName };
}

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
