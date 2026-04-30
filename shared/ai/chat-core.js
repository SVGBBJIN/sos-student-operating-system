// Shared chat orchestration core used by both Vercel (Node) and Supabase Edge (Deno).
// Keep this file runtime-agnostic (Web APIs only).

import { inferSubjectFromTitle } from "../subjects.js";

export const CORE_VERSION = "chat-core-v3-2026-04-28";
export const CORE_CHECKSUM = "sha256:groq-only-strict-retry-v1";

export const MODEL_DEEP = "openai/gpt-oss-120b";
export const MODEL_FAST = "openai/gpt-oss-20b";
// PRIMARY_MODEL kept for back-compat
export const PRIMARY_MODEL = MODEL_DEEP;

export function resolveModel(requested) {
  return (requested === MODEL_FAST || requested === MODEL_DEEP) ? requested : MODEL_DEEP;
}

// Tracks Groq's remaining requests-per-minute from response headers (monitoring-only).
const GROQ_RPM = {
  remaining: Infinity,  // x-ratelimit-remaining-requests
  limit: Infinity,      // x-ratelimit-limit-requests
  resetAtMs: 0,         // absolute ms when the RPM window resets
  requests: [],         // sliding-window timestamps for local counting
};
const RPM_NEAR_LIMIT_THRESHOLD = 0.15;

function updateGroqRpm(headers) {
  const remaining = parseInt(headers.get("x-ratelimit-remaining-requests") || "", 10);
  const limit     = parseInt(headers.get("x-ratelimit-limit-requests")     || "", 10);
  const resetStr  = headers.get("x-ratelimit-reset-requests") || "";
  const now = Date.now();
  if (!isNaN(remaining)) GROQ_RPM.remaining = remaining;
  if (!isNaN(limit))     GROQ_RPM.limit     = limit;
  const sec = parseFloat(resetStr);
  if (!isNaN(sec))       GROQ_RPM.resetAtMs = now + Math.ceil(sec * 1000);
  GROQ_RPM.requests = GROQ_RPM.requests.filter(t => now - t <= 60000);
  GROQ_RPM.requests.push(now);
}

export function getGroqRpmStatus() {
  const now = Date.now();
  return {
    remaining: GROQ_RPM.remaining,
    limit: GROQ_RPM.limit,
    resetAtMs: GROQ_RPM.resetAtMs,
    count: GROQ_RPM.requests.filter(t => now - t <= 60000).length,
    nearLimit: GROQ_RPM.remaining !== Infinity && Date.now() < GROQ_RPM.resetAtMs
      && GROQ_RPM.remaining < GROQ_RPM.limit * RPM_NEAR_LIMIT_THRESHOLD,
  };
}

/** @typedef {{role: string, content: unknown}} ChatMessage */
/** @typedef {{type: string, [key: string]: unknown}} ChatAction */
/** @typedef {{
 *  content: string,
 *  actions: ChatAction[],
 *  clarification: Record<string, unknown> | null,
 *  clarifications: Record<string, unknown>[],
 *  validation_warnings: Record<string, unknown>[],
 *  model_used?: string,
 *  attempt_count?: number,
 *  retry_wait_ms_total?: number,
 *  fallback_used?: boolean,
 * }} ParsedLlmResponse */
/** @typedef {{
 *   apiKey: string,
 *   model: string,
 *   systemPrompt: string,
 *   messages: ChatMessage[],
 *   maxTokens?: number,
 *   imageBase64?: string | null,
 *   imageMimeType?: string | null,
 *   includeTools?: boolean,
 *   toolsOverride?: any[] | null,
 *   toolChoiceOverride?: "auto" | "required",
 *   backupModel?: string | null,
 *   options?: { isContentGen?: boolean, budgetMs?: number }
 * }} CallGroqRequest */

