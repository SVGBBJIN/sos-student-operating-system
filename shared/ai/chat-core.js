// Shared chat orchestration core used by both Vercel (Node) and Supabase Edge (Deno).
// Keep this file runtime-agnostic (Web APIs only).

export const CORE_VERSION = "chat-core-v2-2026-04-12";
export const CORE_CHECKSUM = "sha256:action-tools-parse-v1";

export const PRIMARY_MODEL        = "openai/gpt-oss-120b";
export const CONVERSATIONAL_MODEL = "openai/gpt-oss-20b";
export const BACKUP_MODEL         = "openai/gpt-oss-20b";
export const FAST_MODEL           = "openai/gpt-oss-20b";

// LITE_MODEL is an alias for FAST_MODEL — used for short/simple turns and classification tasks.
export const LITE_MODEL = FAST_MODEL;

/**
 * Selects the appropriate Groq model based on the characteristics of the input.
 * Intended to be called once per session; lock the result in sessionStorage.sos_active_model.
 *
 * @param {{ text?: string, toolCount?: number, agentStep?: boolean }} input
 * @returns {string} Groq model ID
 */
export function selectModel(input = {}) {
  if (input.agentStep) return PRIMARY_MODEL;
  if ((input.toolCount ?? 0) > 0) return PRIMARY_MODEL;
  if ((input.text?.length ?? 0) < 80 && !(input.toolCount)) return FAST_MODEL;
  return PRIMARY_MODEL;
}

// Gemini (Google AI) — OpenAI-compatible endpoint, used as cross-provider fallback.
// gemini-2.5-flash backs PRIMARY/CONVERSATIONAL; gemini-2.5-flash-lite backs FAST/BACKUP paths.
// NOTE: gemma-3-*-it are HuggingFace open-weight IDs and are NOT valid on this endpoint.
export const GEMINI_CONVERSATIONAL_BACKUP = "gemini-2.5-flash";
export const GEMINI_FAST_BACKUP           = "gemini-2.5-flash-lite";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

const GROQ_CIRCUIT = {
  openedUntilMs: 0,
  spikes: [],
};

// Tracks Groq's remaining tokens-per-minute, read from response headers after each call.
// Enables proactive routing to Gemini before hitting a hard TPM 429.
const GROQ_TPM = {
  remaining: Infinity,  // x-ratelimit-remaining-tokens
  limit: Infinity,      // x-ratelimit-limit-tokens
  resetAtMs: 0,         // absolute ms when the TPM window resets
};
const TPM_SWITCH_THRESHOLD = 0.15; // switch providers when <15% of TPM remains

function updateGroqTpm(headers) {
  const remaining = parseInt(headers.get("x-ratelimit-remaining-tokens") || "", 10);
  const limit     = parseInt(headers.get("x-ratelimit-limit-tokens")     || "", 10);
  const resetStr  = headers.get("x-ratelimit-reset-tokens") || "";
  if (!isNaN(remaining)) GROQ_TPM.remaining = remaining;
  if (!isNaN(limit))     GROQ_TPM.limit     = limit;
  // resetStr is like "1.23s" — convert to absolute timestamp
  const sec = parseFloat(resetStr);
  if (!isNaN(sec))       GROQ_TPM.resetAtMs = Date.now() + Math.ceil(sec * 1000);
}

function groqTpmNearLimit() {
  if (GROQ_TPM.limit === Infinity) return false;        // no header data yet
  if (Date.now() > GROQ_TPM.resetAtMs) return false;   // window already reset
  return GROQ_TPM.remaining < GROQ_TPM.limit * TPM_SWITCH_THRESHOLD;
}

// Tracks Groq's remaining requests-per-minute from response headers.
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

function isGeminiModel(mdl) {
  return mdl === GEMINI_CONVERSATIONAL_BACKUP || mdl === GEMINI_FAST_BACKUP;
}

