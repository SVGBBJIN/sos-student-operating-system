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

// Confidence + commitment shared fields. The model attaches these whenever an
// extracted item is uncertain — e.g. "I think there might be a chem test
// Thursday" → confidence ~0.4, tentative. The frontend uses them to gate the
// confidence rail (see executeAction in App.jsx).
const confidenceField = z.number().min(0).max(1).optional();
const eventCommitmentField = z.enum(["tentative", "confirmed"]).optional();
const taskCommitmentField = z.enum(["tentative", "confirmed"]).optional();

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
  confidence: confidenceField,
  status: eventCommitmentField,
});
export type AddEventInput = z.infer<typeof AddEventSchema>;

export const AddTaskSchema = z.object({
  type: z.literal("add_task").optional(),
  task_name: titleLikeString("task_name"),
  due_date: dateString,
  subject: optionalSubjectString,
  confidence: confidenceField,
  commitment: taskCommitmentField,
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
    confidence: confidenceField,
    status: eventCommitmentField,
  })
  .refine(
    (v) => Boolean(v.new_title || v.date || v.event_type || v.subject || v.status),
    { message: "Provide at least one of new_title, date, event_type, subject, or status", path: ["new_title"] }
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
  // Fields already extracted from the student's message — the frontend merges
  // these with the user's clarification answer so nothing gets lost on re-ask.
  known_fields: z.record(z.string(), z.unknown()).optional(),
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

export const CancelTimerSchema = z.object({
  type: z.literal("cancel_timer").optional(),
  label: z.string().min(1).max(200),
});
export type CancelTimerInput = z.infer<typeof CancelTimerSchema>;

export const PrioritizeTasksSchema = z.object({
  type: z.literal("prioritize_tasks").optional(),
  horizon_days: z.number().int().min(1).max(30).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});
export type PrioritizeTasksInput = z.infer<typeof PrioritizeTasksSchema>;

export const PlanIntentSchema = z.object({
  type: z.literal("plan_intent").optional(),
  goal: z.string().min(4).max(500),
  horizon: z.enum(["week", "month", "semester"]),
  subject: optionalSubjectString,
  deadline: dateString.optional(),
});
export type PlanIntentInput = z.infer<typeof PlanIntentSchema>;

export const RevisePlanSchema = z.object({
  type: z.literal("revise_plan").optional(),
  plan_id: z.string().uuid("plan_id must be a valid UUID"),
  instructions: z.string().min(4).max(800),
});
export type RevisePlanInput = z.infer<typeof RevisePlanSchema>;

export const UpdateTaskSchema = z
  .object({
    type: z.literal("update_task").optional(),
    task_id: z.string().uuid().optional(),
    title: titleLikeString("title").optional(),
    new_title: titleLikeString("new_title").optional(),
    due: dateString.optional(),
    estimated_minutes: z.number().int().min(1).max(480).optional(),
    confidence: confidenceField,
    commitment: taskCommitmentField,
  })
  .refine(
    (v) => Boolean(v.task_id || v.title),
    { message: "Provide task_id or title to identify the task", path: ["title"] }
  )
  .refine(
    (v) => Boolean(v.new_title || v.due || v.estimated_minutes !== undefined || v.commitment),
    { message: "Provide at least one of new_title, due, estimated_minutes, or commitment", path: ["new_title"] }
  );
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export const EditNoteSchema = z.object({
  type: z.literal("edit_note").optional(),
  note_id: z.string().min(1, "note_id is required"),
  new_content: z.string().max(50000),
});
export type EditNoteInput = z.infer<typeof EditNoteSchema>;

export const DeleteNoteSchema = z.object({
  type: z.literal("delete_note").optional(),
  note_id: z.string().min(1, "note_id is required"),
});
export type DeleteNoteInput = z.infer<typeof DeleteNoteSchema>;

export const SubtaskSchema = z.object({
  title: titleLikeString("title"),
  due: dateString.optional(),
  estimated_minutes: z.number().int().min(1).max(480).optional(),
});

export const BreakTaskSchema = z.object({
  type: z.literal("break_task").optional(),
  parent_title: titleLikeString("parent_title"),
  subtasks: z.array(SubtaskSchema).min(2).max(10),
});
export type BreakTaskInput = z.infer<typeof BreakTaskSchema>;

export const ConvertEventToBlockSchema = z.object({
  type: z.literal("convert_event_to_block").optional(),
  title: titleLikeString("title").optional(),
  event_id: z.string().optional(),
  date: dateString.optional(),
  start: timeString.optional(),
  end: timeString.optional(),
  category: blockCategoryEnum.optional(),
}).refine(
  (v) => Boolean(v.title || v.event_id),
  { message: "Provide title or event_id to identify the event", path: ["title"] }
);
export type ConvertEventToBlockInput = z.infer<typeof ConvertEventToBlockSchema>;

export const ConvertBlockToEventSchema = z.object({
  type: z.literal("convert_block_to_event").optional(),
  date: dateString,
  start: timeString,
  end: timeString,
  title: titleLikeString("title").optional(),
  event_type: eventTypeEnum.optional(),
  subject: optionalSubjectString,
});
export type ConvertBlockToEventInput = z.infer<typeof ConvertBlockToEventSchema>;

export const DeleteStudySetSchema = z.object({
  type: z.literal("delete_study_set").optional(),
  title: titleLikeString("title"),
});
export type DeleteStudySetInput = z.infer<typeof DeleteStudySetSchema>;

export const ReadNotesSchema = z.object({
  type: z.literal("read_notes").optional(),
  subject: optionalSubjectString,
  search: z.string().max(100).optional(),
});
export type ReadNotesInput = z.infer<typeof ReadNotesSchema>;

export const ReadStudySetsSchema = z.object({
  type: z.literal("read_study_sets").optional(),
});
export type ReadStudySetsInput = z.infer<typeof ReadStudySetsSchema>;

export const ReadProjectSchema = z.object({
  type: z.literal("read_project").optional(),
  subject: subjectString,
});
export type ReadProjectInput = z.infer<typeof ReadProjectSchema>;

export const ReadTasksSchema = z.object({
  type: z.literal("read_tasks").optional(),
  subject: optionalSubjectString,
  status: z.enum(["not_started", "in_progress", "done"]).optional(),
  due_within_days: z.number().int().min(1).max(90).optional(),
});
export type ReadTasksInput = z.infer<typeof ReadTasksSchema>;

// Server-internal retrieval tool. The handler executes it against the
// memory_embeddings store and feeds the results back to the model — it is
// stripped from the actions returned to the client (never client-executed).
export const SearchMemorySchema = z.object({
  type: z.literal("search_memory").optional(),
  query: z.string().min(1).max(200),
  sources: z.array(z.string().min(1).max(40)).max(6).optional(),
});
export type SearchMemoryInput = z.infer<typeof SearchMemorySchema>;

export const UpdateBlockSchema = z
  .object({
    type: z.literal("update_block").optional(),
    date: dateString,
    start: timeString.optional(),
    activity: z.string().max(200).optional(),
    new_activity: z.string().max(80).optional(),
    new_start: timeString.optional(),
    new_end: timeString.optional(),
    new_category: blockCategoryEnum.optional(),
  })
  .refine(
    (v) => Boolean(v.start || v.activity),
    { message: "Provide start time or activity name to identify the block", path: ["start"] }
  );
export type UpdateBlockInput = z.infer<typeof UpdateBlockSchema>;

export const PostponeTaskSchema = z.object({
  type: z.literal("postpone_task").optional(),
  title: titleLikeString("title"),
  new_due_date: dateString,
});
export type PostponeTaskInput = z.infer<typeof PostponeTaskSchema>;

export const BulkCompleteSchema = z
  .object({
    type: z.literal("bulk_complete").optional(),
    subject: optionalSubjectString,
    titles: z.array(z.string().min(1).max(200)).max(20).optional(),
  })
  .refine(
    (v) => Boolean(v.subject || (v.titles && v.titles.length > 0)),
    { message: "Provide subject or titles to bulk-complete", path: ["subject"] }
  );
export type BulkCompleteInput = z.infer<typeof BulkCompleteSchema>;

export const RenameNoteSchema = z.object({
  type: z.literal("rename_note").optional(),
  title: titleLikeString("title"),
  new_title: titleLikeString("new_title"),
});
export type RenameNoteInput = z.infer<typeof RenameNoteSchema>;

export const MoveNoteSchema = z.object({
  type: z.literal("move_note").optional(),
  title: titleLikeString("title"),
  folder: z.string().max(80).optional(),
});
export type MoveNoteInput = z.infer<typeof MoveNoteSchema>;

export const CreateFolderSchema = z.object({
  type: z.literal("create_folder").optional(),
  name: titleLikeString("name"),
  parent_folder: z.string().max(80).optional(),
});
export type CreateFolderInput = z.infer<typeof CreateFolderSchema>;

export const LogGradeSchema = z.object({
  type: z.literal("log_grade").optional(),
  subject: subjectString,
  assignment: titleLikeString("assignment"),
  grade: z.number().min(0).max(100),
  grade_type: z.enum(["exam", "quiz", "homework", "project", "other"]).optional(),
});
export type LogGradeInput = z.infer<typeof LogGradeSchema>;

export const PledgeStartSchema = z.object({
  type: z.literal("pledge_start").optional(),
  title: titleLikeString("title"),
  // When the student says they'll START the task — ISO 8601 with timezone.
  // This is the intention side of the start-latency experiment; the action side
  // is the existing start primitive (tasks.started_at).
  start_at: isoDateTimeString,
});
export type PledgeStartInput = z.infer<typeof PledgeStartSchema>;

export const UpdateStudySetSchema = z.object({
  type: z.literal("update_study_set").optional(),
  title: titleLikeString("title"),
  new_title: z.string().min(2).max(120).optional(),
  cards_to_add: z
    .array(z.object({ q: z.string().min(1).max(500), a: z.string().min(1).max(500) }))
    .max(50)
    .optional(),
  cards_to_remove: z.array(z.string().min(1).max(500)).max(50).optional(),
});
export type UpdateStudySetInput = z.infer<typeof UpdateStudySetSchema>;

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
  cancel_timer: CancelTimerSchema,
  add_note: AddNoteSchema,
  prioritize_tasks: PrioritizeTasksSchema,
  plan_intent: PlanIntentSchema,
  revise_plan: RevisePlanSchema,
  update_task: UpdateTaskSchema,
  edit_note: EditNoteSchema,
  delete_note: DeleteNoteSchema,
  break_task: BreakTaskSchema,
  convert_event_to_block: ConvertEventToBlockSchema,
  convert_block_to_event: ConvertBlockToEventSchema,
  delete_study_set: DeleteStudySetSchema,
  read_notes: ReadNotesSchema,
  read_study_sets: ReadStudySetsSchema,
  read_project: ReadProjectSchema,
  read_tasks: ReadTasksSchema,
  search_memory: SearchMemorySchema,
  update_block: UpdateBlockSchema,
  postpone_task: PostponeTaskSchema,
  bulk_complete: BulkCompleteSchema,
  rename_note: RenameNoteSchema,
  move_note: MoveNoteSchema,
  create_folder: CreateFolderSchema,
  log_grade: LogGradeSchema,
  update_study_set: UpdateStudySetSchema,
  pledge_start: PledgeStartSchema,
} as const;

