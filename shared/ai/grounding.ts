// Anti-hallucination grounding for chat-proposed names.
//
// Runs after schema validation on default-chat actions only (callModel gates it
// behind `groundTitles`, set by chat-handler on the default chat path — brain_dump
// and the forced content pipelines are untouched). Two layers:
//
//   1. Lexical (sync, free). A multi-word title can embed a filler token —
//      "untitled", "tbd", "tba", "n/a", "placeholder" — that the student never
//      typed. titleLikeString already rejects a title that IS exactly a
//      placeholder; this catches the filler buried inside an otherwise-plausible
//      name ("Untitled Chemistry Event"). A filler is only a problem when it
//      does NOT appear in the student's own words — if they literally said
//      "tbd", we respect it.
//
//   2. Vector (async, bounded, best-effort). The proposed name must have a
//      strong semantic association with something the student actually said.
//      Catches invented specifics no regex can ("add my bio thing" →
//      "Cellular Respiration Midterm Exam"). An embedding failure or timeout
//      fails OPEN — we never block a save because the embed round-trip was slow.
//
// A failed check is non-destructive: the action is pulled and replaced with a
// soft clarification so the student confirms the name. We ask, never guess.

import { embedCoalesced } from "./rag/embeddings.js";
import { embedModel } from "./router.js";
import type { Message } from "./providers/types.js";

// Unambiguous "I don't know yet" fillers. Deliberately tight — words that could
// legitimately appear in a real name (default, sample, example) are excluded so
// we never squash a valid creative title.
const FILLER_TOKENS = new Set([
  "untitled", "tbd", "tba", "n/a", "na",
  "placeholder", "unnamed", "unspecified", "unknown",
]);

// Below this cosine, the name has no strong association with anything the
// student said. Conservative on purpose — we want to catch fantasy, not squash
// creative-but-valid names. Related short texts sit well above this; unrelated
// ones fall below.
const MIN_VECTOR_SIM = 0.4;

// Free pre-gate before spending an embedding request. If this fraction of a
// name's content words already appear verbatim in the student's recent
// messages, it's clearly grounded — skip the embed entirely. Only genuinely
// novel-looking names pay for a vector check. This is what keeps the embedding
// request count near zero on the common "add chem test friday" turn.
const MIN_LEXICAL_OVERLAP = 0.6;

// Common words that carry no grounding signal — excluded from the overlap ratio
// so a name isn't deemed "grounded" just because it shares "the"/"my" with the
// message.
const STOPWORDS = new Set([
  "a", "an", "the", "my", "our", "your", "of", "for", "to", "and", "or", "in",
  "on", "at", "with", "this", "that", "is", "are", "be", "do", "i", "me", "we",
  "add", "new", "set", "up", "it",
]);

// Embedding dimension for the ad-hoc similarity check. Smaller than the 1536-d
// persisted store (cheaper/faster); both sides of the comparison use the same
// dim, so the persisted store's dim is irrelevant here.
const SIM_DIM = 768;

const WORD_RE = /[a-z0-9]+/gi;

function tokenize(s: string): string[] {
  return s.toLowerCase().match(WORD_RE) ?? [];
}

function userMessageContents(messages: Message[]): string[] {
  return messages
    .filter((m) => m.role === "user" && typeof m.content === "string")
    .map((m) => m.content.trim())
    .filter((c) => c.length > 0);
}

// Layer 1 — returns the offending filler token, or null if grounded.
export function lexicalUngroundedToken(title: string, historyTokens: Set<string>): string | null {
  for (const tok of tokenize(title)) {
    if (FILLER_TOKENS.has(tok) && !historyTokens.has(tok)) return tok;
  }
  return null;
}

