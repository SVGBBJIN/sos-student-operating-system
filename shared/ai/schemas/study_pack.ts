// Zod schema for the Study Pack generation tool.
//
// A study pack bundles every study artifact for one topic in a single
// structured tool call: an exam-focused summary, key concepts, flashcards and
// a multiple-choice quiz. Artifact shapes mirror studio.ts so the existing
// flashcard / quiz display components can render them unchanged.

import { z } from "zod";
import type { ToolDef } from "../providers/types.js";
import { zodToGeminiSchema } from "./_helpers.js";

export const MakeStudyPackSchema = z.object({
  type: z.literal("make_study_pack"),
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(80).optional(),
  topic: z.string().min(1).max(200).optional(),
  summary: z.array(z.string().min(1).max(500)).min(1).max(15),
  key_concepts: z.array(z.string().min(1).max(200)).min(1).max(20),
  flashcards: z.array(z.object({
    q: z.string().min(1).max(500),
    a: z.string().min(1).max(2000),
  })).min(4).max(30),
  quiz: z.array(z.object({
    q: z.string().min(1).max(500),
    choices: z.array(z.string().min(1).max(300)).min(2).max(6),
    answer: z.string().min(1).max(300),
    explanation: z.string().max(2000).optional(),
  })).min(3).max(15),
});

export type MakeStudyPackInput = z.infer<typeof MakeStudyPackSchema>;

export const STUDY_PACK_SCHEMAS = {
  make_study_pack: MakeStudyPackSchema,
} as const;

export type StudyPackToolName = keyof typeof STUDY_PACK_SCHEMAS;

const STUDY_PACK_DESCRIPTIONS: Record<StudyPackToolName, string> = {
  make_study_pack:
    "Generate a complete study pack for one topic: an exam-focused bullet " +
    "summary, the key concepts, flashcards, and a multiple-choice quiz with " +
    "an answer key. Extract the concepts from the provided material; do not " +
    "invent facts. Outputs must be ready to study with no further editing.",
};

export function buildStudyPackToolDefs(): ToolDef[] {
  return (Object.keys(STUDY_PACK_SCHEMAS) as StudyPackToolName[]).map((name) => ({
    name,
    description: STUDY_PACK_DESCRIPTIONS[name],
    parameters: zodToGeminiSchema(STUDY_PACK_SCHEMAS[name]),
  }));
}

export function validateStudyPack(name: string, args: unknown):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; issues: z.ZodIssue[] } {
  const schema = STUDY_PACK_SCHEMAS[name as StudyPackToolName];
  if (!schema) return { ok: false, issues: [{ code: z.ZodIssueCode.custom, path: [], message: `Unknown study pack tool: ${name}` }] };
  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true, data: parsed.data as Record<string, unknown> };
  return { ok: false, issues: parsed.error.issues };
}
