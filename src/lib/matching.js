// Fuzzy name resolution: translate the loose names the AI emits ("the math
// test", "bio hw") into real event/task objects. Pure — no React/app state.

// Common abbreviations teens use → expanded form
const SUBJECT_ALIASES = {
  calc: 'calculus', math: 'mathematics', bio: 'biology', chem: 'chemistry',
  phys: 'physics', eng: 'english', hist: 'history', sci: 'science', span: 'spanish',
  econ: 'economics', psych: 'psychology', gov: 'government', geo: 'geography',
  pe: 'physical education', gym: 'physical education', lit: 'literature',
  cs: 'computer science', comp: 'computer science', la: 'language arts',
};

const SUBJECT_ALIAS_PATTERNS = Object.entries(SUBJECT_ALIASES).map(
  ([short, long]) => ({ regex: new RegExp('\\b' + short + '\\b', 'g'), replacement: long })
);

export function normalize(str) {
  if (!str) return '';
  let s = str.toLowerCase().trim();
  // expand known abbreviations
  for (const { regex, replacement } of SUBJECT_ALIAS_PATTERNS) {
    regex.lastIndex = 0;
    s = s.replace(regex, replacement);
  }
  return s;
}

// Score how well two strings match (higher = better, 0 = no match)
export function matchScore(query, target) {
  const q = normalize(query);
  const t = normalize(target);
  if (!q || !t) return 0;
  if (q === t) return 100;               // exact match
  if (t.includes(q)) return 80;          // target contains query ("Math Test" contains "math")
  if (q.includes(t)) return 70;          // query contains target ("cancel the math test" contains "math test")
  // word overlap — how many query words appear in target
  const qWords = q.split(/\s+/);
  const tWords = t.split(/\s+/);
  const overlap = qWords.filter(w => tWords.some(tw => tw.includes(w) || w.includes(tw))).length;
  if (overlap > 0) return 30 + (overlap / qWords.length) * 40;
  return 0;
}

// Find the best-matching event from the array. Returns the event object or null.
export function resolveEvent(nameOrId, eventsList) {
  if (!nameOrId || !eventsList?.length) return null;
  // 1. Try exact ID match first
  const byId = eventsList.find(ev => ev.id === nameOrId);
  if (byId) return byId;
  // 2. Score every event by name similarity, pick the best
  let best = null, bestScore = 0;
  for (const ev of eventsList) {
    const s = matchScore(nameOrId, ev.title);
    if (s > bestScore) { bestScore = s; best = ev; }
  }
  return bestScore >= 30 ? best : null;
}

// Find the best-matching task from the array. Returns the task object or null.
export function resolveTask(nameOrId, tasksList) {
  if (!nameOrId || !tasksList?.length) return null;
  const byId = tasksList.find(t => t.id === nameOrId);
  if (byId) return byId;
  let best = null, bestScore = 0;
  for (const t of tasksList) {
    const s = matchScore(nameOrId, t.title);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return bestScore >= 30 ? best : null;
}
