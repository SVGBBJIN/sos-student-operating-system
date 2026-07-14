// Server-side glue for the Hint & Work-Check system: the system prompts that
// encode the spec's behavior, plus the post-validation normalization that
// enforces the deterministic invariants on the work-check output.
//
// The Zod schemas (schemas/coaching.ts) gate shape; the pure rules
// (shared/coaching/workcheck.ts) gate the invariants. This module wires the two
// together and gives the chat-handler clean entry points.

import type { ChatAction } from "./chat-core.js";
import {
  normalizeCheckCards,
  computeCoverage,
  proofreadState,
  type ContentType,
  type RawCheckCard,
  type ProofreadState,
  type ProofreadTrigger,
} from "../coaching/workcheck.js";

// ── Clue (forward) ───────────────────────────────────────────────────────────

export const CLUE_SYSTEM =
  "You are the SOS clue surface. The student is ABOUT to work and is stuck at " +
  "the start. Call make_clue with exactly one forward clue whose only job is to " +
  "get them to a checkable attempt — never enough to solve the problem.\n" +
  "- Route by content type. Procedures (math/science): point at the method or " +
  "the first move, not the computation. Facts: nudge recall and the adjacent " +
  "idea, don't state the answer. Arguments (English/history): point at the move " +
  "the claim needs, not the claim.\n" +
  "- 'Still stuck' must NOT become a second clue. Set next_if_stuck to route the " +
  "student to put down any attempt so the check can show where it breaks.\n" +
  "- Cold start is fine: lean on general method, not the student's saved notes.\n" +
  "- Only fill deep_fallback (a parallel problem with different numbers/setup) " +
  "if the student has produced no attempt at all; never auto-reveal the original " +
  "answer.\n" +
  "No praise, no grade talk, no rewriting their work.";

export function buildClueContext(contentType: ContentType | null): string {
  if (!contentType) return "";
  return `\n\nDOMINANT_CONTENT_TYPE: ${contentType}. Tune the clue to this lane.`;
}

// ── Work-check (backward) ────────────────────────────────────────────────────

export const WORK_CHECK_SYSTEM =
  "You are the SOS work-check surface. The student has produced work and wants " +
  "to know where it is weakest. Call make_work_check. You evaluate THEIR work; " +
  "you never rewrite it (except the grammar lane) and you never predict, imply, " +
  "or hint at a grade or score.\n" +
  "- Evaluate against a common-sense rubric for the content_type. If the student " +
  "pasted a rubric or prompt, it OVERRIDES your internal criteria — paste wins, " +
  "it does not merely append. Pull real criteria out of pasted noise (ignore due " +
  "dates and boilerplate). If no rubric is present, set needs_rubric_nudge.\n" +
  "- Output cards: strengths first, then at MOST 3 gaps, and only the highest-" +
  "leverage spots. Never pad to a quota — one real gap is one card.\n" +
  "- Structural criteria (thesis present? evidence in this paragraph? correct " +
  "step?) are binary: mark addressed true/false. Qualitative criteria " +
  "('compelling', 'insightful') are NEVER checkboxes — deliver them as a question.\n" +
  "- Argument-lane gaps are interrogative: point at the weak joint (the broken " +
  "claim→evidence link) and make the student fill it. Do not prescribe the fix.\n" +
  "- Grammar/flow is the ONLY lane allowed to just-fix, as a low-confidence pass.\n" +
  "- Procedures: localize the broken step and name the CLASS of error. Facts: " +
  "give the answer plus a comprehension question on adjacent understanding.\n" +
  "- State that a step/claim is off and the class of error — never a confident " +
  "assertion that a specific line is wrong. Below confidence, hedge as a " +
  "question. Only check criteria assessable from the text in front of you; for " +
  "anything you cannot verify from the text, mark self_attest so the student " +
  "confirms it ('your teacher checks this').\n" +
  "Set coverage_total to the number of text-verifiable STRUCTURAL criteria you " +
  "checked. No praise strings.";

const TERMINAL_GUIDANCE =
  "\n\nFINAL STAGE: this is the terminal proofread round. If a structural " +
  "element is missing (e.g. no conclusion), surface it ONCE as a gentle question " +
  "in unwritten_note — do not flag unwritten content otherwise. After the cards, " +
  "the system hands the work back for a directed self-read; do not give a verdict.";

const DRAFTING_GUIDANCE =
  "\n\nDRAFTING STAGE: the student is still writing. Treat unwritten content as " +
  "an ignore signal — never flag something that simply is not there yet.";

const TRIGGER_GUIDANCE: Record<ProofreadTrigger, string> = {
  on_request: "",
  milestone:
    " This check was triggered automatically because the student just completed a " +
    "milestone task from their study plan — frame the opening as a quick check-in on " +
    "that deliverable, not a cold ask.",
  pre_submission:
    " This check was triggered automatically because the linked task is due soon — " +
    "prioritize anything that would block submission (missing required elements, " +
    "unaddressed rubric criteria) over stylistic nitpicks.",
};

export function buildWorkCheckContext(opts: {
  contentType: ContentType | null;
  proofread: ProofreadState;
  hasRubric: boolean;
  trigger?: ProofreadTrigger;
}): string {
  const parts: string[] = [];
  if (opts.contentType) parts.push(`DOMINANT_CONTENT_TYPE: ${opts.contentType}.`);
  parts.push(`PROOFREAD_ROUND: ${opts.proofread.round} of 2.`);
  if (!opts.hasRubric) {
    parts.push("No rubric pasted — gently nudge the student to paste theirs (set needs_rubric_nudge).");
  }
  const stage = opts.proofread.terminal ? TERMINAL_GUIDANCE : DRAFTING_GUIDANCE;
  const trigger = opts.trigger ? TRIGGER_GUIDANCE[opts.trigger] : "";
  return `\n\n${parts.join(" ")}${stage}${trigger}`;
}

// Apply the deterministic invariants to the validated make_work_check action:
// shape the cards (strengths first, ≤3 gaps, ≤5 total, confidence/qualitative
// hedging), compute the clamped coverage number, and attach the proofread state
// so the UI can render the terminal hand-back. Idempotent and pure-ish (no I/O).
export function normalizeWorkCheckAction(action: ChatAction, proofread: ProofreadState, trigger?: ProofreadTrigger): ChatAction {
  const rawCards = Array.isArray(action.cards) ? (action.cards as RawCheckCard[]) : [];
  const cards = normalizeCheckCards(rawCards);
  const coverage = computeCoverage(
    cards,
    typeof action.coverage_total === "number" ? action.coverage_total : undefined,
  );
  return {
    ...action,
    cards,
    coverage,
    proofread: { round: proofread.round, max: 2, terminal: proofread.terminal, trigger: trigger ?? "on_request" },
    // At the drafting stage an unwritten element is an ignore signal, so the
    // gentle "no conclusion yet?" prompt only survives at the terminal stage.
    unwritten_note: proofread.terminal ? action.unwritten_note : undefined,
  };
}

// Resolve the proofread state from the round count the client passes through.
// The client owns the per-assignment history (there is no server session
// store); we only need the count-in-window to derive the round + terminal flag.
export function resolveProofread(roundsUsedInWindow: number | undefined): ProofreadState {
  const used = Math.max(0, Math.floor(roundsUsedInWindow ?? 0));
  // Synthesize a history of `used` recent timestamps so the pure rule decides.
  const now = Date.now();
  const history = Array.from({ length: used }, () => now);
  return proofreadState(history, now);
}
