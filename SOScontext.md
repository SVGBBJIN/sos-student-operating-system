Student Operating System, a chat-first AI companion that replaces manual forms with a sleek conversational interface where all events and tasks are created through natural language (e.g., "Help me with a science project due Thursday") and intelligently parsed into structured scheduling data with brief confirmation summaries and easy correction prompts to ensure reliability; keep the current calendar infrastructure and integrations intact but move them behind the scenes so the traditional grid becomes invisible to users, and redesign the AI to adopt a chill, supportive friend personality focused on optimizing schedules, reducing stress, protecting sleep, predicting recurring events, breaking large tasks into manageable sessions, and automatically reallocating missed or overloaded work in a calm, collaborative way — positioning SOS not as a planner, but as a student-focused operating layer that manages time intelligently and adaptively through conversation.


---

## Architecture Overview (Current)

**High-level shape**

- **Frontend**: React 18 SPA built with **Vite**, living under `src/`, deployed as a static app on **Vercel**.
- **APIs**:
  - Vercel serverless function at `/api/chat` (`api/chat.js`).
  - Supabase Edge Functions at `/functions/v1/sos-chat` and `/functions/v1/sos-voice` (`supabase/functions/sos-chat/index.ts`, `supabase/functions/sos-voice/index.ts`).
- **Shared module**: `shared/ai/chat-core.js` — shared chat orchestration logic used by both backends (Node + Deno compatible).
- **Backend services**:
  - **Supabase** for Postgres, auth, and edge functions.
  - **Groq** for LLM chat (tool-calling) and Whisper transcription.

The product is effectively a **monolithic SPA with a thin serverless/edge backend**. Almost all orchestration (state, UI, action execution, DB sync) happens on the client; serverless functions provide a stable AI and rate-limiting gateway plus voice transcription. A **server-side fallback loop** in `api/chat.js` handles unresolved tool actions when client-side resolution fails, surfacing targeted clarification questions back to the user.

### Frontend

- **Entry points**
  - `src/main.jsx`: Bootstraps React and mounts `App` into `#root`.
  - `src/App.jsx`: Core application component; owns:
    - Global state for tasks, events, blocks, notes, and chat.
    - The conversational UI and scheduler views.
    - The "action execution" layer that takes structured actions from the backend and mutates client state + Supabase.

- **Libraries / helpers**
  - `src/lib/supabase.js`
    - Creates a **Supabase client** with the public anon key.
    - Exposes `EDGE_FN_URL` that chooses between:
      - `"/api/chat"` when running on a Vercel host (Vercel serverless backend).
      - Supabase Edge Function URL (`<SUPABASE_URL>/functions/v1/sos-chat`) otherwise.
  - `src/lib/analytics.js`
    - Records events into a Supabase `analytics_events` table.
  - `src/components/ErrorBoundary.jsx`
    - Error boundary for catching and rendering UI errors.
  - `src/lib/icons.jsx`, `src/styles/index.css`
    - Icons and global styling.

### Shared module

- **`shared/ai/chat-core.js`** — single source of truth for chat orchestration logic, shared between the Vercel (Node) and Supabase Edge (Deno) backends:
  - `callGroq(apiKey, model, systemPrompt, messages, maxTokens, ...)` — calls Groq with retries, a circuit breaker, budget-aware routing, routing metadata tagging, and automatic fallback to `BACKUP_MODEL` on failures.
  - `parseLlmResponse(data)` — parses Groq's response, runs per-tool validators via `validateToolArguments`, and converts validation failures into clarification prompts instead of passing invalid actions through.
  - `ACTION_TOOLS` — complete JSON schema for all domain actions (single authoritative copy; imported by both backends).
  - `CONTENT_ACTION_TOOLS` — filtered subset of `ACTION_TOOLS` used when `isContentGen` is true (content types + `ask_clarification`).
  - `CONTENT_ACTION_TYPES` — Set of content generation action names.
  - `CORE_VERSION` / `CORE_CHECKSUM` — version identifiers for telemetry.
  - Exported model constants:
    - `PRIMARY_MODEL`: `"openai/gpt-oss-120b"`
    - `BACKUP_MODEL`: `"llama-3.3-70b-versatile"`
    - `FAST_MODEL`: `"llama-3.1-8b-instant"`

### Backend / API layer

