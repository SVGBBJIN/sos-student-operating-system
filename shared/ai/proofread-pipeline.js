// Proofreading pipeline: classifier → specialist fan-out.
//
// Stage 1 — Classifier: one callGroq pass over the student's work (text or image).
//   Returns either { unified: { bucket, content } } or { segments: [{ bucket, content }] }.
//   Buckets: math | essay | worksheet | logic.
// Stage 2 — Specialists: one callGroq pass per segment, fanned out via Promise.all.
//   Each specialist returns { findings: [...], summary, [flow_notes]? } per the bucket contract.
//
// All passes parse JSON from result.content (no tool calls), because chat-core strips
// tools when imageBase64 is present (chat-core.js:829). JSON-in-content keeps the
// behavior identical between image and text input.

import { callGroq, PRIMARY_MODEL } from "./chat-core.js";

export const FLOW_ANALYSIS_WORD_THRESHOLD = 300;
export const PROOFREAD_BUCKETS = ["math", "essay", "worksheet", "logic"];

const NO_SOLUTIONS_DIRECTIVE =
  "Your goal is NEVER to give the answer directly. You proofread; you do not solve. " +
  "Point at where to look without supplying the correction. Preserve the student's voice. " +
  "If you ever feel tempted to write a corrected step, a rewritten sentence, or the right value, " +
  "replace it with a brief hint about which operation, transition, or claim looks off.";

const JSON_OUTPUT_DIRECTIVE =
  "Respond with ONLY a single JSON object. No prose before or after. No markdown fences. " +
  "If you cannot produce JSON, return {} and nothing else.";

const CLASSIFIER_SYSTEM_PROMPT = [
  "You are the proofreading classifier in a student tool. You receive a student's submitted work — possibly text, possibly a photo or scan.",
  "Your only job is to identify what kind of work it is, transcribe it cleanly, and split it into segments if it contains more than one kind of work.",
  "",
  "Buckets:",
  "- math: equations, calculations, step-by-step algebra/arithmetic.",
  "- essay: continuous prose responding to a writing prompt.",
  "- worksheet: a list of distinct prompts/questions with student answers next to each (mixed types possible).",
  "- logic: a chain of reasoning, proof, or argument with discrete inferences (not numeric math).",
  "",
  "Output schema (one of these two shapes only):",
  '  { "unified": { "bucket": "math|essay|worksheet|logic", "content": "<full transcribed text>" } }',
  '  { "segments": [ { "bucket": "...", "content": "..." }, ... ] }',
  "",
  "Use 'segments' ONLY when the work contains genuinely different kinds of content (e.g. a worksheet with both math problems and short-answer prompts).",
  "Otherwise prefer 'unified'. If an image is provided, transcribe its content into the 'content' field — preserve line breaks and step numbering.",
  "Do not add commentary. Do not include the original prompt. Do not summarize.",
  JSON_OUTPUT_DIRECTIVE,
].join("\n");

function specialistSystemPrompt(bucket, opts = {}) {
  const flowEnabled = bucket === "essay" && opts.includeFlowNotes;
  const lines = [
    NO_SOLUTIONS_DIRECTIVE,
    "",
    `You are the ${bucket} specialist in a student proofreading tool.`,
  ];

  if (bucket === "math") {
    lines.push(
      "Walk through the student's work step by step. For each step, decide whether the operation that produced it follows from the previous line.",
      "When a step does not follow, emit a finding pointing at WHICH operation looks off — e.g. 'check the subtraction on this line', 'this distribution is missing a term'. Never reveal the correct value or the corrected expression.",
      "",
      "Output schema:",
      '  { "summary": "<one short sentence>", "findings": [ { "step": <int 1-based>, "severity": "info|warn|error", "hint": "<<= 18 words>" } ] }'
    );
  } else if (bucket === "essay") {
    lines.push(
      "Read the essay against the optional prompt the student supplied.",
      "First check completeness: does the essay address every part of the prompt? Flag any part it skips or only glances at.",
      "Findings should reference the part of the prompt that's under-addressed and hint at the gap. Do NOT supply sample sentences or rewrites.",
      flowEnabled
        ? "Then check flow: scan paragraph transitions and tonal consistency. Emit flow_notes with vague hints — 'this transition feels abrupt', 'the voice shifts here' — never rewrites or example sentences."
        : "Skip flow analysis (the work is short).",
      "",
      "Output schema:",
      flowEnabled
        ? '  { "summary": "<one short sentence>", "findings": [ { "part": "<which part of the prompt>", "severity": "info|warn|error", "hint": "<<= 22 words>" } ], "flow_notes": [ { "paragraph": <int 1-based>, "hint": "<<= 22 words>" } ] }'
        : '  { "summary": "<one short sentence>", "findings": [ { "part": "<which part of the prompt>", "severity": "info|warn|error", "hint": "<<= 22 words>" } ] }'
    );
  } else if (bucket === "worksheet") {
    lines.push(
      "Treat the work as an ordered list of distinct prompts. For each prompt, decide whether the student answered it (answered, partial, missing) and emit one finding.",
      "For 'partial' or 'missing', hint at what's absent without supplying the answer. For 'answered' findings with quality issues, hint at the issue (clarity, completeness) — never the correction.",
      "",
      "Output schema:",
      '  { "summary": "<one short sentence>", "findings": [ { "prompt_index": <int 1-based>, "status": "answered|partial|missing", "severity": "info|warn|error", "hint": "<<= 22 words>" } ] }'
    );
  } else if (bucket === "logic") {
    lines.push(
      "Walk through the chain of reasoning step by step. For each inference, decide whether it follows from the previous claim(s).",
      "Flag non-sequiturs and unstated assumptions. Hint at the gap without supplying the missing inference.",
      "",
      "Output schema:",
      '  { "summary": "<one short sentence>", "findings": [ { "step": <int 1-based>, "severity": "info|warn|error", "hint": "<<= 22 words>" } ] }'
    );
  }

  lines.push("", JSON_OUTPUT_DIRECTIVE);
  return lines.join("\n");
}

