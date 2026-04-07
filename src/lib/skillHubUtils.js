// ─── Skill Hub Utilities ──────────────────────────────────────────────────────
// Subject detection, trigger logic, session helpers.

import { detectModeFromText } from './tutorModeConfig.js';

const SKILL_HUB_LAST_VISIT_KEY = 'sos_skill_hub_last_visit';

// ─── Trigger Conditions ──────────────────────────────────────────────────────

/**
 * Evaluate smart trigger conditions from tasks and dismissals.
 * Returns an array of trigger objects sorted by urgency (soonest first).
 *
 * @param {Array} tasks - All active tasks
 * @param {Array} dismissals - trigger_dismissals rows from Supabase
 * @returns {Array} triggers sorted by urgency
 */
export function evaluateTriggers(tasks, dismissals = []) {
  const now = Date.now();
  const lastVisit = parseInt(localStorage.getItem(SKILL_HUB_LAST_VISIT_KEY) || '0', 10);
  const daysSinceVisit = (now - lastVisit) / (1000 * 60 * 60 * 24);

  // Build a set of dismissed task IDs (still within 24-hour window)
  const dismissedTaskIds = new Set(
    dismissals
      .filter(d => new Date(d.expires_at).getTime() > now)
      .map(d => d.task_id)
  );

  const triggers = [];

  for (const task of tasks) {
    if (task.status === 'done') continue;
    if (dismissedTaskIds.has(task.id)) continue;

    const dueDate = task.dueDate ? new Date(task.dueDate) : null;
    const daysUntilDue = dueDate ? (dueDate - now) / (1000 * 60 * 60 * 24) : null;
    const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
    const isTestOrExam = /\b(test|exam|midterm|final|quiz)\b/i.test(task.title || '');
    const isHomework = /\b(homework|assignment|hw|project)\b/i.test(task.title || '') ||
      task.category === 'homework';

    let triggerType = null;
    let urgency = 999; // lower = more urgent

    if (isTestOrExam && daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 5) {
      triggerType = 'upcoming_test';
      urgency = daysUntilDue;
    } else if (isOverdue && isHomework) {
      triggerType = 'overdue_homework';
      urgency = Math.abs(daysUntilDue || 0) * -1; // more overdue = more urgent
    } else if (daysSinceVisit >= 3 && dueDate && daysUntilDue !== null && daysUntilDue <= 7) {
      triggerType = 'not_visited';
      urgency = daysUntilDue;
    }

    if (!triggerType) continue;

    const suggestedMode = detectModeFromText(
      (task.title || '') + ' ' + (task.subject || '')
    );

    triggers.push({
      task,
      triggerType,
      urgency,
      daysUntilDue,
      isOverdue,
      suggestedMode,
      message: buildNudgeMessage(task, triggerType, daysUntilDue),
    });
  }

  // Sort by urgency (lowest first = most urgent)
  return triggers.sort((a, b) => a.urgency - b.urgency);
}

function buildNudgeMessage(task, triggerType, daysUntilDue) {
  const title = task.title || 'a task';
  if (triggerType === 'upcoming_test') {
    const d = Math.floor(daysUntilDue);
    if (d === 0) return `${title} is today — time to review.`;
    if (d === 1) return `${title} is tomorrow — let's get ready.`;
    return `You haven't studied for ${title} yet — it's in ${d} day${d !== 1 ? 's' : ''}.`;
  }
  if (triggerType === 'overdue_homework') {
    return `${title} is overdue. Let's work through it now.`;
  }
  return `${title} is coming up — you haven't opened Skill Hub in a while.`;
}

export function recordSkillHubVisit() {
  localStorage.setItem(SKILL_HUB_LAST_VISIT_KEY, Date.now().toString());
}

// ─── Session Scoring ──────────────────────────────────────────────────────────

export function createSessionTracker() {
  return {
    correct: 0,
    incorrect: 0,
    hintsUsed: 0,
    struggledTopics: [], // strings
    conceptStreaks: {}, // concept → consecutive correct count

    recordCorrect(concept = 'general') {
      this.correct++;
      this.conceptStreaks[concept] = (this.conceptStreaks[concept] || 0) + 1;
    },
    recordIncorrect(concept = 'general') {
      this.incorrect++;
      this.conceptStreaks[concept] = 0;
      if (!this.struggledTopics.includes(concept)) {
        this.struggledTopics.push(concept);
      }
    },
    recordHint() {
      this.hintsUsed++;
    },
    toRecord() {
      return {
        score_correct: this.correct,
        score_incorrect: this.incorrect,
        hints_used: this.hintsUsed,
        struggled_topics: this.struggledTopics,
      };
    },
  };
}

// ─── Schedule Filtering ───────────────────────────────────────────────────────

const STUDY_TAGS = /\b(test|exam|quiz|homework|hw|assignment|essay|midterm|final|project)\b/i;

/**
 * Filter tasks to only those relevant for the Schedule tab.
 * Returns tasks due within 14 days, sorted soonest first.
 */
export function filterScheduleTasks(tasks) {
  const now = Date.now();
  const cutoff = now + 14 * 24 * 60 * 60 * 1000;

  return tasks
    .filter(t => {
      if (t.status === 'done') return false;
      if (!t.dueDate) return false;
      const due = new Date(t.dueDate).getTime();
      if (due > cutoff) return false;
      return STUDY_TAGS.test(t.title || '') || STUDY_TAGS.test(t.subject || '');
    })
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
}