export const ACTION_TOOLS = [
  {
    type: "function",
    function: {
      name: "add_event",
      description:
        "Add an event to the student's calendar. Use for tests, exams, quizzes, practices, games, meets, appointments, deadlines, or any scheduled activity with a specific date. STRICT RULES: (1) `title` MUST be the actual name from the student's message — NEVER 'task', 'event', 'untitled', 'tbd', or any placeholder; if the student didn't name it, respond with plain text asking what to call it. (2) `subject` MUST be a real subject name (e.g. 'mathematics', 'biology', 'history', 'spanish') — NEVER 'general', 'subject', 'class', 'school', or 'other'; if you can't infer it from the title (e.g. 'Calc Quiz' → 'calculus', 'Bio Test' → 'biology'), ask the student which class it's for. (3) NEVER invent or guess any value.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title EXACTLY as the student named it. Reject any placeholder like 'task', 'event', 'homework', 'untitled'." },
          date: { type: "string", description: "YYYY-MM-DD. Resolve relative dates ('tomorrow', 'next Friday') against today's date in the system prompt. Never emit a date in the past unless the student explicitly said 'yesterday' or 'last [day]'." },
          time: { type: "string", description: "HH:MM 24-hour (e.g. 14:30). Omit entirely if the student did not specify a time — do not guess." },
          description: { type: "string", description: "Brief description or notes about the event (chapters covered, materials needed, etc.)" },
          location: { type: "string", description: "Where the event takes place (room, building, address)" },
          priority: { type: "string", enum: ["low", "medium", "high"], description: "Priority level — infer from context (exams/finals = high, optional meetings = low)" },
          event_type: {
            type: "string",
            enum: [
              "test", "exam", "quiz", "practice", "game", "match", "meet",
              "tournament", "event", "other",
            ],
          },
          subject: {
            type: "string",
            description: "Specific subject name in lowercase. Examples: 'mathematics', 'calculus', 'biology', 'chemistry', 'physics', 'english', 'history', 'spanish', 'french', 'computer science', 'literature', 'economics', 'psychology', 'physical education'. For non-academic events (sports, appointments, social), use the activity name (e.g. 'swim', 'debate'). NEVER use generic words like 'general', 'subject', 'class', 'school', or 'other' — if you don't know the specific subject, ask the student.",
          },
        },
        required: ["title", "date", "subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_task",
      description:
        "Add a new task to the student's to-do list (homework, assignments, chores, errands — anything without a fixed start time). STRICT RULES: (1) `task_name` MUST be the actual task name from the student's message — NEVER 'task', 'homework', 'assignment', 'todo', 'untitled', or any placeholder; if unclear, ask in plain text. (2) `due_date` is required — if the student said 'due X', 'by X', 'for X' use that; otherwise ask, never guess. (3) `subject` MUST be a specific subject when the task is academic (homework, essay, lab, project, paper, study, worksheet) — infer from name (e.g. 'Calc problem set' → 'calculus', 'AP Bio reading' → 'biology'); if you can't, ask the student. For non-academic tasks (chores, errands), use 'personal'. NEVER use 'general', 'subject', 'class', or 'other'.",
      parameters: {
        type: "object",
        properties: {
          task_name: { type: "string", description: "The actual task name from the student's message. Reject placeholders like 'task', 'homework', 'todo'." },
          due_date: { type: "string", description: "YYYY-MM-DD. Resolve relative dates against today's date in the system prompt. Never emit a past date unless the student explicitly said so. If the student gave no date, respond with plain text asking rather than guessing." },
          subject: {
            type: "string",
            description: "Specific subject name in lowercase (e.g. 'mathematics', 'calculus', 'biology', 'english', 'history', 'spanish'). For non-academic tasks (chores, errands, personal), use 'personal'. NEVER 'general', 'subject', 'class', 'school', or 'other'.",
          },
        },
        required: ["task_name", "due_date", "subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_event",
      description:
        "Delete or cancel an event from the student's calendar. Use when the student says an event is cancelled, not happening, or asks to remove it.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title of the event to delete" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description:
        "Delete a task from the student's task list. Use when the student says to remove, drop, or forget a task.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title of the task to delete" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_event",
      description:
        "Update an existing event — change its title, date, type, or subject. Use for reschedule/move/rename requests. STRICT: `title` is the EXISTING event name to look up — must match what's already on the calendar; if the student didn't name the event clearly, ask before calling. Any provided field must be a real value, never a placeholder.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Current event title to look up — must be the actual name already on the calendar." },
          new_title: { type: "string", description: "New title (omit if not changing name). If provided, must be a real name — never 'task', 'event', 'untitled'." },
          date: { type: "string", description: "New date in YYYY-MM-DD format (omit if not changing)" },
          event_type: {
            type: "string",
            enum: [
              "test", "exam", "quiz", "practice", "game", "match", "meet",
              "tournament", "event", "other",
            ],
          },
          subject: {
            type: "string",
            description: "Specific subject name in lowercase. NEVER 'general', 'subject', 'class', or 'other'. Omit if not changing.",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description:
        "Mark a task as done/completed. Use when the student says they finished, submitted, or completed something.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title of the task to mark complete" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_block",
      description:
        "Add a time block to the student's daily schedule. IMPORTANT: Only call this when the student has explicitly provided the activity, date, and start/end times. If ANY of these are missing from the student's message, respond with plain text asking for the missing detail. NEVER guess or fabricate values.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          start: { type: "string", description: "Start time in HH:MM 24-hour format (e.g. 14:00)" },
          end: { type: "string", description: "End time in HH:MM 24-hour format (e.g. 15:30)" },
          activity: { type: "string", description: "Activity name" },
          category: {
            type: "string",
            enum: ["school", "swim", "debate", "free time", "sleep", "other"],
          },
        },
        required: ["date", "start", "end", "activity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_block",
      description: "Remove a time block from the student's schedule.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date of the block (YYYY-MM-DD)" },
          start: { type: "string", description: "Start time of the block (HH:MM)" },
          end: { type: "string", description: "End time of the block (HH:MM, optional)" },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_recurring_event",
      description:
        "Add a recurring event that repeats on specific days of the week — e.g., swim practice every Mon/Wed/Fri, weekly tutoring on Thursdays. STRICT RULES: (1) `title` MUST be the activity's actual name from the student — NEVER a placeholder. (2) `subject` MUST be a real subject (e.g. 'mathematics', 'biology') for academic recurrences, or the activity name (e.g. 'swim', 'debate', 'soccer') for non-academic. NEVER 'general', 'subject', 'class', or 'other'. (3) If the title, days, or subject are unclear, ask in plain text before calling. NEVER guess or fabricate values.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Activity name as the student named it. Reject placeholders." },
          event_type: {
            type: "string",
            enum: ["test", "practice", "game", "match", "event", "other"],
          },
          subject: {
            type: "string",
            description: "Specific subject (e.g. 'mathematics') for academic events, or the activity name (e.g. 'swim') for non-academic. NEVER 'general', 'subject', 'class', or 'other'.",
          },
          days: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "Monday", "Tuesday", "Wednesday", "Thursday",
                "Friday", "Saturday", "Sunday",
              ],
            },
            description: "Days of the week this event repeats",
          },
          start_date: { type: "string", description: "YYYY-MM-DD — first occurrence" },
          end_date: { type: "string", description: "YYYY-MM-DD — last occurrence" },
        },
        required: ["title", "subject", "days", "start_date", "end_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_all",
      description:
        "DESTRUCTIVE: wipe ALL tasks, events, blocks, and notes. Call this ONLY when the student has explicitly and unambiguously said to clear, reset, wipe, or delete everything. NEVER call it in response to 'clear the chat' or 'start over' (those are not destructive). You MUST set confirm=true; if you are not certain, respond with plain text asking the student to confirm.",
      parameters: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            description: "Must be true to execute. Set to false (or omit) to indicate you are unsure.",
          },
        },
        required: ["confirm"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_calendar",
      description:
        "Read-only lookup of the student's calendar, events, tasks, and time blocks. Call this WHENEVER the student asks what is on their schedule, what is coming up, what they have today/tomorrow/this week, or when their next free slot is — any query that is informational, not mutating. Do NOT follow a read_calendar with add_task or add_event unless the student explicitly asks to add something. Returns the contents of the requested date range; makes no changes.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "Start date in YYYY-MM-DD format. For a single-day query, pass the same value here and in end_date." },
          end_date: { type: "string", description: "End date in YYYY-MM-DD format (defaults to start_date if omitted)." },
        },
        required: ["start_date"],
      },
    },
  },
];

