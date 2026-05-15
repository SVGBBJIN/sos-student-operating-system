// Helpers shared by all schema modules:
//   - PLACEHOLDER_TITLE_STRINGS / PLACEHOLDER_SUBJECT_STRINGS — porting the
//     model-error catchers from chat-core.js so we keep the same guardrails.
//   - validateTitleLikeField / validateSubject — Zod refinements that mirror
//     the original validateToolArguments() logic.
//   - zodToGeminiSchema — converts a Zod schema into Gemini-compatible JSON
//     Schema for use as `responseSchema` or function `parameters`.

import { z, type ZodTypeAny } from "zod";

export const PLACEHOLDER_TITLE_STRINGS = new Set([
  "task title", "new task", "task", "untitled task", "untitled",
  "event title", "new event", "event", "untitled event",
  "activity", "new activity", "block", "new block",
  "assignment", "homework", "new homework",
  "title", "name", "item", "add task", "add event",
  "event name", "task name", "activity name",
  "todo", "to-do", "to do", "thing", "stuff", "something",
  "generic event", "generic task", "placeholder", "tbd", "tba", "n/a",
  "add", "new", "the", "a", "an", "class", "school", "study",
  "mathematics", "calculus", "biology", "chemistry", "physics",
  "english", "history", "spanish", "french", "computer science",
  "literature", "economics", "psychology", "science",
]);

export const PLACEHOLDER_SUBJECT_STRINGS = new Set([
  "subject", "class", "topic", "course", "lesson", "study", "school",
  "academic", "education", "general", "other", "misc", "miscellaneous",
  "n/a", "tbd", "unknown", "none",
]);

const INSTRUCTION_TITLE_REGEX = /^(add|create|schedule|make|put|set|log|track|book|enter|register|new)\s+/i;
const MIN_TITLE_LENGTH = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export const titleLikeString = (label = "title") =>
  z
    .string()
    .min(1, `${label} required`)
    .refine((s) => s.trim().length > 0, `${label} required`)
    .refine((s) => s.trim().length >= MIN_TITLE_LENGTH, `${label} too short (>= ${MIN_TITLE_LENGTH} chars)`)
    .refine((s) => !PLACEHOLDER_TITLE_STRINGS.has(s.trim().toLowerCase()), `${label} is a placeholder; use the actual name`)
    .refine((s) => !INSTRUCTION_TITLE_REGEX.test(s.trim()), `${label} looks like a command phrase, not a name`)
    .transform((s) => s.trim());

export const subjectString = z
  .string()
  .min(1, "subject required")
  .refine(
    (s) => !PLACEHOLDER_SUBJECT_STRINGS.has(s.trim().toLowerCase()),
    "subject is generic; use a specific subject like 'mathematics' or 'biology'"
  )
  .transform((s) => s.trim().toLowerCase());

export const optionalSubjectString = z
  .string()
  .optional()
  .transform((s) => (typeof s === "string" ? s.trim() : s))
  .refine((s) => s === undefined || s.length === 0 || !PLACEHOLDER_SUBJECT_STRINGS.has(s.toLowerCase()), "subject is generic")
  .transform((s) => (typeof s === "string" ? s.toLowerCase() : s));

export const dateString = z
  .string()
  .refine(isValidDate, "must be YYYY-MM-DD");

export const timeString = z
  .string()
  .refine(isValidTime, "must be HH:MM (24h)");

// ── Gemini schema conversion ─────────────────────────────────────────────────
// Gemini's responseSchema and function-declaration `parameters` accept a
// strict subset of JSON Schema (OpenAPI 3.0 style). We can't pass the Zod
// JSON-schema output verbatim — it embeds `$schema`, `$ref`, `additionalProperties`,
// none of which Gemini accepts. This helper strips/maps incompatible keywords.

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  enum?: unknown[];
  description?: string;
  format?: string;
  nullable?: boolean;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  [k: string]: unknown;
};

function zodTypeToGeminiType(t: ZodTypeAny): JsonSchema {
  // Use Zod's _def discriminator. We handle the cases we actually use.
  const def = (t as { _def: { typeName: string; values?: string[]; type?: ZodTypeAny; innerType?: ZodTypeAny; options?: ZodTypeAny[]; shape?: () => Record<string, ZodTypeAny> } })._def;
  const typeName = def.typeName;

  switch (typeName) {
    case "ZodString": {
      const schema: JsonSchema = { type: "string" };
      const desc = (t as { description?: string }).description;
      if (desc) schema.description = desc;
      return schema;
    }
    case "ZodNumber": {
      const schema: JsonSchema = { type: "number" };
      const desc = (t as { description?: string }).description;
      if (desc) schema.description = desc;
      return schema;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral": {
      const value = (def as unknown as { value: unknown }).value;
      const t = typeof value;
      return { type: t === "number" ? "number" : t === "boolean" ? "boolean" : "string", enum: [value] };
    }
    case "ZodEnum":
      return { type: "string", enum: def.values ?? [] };
    case "ZodArray": {
      const items = def.type ? zodTypeToGeminiType(def.type) : { type: "string" };
      return { type: "array", items };
    }
    case "ZodObject": {
      const shape = def.shape ? def.shape() : {};
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        const inner = (v as { _def: { typeName: string } })._def.typeName;
        const isOptional = inner === "ZodOptional" || inner === "ZodDefault" || inner === "ZodNullable";
        const child = zodTypeToGeminiType(v);
        properties[k] = child;
        if (!isOptional) required.push(k);
      }
      const out: JsonSchema = { type: "object", properties };
      if (required.length > 0) out.required = required;
      return out;
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodEffects":
    case "ZodPipeline":
    case "ZodReadonly": {
      const inner = def.innerType ?? def.type;
      if (!inner) return { type: "string" };
      const sub = zodTypeToGeminiType(inner);
      if (typeName === "ZodNullable") sub.nullable = true;
      return sub;
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const opts = def.options ?? [];
      return { anyOf: opts.map((o) => zodTypeToGeminiType(o)) };
    }
    case "ZodAny":
    case "ZodUnknown":
      return { type: "string" };
    default:
      return { type: "string" };
  }
}

export function zodToGeminiSchema(t: ZodTypeAny): object {
  return zodTypeToGeminiType(t);
}

// Pretty-print a Zod failure list as model-facing repair feedback. Mirrors the
// buildValidationFeedback() output style from the old Groq path.
export function formatZodIssuesForModel(toolName: string, issues: z.ZodIssue[]): string {
  const lines = [
    `Your previous "${toolName}" call did not validate. For each field below:`,
    "  • If the value is stated in the student's last message → provide it.",
    "  • Otherwise call ask_clarification — never invent, guess, or approximate any value.",
    "",
  ];
  for (const issue of issues) {
    const path = issue.path.join(".") || "(root)";
    lines.push(`- ${toolName}.${path}: ${issue.message}`);
  }
  return lines.join("\n");
}
