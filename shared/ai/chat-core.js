// Shared chat orchestration core used by both Vercel (Node) and Supabase Edge (Deno).
// Keep this file runtime-agnostic (Web APIs only).

export const CORE_VERSION = "chat-core-v1-2026-03-27";
export const CORE_CHECKSUM = "sha256:action-tools-parse-v1";

export const PRIMARY_MODEL        = "openai/gpt-oss-120b";
export const CONVERSATIONAL_MODEL = "openai/gpt-oss-20b";
export const BACKUP_MODEL         = "openai/gpt-oss-20b";
export const LARGE_BACKUP_MODEL   = "llama-3.3-70b-versatile";
export const FAST_MODEL           = "llama-3.1-8b-instant";

const GROQ_CIRCUIT = {
  openedUntilMs: 0,
  spikes: [],
};

const _CONTENT_ACTION_TYPES = new Set([
  "create_flashcards",
  "create_quiz",
  "create_outline",
  "create_summary",
  "create_study_plan",
  "create_project_breakdown",
  "make_plan",
]);

export const CONTENT_ACTION_TYPES = _CONTENT_ACTION_TYPES;

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
 *   options?: { isContentGen?: boolean, routeType?: "conversational" | "tool_heavy" | "content_gen", budgetMs?: number }
 * }} CallGroqRequest */