const TOOL_SPEC_BY_NAME = new Map(
  ACTION_TOOLS.map((tool) => [tool.function.name, tool.function.parameters])
);
// STUDIO_TOOLS: content-generation tools used exclusively by the Studio screen.
// These are NOT part of the chat tool set — they are only sent when mode="studio".
export const STUDIO_TOOLS = [
  {
    type: "function",
    function: {
      name: "create_flashcards",
      description: "Create flashcards for study. Return concise question/answer pairs.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["create_flashcards"] },
          title: { type: "string" },
          summary: { type: "string" },
          cards: {
            type: "array",
            items: {
              type: "object",
              properties: { q: { type: "string" }, a: { type: "string" } },
              required: ["q", "a"],
            },
          },
        },
        required: ["type", "cards"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_quiz",
      description: "Create a multiple-choice quiz with answer key.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["create_quiz"] },
          title: { type: "string" },
          summary: { type: "string" },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                q: { type: "string" },
                choices: { type: "array", items: { type: "string" } },
                answer: { type: "string" },
                explanation: { type: "string" },
              },
              required: ["q", "choices", "answer"],
            },
          },
        },
        required: ["type", "questions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_outline",
      description: "Create a topic outline with sections and bullet points.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["create_outline"] },
          title: { type: "string" },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: { type: "string" },
                points: { type: "array", items: { type: "string" } },
              },
              required: ["heading", "points"],
            },
          },
        },
        required: ["type", "sections"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_summary",
      description: "Create a concise summary as bullets.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["create_summary"] },
          title: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
        },
        required: ["type", "bullets"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project_breakdown",
      description: "Break a project into phases with concrete tasks.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["create_project_breakdown"] },
          title: { type: "string" },
          phases: {
            type: "array",
            items: {
              type: "object",
              properties: {
                phase: { type: "string" },
                deadline: { type: "string" },
                tasks: { type: "array", items: { type: "string" } },
              },
              required: ["phase", "tasks"],
            },
          },
        },
        required: ["type", "phases"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_plan",
      description: "Create an actionable multi-step plan suitable for adding tasks.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["make_plan"] },
          title: { type: "string" },
          summary: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                date: { type: "string", description: "YYYY-MM-DD" },
                time: { type: "string", description: "HH:MM 24-hour" },
                estimated_minutes: { type: "number" },
              },
              required: ["title"],
            },
          },
        },
        required: ["type", "title", "steps"],
      },
    },
  },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_MAX_STRING_LENGTH = 500;
const LONG_TEXT_MAX_STRING_LENGTH = 5000;

// Generic/placeholder strings the model might use when it doesn't know the real value.
// If any name field (title, activity, task_name, new_title, parent_title) matches one
// of these, validation rejects it and the caller asks the student for the real value.
const PLACEHOLDER_TITLE_STRINGS = new Set([
  "task title", "new task", "task", "untitled task", "untitled",
  "event title", "new event", "event", "untitled event",
  "activity", "new activity", "block", "new block",
  "assignment", "homework", "new homework",
  "title", "name", "item", "add task", "add event",
  "event name", "task name", "activity name",
  "todo", "to-do", "to do", "thing", "stuff", "something",
  "generic event", "generic task", "placeholder", "tbd", "tba", "n/a",
]);

