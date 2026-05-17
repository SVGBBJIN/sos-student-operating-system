// Zod schemas for the chat action tool calls. Replaces the manual validator in
// the old chat-core.js. Schemas also serve as the source of truth for the
// Gemini function declarations registered on each chat request.

import { z } from "zod";
import {
  dateString,
  isoDateTimeString,
  optionalSubjectString,
  positiveDurationSeconds,
  subjectString,
  timeString,
  titleLikeString,
  zodToGeminiSchema,
} from "./_helpers.js";
import type { ToolDef } from "../providers/types.js";

const eventTypeEnum = z.enum([
  "test", "exam", "quiz", "practice", "game", "match", "meet",
  "tournament", "event", "other",
]);

const recurringEventTypeEnum = z.enum([
  "test", "practice", "game", "match", "event", "other",
]);

const priorityEnum = z.enum(["low", "medium", "high"]);

const blockCategoryEnum = z.enum([
  "school", "swim", "debate", "free time", "sleep", "other",
]);

const dayEnum = z.enum([
  "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday", "Sunday",
]);

export const AddEventSchema = z.object({
  type: z.literal("add_event").optional(),
  title: titleLikeString("title"),
  date: dateString,
  time: timeString.optional(),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  priority: priorityEnum.optional(),
  event_type: eventTypeEnum.optional(),
  subject: optionalSubjectString,
});
export type AddEventInput = z.infer<typeof AddEventSchema>;

export const AddTaskSchema = z.object({
  type: z.literal("add_task").optional(),
  task_name: titleLikeString("task_name"),
  due_date: dateString,
  subject: optionalSubjectString,
});
export type AddTaskInput = z.infer<typeof AddTaskSchema>;

export const DeleteEventSchema = z.object({
  type: z.literal("delete_event").optional(),
  title: titleLikeString("title"),
});

export const DeleteTaskSchema = z.object({
  type: z.literal("delete_task").optional(),
  title: titleLikeString("title"),
});

export const UpdateEventSchema = z
  .object({
    type: z.literal("update_event").optional(),
    title: titleLikeString("title"),
    new_title: titleLikeString("new_title").optional(),
    date: dateString.optional(),
    event_type: eventTypeEnum.optional(),
    subject: optionalSubjectString,
  })
  .refine(
    (v) => Boolean(v.new_title || v.date || v.event_type || v.subject),
    { message: "Provide at least one of new_title, date, event_type, or subject", path: ["new_title"] }
  );

export const CompleteTaskSchema = z.object({
  type: z.literal("complete_task").optional(),
  title: titleLikeString("title"),
});

export const AddBlockSchema = z.object({
  type: z.literal("add_block").optional(),
  date: dateString,
  start: timeString,
  end: timeString,
  activity: titleLikeString("activity"),
  category: blockCategoryEnum.optional(),
});

export const DeleteBlockSchema = z.object({
  type: z.literal("delete_block").optional(),
  date: dateString,
  start: timeString.optional(),
  end: timeString.optional(),
});

export const AddRecurringEventSchema = z.object({
  type: z.literal("add_recurring_event").optional(),
  title: titleLikeString("title"),
  event_type: recurringEventTypeEnum.optional(),
  subject: subjectString,
  days: z.array(dayEnum).min(1),
  start_date: dateString,
  end_date: dateString,
});

export const ClearAllSchema = z.object({
  type: z.literal("clear_all").optional(),
  confirm: z.literal(true, { errorMap: () => ({ message: "confirm must be true to wipe everything" }) }),
});

export const AskClarificationSchema = z.object({
  type: z.literal("ask_clarification").optional(),
  question: z.string().min(1).max(500),
  reason: z.string().max(5000).optional(),
  context_action: z.string().max(100).optional(),
  missing_fields: z.array(z.string()).optional(),
  options: z.array(z.string()).max(6).optional(),
  multi_select: z.boolean().optional(),
});

export const ReadCalendarSchema = z.object({
  type: z.literal("read_calendar").optional(),
  start_date: dateString,
  end_date: dateString.optional(),
});

const timerPresetEnum = z.enum(["pomodoro", "short_break", "long_break"]);

export const SetTimerSchema = z
  .object({
    type: z.literal("set_timer").optional(),
    label: titleLikeString("label"),
    duration_seconds: positiveDurationSeconds.optional(),
    fire_at: isoDateTimeString.optional(),
    preset: timerPresetEnum.optional(),
  })
  .refine(
    (v) => Boolean(v.duration_seconds || v.fire_at || v.preset),
    { message: "Provide duration_seconds, fire_at, or preset", path: ["duration_seconds"] }
  );

