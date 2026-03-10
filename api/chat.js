// Vercel serverless function — mirrors supabase/functions/sos-chat/index.ts
// Reads ANTHROPIC_API_KEY, GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from env vars

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/* ── Tool definitions for Claude — one per supported action ── */
const ACTION_TOOLS = [
  {
    name: "add_event",
    description:
      "Add an event to the student's calendar. Use for tests, exams, quizzes, practices, games, meets, appointments, deadlines, or any scheduled activity with a specific date.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
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
  {
    name: "add_task",
    description:
      "Add a homework assignment or task to the student's to-do list.",
    input_schema: {
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
  {
    name: "delete_event",
    description:
      "Delete or cancel an event from the student's calendar. Use when the student says an event is cancelled, not happening, or asks to remove it.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the event to delete" },
      },
      required: ["title"],
    },
  },
  {
    name: "delete_task",
    description:
      "Delete a task from the student's task list. Use when the student says to remove, drop, or forget a task.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the task to delete" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_event",
    description:
      "Update an existing event — change its title, date, type, or subject. Use for reschedule/move/rename requests.",
    input_schema: {
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
  {
    name: "complete_task",
    description:
      "Mark a task as done/completed. Use when the student says they finished, submitted, or completed something.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the task to mark complete" },
      },
      required: ["title"],
    },
  },
  {
    name: "add_block",
    description:
      "Add a time block to the student's daily schedule (study session, practice slot, free time, etc.).",
    input_schema: {
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
  {
    name: "delete_block",
    description: "Remove a time block from the student's schedule.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date of the block (YYYY-MM-DD)" },
        start: { type: "string", description: "Start time of the block (HH:MM)" },
        end: { type: "string", description: "End time of the block (HH:MM, optional)" },
      },
      required: ["date"],
    },
  },
  {
    name: "add_note",
    description: "Save a note or important information to the student's notes.",
    input_schema: {
      type: "object",
      properties: {
        tab_name: { type: "string", description: "Name for the note tab" },
        content: { type: "string", description: "Content to save" },
      },
      required: ["tab_name", "content"],
    },
  },
  {
    name: "break_task",
    description:
      "Break a large task into smaller, manageable subtasks spread across multiple days.",
    input_schema: {
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
  {
    name: "add_recurring_event",
    description:
      "Add a recurring event that repeats on specific days of the week — e.g., swim practice every Mon/Wed/Fri, weekly tutoring on Thursdays.",
    input_schema: {
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
  {
    name: "clear_all",
    description:
      "Wipe ALL tasks, events, and blocks. Only use when the student explicitly asks to clear or reset everything.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

/* ── Anthropic Claude chat + tool use ── */
async function callClaude(apiKey, model, systemPrompt, messages, maxTokens, imageBase64, imageMimeType, includeTools = true) {
  // Convert messages to Anthropic format
  let anthropicMessages = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : "",
  }));

  // Vision: replace messages with single image+text block
  if (imageBase64) {
    const effectiveMime = imageMimeType || "image/jpeg";
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const textContent =
      lastUser && typeof lastUser.content === "string" && lastUser.content.trim()
        ? lastUser.content.trim()
        : "What do you see in this image?";
    anthropicMessages = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: effectiveMime, data: imageBase64 },
          },
          { type: "text", text: textContent },
        ],
      },
    ];
  }

  // Filter out messages with empty content
  anthropicMessages = anthropicMessages.filter((m) => {
    if (typeof m.content === "string") return m.content.trim().length > 0;
    if (Array.isArray(m.content)) return m.content.length > 0;
    return false;
  });

  // Ensure messages alternate correctly (Anthropic requirement)
  const deduped = [];
  for (const m of anthropicMessages) {
    if (deduped.length > 0 && deduped[deduped.length - 1].role === m.role) {
      const prev = deduped[deduped.length - 1];
      if (typeof prev.content === "string" && typeof m.content === "string") {
        prev.content = prev.content + "\n" + m.content;
      }
    } else {
      deduped.push({ ...m });
    }
  }
  // First message must be user
  while (deduped.length > 0 && deduped[0].role !== "user") {
    deduped.shift();
  }

  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: deduped,
  };

  if (includeTools && !imageBase64) {
    body.tools = ACTION_TOOLS;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error(`Claude ${model} request timed out after 30s`);
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude ${model} error ${res.status}: ${errText}`);
  }

  const data = await res.json();

  let textContent = "";
  const actions = [];

  for (const block of data.content || []) {
    if (block.type === "text") {
      textContent += block.text;
    } else if (block.type === "tool_use") {
      actions.push({ type: block.name, ...block.input });
    }
  }

  return { content: textContent.trim(), actions };
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

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
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

    // ── Chat completion path (Claude) ──
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    }

    const {
      systemPrompt,
      messages,
      maxTokens = 1024,
      isContentGen,
      imageBase64,
      imageMimeType,
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

    // Model selection: Sonnet for content gen, Haiku for everything else
    const model = isContentGen ? "claude-sonnet-4-6" : "claude-haiku-4-5";
    const includeTools = !isContentGen;

    const result = await callClaude(
      ANTHROPIC_API_KEY,
      model,
      systemPrompt,
      messages,
      maxTokens,
      imageBase64,
      imageMimeType,
      includeTools
    );

    return res.status(200).json(result);
  } catch (err) {
    console.error("api/chat error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