// Generic subject strings the model uses when it doesn't actually know the class.
// "general" is rejected because it's a meaningless catch-all that hides the missing data.
const PLACEHOLDER_SUBJECT_STRINGS = new Set([
  "subject", "class", "topic", "course", "lesson", "study", "school",
  "academic", "education", "general", "other", "misc", "miscellaneous",
  "n/a", "tbd", "unknown", "none",
]);

// Fields that should never contain a placeholder name. Checked via PLACEHOLDER_TITLE_STRINGS.
const TITLE_LIKE_FIELDS = new Set([
  "title", "activity", "task_name", "new_title", "parent_title",
]);

// Minimum length for a title-like field. Single chars or "a"/"x" are rejected.
const MIN_TITLE_LENGTH = 2;

// Detects titles that are instructions ("add an event", "schedule a test") rather
// than actual names. The model sometimes echoes the user's verb phrase as the title.
const INSTRUCTION_TITLE_REGEX = /^(add|create|schedule|make|put|set|log|track|book|enter|register|new)\s+/i;

function isValidDateString(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidTimeString(value) {
  return TIME_RE.test(value);
}

function validateToolArguments(toolName, args) {
  const spec = TOOL_SPEC_BY_NAME.get(toolName);
  if (!spec || spec.type !== "object") return { issues: [], missingFields: [] };
  const properties = spec.properties || {};
  const required = spec.required || [];
  const issues = [];
  const missingFields = [];

  for (const field of required) {
    const value = args[field];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim().length === 0);
    if (missing) {
      missingFields.push(field);
      issues.push({ field, issue: "missing", expected: "required field" });
    }
  }

  for (const [field, schema] of Object.entries(properties)) {
    const value = args[field];
    if (value === undefined || value === null) continue;
    const expectedType = schema.type;

    if (expectedType === "string") {
      if (typeof value !== "string") {
        issues.push({ field, issue: "type", expected: "string", actual: typeof value });
        continue;
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        issues.push({ field, issue: "length", expected: "non-empty string", actual: "empty string" });
      }
      if (TITLE_LIKE_FIELDS.has(field)) {
        const lower = trimmed.toLowerCase();
        if (PLACEHOLDER_TITLE_STRINGS.has(lower)) {
          missingFields.push(field);
          issues.push({ field, issue: "placeholder", expected: "specific name from the student's message", actual: trimmed });
        } else if (trimmed.length < MIN_TITLE_LENGTH) {
          missingFields.push(field);
          issues.push({ field, issue: "too_short", expected: `at least ${MIN_TITLE_LENGTH} characters`, actual: trimmed });
        } else if (INSTRUCTION_TITLE_REGEX.test(trimmed)) {
          missingFields.push(field);
          issues.push({ field, issue: "instruction_as_title", expected: "the actual name, not a command phrase like 'add an event'", actual: trimmed });
        }
      }
      if (field === "subject" && PLACEHOLDER_SUBJECT_STRINGS.has(trimmed.toLowerCase())) {
        missingFields.push(field);
        issues.push({ field, issue: "placeholder_subject", expected: "specific subject (e.g. 'mathematics', 'biology', 'history')", actual: trimmed });
      }
      const maxLen = ["content", "new_content", "description", "reason", "question"].includes(field)
        ? LONG_TEXT_MAX_STRING_LENGTH
        : DEFAULT_MAX_STRING_LENGTH;
      if (value.length > maxLen) {
        issues.push({ field, issue: "length", expected: `<= ${maxLen} chars`, actual: `${value.length} chars` });
      }
      if ((field.includes("date") || field === "due") && !isValidDateString(trimmed)) {
        issues.push({ field, issue: "format", expected: "YYYY-MM-DD", actual: String(value) });
      }
      if (["time", "start", "end"].includes(field) && !isValidTimeString(trimmed)) {
        issues.push({ field, issue: "format", expected: "HH:MM", actual: String(value) });
      }
      if (schema.enum && !schema.enum.includes(value)) {
        issues.push({ field, issue: "enum", expected: schema.enum.join(", "), actual: String(value) });
      }
      continue;
    }

    if (expectedType === "number") {
      if (typeof value !== "number" || Number.isNaN(value)) {
        issues.push({ field, issue: "type", expected: "number", actual: typeof value });
      }
      continue;
    }

    if (expectedType === "boolean") {
      if (typeof value !== "boolean") {
        issues.push({ field, issue: "type", expected: "boolean", actual: typeof value });
      }
      continue;
    }

    if (expectedType === "array") {
      if (!Array.isArray(value)) {
        issues.push({ field, issue: "type", expected: "array", actual: typeof value });
        continue;
      }
      // Validate nested item shape for object-array fields so a malformed element
      // (e.g. break_task.subtasks[0] missing title) fails before it hits the client.
      const itemSchema = schema.items;
      if (itemSchema && itemSchema.type === "object" && Array.isArray(itemSchema.required)) {
        value.forEach((item, idx) => {
          if (typeof item !== "object" || item === null) {
            issues.push({ field: `${field}[${idx}]`, issue: "type", expected: "object", actual: typeof item });
            return;
          }
          for (const required of itemSchema.required) {
            const val = item[required];
            if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) {
              missingFields.push(`${field}[${idx}].${required}`);
              issues.push({ field: `${field}[${idx}].${required}`, issue: "missing", expected: "required field" });
            }
          }
        });
      }
      continue;
    }

    if (expectedType === "object" && (typeof value !== "object" || Array.isArray(value))) {
      issues.push({
        field,
        issue: "type",
        expected: "object",
        actual: Array.isArray(value) ? "array" : typeof value,
      });
    }
  }

  return { issues, missingFields };
}