- **Vercel function: `api/chat.js`**
  - Node-style HTTP handler deployed as `/api/chat`.
  - Imports `callGroq`, `CONTENT_ACTION_TOOLS`, `PRIMARY_MODEL`, `BACKUP_MODEL` from `shared/ai/chat-core.js`.
  - Responsibilities:
    - Accept chat requests from the frontend (including optional voice mode with base64 audio).
    - Build a Groq **chat completion** payload with system prompt (policy + budgeted context) and message history.
    - Call Groq via `callGroq()` with the appropriate model and tool schema.
    - Parse and validate tool calls via `parseLlmResponse()`.
    - Enforce **content generation rate limits** using Supabase (via service role REST).
    - Handle `mode: "tool_fallback"` requests: build a failure report via `buildToolFallbackPrompt()` and call Groq to produce clarification questions for the user.
    - For voice mode, call Groq **Whisper** on `audioBase64` and then feed the transcription into the normal pipeline.

- **Supabase Edge Function: `supabase/functions/sos-chat/index.ts`**
  - Deno HTTP function deployed at `/functions/v1/sos-chat`.
  - Imports from `shared/ai/chat-core.js` (Deno-compatible import path).
  - Mirrors `api/chat.js` behavior but:
    - Uses `createClient` from `@supabase/supabase-js` for DB access.
    - Reads `user_id` from the Supabase JWT to scope queries and rate limits.
  - Returns the same JSON shape as the Vercel function so the frontend does not care which backend served the request.

- **Supabase Edge Function: `supabase/functions/sos-voice/index.ts`**
  - Dedicated Whisper proxy:
    - Accepts `multipart/form-data` audio uploads.
    - Sends audio to Groq's Whisper API.
    - Returns transcription text.
  - Used when the frontend wants a separate "voice → text" step before sending text through chat.

### Data / storage

- **Supabase project**: `evqylqgkzlbbrvogxsjn` (East US)
  **URL**: `https://evqylqgkzlbbrvogxsjn.supabase.co`

- **Core tables (RLS on `auth.uid() = user_id`)**
  - `profiles`
  - `tasks`
  - `events`
  - `recurring_blocks`
  - `date_blocks`
  - `notes`
  - `chat_messages`
  - `analytics_events`
  - `content_generations` (for content-gen rate limits)

- **Data shape conversions (frontend ↔ DB)**
  - `dueDate` ↔ `due_date`
  - `estTime` ↔ `est_time`
  - `focusMinutes` ↔ `focus_minutes`
  - `completedAt` ↔ `completed_at`
  - `date` (event) ↔ `event_date`
  - `type` (event) ↔ `event_type`
  - Blocks are split:
    - Recurring-week template → `recurring_blocks`.
    - Per-date overrides/instances → `date_blocks`.


---

## Data & Control Flow

### 1. Frontend → backend request

1. User interacts with the chat box or voice UI in `App.jsx`.
2. The app builds a payload that includes:
   - The current conversation history.
   - Summarized state (tasks, events, blocks, notes, etc.) as needed.
   - Flags like `isContentGen` (content generation vs. regular planning).
3. Request is sent to `EDGE_FN_URL` (either `/api/chat` on Vercel or the Supabase Edge URL).

### 2. Backend → Groq (LLM and tools)

1. Backend uses **Groq as the sole LLM provider** with **multi-model routing** via `callGroq()`:
   - **`PRIMARY_MODEL`** (`openai/gpt-oss-120b`) is used by default.
   - Falls back to **`BACKUP_MODEL`** (`llama-3.3-70b-versatile`) on primary failures.
   - **`FAST_MODEL`** (`llama-3.1-8b-instant`) is available for lightweight/conversational turns.
   - A **circuit breaker** backs off on repeated API failures.
   - Each request is tagged with routing metadata (`conversational`, `tool_heavy`, `content_gen`) for intelligent model selection.
2. It constructs a Groq chat completion call with:
   - A **system prompt** split into a policy section (static behavior rules) and a budgeted context section (dynamic summaries of current tasks/events/blocks). Token budgets are tracked and telemetry is emitted per request.
   - The message list from the client.
   - The `ACTION_TOOLS` schema (or `CONTENT_ACTION_TOOLS` when `isContentGen` is true).
3. Groq returns:
   - Assistant text (`content`).
   - Zero or more **tool calls** (actions) in `tool_calls`.

### 3. Backend post-processing

- **Parse and validate tool calls** via `parseLlmResponse()`:
  - Converts raw Groq tool calls into canonical internal form: `[{ name, arguments, id }]`.
  - Runs **per-tool validators** (`validateToolArguments`) on every action:
    - Checks required fields, types, string lengths, date/time formats, and enum values.
    - If validation fails, the action is replaced with a **clarification prompt** rather than passed to the client silently.
  - Recovers malformed tool calls via `parseFailedGeneration` (regex fallback for `tool_use_failed` errors).
