// Deterministic rules for the Hint & Work-Check system.
// Pure functions, sync, no I/O — safe in both Node and Deno.
//
// The model authors the raw clue / work-check; these helpers enforce the
// invariants the spec requires regardless of what the model returns:
//   - content-type routing (procedure / fact / argument)
//   - card shaping: strengths first, hard cap of 3 gaps, ≤5 cards, no padding
//   - the coverage number ("N of 5 addressed") — never a score, never a grade
//   - confidence gating: low-confidence gaps hedge as questions, not verdicts
//   - the proofread cap: 2 rounds per assignment, resets every 2 hours
//
// None of these touch the student's prose. The check surfaces the weakest
// joints and hands the work back; it never rewrites (except the grammar lane).

export type ContentType = "procedure" | "fact" | "argument";

// Below this, a gap is hedged as a question instead of asserted as a verdict.
export const CONFIDENCE_THRESHOLD = 0.6;

// Card / coverage caps. The coverage number tops out at 5 — it is a coverage
// signal, never a grade, so it is intentionally capped low and unitless.
export const MAX_CARDS = 5;
export const MAX_GAPS = 3;
export const MAX_COVERAGE = 5;

// Proofread cap: 2 rounds per assignment, the window resets every 2 hours.
export const PROOFREAD_MAX_ROUNDS = 2;
export const PROOFREAD_WINDOW_MS = 2 * 60 * 60 * 1000;

// ── Content-type routing ─────────────────────────────────────────────────────
// Each task carries a dominant type; blended assignments resolve to one. LMS
// task type / subject metadata wins; free text is the fallback signal.

const PROCEDURE_SUBJECTS = new Set([
  "math", "calculus", "algebra", "geometry", "trigonometry", "statistics",
  "physics", "chemistry", "science", "biology", "engineering", "economics",
]);
const ARGUMENT_SUBJECTS = new Set([
  "english", "history", "literature", "writing", "philosophy", "government",
  "civics", "social studies", "ethics", "law", "politics",
]);

const PROCEDURE_HINTS = /\b(solve|calculate|compute|derive|prove|equation|integral|derivative|simplify|factor|evaluate|graph|balance|stoichi|problem\s*set|pset|show\s+your\s+work|step)\b/i;
const ARGUMENT_HINTS = /\b(essay|thesis|argue|argument|analy[sz]e|claim|evidence|persuad|paragraph|interpret|discuss|critique|compare|contrast|rhetoric|paper)\b/i;
const FACT_HINTS = /\b(define|definition|list|name|identify|recall|vocab|term|date|who|what\s+is|memori[sz]e|flashcard|fill\s+in\s+the\s+blank|matching)\b/i;