// Returns the Gemini backup appropriate for a given primary model.
function geminiBackupFor(mdl) {
  return mdl === CONVERSATIONAL_MODEL ? GEMINI_CONVERSATIONAL_BACKUP : GEMINI_FAST_BACKUP;
}

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
        "Add a new task to the student's to-do list (homework, assignments, chores, errands — anything without a fixed start time). You MUST know the task_name before calling this; if it is unclear, call ask_clarification FIRST. due_date is required: if the student said 'due X', 'by X', 'for X' use that; otherwise ask_clarification rather than guessing. Never invent values.",
      parameters: {
        type: "object",
        properties: {
          task_name: { type: "string", description: "The name or title of the task, phrased as the student said it." },
          due_date: { type: "string", description: "Due date in ISO format (YYYY-MM-DD). If the student did not specify a date, call ask_clarification instead of guessing." },
        },
        required: ["task_name", "due_date"],
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
      description: "Store a note, if you lack any of the contents, you call the ask clarification tool.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The note content." },
          title: { type: "string", description: "Optional title for the note." },
        },
        required: ["content"],
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
        "ONLY call this when you are about to execute an action tool (add_event, add_task, add_block, add_note, etc.) and one or more REQUIRED fields are missing from the student's message. Do NOT call this for casual greetings, general chat, or non-action conversations — respond naturally in those cases. This tool exists solely to collect missing required fields before executing a tool action.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "A single, focused question asking only for the most critical missing field.",
          },
          type: {
            type: "string",
            enum: ["multiple_choice", "text"],
            description: "Type of clarification question.",
          },
          choices: {
            type: "array",
            description: "List of choices (required if type is multiple_choice).",
            items: { type: "string" },
          },
          missing_fields: {
            type: "array",
            description: "The required fields that are missing (e.g. ['date', 'title']).",
            items: { type: "string" },
          },
        },
        required: ["question", "type", "missing_fields"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search_reference",
      description:
        "Search the web for general knowledge, source-backed references, and direct quotes. Use this when the student asks for facts with citations or quote evidence from the web.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query or question to research" },
          quote_count: { type: "number", description: "Desired number of direct quotes (1-6)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_all",
      description:
        "DESTRUCTIVE: wipe ALL tasks, events, blocks, and notes. Call this ONLY when the student has explicitly and unambiguously said to clear, reset, wipe, or delete everything. NEVER call it in response to 'clear the chat' or 'start over' (those are not destructive). You MUST set confirm=true; if you are not certain, call ask_clarification instead.",
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

// Lightweight meta-tool for the conversational model.
// When the student signals intent to schedule/add something, the model calls this
// instead of trying to execute the action itself (which it can't in conversational mode).
// The frontend intercepts it and shows a "Do you want to X?" yes/no card.
export const PROPOSE_ACTION_TOOL = {
  type: "function",
  function: {
    name: "propose_action",
    description: "Call this when you detect the student wants to schedule, add, or create something (event, task, study block, or note) but you're in a conversational context. Surfaces a quick 'Do you want to X?' confirmation card in the UI. Include any details the student already mentioned as prefilled data.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Short, conversational description shown on the card — e.g. 'add your Chem midterm to the calendar' or 'create a task for your essay'",
        },
        action_type: {
          type: "string",
          enum: ["add_event", "add_task", "add_block", "add_note"],
          description: "The action type to propose",
        },
        prefilled: {
          type: "object",
          description: "Any field values the student already mentioned — title, date, subject, time, etc.",
          additionalProperties: true,
        },
      },
      required: ["summary", "action_type"],
    },
  },
};

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

