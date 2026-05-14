// Strict response schemas for the proofread classifier + bucket specialists.

import { z } from "zod";

export const PROOFREAD_BUCKETS = ["math", "essay", "worksheet", "logic"] as const;
export const bucketEnum = z.enum(PROOFREAD_BUCKETS);
export type ProofreadBucket = z.infer<typeof bucketEnum>;

export const ClassificationSchema = z.union([
  z.object({
    unified: z.object({
      bucket: bucketEnum,
      content: z.string().min(1),
    }),
  }),
  z.object({
    segments: z.array(z.object({
      bucket: bucketEnum,
      content: z.string().min(1),
    })).min(1),
  }),
]);
export type Classification = z.infer<typeof ClassificationSchema>;

export const MathSpecialistSchema = z.object({
  summary: z.string().max(500).optional(),
  findings: z.array(z.object({
    step: z.number().int().min(1),
    severity: z.enum(["info", "warn", "error"]),
    hint: z.string().max(200),
  })).default([]),
});

export const EssaySpecialistSchema = z.object({
  summary: z.string().max(500).optional(),
  findings: z.array(z.object({
    part: z.string().max(200),
    severity: z.enum(["info", "warn", "error"]),
    hint: z.string().max(300),
  })).default([]),
  flow_notes: z.array(z.object({
    paragraph: z.number().int().min(1),
    hint: z.string().max(300),
  })).optional(),
});

export const WorksheetSpecialistSchema = z.object({
  summary: z.string().max(500).optional(),
  findings: z.array(z.object({
    prompt_index: z.number().int().min(1),
    status: z.enum(["answered", "partial", "missing"]),
    severity: z.enum(["info", "warn", "error"]),
    hint: z.string().max(300),
  })).default([]),
});

export const LogicSpecialistSchema = z.object({
  summary: z.string().max(500).optional(),
  findings: z.array(z.object({
    step: z.number().int().min(1),
    severity: z.enum(["info", "warn", "error"]),
    hint: z.string().max(300),
  })).default([]),
});

export const SPECIALIST_SCHEMA_BY_BUCKET = {
  math: MathSpecialistSchema,
  essay: EssaySpecialistSchema,
  worksheet: WorksheetSpecialistSchema,
  logic: LogicSpecialistSchema,
} as const;
