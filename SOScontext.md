Student Operating System, a chat-first AI companion that replaces manual forms with a sleek conversational interface where all events and tasks are created through natural language (e.g., "Help me with a science project due Thursday") and intelligently parsed into structured scheduling data with brief confirmation summaries and easy correction prompts to ensure reliability; keep the current calendar infrastructure and integrations intact but move them behind the scenes so the traditional grid becomes invisible to users, and redesign the AI to adopt a chill, supportive friend personality focused on optimizing schedules, reducing stress, protecting sleep, predicting recurring events, breaking large tasks into manageable sessions, and automatically reallocating missed or overloaded work in a calm, collaborative way — positioning SOS not as a planner, but as a student-focused operating layer that manages time intelligently and adaptively through conversation.


---

## Architecture Overview (Current)

**High-level shape**

- **Frontend**: React 18 SPA built with **Vite**, living under `src/`, deployed as a static app on **Vercel**.
- **APIs**:
  - Vercel serverless function at `/api/chat` (`api/chat.js`).
  - Supabase Edge Functions at `/functions/v1/sos-chat` and `/functions/v1/sos-voice` (`supabase/functions/sos-chat/index.ts`, `supabase/functions/sos-voice/index.ts`).
- **Backend services**:
  - **Supabase** for Postgres, auth, and edge functions.
  - **Groq** for LLM chat (tool-calling) and Whisper transcription.

The product is effectively a **monolithic SPA with a thin serverless/edge backend**. Almost all orchestration (state, UI, action execution, DB sync) happens on the client; serverless functions provide a stable AI and rate-limiting gateway plus voice transcription.

### Frontend

- **Entry points**
  - `src/main.jsx`: Bootstraps React and mounts `App` into `#root`.
  - `src/App.jsx`: Core application component; owns:
    - Global state for tasks, events, blocks, notes, and chat.
    - The conversational UI and scheduler views.
    - The “action execution” layer that takes structured actions from the backend and mutates client state + Supabase.

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

### Backend / API layer

- **Vercel function: `api/chat.js`**
  - Node-style HTTP handler deployed as `/api/chat`.
  - Responsibilities:
    - Accept chat requests from the frontend (including optional voice mode with base64 audio).
    - Build a Groq **chat completion** payload with:
      - System and user messages.
      - A tool-calling schema (`ACTION_TOOLS`) describing domain actions (add/update/delete tasks, events, blocks; notes; breaking tasks; etc.).
    - Call Groq’s `/chat/completions` endpoint.
    - Parse tool calls into `{ content, actions, clarification, clarifications }`:
      - Handles malformed tool outputs and retries/recovery.
      - Enforces **content generation rate limits** using Supabase (via service role REST).
    - For voice mode, call Groq **Whisper** on `audioBase64` and then feed the transcription into chat.

- **Supabase Edge Function: `supabase/functions/sos-chat/index.ts`**
  - Deno HTTP function deployed at `/functions/v1/sos-chat`.
  - Mirrors `api/chat.js` behavior but:
    - Uses `createClient` from `@supabase/supabase-js` for DB access.
    - Reads `user_id` from the Supabase JWT to scope queries and rate limits.
  - Returns the same JSON shape as the Vercel function so the frontend does not care which backend served the request.

- **Supabase Edge Function: `supabase/functions/sos-voice/index.ts`**
  - Dedicated Whisper proxy:
    - Accepts `multipart/form-data` audio uploads.
    - Sends audio to Groq’s Whisper API.
    - Returns transcription text.
  - Used when the frontend wants a separate “voice → text” step before sending text through chat.

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
   - Flags like “this is content generation” vs regular planning.
3. Request is sent to `EDGE_FN_URL` (either `/api/chat` on Vercel or the Supabase Edge URL).

### 2. Backend → Groq (LLM and tools)

1. Backend picks a **single LLM provider: Groq** (no multi-model routing in the current architecture).
2. It constructs a Groq chat completion call with:
   - A system prompt describing SOS’s role and rules.
   - The message list from the client.
   - The `ACTION_TOOLS` tool schema (OpenAI-style function-calling).
3. Groq returns:
   - Assistant text (`content`).
   - Zero or more **tool calls** (actions) in `tool_calls`.

### 3. Backend post-processing