function toValidationClarification(toolName, missingFields, issues) {
  const detail = issues
    .map((issue) => issue.field)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  const fields = (missingFields.length > 0 ? missingFields : detail);
  const labelForField = (field) => {
    const map = {
      title: "title",
      due: "due date (YYYY-MM-DD)",
      date: "date (YYYY-MM-DD)",
      time: "time (HH:MM)",
      start: "start time (HH:MM)",
      end: "end time (HH:MM)",
      subject: "subject",
      activity: "activity name",
      tab_name: "note name",
      task_name: "task name",
      due_date: "due date (YYYY-MM-DD)",
    };
    return map[field] || field.replace(/_/g, " ");
  };
  const humanFields = fields.map(labelForField).join(", ");
  const oneFieldQuestion = fields.length === 1
    ? (() => {
        switch (fields[0]) {
          case "title": return "What should the title be?";
          case "due": return "What due date should I use? (YYYY-MM-DD)";
          case "date": return "What date should I use? (YYYY-MM-DD)";
          case "time": return "What time should I use? (HH:MM)";
          case "start": return "What start time should I use? (HH:MM)";
          case "end": return "What end time should I use? (HH:MM)";
          case "subject": return "Which subject is this for?";
          case "activity": return "What activity should I schedule?";
          case "tab_name": return "Which note should I use?";
          default: return `Can you share the ${labelForField(fields[0])}?`;
        }
      })()
    : null;
  return {
    reason: `I need a couple details before I can run ${toolName}.`,
    question: oneFieldQuestion
      || (humanFields
        ? `I still need these details: ${humanFields}. Can you share them in one reply?`
        : `Can you clarify the details for ${toolName}?`),
    options: [],
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

// Pre-computed at module load — avoids per-request schema deep-cloning.
const ACTION_TOOLS_NULLABLE = withNullableOptionals(ACTION_TOOLS);
const CONTENT_ACTION_TOOLS_NULLABLE = withNullableOptionals(CONTENT_ACTION_TOOLS);

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
    // Exception: Gemini/Gemma only supports a single system message — merge both parts
    // into one to prevent the dynamic context from being echoed in the response.
    const staticPrompt = options?.staticSystemPrompt;
    const dynamicContext = options?.dynamicContext;
    const groqMessages = (staticPrompt && isGeminiModel(mdl))
      ? [{ role: "system", content: `${staticPrompt}\n\n${dynamicContext || ""}` }]
      : staticPrompt
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
    const effectiveModel = imageBase64 ? GEMINI_CONVERSATIONAL_BACKUP : mdl;
    const body = {
      model: effectiveModel,
      messages: groqMessages,
      max_completion_tokens: 1000,
      temperature: 1,
      top_p: 1,
    };
    // reasoning_effort is only supported on openai/gpt-oss models, not Gemini fallbacks.
    if (!isGeminiModel(effectiveModel)) {
      body.reasoning_effort = routeType === "conversational" ? "medium" : "high";
    }

    const rawTools = toolsOverride || (includeTools ? ACTION_TOOLS : null);
    // propose_action requires structured JSON tool-calling — 8B fallback models
    // can't reliably produce it and error with tool_use_failed.
    // Strip it (and any other conversational-only tools) when on FAST_MODEL.
    const safeRawTools = (mdl === FAST_MODEL && Array.isArray(rawTools))
      ? (rawTools.filter(t => t?.function?.name !== "propose_action").length > 0
          ? rawTools.filter(t => t?.function?.name !== "propose_action")
          : null)
      : rawTools;
    const effectiveTools = safeRawTools
      ? (safeRawTools === ACTION_TOOLS ? ACTION_TOOLS_NULLABLE
        : safeRawTools === CONTENT_ACTION_TOOLS ? CONTENT_ACTION_TOOLS_NULLABLE
        : withNullableOptionals(safeRawTools))
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
      if (Date.now() < GROQ_CIRCUIT.openedUntilMs) {
        throw new Error(`Groq circuit open until ${new Date(GROQ_CIRCUIT.openedUntilMs).toISOString()}`);
      }
      const remaining = remainingBudgetMs();
      if (remaining <= MIN_REMAINING_FOR_RETRY_MS) {
        throw new Error(`${isGeminiModel(mdl) ? "Gemini" : "Groq"} ${mdl} budget exhausted (${budgetMs}ms)`);
      }
      metrics.attempt_count += 1;
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        Math.max(700, Math.min(remaining - 250, 8000))
      );
      // Route to Gemini (OpenAI-compatible) or Groq based on model name.
      const usingGemini = isGeminiModel(effectiveModel);
      const providerUrl = usingGemini
        ? `${GEMINI_BASE_URL}/chat/completions`
        : "https://api.groq.com/openai/v1/chat/completions";
      const providerKey = usingGemini ? (options?.geminiApiKey || "") : apiKey;
      try {
        res = await fetch(providerUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${providerKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
          if (!usingGemini) noteSpike(503);
          throw new Error(`${usingGemini ? "Gemini" : "Groq"} ${mdl} request timed out within budget (${budgetMs}ms)`);
        }
        throw err;
      }
      clearTimeout(timeoutId);

      // Update Groq TPM/RPM state from response headers (Gemini doesn't provide these).
      if (!usingGemini && res.ok) {
        updateGroqTpm(res.headers);
        updateGroqRpm(res.headers);
      }

      if ((res.status === 429 || res.status >= 500) && i < MAX_RETRIES) {
        if (!usingGemini) noteSpike(res.status);
      }

      if (res.status === 429 && i < MAX_RETRIES) {
        const errBody = await res.text().catch(() => "");
        const retryMatch = errBody.match(/try again in ([\d.]+)s/i);
        const waitSec = retryMatch ? Math.min(parseFloat(retryMatch[1]), 8) : Math.min((2 ** i) * 0.8, 8);
        const waitMs = Math.floor(waitSec * 1000);
        if (remainingBudgetMs() <= waitMs + MIN_REMAINING_FOR_RETRY_MS) {
          throw new Error(`${usingGemini ? "Gemini" : "Groq"} ${mdl} rate limited with insufficient budget to retry`);
        }
        metrics.retry_wait_ms_total += waitMs;
        console.warn(`${usingGemini ? "Gemini" : "Groq"} 429 rate limit hit on ${mdl}, retrying in ${waitSec}s (attempt ${i + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (res.status >= 500 && i < MAX_RETRIES) {
        const waitMs = Math.min(300 * (2 ** i), 2500);
        if (remainingBudgetMs() <= waitMs + MIN_REMAINING_FOR_RETRY_MS) {
          const errText = await res.text().catch(() => "");
          throw new Error(`${usingGemini ? "Gemini" : "Groq"} ${mdl} error ${res.status}: ${errText}`);
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
        throw new Error(`${usingGemini ? "Gemini" : "Groq"} ${mdl} error 400: ${errText.slice(0, 200)}`);
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`${usingGemini ? "Gemini" : "Groq"} ${mdl} error ${res.status}: ${errText}`);
      }
      if (!usingGemini) resetCircuit();
      break;
    }

    const data = await res.json();
    return {
      ...parseLlmResponse(data),
      model_used: effectiveModel,
    };
  }

  // Proactive TPM preemption: if Groq is near its token-per-minute limit and we have
  // a Gemini key, skip Groq entirely and go straight to the Gemini backup model.
  if (groqTpmNearLimit() && options?.geminiApiKey) {
    const geminiModel = geminiBackupFor(selectedPrimary);
    console.warn(`[callGroq] Groq TPM near limit (${GROQ_TPM.remaining}/${GROQ_TPM.limit} tokens remaining) — routing directly to Gemini ${geminiModel}`);
    metrics.fallback_used = true;
    return { ...await attempt(geminiModel), ...metrics };
  }

  // Try primary model; fall back through: Gemini backup → selectedBackup → FAST_MODEL.
  // Gemini (cross-provider) is tried before the Groq FAST_MODEL to preserve quality.
  const geminiBackup = options?.geminiApiKey ? geminiBackupFor(selectedPrimary) : null;
  const canUseFastFallback = FAST_MODEL && FAST_MODEL !== selectedPrimary && FAST_MODEL !== selectedBackup;

  // Attempt a model, then try the next in the chain on empty response.
  async function tryChain(primary, chain) {
    let result = await attempt(primary);
    for (const next of chain) {
      if (!result.content && result.actions.length === 0 && next && next !== primary && remainingBudgetMs() > 900) {
        metrics.fallback_used = true;
        console.warn(`[callGroq] ${primary} returned empty — retrying with ${next}`);
        result = await attempt(next);
        primary = next;
      } else {
        break;
      }
    }
    return result;
  }

  try {
    // Build the fallback chain: [Gemini backup, groq selectedBackup, FAST_MODEL]
    // deduplicated and filtered to avoid looping back to the primary.
    const chain = [geminiBackup, selectedBackup, canUseFastFallback ? FAST_MODEL : null]
      .filter((m) => m && m !== selectedPrimary);
    const result = await tryChain(selectedPrimary, chain);
    return { ...result, ...metrics };
  } catch (primaryErr) {
    let fallbackErr = primaryErr;
    // On hard error from primary, walk the same chain.
    const fallbackChain = [geminiBackup, selectedBackup, canUseFastFallback ? FAST_MODEL : null]
      .filter((m) => m && m !== selectedPrimary);
    for (const next of fallbackChain) {
      if (!next || remainingBudgetMs() <= 900) break;
      metrics.fallback_used = true;
      console.warn(`[callGroq] ${fallbackErr.message} — retrying with ${next}`);
      try {
        const fallbackResult = await tryChain(next,
          fallbackChain.slice(fallbackChain.indexOf(next) + 1)
        );
        return { ...fallbackResult, ...metrics };
      } catch (nextErr) {
        fallbackErr = nextErr;
      }
    }
    throw fallbackErr;
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

  const effectiveTools = tools
    ? (tools === ACTION_TOOLS ? ACTION_TOOLS_NULLABLE
      : tools === CONTENT_ACTION_TOOLS ? CONTENT_ACTION_TOOLS_NULLABLE
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

    if (tc.function.name === "ask_clarification") {
      validatedToolCalls.push(toolName);
      clarifications.push({
        reason: "",
        question: parsedArgs.question || "",
        options: Array.isArray(parsedArgs.choices) ? parsedArgs.choices : [],
        multi_select: false,
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