const noteSourceEnum = z.enum(["user", "ai_generated", "imported"]);

export const AddNoteSchema = z.object({
  type: z.literal("add_note").optional(),
  title: titleLikeString("title"),
  content: z.string().max(50000).optional(),
  subject: optionalSubjectString,
  source: noteSourceEnum.optional(),
});

export const ACTION_SCHEMAS = {
  add_event: AddEventSchema,
  add_task: AddTaskSchema,
  delete_event: DeleteEventSchema,
  delete_task: DeleteTaskSchema,
  update_event: UpdateEventSchema,
  complete_task: CompleteTaskSchema,
  add_block: AddBlockSchema,
  delete_block: DeleteBlockSchema,
  add_recurring_event: AddRecurringEventSchema,
  clear_all: ClearAllSchema,
  ask_clarification: AskClarificationSchema,
  read_calendar: ReadCalendarSchema,
  set_timer: SetTimerSchema,
  add_note: AddNoteSchema,
} as const;

export type ActionName = keyof typeof ACTION_SCHEMAS;

// Descriptions are concise restatements of the original tool descriptions —
// terse enough to fit Gemini's tool-prompt budget but explicit on the rules
// the model previously violated (placeholders, dates, ask_clarification escape).
const ACTION_DESCRIPTIONS: Record<ActionName, string> = {
  add_event: "Add a calendar event (tests, quizzes, practices, games, appointments). Title/date must be the student's exact wording. Infer subject from the title; if any required field is missing or ambiguous, call ask_clarification.",
  add_task: "Add a homework/todo task. Use task_name as the student said it; resolve due_date against today; ask_clarification when uncertain. Use 'personal' subject for non-academic tasks.",
  delete_event: "Cancel/remove an event from the calendar by title.",
  delete_task: "Remove a task from the to-do list by title.",
  update_event: "Update an existing event — change new_title, date, event_type, or subject. `title` must match an event already on the calendar.",
  complete_task: "Mark a task done.",
  add_block: "Add a time block to the schedule. NEVER infer, estimate, or generate start/end times. If the student did not state exact start and end times, call ask_clarification with missing_fields=['start','end']. All four fields (date, start, end, activity) must appear verbatim in the student's message.",
  delete_block: "Remove a time block from the schedule.",
  add_recurring_event: "Add a recurring event repeating on weekdays (e.g. swim Mon/Wed/Fri).",
  clear_all: "DESTRUCTIVE: wipe ALL tasks, events, blocks, notes. confirm MUST be true.",
  ask_clarification: "Ask the student for a missing/ambiguous detail BEFORE running any action tool. Populate missing_fields precisely. Use up to 6 short options when natural; omit options for free-form fields.",
  read_calendar: "Read-only lookup of the schedule for the given date range. Never combine with mutating tools unless the student explicitly asked.",
  set_timer: "Start a countdown timer. `label` must be the student's wording (e.g. 'laundry', 'pomodoro'). Provide EXACTLY ONE of: duration_seconds (1..86400), fire_at (ISO 8601 with timezone), or preset (pomodoro=25min, short_break=5min, long_break=15min). Convert phrases like '20 minutes' → duration_seconds=1200, '1 hour' → 3600. NEVER guess a duration. If the student says 'set a timer' without a length, you MUST call ask_clarification with missing_fields=['duration_seconds'].",
  add_note: "Create a note in the student's notebook. `subject` becomes the folder it lives in. Ask one missing field at a time via ask_clarification with context_action='add_note': first subject (missing_fields=['subject']), then source (missing_fields=['source'], options=['I will write it','Paste/import','AI write']), then title. Use source='ai_generated' if the student asked you to write it.",
};

export function buildActionToolDefs(): ToolDef[] {
  return (Object.keys(ACTION_SCHEMAS) as ActionName[]).map((name) => ({
    name,
    description: ACTION_DESCRIPTIONS[name],
    parameters: zodToGeminiSchema(ACTION_SCHEMAS[name]),
  }));
}

export function validateAction(name: string, args: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; issues: z.ZodIssue[] } {
  const schema = ACTION_SCHEMAS[name as ActionName];
  if (!schema) return { ok: false, issues: [{ code: z.ZodIssueCode.custom, path: [], message: `Unknown tool: ${name}` }] };
  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true, data: parsed.data as Record<string, unknown> };
  return { ok: false, issues: parsed.error.issues };
}
