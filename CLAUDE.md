# CLAUDE.md — SOS Student Operating System

Chat-first AI student planner and study assistant. Students type (or speak) natural language; the AI routes intent to structured tools; the client executes those tools against Supabase. Core UX premise: students never open a form—they describe what they need and the system handles it.

**Mission**: Reduce academic workload friction (tasks, events, calendar blocks) and surface personalized study materials at the right time.

For exhaustive feature and API documentation, see **`SOS_PROJECT_CONTEXT.md`**.

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # Production build (required to pass before pushing)
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit (shared/, api/, supabase/functions/)
npm run eval:harness  # Score cached sample-runs.jsonl against fixtures
npm run eval:live     # Live Gemini calls, regenerate sample-runs.jsonl (GEMINI_API_KEY required)
npm run eval:shadow   # Diff Flash vs Pro tier predictions
npm run eval:cost     # Cost-per-1k-requests projection
npm run eval:planning # Planning pipeline regression eval
```

**Pre-push requirement**: `npm run build` and `npm run typecheck` must both pass.

## Architecture Overview

```
src/App.jsx                       — Single ~7800-line React component: all state, data fetching, action execution
src/lib/streamChat.js             — SSE consumer for the chat endpoint

api/                              — Vercel Node.js serverless
  chat.ts                         — Chat transport adapter (SSE or JSON)
  embed.ts                        — Batch embeddings endpoint
  lms-*.ts                        — LMS integration endpoints (courses, oauth, events, sync)