- Parse tool calls into canonical internal form:
  - `[{ name, arguments, id }]` → typed actions for the frontend.
- Extract any clarifying questions vs concrete changes.
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
     - **Resolves references** (e.g., fuzzy-match “math test” to an actual event).
     - Determines whether the action:
       - Can be auto-applied, or
       - Needs explicit confirmation in the UI.
     - Applies the change to **local React state**.
     - **Syncs to Supabase** via the `supabase` client, updating the appropriate table(s).
3. Analytics events may also be written via `lib/analytics.js`.

### 5. Voice flow

- **Combined flow (through `/api/chat`)**
  - Client sends base64 audio to `api/chat`.
  - Function calls Whisper, obtains text, then runs the normal chat/action pipeline.

- **Two-step flow (through `sos-voice`)**
  - Client sends audio file to `/functions/v1/sos-voice`.
  - Receives transcription text and then calls chat as if the text were typed.


---

## The Action System (Current)

The AI does **not** emit inline `<action>` tags anymore. Instead, Groq uses **tool-calling** with a JSON schema (`ACTION_TOOLS`) shared between `api/chat.js` and `supabase/functions/sos-chat/index.ts`.

### Core action tools (high level)

> For exact schemas, see `ACTION_TOOLS` at the top of `api/chat.js` / `supabase/functions/sos-chat/index.ts`.

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
  - `update_task` (where implemented on the client)
  - `delete_task`
  - `complete_task`
  - `break_task`

- **Notes & content**
  - `add_note`
  - Content-generation style actions are usually encoded as notes or structured text the client can render.

### Resolution pipeline (conceptual)

Because the model only sees titles/dates, not DB IDs, the client:

1. For any action that targets an existing entity (event/task/block), tries:
   - Exact ID match if provided.
   - Otherwise, fuzzy title match over current in-memory state.
2. If a confident match is found:
   - Enriches the action with the specific `id` and canonical title.
3. If no match:
   - Marks the action as failed-to-resolve.
   - Surfaces a user-friendly error instead of claiming success.

This keeps the LLM prompt simpler (no raw IDs exposed) while ensuring reliable updates/deletes on the actual records.


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

1. **Schema**
   - Add a new tool entry to `ACTION_TOOLS` in:
     - `api/chat.js`
     - `supabase/functions/sos-chat/index.ts`
   - Make sure parameter names and required fields match your frontend/domain model.
2. **Backend wiring**
   - No additional backend handler is usually needed; the backend just passes tools through to Groq and returns tool calls to the client.
   - If the new tool implies new rate-limit categories or safety checks, add them in the edge/serverless functions.
3. **Client execution**
   - In `App.jsx`, extend the action execution switch/handler to:
     - Recognize the new `tool.name`.
     - Run the proper state updates and Supabase mutations.
   - Integrate with the resolution pipeline if it targets existing entities (follow the event/task patterns).
4. **Prompting**
   - Update the system prompt string (where constructed in the backend) to:
     - Describe when the new tool should be used.
     - Provide 1–2 short examples of correct usage.

### 3. Adding new content-generation features

Examples: new types of study materials, explanations, or structured views.

1. **Output format**
   - Decide whether the model should:
     - Call a dedicated tool (e.g., `create_mindmap`), or
     - Return plain text/Markdown with simple conventions.
2. **Backend**
   - If using a tool:
     - Add it to `ACTION_TOOLS` and mention it in the prompt.
   - Ensure content-generation rate limiting (`content_generations`) reflects any new high-cost flows.
3. **Frontend**
   - Add a renderer component for the new content type.
   - Extend the action execution to route that tool to the renderer and/or notes.

### 4. Changing models or providers

Currently everything routes through **Groq**. If you ever reintroduce multiple providers:

- Keep **one place** in each backend where provider/model are chosen.
- Always normalize the response shape to `{ content, actions, clarification(s) }` so the client remains provider-agnostic.
- Confirm tool-calling behavior is consistent across providers (argument encoding, naming, error shapes).


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

When implementing future features, aim to **preserve this architecture**: keep the SPA as the main orchestrator, use edge/serverless functions as a thin AI and policy layer, and let Supabase own durable storage and auth. This keeps changes localized and makes it easy to reason about data and behavior. 