// Resolve the dominant content type from whatever signal is available. taskType
// (from LMS sync) is authoritative; otherwise subject, then the work text.
export function classifyContentType(input: {
  taskType?: string | null;
  subject?: string | null;
  text?: string | null;
}): ContentType {
  const explicit = (input.taskType ?? "").trim().toLowerCase();
  if (explicit === "procedure" || explicit === "fact" || explicit === "argument") {
    return explicit;
  }

  const subject = (input.subject ?? "").trim().toLowerCase();
  if (subject) {
    if (PROCEDURE_SUBJECTS.has(subject)) return "procedure";
    if (ARGUMENT_SUBJECTS.has(subject)) return "argument";
  }

  const text = input.text ?? "";
  // Score the three lanes from the text; the dominant lane wins ties toward
  // procedure (most narrowly checkable) then argument.
  const scores: Record<ContentType, number> = {
    procedure: countMatches(text, PROCEDURE_HINTS),
    argument: countMatches(text, ARGUMENT_HINTS),
    fact: countMatches(text, FACT_HINTS),
  };
  const best = (Object.entries(scores) as [ContentType, number][])
    .sort((a, b) => b[1] - a[1]);
  if (best[0]![1] === 0) return "argument"; // unknown → treat as argument (most cautious, interrogative lane)
  return best[0]![0];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function countMatches(text: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const m = text.match(g);
  return m ? m.length : 0;
}

// ── Work-check card shaping ──────────────────────────────────────────────────

export type CardKind = "strength" | "gap";
export type CriterionKind = "structural" | "qualitative";
export type CardLane = "content" | "grammar";

export interface RawCheckCard {
  kind: CardKind;
  criterion_kind?: CriterionKind;
  lane?: CardLane;
  text: string;
  addressed?: boolean;
  confidence?: number;
  self_attest?: boolean;
}

export interface CheckCard {
  kind: CardKind;
  criterion_kind: CriterionKind;
  lane: CardLane;
  text: string;
  // Only meaningful for structural criteria; feeds the coverage count.
  addressed: boolean;
  confidence: number;
  // Derived: render this gap as a question, not a verdict. True when the model
  // is below the confidence threshold or the criterion is qualitative. The
  // grammar lane is the one exception — it is always allowed to just-fix.
  hedged: boolean;
  // Self-attested items remind, they never count toward coverage.
  self_attest: boolean;
}

// Normalize the model's raw cards into the shape the UI renders and the spec
// guarantees: strengths first, ≤3 gaps, ≤5 cards total, never padded to a
// quota, low-confidence / qualitative gaps demoted to questions.
export function normalizeCheckCards(raw: RawCheckCard[]): CheckCard[] {
  const cards = (raw ?? []).filter((c) => c && typeof c.text === "string" && c.text.trim().length > 0);

  const shape = (c: RawCheckCard): CheckCard => {
    const lane: CardLane = c.lane === "grammar" ? "grammar" : "content";
    const criterion_kind: CriterionKind = c.criterion_kind === "qualitative" ? "qualitative" : "structural";
    const confidence = clamp01(typeof c.confidence === "number" ? c.confidence : 1);
    const self_attest = Boolean(c.self_attest);
    // Grammar rides the just-fix lane; everything qualitative or under-confident
    // is handed back as a question so the student fills the joint themselves.
    const hedged = lane === "grammar"
      ? false
      : criterion_kind === "qualitative" || confidence < CONFIDENCE_THRESHOLD;
    return {
      kind: c.kind === "strength" ? "strength" : "gap",
      criterion_kind,
      lane,
      text: c.text.trim(),
      addressed: Boolean(c.addressed),
      confidence,
      hedged,
      self_attest,
    };
  };

  const strengths = cards.filter((c) => c.kind === "strength").map(shape);
  // Gaps: keep the highest-leverage few. Hard cap of 3, never padded.
  const gaps = cards.filter((c) => c.kind === "gap").map(shape).slice(0, MAX_GAPS);

  // Total cap of 5. Gaps are the point of the check, so they hold their slots;
  // strengths fill whatever room is left (strengths-first ordering preserved).
  const strengthRoom = Math.max(0, MAX_CARDS - gaps.length);
  return [...strengths.slice(0, strengthRoom), ...gaps];
}

export interface Coverage {
  addressed: number;
  total: number;
}

// The coverage number: "N of 5 addressed". Counts only text-verifiable
// structural criteria; self-attested items never count. Clamped so it can
// never read as a score or imply a grade.
export function computeCoverage(cards: CheckCard[], declaredTotal?: number): Coverage {
  const structural = cards.filter(
    (c) => c.criterion_kind === "structural" && c.lane === "content" && !c.self_attest,
  );
  const addressed = structural.filter((c) => c.addressed).length;
  // total: prefer the model's declared structural-criteria count, but never let
  // it exceed the cap or drop below what we can already see addressed.
  let total = typeof declaredTotal === "number" && declaredTotal > 0 ? Math.round(declaredTotal) : structural.length;
  total = Math.min(MAX_COVERAGE, Math.max(addressed, total, 1));
  return { addressed: Math.min(addressed, total), total };
}

// ── Proofread cap ────────────────────────────────────────────────────────────

export interface ProofreadState {
  // The round this attempt would be (1-based). Capped at PROOFREAD_MAX_ROUNDS.
  round: number;
  roundsUsed: number;
  // Whether a fresh proofread round is still allowed in the current window.
  allowed: boolean;
  // Reaching the terminal = the final-mode signal: the last allowed round,
  // after which the system hands the work back with a directed self-read.
  terminal: boolean;
  // When the current window rolls over and rounds reset.
  resetsAt: number;
}

// ── Automatic proofread triggers ─────────────────────────────────────────────
// The work-check used to fire only on-request (the student asks, or the
// client's keyword detector fires). These two triggers make it proactive:
//   - milestone: a milestone task tied to a study_plan was just marked done —
//     good moment to check the deliverable before moving on.
//   - pre_submission: a task's due date is within the submission window and
//     the task has draftable content (a note/attempt) attached — last chance
//     to check before it's due.
// Both are nudges, never forced: they surface a suggestion the student can
// accept or dismiss, and still spend a round against the same 2h/2-round cap
// so an auto-triggered check and an on-request check can't be stacked to
// evade the limit.

export type ProofreadTrigger = "on_request" | "milestone" | "pre_submission";

// How close to the deadline "pre-submission" starts being offered.
export const PRE_SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AutoProofreadInput {
  isMilestoneTask?: boolean;
  dueAt?: number | null; // epoch ms
  hasDraftContent?: boolean; // a note/attempt is attached to work from
  now?: number;
}

// Decide whether an automatic nudge should fire, and under what trigger. Pure
// and read-only — callers still run this through proofreadState() to confirm
// a round is actually available before executing the check.
export function resolveAutoProofreadTrigger(input: AutoProofreadInput): ProofreadTrigger | null {
  if (!input.hasDraftContent) return null;
  if (input.isMilestoneTask) return "milestone";
  const now = input.now ?? Date.now();
  if (typeof input.dueAt === "number" && input.dueAt > now && input.dueAt - now <= PRE_SUBMISSION_WINDOW_MS) {
    return "pre_submission";
  }
  return null;
}

// Given the timestamps of prior proofread rounds for one assignment, decide what
// the next attempt is. The window slides: rounds older than 2 hours fall away,
// and each new window re-checks the full work fresh.
export function proofreadState(history: number[], now: number = Date.now()): ProofreadState {
  const inWindow = (history ?? []).filter((t) => typeof t === "number" && now - t < PROOFREAD_WINDOW_MS);
  const roundsUsed = inWindow.length;
  const allowed = roundsUsed < PROOFREAD_MAX_ROUNDS;
  const round = Math.min(roundsUsed + 1, PROOFREAD_MAX_ROUNDS);
  // This attempt is terminal when it is (or would be) the final allowed round.
  const terminal = round >= PROOFREAD_MAX_ROUNDS;
  const oldest = inWindow.length > 0 ? Math.min(...inWindow) : now;
  const resetsAt = oldest + PROOFREAD_WINDOW_MS;
  return { round, roundsUsed, allowed, terminal, resetsAt };
}
