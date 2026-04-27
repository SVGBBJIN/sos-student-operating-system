// Canonical subject data shared between chat-core.js and App.jsx.

export const SUBJECT_ALIASES = {
  calc: 'calculus', math: 'mathematics', bio: 'biology', chem: 'chemistry',
  phys: 'physics', eng: 'english', hist: 'history', sci: 'science', span: 'spanish',
  econ: 'economics', psych: 'psychology', gov: 'government', geo: 'geography',
  pe: 'physical education', gym: 'physical education', lit: 'literature',
  cs: 'computer science', comp: 'computer science', la: 'language arts',
};

// Display labels for the clarification card dropdown (Title Case).
export const SUBJECT_LIST = [
  'Mathematics', 'English', 'Science', 'History', 'Spanish', 'French', 'Language Arts',
  'Economics', 'Psychology', 'Government', 'Geography', 'Physical Education',
  'Literature', 'Computer Science', 'Calculus', 'Biology', 'Chemistry', 'Physics',
  'Other',
];

const ACADEMIC_WORDS = new Set([
  'test', 'exam', 'quiz', 'hw', 'homework', 'essay', 'project', 'lab',
  'report', 'assignment', 'worksheet', 'midterm', 'final', 'paper', 'study',
]);

// Common non-academic words that share stems with subject aliases.
const DENY_STEMS = ['muffin', 'breakfast', 'lunch', 'dinner', 'food', 'recipe', 'english muffin'];

/**
 * Infer a canonical subject name from an event/task title.
 * Returns null when confidence is low to avoid false positives.
 */
export function inferSubjectFromTitle(title) {
  if (!title) return null;
  const lower = title.toLowerCase();
  if (DENY_STEMS.some(s => lower.includes(s))) return null;
  const hasAcademic = [...ACADEMIC_WORDS].some(w => lower.includes(w));
  if (!hasAcademic) return null;
  for (const [alias, canonical] of Object.entries(SUBJECT_ALIASES)) {
    if (new RegExp('\\b' + alias + '\\b', 'i').test(title)) return canonical;
  }
  for (const subject of SUBJECT_LIST) {
    const norm = subject.toLowerCase();
    if (norm !== 'other' && lower.includes(norm)) return subject.toLowerCase();
  }
  return null;
}