// Free pre-gate — fraction of the name's content words (non-stopword) that
// appear in the student's recent messages. 1 when every meaningful word echoes
// the conversation; 0 when none do. Returns 0 when the name has no content
// words (e.g. all stopwords) so those fall through to the vector check.
export function lexicalOverlap(title: string, historyTokens: Set<string>): number {
  const content = tokenize(title).filter((t) => !STOPWORDS.has(t));
  if (content.length === 0) return 0;
  const hit = content.filter((t) => historyTokens.has(t)).length;
  return hit / content.length;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("grounding embed timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// ── Per-action policy ────────────────────────────────────────────────────────
// manage_task is already expanded into its per-operation type before grounding
// runs, so we list the expanded types here.

const NAME_FIELDS = ["title", "task_name", "activity"] as const;

// Names that get the vector (fantasy-specifics) check. Creation verbs only —
// where an invented name is the real risk.
const VECTOR_CHECKED = new Set(["add_event", "add_task"]);

// Names that get the lexical (buried-placeholder) check. Creation verbs plus the
// follow-up task verbs whose title identifies an existing task.
const LEXICAL_CHECKED = new Set([
  "add_event", "add_task", "add_block", "add_recurring_event",
  "update_task", "delete_task", "complete_task", "postpone_task",
]);

function nameOf(action: Record<string, unknown>): { field: string; value: string } | null {
  for (const f of NAME_FIELDS) {
    const v = action[f];
    if (typeof v === "string" && v.trim().length > 0) return { field: f, value: v.trim() };
  }
  return null;
}

export interface GroundingFlag {
  action: Record<string, unknown>;
  type: string;
  field: string;
  value: string;
  reason: string;
}

export interface GroundingOutcome<T> {
  kept: T[];
  flagged: GroundingFlag[];
}

// Verify the names on a batch of default-chat actions. Lexical layer is sync and
// always runs; the vector layer runs once per turn (a single batched embed of
// every candidate name + the recent student messages) and fails open.
export async function groundActionNames<T extends Record<string, unknown>>(opts: {
  actions: T[];
  messages: Message[];
  timeoutMs?: number;
}): Promise<GroundingOutcome<T>> {
  const { actions, messages } = opts;
  const userMsgs = userMessageContents(messages).slice(-6);
  const historyTokens = new Set(tokenize(userMsgs.join("\n")));

  const kept: T[] = [];
  const flagged: GroundingFlag[] = [];
  // Survivors of the lexical layer that still need a vector check.
  const vectorPending: { action: T; type: string; field: string; value: string }[] = [];

  for (const action of actions) {
    const type = String(action.type ?? "");
    const named = nameOf(action);
    if (!named || (!LEXICAL_CHECKED.has(type) && !VECTOR_CHECKED.has(type))) {
      kept.push(action);
      continue;
    }
    if (LEXICAL_CHECKED.has(type)) {
      const token = lexicalUngroundedToken(named.value, historyTokens);
      if (token) {
        flagged.push({
          action, type, field: named.field, value: named.value,
          reason: `The name "${named.value}" contains "${token}", which you didn't mention — I don't want to save a placeholder.`,
        });
        continue;
      }
    }
    if (VECTOR_CHECKED.has(type)) {
      // Free pre-gate: a name whose words already echo the conversation is
      // grounded — don't spend an embedding request on it.
      if (lexicalOverlap(named.value, historyTokens) >= MIN_LEXICAL_OVERLAP) {
        kept.push(action);
      } else {
        vectorPending.push({ action, type, field: named.field, value: named.value });
      }
    } else {
      kept.push(action);
    }
  }

  if (vectorPending.length === 0 || userMsgs.length === 0) {
    for (const p of vectorPending) kept.push(p.action);
    return { kept, flagged };
  }

  // Single coalesced embed: [...candidate names, ...recent student messages].
  // Routed to the secondary embedding model — this similarity is self-contained
  // (both sides embedded together, never compared against the persisted store),
  // so it never spends the primary model's RAG/memory request budget. The
  // coalescer further merges concurrent grounding turns into one upstream call.
  let vectors: number[][] | null = null;
  try {
    const names = vectorPending.map((p) => p.value);
    vectors = await withTimeout(
      embedCoalesced([...names, ...userMsgs], {
        taskType: "SEMANTIC_SIMILARITY",
        dim: SIM_DIM,
        model: embedModel("secondary"),
      }),
      opts.timeoutMs ?? 2500
    );
  } catch {
    vectors = null; // fail open
  }

  if (!vectors || vectors.length < vectorPending.length + 1) {
    // Embed unavailable — keep everything the lexical layer let through.
    for (const p of vectorPending) kept.push(p.action);
    return { kept, flagged };
  }

  const msgVecs = vectors.slice(vectorPending.length);
  vectorPending.forEach((p, i) => {
    const nameVec = vectors![i]!;
    const sim = msgVecs.length > 0 ? Math.max(...msgVecs.map((v) => cosine(nameVec, v))) : 1;
    if (sim < MIN_VECTOR_SIM) {
      flagged.push({
        action: p.action, type: p.type, field: p.field, value: p.value,
        reason: `I couldn't tie the name "${p.value}" back to anything you said (semantic match ${sim.toFixed(2)}), so I want to confirm before saving.`,
      });
    } else {
      kept.push(p.action);
    }
  });

  return { kept, flagged };
}
