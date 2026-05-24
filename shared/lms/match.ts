// Fuzzy assignment → task matcher. Dependency-free token-set similarity.
//
// Lives in shared/ so the ingest layer (Node + Deno) matches identically.
// Threshold tuned to be forgiving of LMS title formatting ("Ch 4 HW —
// Quadratics" vs SOS task "Chapter 4 quadratics homework") without matching
// totally unrelated work.

export interface CandidateTask {
  id: string;
  title: string;
  subject?: string | null;
  status: string;
}

export interface MatchInput {
  assignmentTitle: string;
  courseName?: string | null;
}

export interface MatchResult {
  task: CandidateTask;
  score: number; // 0..1
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "on", "in",
  "ch", "chapter", "hw", "homework", "assignment", "due", "part",
  "no", "number", "page", "pg", "p", "vol", "volume", "unit",
]);

function normalize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(normalize(a));
  const tb = new Set(normalize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  // Sørensen–Dice gives a softer score than pure Jaccard when one title has
  // extra filler tokens, which fits the LMS-vs-shorthand case.
  return (2 * inter) / (ta.size + tb.size);
}

const MATCH_THRESHOLD = 0.5;
// Course-name match adds a small bonus when the SOS subject matches the LMS
// course (e.g. course "AP Biology", SOS subject "biology"). Never enough on its
// own — must combine with a non-trivial title overlap.
const SUBJECT_BONUS = 0.15;

export function pickBestMatch(
  input: MatchInput,
  candidates: CandidateTask[]
): MatchResult | null {
  if (candidates.length === 0) return null;
  let best: MatchResult | null = null;
  for (const task of candidates) {
    if (task.status === "done") continue;
    const titleScore = tokenSetRatio(input.assignmentTitle, task.title);
    if (titleScore <= 0) continue;
    let score = titleScore;
    if (input.courseName && task.subject) {
      const courseScore = tokenSetRatio(input.courseName, task.subject);
      if (courseScore > 0.3) score = Math.min(1, score + SUBJECT_BONUS);
    }
    if (!best || score > best.score) best = { task, score };
  }
  if (!best || best.score < MATCH_THRESHOLD) return null;
  return best;
}

export const MATCH_CONFIG = {
  threshold: MATCH_THRESHOLD,
  subjectBonus: SUBJECT_BONUS,
} as const;