function toValidationClarification(toolName, missingFields, issues, args = {}) {
  const detail = issues
    .map((issue) => issue.field)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  const fields = (missingFields.length > 0 ? missingFields : detail);
  const labelForField = (field) => {
    const map = {
      title: "title",
      due: "due date",
      date: "date",
      time: "time",
      start: "start time",
      end: "end time",
      subject: "subject",
      activity: "activity name",
      tab_name: "note name",
      task_name: "task name",
      due_date: "due date",
    };
    return map[field] || field.replace(/_/g, " ");
  };

  // Compute suggested defaults for fields the model left blank.
  const suggested_defaults = {};
  if (fields.includes("subject") && (args.title || args.task_name)) {
    const inferred = inferSubjectFromTitle(args.title || args.task_name);
    if (inferred) suggested_defaults.subject = inferred;
  }
  if (fields.includes("time") && (toolName === "add_event" || toolName === "update_event")) {
    suggested_defaults.time = "all-day";
  }

  const humanFields = fields
    .filter(f => !suggested_defaults[f]) // hide fields we can auto-fill
    .map(labelForField).join(", ");

  const remainingFields = fields.filter(f => !suggested_defaults[f]);

  const oneFieldQuestion = remainingFields.length === 1
    ? (() => {
        switch (remainingFields[0]) {
          case "title": return "What should the title be?";
          case "due": return "What due date should I use? (e.g. next Friday)";
          case "date": return "What date should I use? (e.g. next Friday)";
          case "time": return "What time? (e.g. 14:30) — or leave blank for all-day.";
          case "start": return "What start time? (HH:MM)";
          case "end": return "What end time? (HH:MM)";
          case "task_name": return "What should I name this task?";
          case "subject": return "Which subject is this for?";
          case "activity": return "What activity should I schedule?";
          case "tab_name": return "Which note should I use?";
          default: return `Can you share the ${labelForField(remainingFields[0])}?`;
        }
      })()
    : null;

  return {
    reason: remainingFields.length === 0
      ? null
      : `I need a couple details before I can run ${toolName}.`,
    question: oneFieldQuestion
      || (humanFields
        ? `I still need: ${humanFields}. Can you share them in one reply?`
        : `Can you clarify the details for ${toolName}?`),
    options: [],
    multi_select: false,
    context_action: toolName,
    missing_fields: missingFields,
    suggested_defaults,
  };
}

/* ── Tool schema helpers ── */

/**
 * Returns a copy of the tools array where every non-required property
 * accepts null in addition to its declared type.  This prevents Groq's
 * server-side schema validation from returning HTTP 400 when the LLM
 * explicitly emits `null` for an optional field (e.g. context_action: null).
 */
function withNullableOptionals(tools) {
  return tools.map((tool) => {
    const params = tool.function.parameters;
    const required = new Set(params.required || []);
    const properties = Object.fromEntries(
      Object.entries(params.properties || {}).map(([key, val]) => {
        if (required.has(key) || !val.type) return [key, val];
        const t = val.type;
        const types = Array.isArray(t) ? t : [t];
        if (types.includes("null")) return [key, val];
        return [key, { ...val, type: [...types, "null"] }];
      })
    );
    return { ...tool, function: { ...tool.function, parameters: { ...params, properties } } };
  });
}

// Pre-computed at module load — avoids per-request schema deep-cloning.
const ACTION_TOOLS_NULLABLE = withNullableOptionals(ACTION_TOOLS);
const STUDIO_TOOLS_NULLABLE = withNullableOptionals(STUDIO_TOOLS);

