// Common abbreviations teens use → expanded form
export const SUBJECT_ALIASES = {
  calc:'calculus', math:'mathematics', bio:'biology', chem:'chemistry',
  phys:'physics', eng:'english', hist:'history', sci:'science', span:'spanish',
  econ:'economics', psych:'psychology', gov:'government', geo:'geography',
  pe:'physical education', gym:'physical education', lit:'literature',
  cs:'computer science', comp:'computer science', la:'language arts'
};

export const SUBJECT_ALIAS_PATTERNS = Object.entries(SUBJECT_ALIASES).map(
  ([short, long]) => ({ regex: new RegExp('\\b' + short + '\\b', 'g'), replacement: long })
);

export function normalize(str) {
  if (!str) return '';
  let s = str.toLowerCase().trim();
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
  if (q === t) return 100;
  if (t.includes(q)) return 80;
  if (q.includes(t)) return 70;
  const qWords = q.split(/\s+/);
  const tWords = t.split(/\s+/);
  const overlap = qWords.filter(w => tWords.some(tw => tw.includes(w) || w.includes(tw))).length;
  if (overlap > 0) return 30 + (overlap / qWords.length) * 40;
  return 0;
}
