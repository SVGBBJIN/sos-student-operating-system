// Weighted-evidence confidence engine for LMS submission tracking.
//
// Pure, sync, no I/O — mirrors shared/scheduling/priority.ts. Lives in shared/
// so both api/lms-event.ts (Node) and supabase/functions/sos-lms-event (Deno)
// score events identically.
//
// Inputs: an ordered list of evidence rows for one (lms, assignment_id).
// Output: a 0–100 score, a bucket, and whether the matched task may be
// auto-completed. Caps prevent spam (e.g. many MutationObserver fires of the
// same "Turned in" text don't push the score past +70).

export type EvidenceKind =
  | "text_indicator"
  | "url_state"
  | "submission_post"
  | "upload"
  | "grade_posted"
  | "page_visit";

export interface Evidence {
  kind: EvidenceKind;
  // Detail is opaque; the engine only needs `kind`. Carried through so the
  // ingest layer can persist it on the event row for later debugging.
  detail?: Record<string, unknown>;
}

export type ConfidenceBucket = "submitted" | "likely_submitted" | "incomplete";

export interface ConfidenceOutcome {
  score: number;            // 0..100
  bucket: ConfidenceBucket;
  autoCompletable: boolean; // gated on strong evidence + corroboration
  corroborated: boolean;    // 2+ distinct medium/strong evidence kinds seen
  perEvidenceWeight: number[]; // capped weight contributed by each input event
}

// Per-event base weight and how many times that kind can contribute. Anything
// beyond `cap` is counted as 0 — keeps a noisy DOM from inflating the score.
const RULES: Record<EvidenceKind, { weight: number; cap: number }> = {
  text_indicator:   { weight: 70, cap: 1 },
  url_state:        { weight: 60, cap: 1 },
  submission_post:  { weight: 90, cap: 1 },
  upload:           { weight: 30, cap: 1 },
  grade_posted:     { weight: 95, cap: 1 },
  page_visit:       { weight: 10, cap: 3 },
};

// Evidence that is strong enough on its own to justify auto-completing the
// matched task. Uploads alone never qualify — many uploads succeed without the
// student actually clicking "submit".
const STRONG_EVIDENCE = new Set<EvidenceKind>([
  "submission_post",
  "grade_posted",
  "text_indicator",
]);

// Evidence kinds with weight ≥50 that count toward corroboration. A submission
// is corroborated when at least 2 distinct kinds from this set are present —
// meaning the signal came from more than one source (e.g., the DOM said
// "Turned in" AND the URL changed to the submission view, not just one alone).
const CORROBORATING_EVIDENCE = new Set<EvidenceKind>([
  "submission_post",
  "grade_posted",
  "text_indicator",
  "url_state",
]);

const SUBMITTED_THRESHOLD = 85;
const LIKELY_THRESHOLD = 50;

export function scoreEvidence(events: Evidence[]): ConfidenceOutcome {
  const usage = new Map<EvidenceKind, number>();
  const perEvidenceWeight: number[] = [];
  let total = 0;
  let hasStrong = false;
  const corroboratingKindsSeen = new Set<EvidenceKind>();

  for (const ev of events) {
    const rule = RULES[ev.kind];
    if (!rule) { perEvidenceWeight.push(0); continue; }
    const used = usage.get(ev.kind) ?? 0;
    if (used < rule.cap) {
      total += rule.weight;
      perEvidenceWeight.push(rule.weight);
      usage.set(ev.kind, used + 1);
      if (STRONG_EVIDENCE.has(ev.kind)) hasStrong = true;
      if (CORROBORATING_EVIDENCE.has(ev.kind)) corroboratingKindsSeen.add(ev.kind);
    } else {
      perEvidenceWeight.push(0);
    }
  }

  const score = Math.min(100, total);
  const bucket: ConfidenceBucket =
    score >= SUBMITTED_THRESHOLD ? "submitted"
    : score >= LIKELY_THRESHOLD  ? "likely_submitted"
    : "incomplete";

  const corroborated = corroboratingKindsSeen.size >= 2;

  return {
    score,
    bucket,
    // Require corroboration: 2+ independent medium/strong signals must agree
    // before we close a task without asking. A single DOM text change or a
    // single API post is not enough — both need to be present.
    autoCompletable: bucket === "submitted" && hasStrong && corroborated,
    corroborated,
    perEvidenceWeight,
  };
}

// Convenience: score after appending one new event. Mirrors what the ingest
// layer wants when persisting `confidence_after` per row.
export function scoreWithNew(prior: Evidence[], next: Evidence): ConfidenceOutcome {
  return scoreEvidence([...prior, next]);
}

export const CONFIDENCE_THRESHOLDS = {
  submitted: SUBMITTED_THRESHOLD,
  likely:    LIKELY_THRESHOLD,
} as const;

export function baseWeightFor(kind: EvidenceKind): number {
  return RULES[kind]?.weight ?? 0;
}