- Extract any clarifying questions vs. concrete changes.
- Enforce **content generation quotas**:
  - Use `content_generations` table to check per-user daily counts.
  - Reject or downgrade requests when limits are hit.
- Normalize into a response:
  - `content`: string for chat bubbles.
  - `actions`: structured list of domain actions.
  - `clarification` / `clarifications`: messages prompting the user to confirm or supply missing information.

### 4. Frontend action execution + persistence

1. The client receives `{ content, actions, clarification(s) }`.
2. It:
   - Renders `content` into the chat timeline.
   - For each action:
     - **Resolves references** (e.g., fuzzy-match "math test" to an actual event).
     - Determines whether the action:
       - Can be auto-applied, or
       - Needs explicit confirmation in the UI.
     - Applies the change to **local React state**.
     - **Syncs to Supabase** via the `supabase` client, updating the appropriate table(s).
3. If client-side resolution fails (no confident match), the client can re-submit with `mode: "tool_fallback"` and a `tool_failures` array. The server calls `buildToolFallbackPrompt()` and runs Groq to produce targeted clarification questions (e.g., "Which 'math test' did you mean?"). The server does not execute actions directly — orchestration still lives on the client.
4. Analytics events may also be written via `lib/analytics.js`.

### 5. Voice flow

- **Combined flow (through `/api/chat`)**
  - Client sends base64 audio to `api/chat`.
  - Function calls Whisper, obtains text, then runs the normal chat/action pipeline.

- **Two-step flow (through `sos-voice`)**
  - Client sends audio file to `/functions/v1/sos-voice`.
  - Receives transcription text and then calls chat as if the text were typed.


---

## The Action System (Current)

The AI uses **tool-calling** with a JSON schema (`ACTION_TOOLS`) defined in `shared/ai/chat-core.js` and imported by both backends. The schema is the single authoritative source; do not add tool definitions in `api/chat.js` or `sos-chat/index.ts` directly.

### Core action tools (high level)

> For exact schemas, see `ACTION_TOOLS` in `shared/ai/chat-core.js`.

- **Scheduling & calendar**
  - `add_event`
  - `update_event`
  - `delete_event`
  - `add_block`
  - `delete_block`
  - `convert_event_to_block`
  - `convert_block_to_event`

- **Tasks**
  - `add_task`
  - `update_task`
  - `delete_task`
  - `complete_task`
  - `break_task`

- **Notes**
  - `add_note`
  - `edit_note`
  - `delete_note`

- **Content generation** (used when `isContentGen` is true; enforced with typed response schemas)
  - `create_flashcards`
  - `create_quiz`
  - `create_outline`
  - `create_summary`
  - `create_study_plan`
  - `create_project_breakdown`
  - `make_plan`
  - `ask_clarification` (always available; also included in `CONTENT_ACTION_TOOLS`)

  When `isContentGen` is true, the backend constrains available tools to `CONTENT_ACTION_TOOLS` only. The server enforces structured output shapes for all content generation responses; there are no client-side parsing fallbacks.

### Resolution pipeline (conceptual)

Because the model only sees titles/dates, not DB IDs, the client:

1. For any action that targets an existing entity (event/task/block), tries:
   - Exact ID match if provided.
   - Otherwise, fuzzy title match over current in-memory state.
2. If a confident match is found:
   - Enriches the action with the specific `id` and canonical title.
3. If no match:
   - Marks the action as failed-to-resolve.
   - Optionally triggers the server-side fallback loop (see §4 above) for clarification.

This keeps the LLM prompt simpler (no raw IDs exposed) while ensuring reliable updates/deletes on the actual records.


---

## Evaluation & Observability

- **`eval/fixtures/conversations.json`** — test conversation fixtures used by the harness.
- **`eval/fixtures/sample-runs.jsonl`** — model run results in JSONL format.
- **`scripts/eval-harness.mjs`** — metrics computation script; run with `npm run eval:harness`.
  - Computes per-model-revision statistics:
    - Tool call **precision / recall** (which actions the model correctly predicts).
    - **Clarification appropriateness** (whether the model correctly decides to ask vs. act).
    - **Hallucinated field rate** (invalid or unexpected fields generated).
    - **Latency percentiles** (p50, p95) by model revision.
  - Outputs a JSON report with aggregate and per-revision stats.