export const ACTION_TOOLS = [
  {
    type: "function",
    function: {
      name: "add_event",
      description:
        "Add an event to the student's calendar. Use for tests, exams, quizzes, practices, games, meets, appointments, deadlines, or any scheduled activity with a specific date. IMPORTANT: Only call this when the student has explicitly stated the title and date. If the student hasn't said what the event is or when it is, use ask_clarification FIRST. NEVER invent or guess values.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          time: { type: "string", description: "Start time in HH:MM 24h format (e.g. 14:30). Omit for all-day events." },
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
            description: "School subject (e.g., Math, Biology, English)",
          },
        },
        required: ["title", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_task",
      description:
        "Add a homework assignment or task to the student's to-do list. IMPORTANT: Only call this when the student has explicitly stated what the task is. If the title or key details are missing, use ask_clarification FIRST. NEVER guess or fabricate values.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          subject: { type: "string", description: "School subject" },
          due: { type: "string", description: "Due date in YYYY-MM-DD format" },
          estimated_minutes: {
            type: "number",
            description: "Estimated time to complete in minutes",
          },
        },
        required: ["title", "due"],
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
        "Update an existing event — change its title, date, type, or subject. Use for reschedule/move/rename requests.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Current event title to look up" },
          new_title: { type: "string", description: "New title (omit if not changing name)" },
          date: { type: "string", description: "New date in YYYY-MM-DD format (omit if not changing)" },
          event_type: {
            type: "string",
            enum: [
              "test", "exam", "quiz", "practice", "game", "match", "meet",
              "tournament", "event", "other",
            ],
          },
          subject: { type: "string" },
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
        "Add a time block to the student's daily schedule. IMPORTANT: Only call this when the student has explicitly provided the activity, date, and start/end times. If ANY of these are missing from the student's message, use ask_clarification FIRST to ask for the missing details. NEVER guess or fabricate values.",
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
      name: "convert_event_to_block",
      description:
        "Convert a date-only event into a scheduled time block on the same date.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title to convert" },
          event_id: { type: "string", description: "Event id to convert (optional if title provided)" },
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          start: { type: "string", description: "Start time in HH:MM 24-hour format" },
          end: { type: "string", description: "End time in HH:MM 24-hour format" },
          category: {
            type: "string",
            enum: ["school", "swim", "debate", "free time", "sleep", "other"],
          },
        },
        required: ["date", "start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "convert_block_to_event",
      description:
        "Convert an existing scheduled block range into a calendar event.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          start: { type: "string", description: "Start time in HH:MM 24-hour format" },
          end: { type: "string", description: "End time in HH:MM 24-hour format (optional)" },
          title: { type: "string", description: "Event title" },
          event_type: {
            type: "string",
            enum: ["test", "exam", "quiz", "practice", "game", "match", "meet", "tournament", "event", "other"],
          },
          subject: { type: "string", description: "School subject" },
        },
        required: ["date", "start", "title", "event_type", "subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_note",
      description: "Save a note or important information to the student's notes.",
      parameters: {
        type: "object",
        properties: {
          tab_name: { type: "string", description: "Name for the note tab" },
          content: { type: "string", description: "Content to save" },
        },
        required: ["tab_name", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_note",
      description: "Replace the content of an existing note. Use when the student asks to update, rewrite, or change a note's content.",
      parameters: {
        type: "object",
        properties: {
          tab_name: { type: "string", description: "Name of the note to edit" },
          new_content: { type: "string", description: "The new content to replace the existing content with" },
        },
        required: ["tab_name", "new_content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_note",
      description: "Delete a note from the student's notes. Use when the student asks to remove or delete a specific note.",
      parameters: {
        type: "object",
        properties: {
          tab_name: { type: "string", description: "Name of the note to delete" },
        },
        required: ["tab_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "break_task",
      description:
        "Break a large task into smaller, manageable subtasks spread across multiple days.",
      parameters: {
        type: "object",
        properties: {
          parent_title: { type: "string", description: "Title of the task to break up" },
          subtasks: {
            type: "array",
            description: "List of subtasks",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                due: { type: "string", description: "YYYY-MM-DD" },
                estimated_minutes: { type: "number" },
              },
            },
          },
        },
        required: ["parent_title", "subtasks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_recurring_event",
      description:
        "Add a recurring event that repeats on specific days of the week — e.g., swim practice every Mon/Wed/Fri, weekly tutoring on Thursdays. IMPORTANT: Only call this when the student has explicitly named the activity and stated which days it repeats. If the title or recurrence days are missing, use ask_clarification FIRST. NEVER guess or fabricate values.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          event_type: {
            type: "string",
            enum: ["test", "practice", "game", "match", "event", "other"],
          },
          subject: { type: "string" },
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
        required: ["title", "days", "start_date", "end_date"],
      },
    },
  },
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
              properties: {
                q: { type: "string" },
                a: { type: "string" },
              },
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
      name: "create_study_plan",
      description: "Create a practical study plan with timed steps.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["create_study_plan"] },
          title: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                time_minutes: { type: "number" },
                day: { type: "string" },
              },
              required: ["step"],
            },
          },
        },
        required: ["type", "steps"],
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
  {
    type: "function",
    function: {
      name: "ask_clarification",
      description:
        "Ask the student a focused follow-up question when required details are missing, the request is ambiguous, or multiple interpretations are possible. Use this proactively — don't guess when asking would be better. Also use for content generation requests that lack a topic or scope.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Brief explanation of WHY you need clarification (shown to the student, e.g. 'I want to make sure I create the right study plan for you')",
          },
          question: {
            type: "string",
            description: "Direct clarification question for the student",
          },
          options: {
            type: "array",
            description: "Suggested answer options the student can tap/select",
            items: { type: "string" },
          },
          multi_select: {
            type: "boolean",
            description: "Whether the student may choose multiple options",
          },
          context_action: {
            type: "string",
            description: "Optional action this clarification is about (for example add_event)",
          },
          missing_fields: {
            type: "array",
            description: "Optional list of required fields that are currently missing",
            items: { type: "string" },
          },
        },
        required: ["reason", "question", "options", "multi_select"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_all",
      description:
        "Wipe ALL tasks, events, and blocks. Only use when the student explicitly asks to clear or reset everything.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

/* ── Parse Groq's malformed tool calls from failed_generation ── */
export function parseFailedGeneration(failedGen) {
  const results = [];
  // Matches both Groq malformed formats:
  //   <function=tool_name {"key":"val"}></function>     (space-separated)
  //   <function=tool_name({"key":"val"})></function>     (parenthesized)
  //   <function=tool_name({"key":"val"})</function>      (parenthesized, no >)
  const regex = /<function=(\w+)[\s(>]*(\{[\s\S]*?\})\s*\)?\s*>?\s*<\/function>/g;
  let match;
  while ((match = regex.exec(failedGen)) !== null) {
    try {
      const args = JSON.parse(match[2]);
      results.push({ name: match[1], arguments: args });
    } catch (_) { /* skip unparseable entries */ }
  }
  return results;
}

const TOOL_SPEC_BY_NAME = new Map(
  ACTION_TOOLS.map((tool) => [tool.function.name, tool.function.parameters])
);
export const CONTENT_ACTION_TOOLS = ACTION_TOOLS.filter((tool) => _CONTENT_ACTION_TYPES.has(tool.function.name) || tool.function.name === "ask_clarification");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_MAX_STRING_LENGTH = 500;
const LONG_TEXT_MAX_STRING_LENGTH = 5000;

// Generic/placeholder strings the model might use when it doesn't know the real value.
// If any name field (title, activity) matches one of these, it is treated as missing —
// triggering ask_clarification instead of executing the action.
const PLACEHOLDER_TITLE_STRINGS = new Set([
  "task title", "new task", "task", "untitled task", "untitled",
  "event title", "new event", "event", "untitled event",
  "activity", "new activity", "block", "new block",
  "assignment", "homework", "new homework",
  "title", "name", "item", "add task", "add event",
  "event name", "task name", "activity name",
]);

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
      if (["title", "activity"].includes(field) && PLACEHOLDER_TITLE_STRINGS.has(trimmed.toLowerCase())) {
        missingFields.push(field);
        issues.push({ field, issue: "placeholder", expected: "specific name from the student's message", actual: trimmed });
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

function toValidationClarification(toolName, missingFields, issues) {
  const detail = issues
    .map((issue) => issue.field)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  const humanFields = (missingFields.length > 0 ? missingFields : detail).join(", ");
  return {
    reason: `I need a couple details before I can run ${toolName}.`,
    question: humanFields
      ? `Can you provide valid values for: ${humanFields}?`
      : `Can you clarify the details for ${toolName}?`,
    options: ["Provide details", "Skip this action"],
    multi_select: false,
    context_action: toolName,
    missing_fields: missingFields,
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

  const routeType = options?.routeType || (isContentGen ? "content_gen" : "conversational");
  const selectedPrimary = routeType === "conversational" ? CONVERSATIONAL_MODEL : model;
  const selectedBackup = routeType === "conversational" ? (backupModel || null) : (backupModel || null);

  function remainingBudgetMs() {
    return budgetMs - (Date.now() - requestStartedAt);
  }

  function noteSpike(statusCode) {
    const now = Date.now();
    GROQ_CIRCUIT.spikes = GROQ_CIRCUIT.spikes.filter((ts) => now - ts <= 60000);
    if (statusCode === 429 || statusCode >= 500) {
      GROQ_CIRCUIT.spikes.push(now);
      if (GROQ_CIRCUIT.spikes.length >= 4) {
        GROQ_CIRCUIT.openedUntilMs = now + 15000;
      }
    }
  }

  function resetCircuit() {
    GROQ_CIRCUIT.spikes = [];
    GROQ_CIRCUIT.openedUntilMs = 0;
  }

  // Inner attempt: builds the request for a specific model and runs it with budget-aware retries.
  async function attempt(mdl) {
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
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
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
      for (const m of messages) {
        const text = typeof m.content === "string" ? m.content.trim() : "";
        if (text) groqMessages.push({ role: m.role, content: text });
      }
    }

    // Vision requests always use the vision-capable model regardless of mdl
    const effectiveModel = imageBase64 ? "meta-llama/llama-4-scout-17b-16e-instruct" : mdl;
    const body = {
      model: effectiveModel,
      messages: groqMessages,
      max_tokens: maxTokens,
    };

    const rawTools = toolsOverride || (includeTools ? ACTION_TOOLS : null);
    const effectiveTools = rawTools ? withNullableOptionals(rawTools) : null;
    if (effectiveTools && effectiveTools.length > 0 && !imageBase64) {
      body.tools = effectiveTools;
      body.tool_choice = toolChoiceOverride;
    }

    // Retry loop: capped by both retry count and remaining budget.
    const MAX_RETRIES = 5;
    const MIN_REMAINING_FOR_RETRY_MS = 900;
    let res;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      if (Date.now() < GROQ_CIRCUIT.openedUntilMs) {
        throw new Error(`Groq circuit open until ${new Date(GROQ_CIRCUIT.openedUntilMs).toISOString()}`);
      }
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
          noteSpike(503);
          throw new Error(`Groq ${mdl} request timed out within budget (${budgetMs}ms)`);
        }
        throw err;
      }
      clearTimeout(timeoutId);

      if ((res.status === 429 || res.status >= 500) && i < MAX_RETRIES) {
        noteSpike(res.status);
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

      // Recover from Groq's malformed tool call errors (400 tool_use_failed)
      if (res.status === 400) {
        const errText = await res.text().catch(() => "");
        let errData;
        try { errData = JSON.parse(errText); } catch (_) { /* not JSON */ }

        if (errData?.error?.code === "tool_use_failed" && errData?.error?.failed_generation) {
          const recovered = parseFailedGeneration(errData.error.failed_generation);
          if (recovered.length > 0) {
            const syntheticToolCalls = recovered.map((r, k) => ({
              id: `recovered_${k}`,
              type: "function",
              function: { name: r.name, arguments: JSON.stringify(r.arguments) },
            }));
            return parseLlmResponse({ choices: [{ message: { content: "", tool_calls: syntheticToolCalls } }] });
          }
        }
        throw new Error(`Groq ${mdl} error 400: ${errText.slice(0, 200)}`);
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Groq ${mdl} error ${res.status}: ${errText}`);
      }
      resetCircuit();
      break;
    }

    const data = await res.json();
    return {
      ...parseLlmResponse(data),
      model_used: effectiveModel,
    };
  }

  // Try primary model; fall back to backupModel on hard errors OR empty responses
  try {
    let result = await attempt(selectedPrimary);
    if (!result.content && result.actions.length === 0 && selectedBackup && selectedBackup !== selectedPrimary) {
      metrics.fallback_used = true;
      console.warn(`[callGroq] Primary model (${selectedPrimary}) returned empty response — retrying with backup ${selectedBackup}`);
      result = await attempt(selectedBackup);
    }
    return { ...result, ...metrics };
  } catch (primaryErr) {
    if (selectedBackup && selectedBackup !== selectedPrimary && remainingBudgetMs() > 900) {
      metrics.fallback_used = true;
      console.warn(`[callGroq] Primary model (${selectedPrimary}) failed: ${primaryErr.message} — retrying with backup ${selectedBackup}`);
      const fallbackResult = await attempt(selectedBackup);
      return { ...fallbackResult, ...metrics };
    }
    throw primaryErr;
  }
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

  const effectiveTools = tools ? withNullableOptionals(tools) : null;
  const body = {
    model,
    messages: groqMessages,
    max_tokens: maxTokens,
    stream: true,
  };
  if (effectiveTools && effectiveTools.length > 0) {
    body.tools = effectiveTools;
    body.tool_choice = toolChoice || "auto";
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

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
    let parsedArgs;
    try {
      const raw = tc.function.arguments;
      parsedArgs = (typeof raw === "object" && raw !== null) ? raw : JSON.parse(raw || "{}");
    } catch (_) {
      parsedArgs = {};
    }

    if (tc.function.name === "ask_clarification") {
      validatedToolCalls.push(toolName);
      clarifications.push({
        reason: parsedArgs.reason || "",
        question: parsedArgs.question || "",
        options: Array.isArray(parsedArgs.options) ? parsedArgs.options : [],
        multi_select: Boolean(parsedArgs.multi_select),
        ...(parsedArgs.context_action ? { context_action: parsedArgs.context_action } : {}),
        ...(Array.isArray(parsedArgs.missing_fields)
          ? { missing_fields: parsedArgs.missing_fields }
          : {}),
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
      clarifications.push(toValidationClarification(tc.function.name, missingFields, issues));
      return [];
    }

    validatedToolCalls.push(toolName);
    const actionType = _CONTENT_ACTION_TYPES.has(tc.function.name) ? tc.function.name : (parsedArgs.type || tc.function.name);
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
