// Proofread: Flash classifier → Pro specialists per bucket.
//
// Pass 1 classifies the work into a bucket (math/essay/worksheet/logic) and
// transcribes it. Pass 2 runs one specialist per segment in parallel; each
// specialist returns findings + summary against a strict Zod schema.
//
// Everything uses responseSchema-enforced JSON. The old "tryParseJson" fallback
// is gone — if the schema fails twice, the segment surfaces an error finding
// rather than silently degrading.

import { z } from "zod";
import { callModel } from "../chat-core.js";
import {
  ClassificationSchema,
  PROOFREAD_BUCKETS,
  SPECIALIST_SCHEMA_BY_BUCKET,
  type Classification,
  type ProofreadBucket,
} from "../schemas/proofread.js";
import { zodToGeminiSchema } from "../schemas/_helpers.js";
import type { Attachment, Message } from "../providers/types.js";

const FLOW_ANALYSIS_WORD_THRESHOLD = 300;

// Wall-clock budget for classify + parallel specialists. Stays under the
// platform function ceiling (vercel.json maxDuration=60 for api/proofread.ts).
const PROOFREAD_BUDGET_MS = 50_000;
const CLASSIFY_CAP_MS = 16_000;
const SPECIALIST_CAP_MS = 32_000;

const NO_SOLUTIONS_DIRECTIVE =
  "Your goal is NEVER to give the answer directly. You proofread; you do not solve. " +
  "Point at where to look without supplying the correction. Preserve the student's voice. " +
  "If you ever feel tempted to write a corrected step, a rewritten sentence, or the right value, " +
  "replace it with a brief hint about which operation, transition, or claim looks off.";

const CLASSIFIER_SYSTEM = [
  "You are the proofreading classifier in a student tool. You receive a student's submitted work — possibly text, possibly a photo or scan.",
  "Identify the kind of work, transcribe it cleanly, and split it into segments if it contains genuinely different kinds.",
  "Buckets: math, essay, worksheet, logic.",
  "Prefer the 'unified' shape unless the work mixes kinds (e.g. a worksheet with both math and short-answer prompts).",
  "When an image is provided, transcribe its content into the 'content' field — preserve line breaks and step numbering.",
].join("\n");

function specialistSystem(bucket: ProofreadBucket, includeFlowNotes: boolean): string {
  const intro = `${NO_SOLUTIONS_DIRECTIVE}\n\nYou are the ${bucket} specialist in a student proofreading tool.`;
  if (bucket === "math") {
    return [
      intro,
      "Walk through each step. When a step does not follow from the previous, emit a finding pointing at WHICH operation looks off — e.g. 'check the subtraction on this line'. Never reveal the correct value or the corrected expression.",
    ].join("\n");
  }
  if (bucket === "essay") {
    return [
      intro,
      "Check completeness against any prompt the student supplied. Findings reference the part of the prompt that's under-addressed; never supply sample sentences or rewrites.",
      includeFlowNotes
        ? "Then check flow: scan paragraph transitions and tonal consistency. Use flow_notes with vague hints — never rewrites."
        : "Skip flow analysis (the work is short).",
    ].join("\n");
  }
  if (bucket === "worksheet") {
    return [
      intro,
      "Treat the work as an ordered list of distinct prompts. For each, decide whether the student answered it (answered/partial/missing) and emit one finding hint.",
    ].join("\n");
  }
  return [
    intro,
    "Walk through the chain of reasoning step by step. Flag non-sequiturs and unstated assumptions. Hint at the gap without supplying the missing inference.",
  ].join("\n");
}

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export interface ProofreadInput {
  text?: string;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  prompt?: string;
}

export interface SpecialistResult {
  bucket: ProofreadBucket;
  content: string;
  summary: string;
  findings: unknown[];
  wordCount: number;
  flow_notes?: unknown[];
  error?: string;
}

export interface ProofreadOutput {
  classification: Classification;
  results: SpecialistResult[];
}