/**
 * Group tasks by relative time bucket for the timeline view.
 */
export function groupByTimeBucket(tasks) {
  const now = Date.now();
  const buckets = { TODAY: [], TOMORROW: [], 'IN 3 DAYS': [], 'THIS WEEK': [], 'COMING UP': [] };

  for (const t of tasks) {
    const due = new Date(t.dueDate).getTime();
    const days = (due - now) / (1000 * 60 * 60 * 24);

    if (days < 0) {
      buckets.TODAY.unshift({ ...t, overdue: true }); // overdue at top
    } else if (days < 1) {
      buckets.TODAY.push(t);
    } else if (days < 2) {
      buckets.TOMORROW.push(t);
    } else if (days < 4) {
      buckets['IN 3 DAYS'].push(t);
    } else if (days < 8) {
      buckets['THIS WEEK'].push(t);
    } else {
      buckets['COMING UP'].push(t);
    }
  }

  return Object.entries(buckets).filter(([, items]) => items.length > 0);
}

/**
 * Format a due date relative to now.
 */
export function formatDue(dueDateStr) {
  if (!dueDateStr) return '';
  const due = new Date(dueDateStr);
  const now = new Date();
  const diffMs = due - now;
  const diffHrs = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) {
    const hoursAgo = Math.abs(Math.floor(diffHrs));
    if (hoursAgo < 24) return `${hoursAgo}h overdue`;
    return `${Math.floor(Math.abs(diffDays))}d overdue`;
  }
  if (diffHrs < 1) return 'due in <1 hour';
  if (diffHrs < 24) return `due in ${Math.round(diffHrs)} hours`;
  if (diffDays < 2) return 'due tomorrow';
  const weekday = due.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `due ${weekday}`;
}

// ─── Subject Icon ─────────────────────────────────────────────────────────────

const SUBJECT_ICONS = {
  math: '📐', calc: '📐', calculus: '📐', algebra: '📐', geometry: '📐',
  physics: '⚡', chemistry: '🧪', biology: '🧬', science: '🔬',
  cs: '💻', computer: '💻', coding: '💻',
  english: '📖', history: '🏛', essay: '✍️', writing: '✍️', literature: '📚',
  government: '⚖️', philosophy: '🤔', economics: '📊',
  vocab: '🔤', vocabulary: '🔤', definitions: '🔤',
};

export function getSubjectIcon(text = '') {
  const t = text.toLowerCase();
  for (const [key, icon] of Object.entries(SUBJECT_ICONS)) {
    if (t.includes(key)) return icon;
  }
  return '📝';
}

// ─── Socratic JSON Parser ─────────────────────────────────────────────────────

/**
 * Extract the embedded JSON block from an AI response for Cause & Effect mode.
 * Returns { text, socratic } where text is the prose and socratic is the parsed object.
 */
export function parseSocraticResponse(content = '') {
  // Try to find ```json ... ``` block
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const socratic = JSON.parse(jsonMatch[1].trim());
      const text = content.replace(/```json[\s\S]*?```/, '').trim();
      return { text, socratic };
    } catch (_) {}
  }
  // Fallback: try to find a raw JSON object at the end
  const rawMatch = content.match(/\{[\s\S]*"question"[\s\S]*"options"[\s\S]*\}/);
  if (rawMatch) {
    try {
      const socratic = JSON.parse(rawMatch[0]);
      const text = content.slice(0, content.indexOf(rawMatch[0])).trim();
      return { text, socratic };
    } catch (_) {}
  }
  return { text: content, socratic: null };
}

/**
 * Parse Interpretation mode button suggestions from AI response.
 * Looks for ---BUTTONS--- section.
 */
export function parseInterpretationButtons(content = '') {
  const parts = content.split('---BUTTONS---');
  if (parts.length < 2) return { text: content, buttons: null };

  const text = parts[0].trim();
  const buttonSection = parts[1].trim();

  const buttons = {};
  const defendMatch = buttonSection.match(/defend:\s*(.+)/);
  const concedeMatch = buttonSection.match(/concede:\s*(.+)/);
  const exampleMatch = buttonSection.match(/example:\s*(.+)/);

  if (defendMatch) buttons.defend = defendMatch[1].trim();
  if (concedeMatch) buttons.concede = concedeMatch[1].trim();
  if (exampleMatch) buttons.example = exampleMatch[1].trim();

  return { text, buttons: Object.keys(buttons).length ? buttons : null };
}

/**
 * Check if AI response contains a synthesis block.
 */
export function extractSynthesis(content = '') {
  const match = content.match(/SYNTHESIS:([\s\S]*?)(?=\n\n|$)/);
  if (match) {
    return {
      text: content.slice(0, content.indexOf('SYNTHESIS:')).trim(),
      synthesis: match[1].trim(),
    };
  }
  return { text: content, synthesis: null };
}

/**
 * Parse session complete summary from Study mode.
 */
export function parseSessionComplete(content = '') {
  if (!content.includes('SESSION COMPLETE')) return null;
  const correctMatch = content.match(/Correct:\s*(\d+)/);
  const missedMatch = content.match(/Missed:\s*(\d+)/);
  const reviewMatch = content.match(/Review these topics:([\s\S]*?)(?=\n\n|$)/);
  return {
    correct: correctMatch ? parseInt(correctMatch[1], 10) : 0,
    missed: missedMatch ? parseInt(missedMatch[1], 10) : 0,
    reviewTopics: reviewMatch
      ? reviewMatch[1].split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
      : [],
  };
}