function tryParseJson(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;

  // Strip markdown fences if the model added them despite instructions.
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }

  // Direct parse first.
  try { return JSON.parse(s); } catch (_) { /* fall through */ }

  // Forgiving fallback: take from first '{' to matching last '}'.
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch (_) { /* ignore */ }
  }
  return null;
}

function countWords(text) {
  if (typeof text !== "string") return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function normalizeBucket(bucket) {
  const b = typeof bucket === "string" ? bucket.trim().toLowerCase() : "";
  return PROOFREAD_BUCKETS.includes(b) ? b : null;
}

function normalizeClassification(parsed, fallbackContent) {
  if (!parsed || typeof parsed !== "object") {
    return { unified: { bucket: "essay", content: fallbackContent || "" } };
  }

  if (Array.isArray(parsed.segments) && parsed.segments.length > 0) {
    const segments = parsed.segments
      .map((s) => ({
        bucket: normalizeBucket(s?.bucket),
        content: typeof s?.content === "string" ? s.content.trim() : "",
      }))
      .filter((s) => s.bucket && s.content);
    if (segments.length === 1) {
      return { unified: segments[0] };
    }
    if (segments.length > 1) {
      return { segments };
    }
  }

  const u = parsed.unified;
  if (u && normalizeBucket(u.bucket) && typeof u.content === "string") {
    return { unified: { bucket: normalizeBucket(u.bucket), content: u.content.trim() } };
  }

  // Fallback: shape unrecognized — assume essay over the original input.
  return { unified: { bucket: "essay", content: fallbackContent || "" } };
}

async function runClassifier({ apiKey, text, imageBase64, imageMimeType, prompt }) {
  const userBlocks = [];
  if (prompt && typeof prompt === "string" && prompt.trim()) {
    userBlocks.push(`Prompt the student was given:\n${prompt.trim()}`);
  }
  if (text && text.trim()) {
    userBlocks.push(`Student work:\n${text.trim()}`);
  } else if (imageBase64) {
    userBlocks.push("Student work is in the attached image. Transcribe and classify it.");
  } else {
    throw new Error("Proofread classifier requires either text or imageBase64.");
  }

  const messages = [{ role: "user", content: userBlocks.join("\n\n") }];

  const result = await callGroq(
    apiKey,
    PRIMARY_MODEL,
    CLASSIFIER_SYSTEM_PROMPT,
    messages,
    1500,
    imageBase64 || null,
    imageMimeType || null,
    false,         // includeTools
    null,          // toolsOverride
    "auto",        // toolChoiceOverride (ignored, no tools)
    null,          // backupModel
    { isContentGen: true, budgetMs: 20000 }
  );

  const parsed = tryParseJson(result?.content || "");
  return normalizeClassification(parsed, text || "");
}

async function runSpecialist({ apiKey, bucket, content, prompt }) {
  const wordCount = countWords(content);
  const includeFlowNotes = bucket === "essay" && wordCount >= FLOW_ANALYSIS_WORD_THRESHOLD;
  const sysPrompt = specialistSystemPrompt(bucket, { includeFlowNotes });

  const userBlocks = [];
  if (prompt && typeof prompt === "string" && prompt.trim()) {
    userBlocks.push(`Prompt the student was given:\n${prompt.trim()}`);
  }
  userBlocks.push(`Student work:\n${content}`);

  const result = await callGroq(
    apiKey,
    PRIMARY_MODEL,
    sysPrompt,
    [{ role: "user", content: userBlocks.join("\n\n") }],
    1500,
    null, null,    // text-only — image already transcribed by classifier
    false,         // includeTools
    null,
    "auto",
    null,
    { isContentGen: true, budgetMs: 20000 }
  );

  const parsed = tryParseJson(result?.content || "") || {};
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const out = { bucket, content, summary, findings, wordCount };
  if (includeFlowNotes) {
    out.flow_notes = Array.isArray(parsed.flow_notes) ? parsed.flow_notes : [];
  }
  return out;
}

/**
 * @param {{
 *   apiKey: string,
 *   text?: string,
 *   imageBase64?: string | null,
 *   imageMimeType?: string | null,
 *   prompt?: string,
 * }} opts
 * @returns {Promise<{ classification: object, results: Array<object> }>}
 */
export async function runProofread(opts) {
  const { apiKey, text, imageBase64, imageMimeType, prompt } = opts || {};
  if (!apiKey) throw new Error("runProofread: apiKey is required.");
  if (!text && !imageBase64) throw new Error("runProofread: text or imageBase64 is required.");

  const classification = await runClassifier({ apiKey, text, imageBase64, imageMimeType, prompt });

  const segmentList = classification.segments
    ? classification.segments
    : [classification.unified];

  const results = await Promise.all(
    segmentList.map((seg) =>
      runSpecialist({ apiKey, bucket: seg.bucket, content: seg.content, prompt }).catch((err) => ({
        bucket: seg.bucket,
        content: seg.content,
        summary: "",
        findings: [],
        wordCount: countWords(seg.content),
        error: err?.message || "specialist_failed",
      }))
    )
  );

  return { classification, results };
}