/* ── Groq chat + function calling ── */
export async function callGroq(
  apiKey,
  model,
  systemPrompt,
  messages,
  maxTokens,
  imageBase64,
  imageMimeType,
  includeTools = true,
  toolsOverride = null,
  toolChoiceOverride = "auto",
  backupModel = null,
  options = {}
) {
  const isContentGen = Boolean(options?.isContentGen);
  const budgetMs = Math.max(1000, Number(options?.budgetMs) || (isContentGen ? 20000 : 10000));
  const requestStartedAt = Date.now();
  const metrics = {
    attempt_count: 0,
    retry_wait_ms_total: 0,
    fallback_used: false,
  };

  function remainingBudgetMs() {
    return budgetMs - (Date.now() - requestStartedAt);
  }

  // Inner attempt: builds the request for the resolved model and runs it with budget-aware retries.
  async function attempt(mdl, msgs) {
    // Prompt-caching: when staticSystemPrompt + dynamicContext are provided separately,
    // the static policy becomes a single unchanging system message (Groq can cache it
    // alongside the tool definitions). The dynamic per-user context is sent as a second
    // system message so it doesn't pollute the cached prefix.
    const staticPrompt = options?.staticSystemPrompt;
    const dynamicContext = options?.dynamicContext;
    const groqMessages = staticPrompt
      ? [
          { role: "system", content: staticPrompt },
          { role: "system", content: dynamicContext || "" },
        ]
      : [{ role: "system", content: systemPrompt }];

    if (imageBase64) {
      const effectiveMime = imageMimeType || "image/jpeg";
      const lastUser = [...(msgs || messages)].reverse().find((m) => m.role === "user");
      const textContent =
        lastUser && typeof lastUser.content === "string" && lastUser.content.trim()
          ? lastUser.content.trim()
          : "What do you see in this image?";
      groqMessages.push({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${effectiveMime};base64,${imageBase64}` },
          },
          { type: "text", text: textContent },
        ],
      });
    } else {
      for (const m of (msgs || messages)) {
        const text = typeof m.content === "string" ? m.content.trim() : "";
        if (text) groqMessages.push({ role: m.role, content: text });
      }
    }

    const body = {
      model: mdl,
      messages: groqMessages,
      max_completion_tokens: 1000,
      temperature: 1,
      top_p: 1,
      reasoning_effort: "high",
    };

    const rawTools = toolsOverride || (includeTools ? ACTION_TOOLS : null);
    const effectiveTools = rawTools
      ? (rawTools === ACTION_TOOLS ? ACTION_TOOLS_NULLABLE
        : rawTools === STUDIO_TOOLS ? STUDIO_TOOLS_NULLABLE
        : withNullableOptionals(rawTools))
      : null;
    if (effectiveTools && effectiveTools.length > 0 && !imageBase64) {
      body.tools = effectiveTools;
      body.tool_choice = toolChoiceOverride;
    }

    // Retry loop: capped by both retry count and remaining budget.
    const MAX_RETRIES = 5;
    const MIN_REMAINING_FOR_RETRY_MS = 900;
    let res;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      const remaining = remainingBudgetMs();
      if (remaining <= MIN_REMAINING_FOR_RETRY_MS) {
        throw new Error(`Groq ${mdl} budget exhausted (${budgetMs}ms)`);
      }
      metrics.attempt_count += 1;
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        Math.max(700, Math.min(remaining - 250, 8000))
      );
      try {
        res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
          throw new Error(`Groq ${mdl} request timed out within budget (${budgetMs}ms)`);
        }
        throw err;
      }
      clearTimeout(timeoutId);

      if (res.ok) {
        updateGroqRpm(res.headers);
      }

      if (res.status === 429 && i < MAX_RETRIES) {
        const errBody = await res.text().catch(() => "");
        const retryMatch = errBody.match(/try again in ([\d.]+)s/i);
        const waitSec = retryMatch ? Math.min(parseFloat(retryMatch[1]), 8) : Math.min((2 ** i) * 0.8, 8);
        const waitMs = Math.floor(waitSec * 1000);
        if (remainingBudgetMs() <= waitMs + MIN_REMAINING_FOR_RETRY_MS) {
          throw new Error(`Groq ${mdl} rate limited with insufficient budget to retry`);
        }
        metrics.retry_wait_ms_total += waitMs;
        console.warn(`Groq 429 rate limit hit on ${mdl}, retrying in ${waitSec}s (attempt ${i + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (res.status >= 500 && i < MAX_RETRIES) {
        const waitMs = Math.min(300 * (2 ** i), 2500);
        if (remainingBudgetMs() <= waitMs + MIN_REMAINING_FOR_RETRY_MS) {
          const errText = await res.text().catch(() => "");
          throw new Error(`Groq ${mdl} error ${res.status}: ${errText}`);
        }
        metrics.retry_wait_ms_total += waitMs;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (res.status === 400) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Groq ${mdl} error 400: ${errText.slice(0, 200)}`);
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Groq ${mdl} error ${res.status}: ${errText}`);
      }
      break;
    }

    const data = await res.json();
    return {
      ...parseLlmResponse(data),
      model_used: mdl,
    };
  }

  const resolvedModel = resolveModel(model);

  // Single attempt — no fallback chain.
  let parsed = await attempt(resolvedModel);

  // Strict validate-and-retry: if there are validation warnings, retry once with
  // human-readable field-by-field feedback so the model can correct the call.
  if (parsed.validation_warnings && parsed.validation_warnings.length > 0) {
    const originalClarifications = parsed.clarifications || [];
    const originalClarification = parsed.clarification || null;
    const feedback = buildValidationFeedback(parsed.validation_warnings);
    const retryMessages = [
      ...(messages || []),
      { role: "user", content: feedback },
    ];
    console.warn(`[callGroq] validation warnings on ${resolvedModel}, retrying once`, parsed.validation_warnings);
    try {
      const retried = await attempt(resolvedModel, retryMessages);
      const before = parsed.validation_warnings.length;
      const after = (retried.validation_warnings || []).length;
      const retryHasContent = retried.actions.length > 0 || retried.clarifications.length > 0;
      const retryImproves = after < before;
      if (retryHasContent || retryImproves) {
        // Retry produced a tool call or structured clarification — use it.
        parsed = retried;
      } else if (retried.content && originalClarifications.length > 0) {
        // Retry produced only plain text (no tool call, no clarification). Keep the
        // structured clarification cards from attempt 1 so the UI prompts the user
        // instead of silently dropping the question.
        parsed = {
          ...retried,
          clarifications: originalClarifications,
          clarification: originalClarification,
        };
      }
      // If retry has equally many warnings and no content, keep original (do nothing).
    } catch (retryErr) {
      console.warn(`[callGroq] retry after validation error failed: ${retryErr.message}`);
    }
  }

  // Server-side safety net: auto-fill subject from title for academic events when the
  // model omitted or generic-ed it. Operates on actions that already passed validation.
  if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
    parsed.actions = parsed.actions.map(enrichActionSubject);
  }

  return { ...parsed, ...metrics };
}

// Renders validation warnings into actionable instructions for the model retry.
function buildValidationFeedback(warnings) {
  const lines = ["Your previous tool call had problems. Fix the listed fields and call the tool again, or ask the student in plain text if you can't determine a value."];
  for (const w of warnings) {
    const tool = w.tool || "(unknown tool)";
    for (const issue of (w.issues || [])) {
      const field = issue.field;
      const kind = issue.issue;
      let instruction;
      switch (kind) {
        case "missing":
          instruction = `field "${field}" is missing — provide the actual value or ask the student.`;
          break;
        case "placeholder":
          instruction = `field "${field}" is a placeholder ("${issue.actual}") — use the real name from the student's message, never generic words like 'task', 'event', 'untitled'.`;
          break;
        case "placeholder_subject":
          instruction = `field "${field}" is a generic subject ("${issue.actual}") — use a specific subject like 'mathematics', 'biology', 'history', 'spanish', etc., or ask the student which class it's for. Do not use 'general', 'class', 'subject', or 'other'.`;
          break;
        case "format":
          instruction = `field "${field}" has wrong format — expected ${issue.expected}, got "${issue.actual}".`;
          break;
        case "enum":
          instruction = `field "${field}" must be one of: ${issue.expected}.`;
          break;
        case "too_short":
          instruction = `field "${field}" is too short — needs ${issue.expected}.`;
          break;
        default:
          instruction = `field "${field}": ${kind}`;
      }
      lines.push(`- ${tool}.${field}: ${instruction}`);
    }
  }
  return lines.join("\n");
}

// If an action has a title but no usable subject, infer it from the title.
// Only fills in when the model left subject blank or used a generic placeholder.
function enrichActionSubject(action) {
  if (!action || typeof action !== "object") return action;
  const titleField = action.title || action.task_name || action.activity || "";
  if (!titleField) return action;
  const current = (action.subject || "").trim().toLowerCase();
  const isGeneric = !current || PLACEHOLDER_SUBJECT_STRINGS.has(current);
  if (!isGeneric) return action;
  const inferred = inferSubjectFromTitle(titleField);
  if (inferred) return { ...action, subject: inferred };
  return action;
}

/**
 * Single-shot streaming call to Groq.
 * Calls `onTextDelta(chunk)` for each text token as it arrives.
 * Tool-call tokens are accumulated silently — they are never passed to onTextDelta,
 * so raw JSON is never shown in the chat window.
 * Returns a full ParsedLlmResponse when the stream ends.
 */
export async function callGroqStream(
  apiKey,
  model,
  systemPrompt,
  messages,
  maxTokens,
  tools,
  toolChoice,
  onTextDelta,
  options = {}
) {
  const backupModel = options?.backupModel || null;
  try {
    return await _callGroqStreamInner(apiKey, model, systemPrompt, messages, maxTokens, tools, toolChoice, onTextDelta, options);
  } catch (err) {
    if (backupModel && backupModel !== model) {
      console.warn(`[callGroqStream] ${model} failed (${err.message}) — retrying with ${backupModel}`);
      return _callGroqStreamInner(apiKey, backupModel, systemPrompt, messages, maxTokens, tools, toolChoice, onTextDelta, { ...options, backupModel: null });
    }
    throw err;
  }
}

async function _callGroqStreamInner(
  apiKey,
  model,
  systemPrompt,
  messages,
  maxTokens,
  tools,
  toolChoice,
  onTextDelta,
  options = {}
) {
  const staticPrompt = options?.staticSystemPrompt;
  const dynamicContext = options?.dynamicContext;
  const groqMessages = staticPrompt
    ? [
        { role: "system", content: staticPrompt },
        { role: "system", content: dynamicContext || "" },
      ]
    : [{ role: "system", content: systemPrompt }];

  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content.trim() : "";
    if (text) groqMessages.push({ role: m.role, content: text });
  }

  const effectiveTools = tools
    ? (tools === ACTION_TOOLS ? ACTION_TOOLS_NULLABLE
      : tools === STUDIO_TOOLS ? STUDIO_TOOLS_NULLABLE
      : withNullableOptionals(tools))
    : null;
  const body = {
    model,
    messages: groqMessages,
    max_completion_tokens: 1000,
    temperature: 1,
    top_p: 1,
    reasoning_effort: "high",
    stream: true,
  };
  if (effectiveTools && effectiveTools.length > 0) {
    body.tools = effectiveTools;
    body.tool_choice = toolChoice || "auto";
  }

  const streamTimeoutMs = 25000;
  const streamController = new AbortController();
  const streamTimeoutId = setTimeout(() => streamController.abort(), streamTimeoutMs);
  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: streamController.signal,
    });
  } catch (err) {
    clearTimeout(streamTimeoutId);
    if (err.name === "AbortError") {
      throw new Error(`Groq ${model} stream request timed out after ${streamTimeoutMs}ms`);
    }
    throw err;
  }
  clearTimeout(streamTimeoutId);

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq ${model} stream error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulatedText = "";
  // tool_calls[index] → { id, name, argumentsRaw }
  const toolCallMap = {};
  let finishReason = null;

  let buffer = "";
  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete last line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") break outer;
      let chunk;
      try { chunk = JSON.parse(payload); } catch (_) { continue; }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (!delta) continue;

      // Text delta — send to caller for live rendering
      if (typeof delta.content === "string" && delta.content) {
        accumulatedText += delta.content;
        if (typeof onTextDelta === "function") onTextDelta(delta.content);
      }

      // Tool-call delta — accumulate silently, never surfaced to onTextDelta
      if (Array.isArray(delta.tool_calls)) {
        for (const tcDelta of delta.tool_calls) {
          const idx = tcDelta.index ?? 0;
          if (!toolCallMap[idx]) {
            toolCallMap[idx] = { id: tcDelta.id || `tc_${idx}`, name: "", argumentsRaw: "" };
          }
          if (tcDelta.function?.name) toolCallMap[idx].name += tcDelta.function.name;
          if (tcDelta.function?.arguments) toolCallMap[idx].argumentsRaw += tcDelta.function.arguments;
        }
      }
    }
  }

  // Reconstruct a Groq-compatible response object and parse it
  const toolCalls = Object.values(toolCallMap).map((tc) => ({
    id: tc.id,
    type: "function",
    function: { name: tc.name, arguments: tc.argumentsRaw },
  }));
  const syntheticData = {
    choices: [{
      message: {
        content: accumulatedText || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finish_reason: finishReason,
    }],
  };
  return {
    ...parseLlmResponse(syntheticData),
    model_used: model,
  };
}