supabase/functions/               — Deno Edge Functions (mirrors of api/* endpoints)
  sos-chat/                       — Chat endpoint
  sos-voice/                      — Groq Whisper transcription
  embed-batch/                    — Server-side embedding upserter
  sync-submissions/               — Cron: LMS submission reconciliation
  sos-lms-event/                  — LMS webhook receiver

shared/ai/                        — Isomorphic AI service layer (runs in both Node and Deno)
  router.ts                       — ONLY file with model strings; tier routing (embed/flash/pro)
  chat-handler.ts                 — Transport-agnostic chat orchestrator (mode dispatch)
  chat-core.ts                    — callModel(): single LLM inference entry point
  voice.ts                        — Groq Whisper transcription helper
  resilience.ts                   — Retry classification + circuit breaker
  telemetry.ts                    — Token counter, cost estimator, request logging
  providers/{types,gemini,groq,index}.ts — LLM provider abstraction
  schemas/                        — All action schemas (Zod)
    {actions,studio,study_pack,intent_plan,plan,library,proofread,lms}.ts
  pipelines/
    plan.ts                       — unified 3-pass plan pipeline (explicit request / goal / brain-dump → one make_plan action)
    proofread.ts                  — Writing feedback pipeline
  context/
    enrich.ts                     — Dynamic context enrichment (behavioral + RAG + study signals)
    ranker.ts                     — Task ranking helpers
  signals/
    behavioral.ts                 — Behavioral signals (completion rate, postpone rate, time histogram)
  rag/
    retrieve.ts                   — pgvector retrieval (match_memories RPC)
    embeddings.ts                 — Embedding utilities + coalescing
  lms/                            — LMS integration helpers

shared/scheduling/priority.ts     — Priority engine (pure, no I/O, 0–1 scores)
shared/rate-limit.ts              — Content-gen + RPM rate limiting
shared/{env,auth,sse}.ts          — Cross-runtime helpers

supabase/migrations/              — DDL in chronological order
extension/                        — Browser extension (LMS submission tracking)
```

**Dual deployment contract**: `api/chat.ts` (Vercel) and `supabase/functions/sos-chat` are thin transport adapters that both call `handleChatRequest()` from `shared/ai/chat-handler.ts`. All AI logic lives in the shared layer. Only Web APIs in `shared/` — no Node-only APIs (`Buffer`, `require`, etc.) since Deno consumes the same files.

## AI Architecture

### LLM Routing (router.ts)
**Single source of truth for model strings.** Maps intent → tier → provider → model.

| Tier | Primary (Groq) | Fallback (Gemini) | Used for |
|------|---------------|-------------------|----------|
| `embed` | — | `gemini-embedding-002` | RAG, memory, semantic search |
| `flash` | `openai/gpt-oss-20b` | `gemini-2.5-flash` | Chat, routing, classification, summarization |
| `pro` | `openai/gpt-oss-120b` | `gemini-2.5-pro` | Studio, planning, deep reasoning |

**Special cases:**
- **Vision**: Image attachments → `meta-llama/llama-4-scout-17b-16e-instruct` (Groq), fallback: `gemini-2.5-flash`
- **Voice**: `whisper-large-v3-turbo` (Groq) via `shared/ai/voice.ts`, bypasses `callModel()`
- **Emergency rollback**: `AI_PROVIDER_OVERRIDE=gemini` forces all intents to Gemini

### Chat Handler (chat-handler.ts)
Transport-agnostic orchestrator. Mode dispatch:

| Mode | Pipeline | Output |
|------|----------|--------|
| `chat` (default) | Action routing + RAG + behavioral context | SSE or JSON |
| `plan` | 3-pass unified plan pipeline (Pro + thinking 4096) — classifies the input as an explicit request / goal / brain-dump internally and fills the matching bucket(s) of one `make_plan` action | `make_plan` action, or an array of tentative actions when the input was brain-dump-shaped |
| `studio` | Content generation (forced single tool call) | Flashcards/quiz/outline/summary |
| `study_pack` | Bundled exam prep artifacts | Summary + concepts + cards + quiz |
| `proofread` | Writing feedback pipeline | Structured feedback |
| `briefing` | Daily rollup | Events + tasks + prep gaps |
| `voice` | Groq Whisper transcription | `{ text: string }` |

### SSE Streaming Frames
- `delta` — text chunk
- `tool_call` — structured action invocation
- `usage` — token counts
- `progress` — pipeline phase (`{phase, label, step, totalSteps, draft?}`)
- `done` — final result
- `error` — error details

The `progress` frame enables live steppers + early preview (~15s) before final result ships. The plan pipeline emits progress events.

### 3-Pass Pipelines
Pattern: graceful degradation if critique/refine fail or timeout.

**Plan** (`shared/ai/pipelines/plan.ts`) — replaces the former planning / intent_plan / brain_dump pipelines, which were the same draft→critique→refine shape over one `make_plan` tool call and differed only in which buckets the model filled:
1. Draft (22s cap) — Pro + `thinkingBudget: 4096`. The draft prompt first classifies the input, then fills only the matching bucket(s) of `make_plan`:
   - **explicit request** ("make me a plan for...") → `steps[]` (each `kind: 'block'` or `'deadline'`)
   - **goal** ("survive finals week") → `recurring_blocks[]` + `milestone_tasks[]` + `review_cadence`
   - **brain-dump** (messy transcript/text dump) → `batch_actions[]`, each item carrying `confidence`/`status`/`commitment` — `confidence >= 0.85` eligible for auto-apply, `confidence < 0.7` routes to review rail, `0.7–0.85` shown for confirmation
2. Critique (10s cap) — gap/realism/calibration analysis, tailored to whichever bucket was filled
3. Refine (22s cap) — final plan, same bucket(s) as the draft
- Total budget: 50s (within Vercel 60s limit)
- Progress phases: `analyzing → drafting → reviewing → finalizing`
- Client dispatch (`src/App.jsx`): a populated `batch_actions[]` routes straight to the action review rail (bypassing the propose-mode card); `recurring_blocks`/`milestone_tasks` renders `IntentPlanCard` (batch-creates blocks/tasks + persists a `study_plans` row on "Apply"); `steps[]` renders `PlanCard` in propose mode.

**Proofread** (`shared/ai/pipelines/proofread.ts`):
- Classify content type → route to specialist (Flash for quick, Pro for deep)
- Cap: 2 rounds per 2h; terminal round triggers self-read instead of verdict

### callModel() Entry Point (chat-core.ts)
Single LLM inference function. Takes `{intent, messages, tools?, onChunk?, ...}`:
1. Routes via `router.ts` → model + provider + fallback
2. Dispatches to provider (Groq or Gemini)
3. Applies retry/circuit breaker from `resilience.ts`
4. Validates tool outputs against Zod schemas
5. Yields chunks through `onChunk` when streaming

## Action Tools

**Zod schemas are the single source of truth.** Each schema generates tool definition + JSON Schema + runtime validator.

### Scheduling & Calendar
- `add_event`, `update_event`, `delete_event` — event CRUD
- `add_block`, `update_block`, `delete_block` — time blocks (school, swim, sleep, etc.)
- `add_recurring_event` — repeating events (M–Su, date range)
- `convert_event_to_block`, `convert_block_to_event` — type conversion
- `read_calendar` — date range queries
- `view_schedule` — quick view

### Tasks
- `add_task`, `update_task`, `delete_task`, `complete_task`, `postpone_task` — task CRUD
- `break_task` — decompose into subtasks
- `prioritize_tasks` — rank by computed score (1–10 results)
- `bulk_complete` — batch complete
- `read_tasks` — optional filters

### Notes & Knowledge Graph
- `add_note`, `edit_note`, `delete_note`, `rename_note` — note CRUD
- `move_note` — note → folder
- `create_folder` — create folder
- `read_notes`, `read_project` — lookups

### Timers
- `set_timer` — label, duration_seconds OR fire_at OR preset (pomodoro/short_break/long_break)
- `cancel_timer` — timer_id or label

### Content Generation (Studio)
| Action | Output | Limits |
|--------|--------|--------|
| `create_flashcards` | q/a cards | 1–40 |
| `create_quiz` | questions + choices + explanation | 1–30 |
| `create_outline` | sections + points | 1–20 |
| `create_summary` | bullet summary | 1–20 |
| `create_project_breakdown` | phases + tasks | 1–12 |
| `make_plan` | unified plan schema: `steps[]` (explicit request), or `recurring_blocks[]`+`milestone_tasks[]`+`review_cadence` (goal), or `batch_actions[]` (brain-dump) — see Plan pipeline above | steps 0–40, recurring_blocks 0–8, milestone_tasks 0–20, batch_actions 0–60 |
| `make_study_pack` | summary + concepts + cards + quiz | — |

### Grades & Study Sets
- `log_grade` — subject, assignment, grade (0–100), grade_type
- `read_study_sets` — list flashcard decks
- `delete_study_set`, `update_study_set` — deck operations

### Control Flow
- `ask_clarification` — pause and ask for details (multi_select option)
- `propose_action` — suggest action to user

### Confidence & Commitment Gating
- `confidence >= 0.85` OR `commitment: 'confirmed'` → eligible for auto-apply (if `aiAutoApprove` enabled)
- `confidence < 0.7` OR `status/commitment: 'tentative'` → routed to review rail
- `0.7 ≤ confidence < 0.85` → shown for confirmation regardless of setting

## Frontend Architecture

### Single-Component Design
`src/App.jsx` (~7800 lines): intentional monolith for tight coordination between async AI responses and UI state.

### Active Panels
- `dashboard` — Main chat interface (default)
- `home` — Custom home with focus widget
- `settings` — Appearance, API connectors, notification preferences

### Key State Variables
```javascript
// Data
tasks[], events[], blocks{}, notes[], studyPlans[], flashcardDecks[], grades[], entityLinks[], messages[]

// Pending (AI response state)
pending: {
  actions[],              // awaiting review
  content,                // AI response text
  clarification,          // ask_clarification pending
  clarificationAnswers{},
  linkSuggestions[],
  proposal,
  queue[]                 // batch to execute
}

// Settings (localStorage)
aiAutoApprove             // auto-apply confidence >= 0.85
notifPrefs                // per-action notifications
contentGenUsed            // daily counter (resets midnight)

// AI status
currentModel, modelFallbackUsed, rpmSnapshot, pipelineProgress
```

### executeAction() — Action Execution Engine
Located ~line 5889. Switch on `action.type`. Every action:
1. Resolves entity references (task/event by id or fuzzy title)
2. Applies confidence gating
3. Calls Supabase operation
4. Pushes undo snapshot
5. Records to `recentlyExecutedActionsRef`

## Dynamic Context Enrichment (context/enrich.ts)

Before every LLM turn, server enriches context in parallel (all bounded 3s, graceful degrade on failure):

1. **Behavioral signals** — 30-day completion rate, postpone rate by subject, time-of-day histogram, recent abandons (cached hourly)
2. **RAG retrieval** — top-8 `memory_embeddings` matching query via pgvector cosine + recency

Assembled snippet injected into system prompt with task priority top-3, schedule density, and memory matches.

### Note bucket + search
Saved work (notes, saved chats, flashcard decks, applied study plans) is embedded into `memory_embeddings` on save (`src/lib/supabase.js` `queueEmbedSync()` → `supabase/functions/embed-batch`, auth'd off the caller's own bearer token) and retrievable two ways:
- **Model-invoked**: the `search_memory` action tool (existing chat-routing tool, server-executed, results fed back into the same turn — never client-executed)
- **Manual search**: `mode: "search"` on the chat endpoint (`{ searchQuery, searchSources?, searchLimit? }` → `{ results }`), a pure `retrieve()` passthrough with no LLM call. `⌘K` global search debounces into this to augment its instant local substring filter with semantic/paraphrase matches.

## Priority Engine (shared/scheduling/priority.ts)

Pure, sync, no-I/O scorer. Runs **server-side** (in context assembly) and **client-side** (for `prioritize_tasks` display).

**Score = weighted sum of 5 factors (each 0–1):**

| Factor | Weight | Logic |
|--------|--------|-------|
| Urgency | 35% | Days-to-due exponential decay (3-day half-life); overdue = 1.0 |
| Importance | 25% | priority field + 0.15 boost for high-stakes subjects (math, AP, SAT, finals, etc.) |
| Momentum | 15% | Per-subject postpone rate; high postpone → higher score |
| Deadline Density | 15% | Fraction of 5 tasks sharing same due date |
| Friction | 10% | `postpone_count × 0.15` |

## LMS Integration

### Architecture
Browser extension (Chrome/Firefox) + backend confidence engine:

1. Extension parses assignment DOM (Google Classroom, Canvas)
2. Posts evidence to `POST /api/lms-event` or Supabase edge function
3. `lms_submission_events` table appends evidence with weight (1–5) and kind
4. `sync-submissions` edge function (cron every 10 min) replays evidence; flips tasks to `done` when cumulative confidence ≥ 85
5. Completed via LMS sets `completion_source = 'lms'` on task; LMS badge shown in UI

**Evidence kinds**: `text_indicator`, `url_state`, `submission_post`, `upload`, `grade_posted`, `page_visit`

**OAuth flow**: Google Classroom → stores tokens in Supabase for background sync.

### API Endpoints (LMS)
- `GET /api/lms-oauth-callback` — Google Classroom OAuth redirect
- `POST /api/lms-courses` — List available courses
- `POST /api/lms-tracked-courses` — User's tracked courses
- `POST /api/lms-ingest` — Ingest assignment structure
- `POST /api/lms-event` — Receive submission evidence
- `POST /api/lms-sync-trigger` — Manual sync trigger
- `POST /api/lms-confirm` — Confirm matched task

## Core Tables

All tables use Supabase Auth RLS (`auth.uid() = user_id`).

**Data**:
- `tasks` — title, due_date, subject, status, priority, confidence, commitment, completion_source, lms_assignment_ref
- `events` — title, event_date, event_type, subject, status, confidence
- `blocks` — activity, date, start_time/end_time, category
- `notes` — title, content, subject, parent_id (folders), is_folder, `type` (`note` | `saved_chat` — replaces the old `[chat-save]` name-prefix convention)
- `memory_embeddings` — pgvector RAG (source, source_id, chunk_idx, embedding vector(1536), metadata). `source` ∈ `memory | event | task | note | lesson | block | flashcard_deck | study_plan`

**Behavioral signals**:
- `task_events` — event_type (status_change, postpone, complete, etc.), timestamps, metadata

**Timers & schedules**:
- `timers` — label, fire_at, fired, dismissed_at
- `study_plans` — title, plan_json, applied_at, review_cadence_days
- `study_packs` — title, subject, status (generating|ready), artifacts, linked_event_id

**Study**:
- `flashcard_decks` — title, cards[], source (ai|manual), card_count
- `grades` — subject, assignment, grade (0–100), grade_type

**LMS**:
- `lms_submission_events` — evidence per assignment (lms, lms_course_id, evidence_kind, confidence_after)

**Admin**:
- `trigger_dismissals` — suppress re-suggestion (expires_at)

**RPC**: `match_memories(query_embedding, user_id_in, match_count, source_filter, metadata_filter)`

## API Endpoints

### Vercel Node.js (`api/`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Main chat (SSE or JSON) |
| `/api/embed` | POST | Batch embeddings |
| `/api/lms-courses` | POST | List courses |
| `/api/lms-tracked-courses` | POST | User's tracked courses |
| `/api/lms-oauth-callback` | GET | Google OAuth redirect |
| `/api/lms-ingest` | POST | Ingest assignments |
| `/api/lms-event` | POST | Evidence webhook |
| `/api/lms-sync-trigger` | POST | Manual sync |
| `/api/lms-confirm` | POST | Confirm matched task |

**Chat body** (`ChatBody`):
```typescript
{
  mode?: string,                    // "chat" | "planning" | "intent_plan" | "brain_dump" | ...
  systemPrompt?: string,
  messages: ChatMessage[],
  imageBase64?: string, imageMimeType?: string,
  audioBase64?: string,
  workspaceContext?: string,
  clientTasks?: Task[],
  clientCalendarDensity?: CalendarDensity,
  maxTokens?: number
}
```

Auth: Bearer token from `Authorization` header via `extractUserId()`.

### Supabase Edge Functions (Deno)
| Function | Description |
|----------|-------------|
| `sos-chat` | Deno mirror of api/chat.ts |
| `sos-voice` | Groq Whisper transcription |
| `embed-batch` | Server-side embedding upserter |
| `sync-submissions` | Cron: LMS reconciliation |
| `sos-lms-event` | LMS webhook receiver |

## Environment Variables

### Server-side
```
GROQ_API_KEY              — required (chat, vision, voice)
GEMINI_API_KEY            — required (embeddings + fallback)
SUPABASE_URL              — Supabase project URL
SUPABASE_SERVICE_ROLE_KEY — service role key
GOOGLE_CLIENT_ID          — LMS OAuth
GOOGLE_CLIENT_SECRET      — LMS OAuth
AI_PROVIDER_OVERRIDE      — set "gemini" to force Gemini rollback
```

### Client-side (VITE_ prefix)
```
VITE_SUPABASE_URL         — frontend Supabase URL
VITE_SUPABASE_ANON_KEY    — frontend anon key
VITE_GOOGLE_CLIENT_ID     — LMS setup popup
VITE_GNEWS_TOKEN          — optional (news widget)
```

## Rate Limiting

- **Content generation** (studio, planning, intent_plan, study_pack): 5 per day per user
- **Chat / action_routing**: RPM tier limits via `shared/rate-limit.ts`
- Daily counter tracked server-side and localStorage
- `RateLimitBanner` displays status + reset countdown

## Key Patterns & Rules

1. **Model strings only in `router.ts`** — never hardcode elsewhere. Vision override in `chat-core.ts` is the one exception.
2. **Zod schemas = single source of truth** — schema generates tool def + validator + JSON Schema.
3. **Transport agnosticism** — `chat-handler.ts` shared; both adapters are thin normalizers.
4. **Web APIs only in `shared/`** — no Node-only APIs; Deno consumes same code.
5. **No direct provider imports** — use `getProvider()` from `shared/ai/providers/index.ts`.
6. **Graceful degradation everywhere** — pipelines ship draft on failure; enrichment skips failed signals; provider fallback to Gemini.
7. **Confidence gating** — items below threshold route to review rail, never auto-apply.
8. **RLS everywhere** — all tables restrict to `auth.uid() = user_id`.
9. **Undo snapshots** — every action execution pushes snapshot before mutation.

## What NOT to do

- Don't hardcode model strings — go through `router.ts`. The vision override in `chat-core.ts` is the only exception (it depends on request payload).
- Don't bypass the Zod schemas in `shared/ai/schemas/`. They catch placeholder values, instruction-as-title, and generic subjects before they reach the user.
- Don't use Node-only APIs (`Buffer`, `require`) in `shared/`. The same files run in Deno too.
- Don't import from `@google/genai` outside `shared/ai/providers/gemini.ts`. The provider seam is intentional.
- Don't import directly from `shared/ai/providers/groq.ts` — go through `getProvider()`.

## Development Workflow

### Before pushing
```bash
npm run build
npm run typecheck
```

Both must pass. No exceptions.

### Full test suite
```bash
npm run lint          # ESLint
npm run eval:harness  # Action routing precision/recall
npm run eval:planning # Planning pipeline regression
```

### To update a schema
1. Edit `shared/ai/schemas/actions.ts` (or `studio.ts`, etc.)
2. The tool definition + JSON Schema + validator are auto-generated
3. If new action type, add case to `executeAction()` in `src/App.jsx`
4. Run `npm run typecheck` to catch schema mismatches

### To add a new LLM intent
1. Add intent name to `router.ts` with tier mapping
2. Add handler case to `chat-handler.ts` for the new `mode`
3. If pipeline, add to `shared/ai/pipelines/`
4. Both runtimes (Vercel + Deno) auto-inherit the logic