- **Request telemetry** is emitted from the backend on every chat request: prompt version (`CORE_VERSION`), context sizes, token budgets, model used, and latency. Useful for tracking prompt evolution and model performance over time.


---

## How to Implement New Features Safely

This section is optimized for **future development**. Use it as a checklist when you add capabilities.

### 1. Adding a new domain entity or field

- **Design the data model**
  - Decide whether it is:
    - A new table (e.g., `study_sessions`), or
    - A field on an existing table (e.g., `difficulty` on `tasks`).
  - Add or migrate schema in Supabase (SQL migrations or UI).

- **Update the frontend model**
  - Extend React state in `App.jsx` with the new entity/field.
  - Add load logic into the initial **load-from-Supabase** path.
  - Update Supabase read/write functions to:
    - Map between JS naming and DB naming (`camelCase` ↔ `snake_case`).

- **UI surfaces**
  - Decide:
    - Where the data is visible (scheduler, task list, notes, separate panel).
    - How the user can edit it manually (forms/controls).

### 2. Adding a new AI action tool

Use this when the model should be able to directly manipulate the new entity or field.

1. **Schema** — edit `shared/ai/chat-core.js` only (not both backends separately):
   - Add a new entry to `ACTION_TOOLS` with the correct parameter names and required fields.
   - Add a per-tool validator in `validateToolArguments` for the new tool name.
2. **Backend wiring**
   - No additional backend handler is usually needed; the backend passes tools through to Groq and returns validated tool calls to the client.
   - If the new tool implies new rate-limit categories or safety checks, add them in `api/chat.js` and `sos-chat/index.ts`.
3. **Client execution**
   - In `App.jsx`, extend the action execution switch/handler to:
     - Recognize the new `tool.name`.
     - Run the proper state updates and Supabase mutations.
   - Integrate with the resolution pipeline if it targets existing entities (follow the event/task patterns).
4. **Prompting**
   - Update the system prompt (policy section in the backend) to:
     - Describe when the new tool should be used.
     - Provide 1–2 short examples of correct usage.

### 3. Adding new content-generation features

Examples: new types of study materials, explanations, or structured views.

1. **Output format**
   - Decide whether the model should call a dedicated tool (e.g., `create_mindmap`).
   - All content-generation tools must have enforced typed response schemas — do not rely on free-form text parsing.
2. **Backend**
   - Add the tool to `ACTION_TOOLS` and `CONTENT_ACTION_TYPES` in `shared/ai/chat-core.js`.
   - Ensure content-generation rate limiting (`content_generations`) reflects any new high-cost flows.
3. **Frontend**
   - Add a renderer component for the new content type.
   - Extend the action execution to route that tool to the renderer and/or notes.

### 4. Changing models or providers

Currently everything routes through **Groq** via `callGroq()` in `shared/ai/chat-core.js`. If you ever reintroduce multiple providers:

- Keep **one place** (`shared/ai/chat-core.js`) where provider/model selection logic lives.
- Always normalize the response shape to `{ content, actions, clarification(s) }` so the client remains provider-agnostic.
- Confirm tool-calling behavior is consistent across providers (argument encoding, naming, error shapes).
- Update `CORE_VERSION` to reflect the routing change so telemetry can track the transition.


---

## Operational Notes & Deployment

- **Vercel**
  - Builds the Vite app using `npm run build`.
  - Serves:
    - Static frontend (`dist/`).
    - `/api/chat` serverless function (`api/chat.js`).
  - `vercel.json` adds CORS headers on `/api/*` so other origins or tools can call the API.

- **Supabase**
  - Edge functions:
    - `sos-chat`: main chat/action gateway.
    - `sos-voice`: Whisper transcription gateway.
  - Required secrets (set via `supabase secrets set` or project dashboard):
    - `SUPABASE_URL`
    - `SUPABASE_ANON_KEY` (for clients; already baked into `lib/supabase.js`).
    - `SUPABASE_SERVICE_ROLE_KEY` (used server-side only where needed).
    - `GROQ_API_KEY` (for chat + Whisper).

- **Rate limiting**
  - Content generation (study materials, long-form outputs) is capped per user per day.
  - Implementation lives in the backend functions and uses `content_generations` in Supabase.

When implementing future features, aim to **preserve this architecture**: keep the SPA as the main orchestrator, use edge/serverless functions as a thin AI and policy layer, let Supabase own durable storage and auth, and keep `shared/ai/chat-core.js` as the single source of truth for AI orchestration logic. This keeps changes localized and makes it easy to reason about data and behavior.