export function parseLlmResponse(data) {
  const message = data.choices?.[0]?.message;
  const textContent = message?.content || "";
  const clarifications = [];
  const validationWarnings = [];
  const toolCalls = message?.tool_calls || [];
  const proposedToolCalls = [];
  const validatedToolCalls = [];
  const actions = toolCalls.flatMap((tc) => {
    const toolName = tc?.function?.name || "unknown_tool";
    proposedToolCalls.push(toolName);
    const raw = tc?.function?.arguments;
    let parsedArgs;
    let parseFailed = false;
    if (typeof raw === "object" && raw !== null) {
      parsedArgs = raw;
    } else if (raw == null || raw === "") {
      // The model emitted the tool call but produced no argument payload.
      parseFailed = true;
      parsedArgs = {};
    } else {
      try {
        parsedArgs = JSON.parse(raw);
      } catch (err) {
        parseFailed = true;
        parsedArgs = {};
        try { console.warn("[chat-core] tool-arg JSON parse failed", { tool: toolName, err: String(err), raw }); } catch (_) {}
      }
    }
    if (parseFailed) {
      validationWarnings.push({
        tool: toolName,
        missing_fields: [],
        issues: [{ field: "arguments", reason: "unparseable_or_missing" }],
      });
      clarifications.push({
        reason: "model_output_invalid",
        question: "I didn't capture the details cleanly — could you say that again in one sentence?",
        options: [],
        multi_select: false,
      });
      return [];
    }

    const { issues, missingFields } = validateToolArguments(tc.function.name, parsedArgs);
    if (issues.length > 0) {
      validationWarnings.push({
        tool: tc.function.name,
        missing_fields: missingFields,
        issues,
      });
      clarifications.push(toValidationClarification(tc.function.name, missingFields, issues, parsedArgs));
      return [];
    }

    validatedToolCalls.push(toolName);
    const actionType = parsedArgs.type || tc.function.name;
    return [{
      type: actionType,
      ...parsedArgs,
    }];
  });

  // Return single clarification for backward compat, plus full array
  const clarification = clarifications.length > 0 ? clarifications[0] : null;
  return {
    content: textContent.trim(),
    actions,
    clarification,
    clarifications,
    validation_warnings: validationWarnings,
    tool_call_stats: {
      proposed: proposedToolCalls.length,
      validated: validatedToolCalls.length,
      proposed_tools: proposedToolCalls,
      validated_tools: validatedToolCalls,
    },
  };
}