export type ActionName = keyof typeof ACTION_SCHEMAS;

// Descriptions are concise restatements of the original tool descriptions —
// terse enough to fit Gemini's tool-prompt budget but explicit on the rules
// the model previously violated (placeholders, dates, ask_clarification escape).
const ACTION_DESCRIPTIONS: Record<ActionName, string> = {
  add_event: "Add a calendar event (tests, quizzes, games, appointments). Use exact title/date from the student's words; infer subject from title. Set status='tentative' and confidence<0.7 when wording is hedged or date is inferred. Call ask_clarification if required fields are missing.",
  add_task: "Add a homework/todo task. Use exact task_name from the student's words; resolve due_date against today. Use 'personal' for non-academic. Set commitment='tentative' and confidence<0.7 when wording is hedged or due_date is inferred. Call ask_clarification if required fields are missing.",
  delete_event: "Cancel/remove an event from the calendar by title.",
  delete_task: "Remove a task from the to-do list by title.",
  update_event: "Update an existing event — change new_title, date, event_type, or subject. `title` must match an event already on the calendar.",
  complete_task: "Mark a task done.",
  add_block: "Add a time block to the schedule. NEVER infer, estimate, or generate start/end times. If the student did not state exact start and end times, call ask_clarification with missing_fields=['start','end']. All four fields (date, start, end, activity) must appear verbatim in the student's message.",
  delete_block: "Remove a time block from the schedule.",
  add_recurring_event: "Add a recurring event repeating on weekdays (e.g. swim Mon/Wed/Fri).",
  clear_all: "DESTRUCTIVE: wipe ALL tasks, events, blocks, notes. confirm MUST be true.",
  ask_clarification: "Ask for ONE missing or ambiguous required field before running an action. Set context_action (target tool name), missing_fields (needed fields), known_fields (already extracted values, e.g. {title:'Chem test'}). Up to 6 short options when helpful.",
  read_calendar: "Read-only schedule lookup. Set end_date to the stated timeframe; omit for default one-week window. Never combine with mutating tools.",
  set_timer: "Start a countdown. label = student's exact words. Exactly one of: duration_seconds (1..86400), fire_at (ISO 8601+tz), or preset (pomodoro/short_break/long_break). Convert '20 minutes'→1200, '1 hour'→3600. If no duration given, call ask_clarification.",
  cancel_timer: "Cancel (stop) a running timer by label. Use the label exactly as shown in ACTIVE TIMERS. If no timers are running, tell the student there's nothing to cancel. If the label is ambiguous, call ask_clarification.",
  add_note: "Create a note. subject = folder. Ask one missing field at a time: subject first, then source (options: 'I will write it'/'Paste/import'/'AI write'), then title. Use source='ai_generated' if the student asked you to draft it.",
  prioritize_tasks: "Read-only: return a ranked list of the student's most important tasks to tackle right now. Only call this when the student explicitly asks what to do next, what matters most, or which task to prioritize. Never combine with mutating tools.",
  plan_intent: "Convert a student goal or intent into a structured multi-week plan with recurring blocks, milestone tasks, and a review cadence. Use for goals like 'survive finals week', 'improve Chinese speaking', or 'balance coding and school'. `horizon` must be one of: week, month, semester. If no deadline or subject is stated, omit those fields — do not guess.",
  revise_plan: "Revise an existing saved study plan by re-running the intent plan pipeline with the student's correction instructions. Requires plan_id (UUID of the saved plan) and instructions (what to change, e.g. 'make the plan lighter' or 'add 2 more study sessions per week'). Only call this when the student explicitly asks to revise, adjust, or change a saved plan.",
  update_task: "Update an existing task's title, due date, or estimated time. Identify the task by task_id (UUID) or title (fuzzy match). Provide at least one of new_title, due, or estimated_minutes. If the task cannot be found, ask_clarification.",
  edit_note: "Replace the full content of an existing note. note_id must be the exact UUID of the note. new_content replaces the current body entirely.",
  delete_note: "Permanently delete a note by its UUID. Only call when the student explicitly asks to delete or remove a note.",
  break_task: "Split a task into 2–10 smaller subtasks. parent_title is the original task's name (used as subject context). Each subtask must have a real title; due and estimated_minutes are optional. Call ask_clarification first if the student hasn't specified what parts to break into.",
  convert_event_to_block: "Convert a calendar event into a time block on the schedule. Identify the event by title or event_id. Optionally override date, start, end, and category; if omitted, the client infers from the event. NEVER guess start/end — call ask_clarification if the student didn't state them.",
  convert_block_to_event: "Convert a time block into a calendar event. date, start, and end identify the block to remove. title, event_type, and subject are optional — the client falls back to the block's name if title is omitted.",
  delete_study_set: "Permanently delete a flashcard deck / study set by title. Uses fuzzy title matching. Only call when the student explicitly asks to delete or remove a flashcard deck or study set.",
  read_notes: "Read and list the student's notes, optionally filtered by subject or search query. Posts a summary to chat with note titles and IDs so the student can reference them. Call when the student asks what notes they have, wants to find a note, or asks to see their notes.",
  read_study_sets: "Read and list all flashcard decks the student has saved. Posts a summary to chat with deck titles and card counts. Call when the student asks what study sets or flashcard decks they have.",
  read_project: "Read all content (tasks, events, notes, study sets) grouped under a specific subject/project. subject must match one the student uses (e.g. 'Math', 'Chemistry'). Call when the student asks what's in a project or subject.",
  read_tasks: "List the student's tasks with optional filters: subject, status (not_started/in_progress/done), or tasks due within N days. Posts a formatted list to chat. Call when the student asks what tasks they have, wants to see pending work, or asks about tasks for a specific subject.",
  search_memory: "Search the student's saved memories, notes, and past context by meaning (semantic search). Call this ONLY when answering needs background the student mentioned earlier or stored previously — e.g. 'what did I say about my history essay?', 'remind me what my goals were'. `query` is the keywords/phrase to search for. Do NOT call for simple scheduling or task actions. The results come back to you to use in your answer.",
  update_block: "Modify an existing time block — rename it, change its time, or change its category. Identify the block by date + start time OR date + activity name. Provide at least one of new_activity, new_start, new_end, or new_category. NEVER guess times — call ask_clarification if the student didn't state them.",
  postpone_task: "Push a task's due date to a later date. Identify by title (fuzzy match). new_due_date must be a valid YYYY-MM-DD date. Increments the task's postpone count for behavioral tracking.",
  bulk_complete: "Mark multiple tasks done in one shot. Filter by subject (e.g. 'Math') and/or a list of titles. At least one of subject or titles is required. Common at end of study sessions ('mark all my English tasks as done').",
  rename_note: "Change the title/name of an existing note without touching its content. title is the current name (fuzzy match); new_title is the replacement.",
  move_note: "Move a note into a different folder by updating its parent. title identifies the note (fuzzy match). folder is the destination folder name — omit to move to root. If the folder doesn't exist, tell the student to create it first.",
  create_folder: "Create a new folder in the student's notes. name is the folder title. Optionally nest it under a parent_folder. Does not create duplicate folders.",
  log_grade: "Record a grade for an assignment or exam. subject, assignment name, and grade (0–100) are required. grade_type can be 'exam', 'quiz', 'homework', 'project', or 'other'. Posts the logged grade and the updated subject average to chat.",
  update_study_set: "Edit an existing flashcard deck — rename it, add new cards, or remove cards by question text. At least one of new_title, cards_to_add, or cards_to_remove must be provided. Identify the deck by title (fuzzy match).",
  pledge_start: "Record WHEN the student intends to START a task (not when it's due). Call this whenever the student commits to a start time — 'I'll start my essay at 7', 'I'll get to chem after dinner', 'gonna do calc tonight'. Identify the task by title (fuzzy match); start_at is the resolved ISO 8601 datetime with timezone. This powers the start-latency experiment that measures intention vs. actual start.",
};

export function buildActionToolDefs(): ToolDef[] {
  return (Object.keys(ACTION_SCHEMAS) as ActionName[]).map((name) => ({
    name,
    description: ACTION_DESCRIPTIONS[name],
    parameters: zodToGeminiSchema(ACTION_SCHEMAS[name]),
  }));
}

export function buildChatToolDefs(): ToolDef[] {
  const CHAT_TOOLS: ActionName[] = [
    "ask_clarification",
    "read_calendar",
    "read_tasks",
    "read_notes",
    "read_study_sets",
    "read_project",
    "prioritize_tasks",
  ];
  return CHAT_TOOLS.map((name) => ({
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