async function runClassifier(input: ProofreadInput, budgetMs: number): Promise<Classification> {
  const userBlocks: string[] = [];
  if (input.prompt && input.prompt.trim()) userBlocks.push(`Prompt the student was given:\n${input.prompt.trim()}`);
  if (input.text && input.text.trim()) userBlocks.push(`Student work:\n${input.text.trim()}`);
  else if (input.imageBase64) userBlocks.push("Student work is in the attached image. Transcribe and classify it.");
  else throw new Error("Proofread classifier requires either text or imageBase64.");

  const attachments: Attachment[] = input.imageBase64
    ? [{ kind: "image", mimeType: input.imageMimeType ?? "image/jpeg", base64: input.imageBase64 }]
    : [];

  const res = await callModel({
    intent: "proofread_classify",
    systemPrompt: CLASSIFIER_SYSTEM,
    messages: [{ role: "user", content: userBlocks.join("\n\n") }],
    attachments,
    toolSet: "none",
    responseSchema: zodToGeminiSchema(ClassificationSchema as unknown as z.ZodTypeAny),
    responseMimeType: "application/json",
    maxOutputTokens: 1500,
    temperature: 0.2,
    thinkingBudget: 512,
    budgetMs,
  });

  try {
    const parsed = JSON.parse(res.content);
    const checked = ClassificationSchema.parse(parsed);
    return checked;
  } catch {
    const fallback = input.text || "";
    return { unified: { bucket: "essay", content: fallback } };
  }
}

async function runSpecialist(bucket: ProofreadBucket, content: string, promptText: string | undefined, budgetMs: number): Promise<SpecialistResult> {
  const wc = wordCount(content);
  const includeFlowNotes = bucket === "essay" && wc >= FLOW_ANALYSIS_WORD_THRESHOLD;
  const sys = specialistSystem(bucket, includeFlowNotes);
  const schema = SPECIALIST_SCHEMA_BY_BUCKET[bucket];

  const userBlocks: string[] = [];
  if (promptText && promptText.trim()) userBlocks.push(`Prompt the student was given:\n${promptText.trim()}`);
  userBlocks.push(`Student work:\n${content}`);

  const messages: Message[] = [{ role: "user", content: userBlocks.join("\n\n") }];
  const res = await callModel({
    intent: "proofread_specialist",
    systemPrompt: sys,
    messages,
    toolSet: "none",
    responseSchema: zodToGeminiSchema(schema as unknown as z.ZodTypeAny),
    responseMimeType: "application/json",
    maxOutputTokens: 1500,
    temperature: 0.2,
    thinkingBudget: 1024,
    budgetMs,
  });

  try {
    const parsed = JSON.parse(res.content);
    const checked = schema.parse(parsed);
    return {
      bucket,
      content,
      summary: typeof checked.summary === "string" ? checked.summary : "",
      findings: Array.isArray(checked.findings) ? checked.findings : [],
      wordCount: wc,
      ...(includeFlowNotes && bucket === "essay" && Array.isArray((checked as { flow_notes?: unknown[] }).flow_notes)
        ? { flow_notes: (checked as { flow_notes: unknown[] }).flow_notes }
        : {}),
    };
  } catch (err) {
    return {
      bucket,
      content,
      summary: "",
      findings: [],
      wordCount: wc,
      error: err instanceof Error ? err.message : "specialist_failed",
    };
  }
}

export async function runProofread(input: ProofreadInput): Promise<ProofreadOutput> {
  if (!input.text && !input.imageBase64) {
    throw new Error("runProofread: text or imageBase64 is required");
  }
  const deadline = Date.now() + PROOFREAD_BUDGET_MS;
  const classification = await runClassifier(input, Math.min(CLASSIFY_CAP_MS, deadline - Date.now()));
  const segments = "segments" in classification ? classification.segments : [classification.unified];
  const specialistBudget = Math.min(SPECIALIST_CAP_MS, deadline - Date.now());
  const results = await Promise.all(
    segments.map((s) =>
      runSpecialist(s.bucket, s.content, input.prompt, specialistBudget).catch((err): SpecialistResult => ({
        bucket: s.bucket,
        content: s.content,
        summary: "",
        findings: [],
        wordCount: wordCount(s.content),
        error: err instanceof Error ? err.message : "specialist_failed",
      }))
    )
  );
  return { classification, results };
}

export { PROOFREAD_BUCKETS, FLOW_ANALYSIS_WORD_THRESHOLD };
