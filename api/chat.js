// Vercel serverless function — mirrors supabase/functions/sos-chat/index.ts
// Reads ANTHROPIC_API_KEY, GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from env vars

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/* ── Model constants ── */
const PRIMARY_MODEL = "openai/gpt-oss-120b";
const BACKUP_MODEL  = "llama-3.3-70b-versatile";

/* ── Tool definitions for Groq (OpenAI function-calling format) ── */
const ACTION_TOOLS = [
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
        "Add a recurring event that repeats on specific days of the week — e.g., swim practice every Mon/Wed/Fri, weekly tutoring on Thursdays.",
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
function parseFailedGeneration(failedGen) {
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_MAX_STRING_LENGTH = 500;
const LONG_TEXT_MAX_STRING_LENGTH = 5000;

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

/* ── Groq chat + function calling ── */
async function callGroq(apiKey, model, systemPrompt, messages, maxTokens, imageBase64, imageMimeType, includeTools = true, toolsOverride = null, backupModel = null) {
  // Inner attempt: builds the request for a specific model and runs it with 429 retry logic.
  async function attempt(mdl) {
    const groqMessages = [{ role: "system", content: systemPrompt }];

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

    const effectiveTools = toolsOverride || (includeTools ? ACTION_TOOLS : null);
    if (effectiveTools && effectiveTools.length > 0 && !imageBase64) {
      body.tools = effectiveTools;
      body.tool_choice = "auto";
    }

    // Retry loop: handles 429 rate limits with exponential backoff (up to 3 retries)
    const MAX_RETRIES = 3;
    let res;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
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
          throw new Error(`Groq ${mdl} request timed out after 30s`);
        }
        throw err;
      }
      clearTimeout(timeoutId);

      if (res.status === 429 && i < MAX_RETRIES) {
        const errBody = await res.text().catch(() => "");
        const retryMatch = errBody.match(/try again in ([\d.]+)s/i);
        const waitSec = retryMatch ? Math.min(parseFloat(retryMatch[1]), 30) : (2 ** i) * 2;
        console.warn(`Groq 429 rate limit hit on ${mdl}, retrying in ${waitSec}s (attempt ${i + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
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
      break;
    }

    const data = await res.json();
    return parseLlmResponse(data);
  }

  // Try primary model; fall back to backupModel on hard errors OR empty responses
  try {
    const result = await attempt(model);
    if (!result.content && result.actions.length === 0 && backupModel && backupModel !== model) {
      console.warn(`[callGroq] Primary model (${model}) returned empty response — retrying with backup ${backupModel}`);
      return await attempt(backupModel);
    }
    return result;
  } catch (primaryErr) {
    if (backupModel && backupModel !== model) {
      console.warn(`[callGroq] Primary model (${model}) failed: ${primaryErr.message} — retrying with backup ${backupModel}`);
      return await attempt(backupModel);
    }
    throw primaryErr;
  }
}

function parseLlmResponse(data) {
  const message = data.choices?.[0]?.message;
  const textContent = message?.content || "";
  const clarifications = [];
  const validationWarnings = [];
  const actions = (message?.tool_calls || []).flatMap((tc) => {
    let parsedArgs;
    try {
      const raw = tc.function.arguments;
      parsedArgs = (typeof raw === "object" && raw !== null) ? raw : JSON.parse(raw || "{}");
    } catch (_) {
      parsedArgs = {};
    }

    if (tc.function.name === "ask_clarification") {
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

    return [{
      type: tc.function.name,
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
  };
}

/* ── Extract user ID from JWT ── */
function extractUserId(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString("utf8")
    );
    return payload.sub || null;
  } catch {
    return null;
  }
}

/* ── Rate limiting for content generation (via Supabase REST API) ── */
async function checkContentRateLimit(userId, supabaseUrl, serviceKey) {
  const now = new Date();
  const estNow = new Date(now.getTime() + -5 * 60 * 60 * 1000);
  const todayEST =
    estNow.getFullYear() +
    "-" +
    String(estNow.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(estNow.getDate()).padStart(2, "0");

  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
  };

  const getRes = await fetch(
    `${supabaseUrl}/rest/v1/content_generations?user_id=eq.${userId}&date=eq.${todayEST}&select=count`,
    { headers }
  );
  const getData = await getRes.json();
  const used = getData?.[0]?.count ?? 0;
  const DAILY_LIMIT = 5;

  if (used >= DAILY_LIMIT) {
    return { allowed: false, used };
  }

  await fetch(`${supabaseUrl}/rest/v1/content_generations`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, date: todayEST, count: used + 1 }),
  });

  return { allowed: true, used: used + 1 };
}

/* ── Main handler ── */
export default async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end("ok");
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const SUPABASE_URL =
    process.env.SUPABASE_URL || "https://evqylqgkzlbbrvogxsjn.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const body = req.body;

    // ── Voice transcription path (Groq Whisper) ──
    if (body.mode === "voice") {
      if (!GROQ_API_KEY) {
        return res.status(500).json({ error: "GROQ_API_KEY not configured" });
      }
      const { audioBase64, audioMimeType } = body;
      if (!audioBase64) {
        return res.status(400).json({ error: "No audio data provided" });
      }

      const effectiveMime = audioMimeType || "audio/webm";
      const audioExt = effectiveMime.includes("mp4") || effectiveMime.includes("aac")
        ? "m4a"
        : effectiveMime.includes("ogg")
        ? "ogg"
        : effectiveMime.includes("mp3")
        ? "mp3"
        : "webm";
      const audioBuffer = Buffer.from(audioBase64, "base64");
      const audioBlob = new Blob([audioBuffer], { type: effectiveMime });
      const audioFile = new File([audioBlob], `voice.${audioExt}`, { type: effectiveMime });

      const groqForm = new FormData();
      groqForm.append("file", audioFile, `voice.${audioExt}`);
      groqForm.append("model", "whisper-large-v3-turbo");
      groqForm.append("response_format", "json");
      groqForm.append("language", "en");

      const groqRes = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
          body: groqForm,
        }
      );

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        console.error("Groq Whisper error:", groqRes.status, errText);
        return res.status(groqRes.status).json({ error: "Transcription failed", details: errText });
      }

      const whisperResult = await groqRes.json();
      return res.status(200).json({ text: whisperResult.text || "" });
    }

    // ── Chat completion path (Groq) ──
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: "GROQ_API_KEY not configured" });
    }

    const {
      systemPrompt,
      messages,
      maxTokens = 1024,
      isContentGen,
      imageBase64,
      imageMimeType,
      workspaceContext,
    } = body;

    // Rate limiting for content generation
    if (isContentGen && SUPABASE_SERVICE_ROLE_KEY) {
      const userId = extractUserId(req.headers.authorization);
      if (userId) {
        const { allowed, used } = await checkContentRateLimit(
          userId,
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY
        );
        if (!allowed) {
          return res.status(429).json({ error: "Rate limited", rateLimited: true, used });
        }
      }
    }

    const normalizedWorkspaceContext = typeof workspaceContext === "string"
      ? workspaceContext.trim().toLowerCase()
      : "chat";
    const contextPromptSuffix = `\n\nWORKSPACE_CONTEXT: ${normalizedWorkspaceContext}. Prioritize this context when relevant (schedule => planning/time/tasks, notes => note/doc references, chat/none => general).`;
    const effectiveSystemPrompt = `${systemPrompt || ""}${contextPromptSuffix}`;

    // Always use full ACTION_TOOLS so the AI can call any tool based on actual message intent,
    // not regex-gated detection. openai/gpt-oss-120b handles chat + tool calling in one pass.
    const result = await callGroq(
      GROQ_API_KEY,
      PRIMARY_MODEL,
      effectiveSystemPrompt,
      messages,
      maxTokens,
      imageBase64,
      imageMimeType,
      true,         // includeTools — always on; model decides when to call tools
      null,         // toolsOverride — use full ACTION_TOOLS
      BACKUP_MODEL  // fallback if primary fails or returns empty
    );

    return res.status(200).json(result);
  } catch (err) {
    console.error("api/chat error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
