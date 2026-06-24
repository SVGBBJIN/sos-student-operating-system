# SOS — Student Operating System · AI Context Directory

> **For AI bots**: This file is a lookup directory, not a tutorial. Use it to find the right file and line range, then Read only what you need. Do not re-read this whole file on every turn.

---

## What this app is

Chat-first AI student planner. All tasks, events, and notes are created through natural language. The AI parses intent into structured actions; the client executes them against Supabase. See CLAUDE.md for current feature list.

---

## Quick lookup — "where is X?"

| Need | Go to |
|------|-------|
| Add/change an AI tool | `shared/ai/schemas/actions.ts` (Zod schema = tool def + JSON Schema + validator in one place) |
| AI model selection logic | `shared/ai/router.ts` — intent → tier → model. Only file that references model strings. |
| AI fallback chain | `shared/ai/chat-core.ts` `callModel()` — in-tier (Flash 3 → 2.5 Flash) + tier downgrade (2.5 Pro → Flash 3) |
| Planning pipeline (study plans) | `shared/ai/pipelines/planning.ts` — 3-pass draft→critique→refine, Pro tier with thinkingBudget=4096 |
| Intent-plan pipeline | `shared/ai/pipelines/intent_plan.ts` — same 3-pass pattern; produces `make_intent_plan` (blocks + tasks + review cadence) |
| Brain-dump pipeline | `shared/ai/pipelines/brain_dump.ts` — 3-pass transcript/text → batch actions with confidence scoring |
| RAG / embeddings | `shared/ai/rag/` (`embeddings.ts`, `retrieve.ts`, `cache.ts`) + migration `20260514_add_pgvector.sql` |
| Context assembly | `shared/ai/context/assembler.ts` (workspace + retrieved memories + ranked tasks + behavioral signals) |
| Priority engine | `shared/scheduling/priority.ts` — `computePriority`, `rankTasks`, `buildCalendarDensity` (pure, sync, no I/O) |
| Behavioral signals | `shared/ai/signals/behavioral.ts` — `getBehavioralSignals(userId)`, hour-bucket cache, `formatSignalsForContext` |
| Behavioral telemetry writes | `src/lib/dataHandlers.js` `dbInsertTaskEvent()` — fire-and-forget writes to `task_events` |
| Streaming SSE consumer (frontend) | `src/lib/streamChat.js` |
| System prompt construction | `src/App.jsx` `buildSystemPrompt()` ~line 647 |
| Action execution (client-side) | `src/App.jsx` `executeAction()` ~line 5273 |
| Send message / streaming | `src/App.jsx` `sendMessage()` ~line 6900 |
| Timer state + scheduler | `src/App.jsx` `activeTimers`, `scheduleTimerFire()`, `dismissActiveTimer()` ~line 5220 |
| Timer widget (Pomodoro + AI timers) | `src/components/PomodoroTimer.jsx` |
| RPM tracking + queue drain | `src/App.jsx` `pendingQueue` state + `queueOrExecute()` |
| Lofi left panel (Calendar / Projects / Proofread tabs) | `src/components/LofiLeftPanel.jsx` |
| Projects tree (folders + notes) | `src/components/ProjectsTree.jsx` |
| Lofi right panel (widgets) | `src/components/LofiRightPanel.jsx` |
| Lofi top bar | `src/components/StudyTopBar.jsx` |
| Calendar window (events + block bands; Week/Month/Year views) | `src/components/CalendarWindow/CalendarWindow.jsx` |
| Library hub (Notes / Study Plans / Flashcards / Schedule / Proofread) | `src/pages/Library.jsx` |
| Flashcard schema + persistence | `shared/ai/schemas/library.ts`, `flashcard_decks` table, `dbSaveFlashcardDeck()` in `App.jsx` |
| Unified brand mark (S·bulb·S, inlined SVG) | `src/components/BrandMark.jsx` — used by `DynamicTopBar` + `Landing` |
| Settings UI (all toggles) | `src/App.jsx` activePanel `'settings'` block |
| Home screen (opt-in) | `src/components/HomeScreen.jsx` |
| Column resize + lock | `src/hooks/useColumnLayout.js`, `src/components/ColumnResizeHandles.jsx` |
| Supabase client + constants | `src/lib/supabase.js` |
| Vercel API handler | `api/chat.ts` (also `api/embed.ts` for batch embeddings) |
| Supabase edge function | `supabase/functions/sos-chat/index.ts` |
| Voice transcription edge fn | `supabase/functions/sos-voice/index.ts` — Groq Whisper large-v3-turbo |
| Embedding worker | `supabase/functions/embed-batch/index.ts` |
| Regression eval (planning fallback) | `scripts/eval-planning-fallback.mjs` |

---

## Architecture (one-liner per layer)

- **Frontend** — React 18 + Vite SPA (`src/`). `App.jsx` owns state, chat, action execution. SSE consumer in `src/lib/streamChat.js`.
- **Serverless** — Vercel `/api/chat` (Node TS) or Supabase Edge `sos-chat` (Deno TS); both import from `shared/ai/index.js`.
- **AI** — Hybrid Groq + Gemini. Tier 1 (Flash: `openai/gpt-oss-20b` on Groq, fallback `gemini-2.5-flash`) handles chat, action routing, summarization. Tier 2 (Pro: `openai/gpt-oss-120b` on Groq, fallback `gemini-2.5-pro`) handles planning, intent planning, study packs, work-check coaching. Tier 0 (Embed: `gemini-embedding-002` on Gemini) handles all embeddings for RAG.
- **Storage** — Supabase Postgres + Auth + pgvector. Client writes directly via `sb` client after action execution.
- **Shared core** — `shared/ai/index.ts` exports `callModel()`. Router (`shared/ai/router.ts`) is the only place model strings appear.

---

## Models (current)

```
gemini-embedding-002          // Tier 0: embeddings only (Gemini — Groq has no embedding model)
openai/gpt-oss-20b            // Tier 1 primary (Groq): chat, action_routing, summarize, classify
gemini-2.5-flash              // Tier 1 cross-provider fallback (Gemini)
openai/gpt-oss-120b           // Tier 2 primary (Groq): planning, studio, proofread specialist
gemini-2.5-pro                // Tier 2 cross-provider fallback (Gemini)
meta-llama/llama-4-scout-...  // Vision override in chat-core.ts (image-bearing messages)
```

Mapping is defined in `shared/ai/router.ts` (`TIER_BY_INTENT` + `MODEL_BY_TIER`). **Never reference model strings outside `router.ts`** — the only file aware of model names. Set `AI_PROVIDER_OVERRIDE=gemini` env var to roll everything back to Gemini without a redeploy.

**Reliability fallback** (chat-core.ts `callModel()`): on a retryable failure of the primary tier, the call retries once on the cross-provider fallback (Groq flash → Gemini 2.5 Flash; Groq pro → Gemini 2.5 Pro). If both fail, `callModel` records the failure in the circuit breaker and surfaces a graceful "having trouble" message. Planning wraps each pass in its own try/catch; critique/refine degrade to the draft on error. `PlanningPipelineError.stage` carries the failure point so the UI can surface specific copy.

Run the regression eval with `npm run eval:planning`.

---

## Action tools (Zod schemas in `shared/ai/schemas/actions.ts`)

**Scheduling**
- `add_event` · `update_event` · `delete_event` — calendar events. Now persists `time`, `description`, `location`, `priority` (migration `20260508_events_time_columns.sql`).
- `add_block` · `delete_block` — time blocks (recurring or date-specific). Render as translucent bands behind events in `CalendarWindow`.
- `convert_event_to_block` · `convert_block_to_event`
- `add_recurring_event`
- `read_calendar` — read-only schedule lookup; single-day shows blocks + events + tasks, multi-day separates important events (test/exam/game) with urgency flags. Defaults to a **one-week window** when no `end_date` is given; the schema description steers the model to set `end_date` to match a user-stated timeframe ("next month", "this week").
- `view_schedule` — no-op; redirects AI away from `add_task` when user asks what's on calendar

**Tasks**
- `add_task` · `update_task` · `delete_task` · `complete_task` · `break_task`
- Each mutating task action fires `dbInsertTaskEvent` (fire-and-forget) writing to `task_events`: `add_task→create`, `complete_task→complete`, `update_task→postpone` (when new due > old due), `delete_task→abandon`.

**Priority & intent planning**
- `prioritize_tasks` — read-only; returns top-N tasks ranked by `rankTasks()` (priority engine). No DB writes. Use when user asks "what should I do now?". Client uses `buildCalendarDensity(tasks, blocks.dates)` to compute real blocked-minutes density.
- `plan_intent` — triggers `intent_plan` pipeline (Pro tier, 3-pass). Accepts `goal`, `horizon` (week/month/semester), optional `subject`/`deadline`. Returns `make_intent_plan` proposal displayed as `IntentPlanCard`; user hits Apply to batch-create recurring blocks + milestone tasks in one undoable snapshot.

**Timers** (Supabase `timers` table, migration `20260517_timers.sql`)
- `set_timer` — starts a countdown; persists to DB, fires browser Notification + chime + `SosNotification` toast. Active timers shown in the unified `PomodoroTimer` widget (`src/components/PomodoroTimer.jsx`). Active timer labels are injected into the system prompt as `ACTIVE TIMERS` so the AI can reference them.
- `cancel_timer` — cancels a running timer by label (fuzzy match: exact → startsWith → includes). Marks row `fired=true, dismissed_at=now` in DB.

**Notes & projects** (notes table now has `parent_id` + `is_folder`; folders == projects)
- `add_note` · `edit_note` · `delete_note`

**Content generation** (only available when `isContentGen: true`)
- `create_flashcards` · `create_quiz` · `create_outline` · `create_summary`
- `create_study_plan` · `create_project_breakdown` · `make_plan`
- A saved `create_flashcards` result is persisted to `flashcard_decks` (`source: 'ai'`) via `dbSaveFlashcardDeck()` and surfaces in the Library "Flashcards" view. Applied study/intent plans persist to `study_plans`.

**Meta**
- `ask_clarification` — always available; triggers `MultiFieldClarificationCard` (direct merge, no AI roundtrip) when `multi_field=true` + `known_fields` populated; falls back to legacy `ClarificationCard` (AI roundtrip) otherwise.
- `propose_action` — surfaces yes/no confirmation card

To add a new tool: add `ZodSchema` + entry in `ACTION_SCHEMAS` + description in `ACTION_DESCRIPTIONS` (all in `shared/ai/schemas/actions.ts`) → add a `case` in `executeAction()` switch (`App.jsx`).

---

## Layout

Current UI supports dashboard, home, and settings panels via `activePanel` state. See `src/App.jsx` for main component layout.

---

## Projects + Notes (unified file system)

The notes table is a tree. A folder is `is_folder = true`; a project is a folder at the root. A note is `is_folder = false` and may live at any depth. Migration `20260508_notes_hierarchy.sql` adds `parent_id` (self-FK with `ON DELETE CASCADE`) and `is_folder`.

UI:
- Projects tab in `LofiLeftPanel` renders `ProjectsTree.jsx` — indent-based, expand/collapse, click leaf to open in a focused note editor (`ProjectNoteEditor`, defined inline in `LofiLeftPanel.jsx`) with a Backlinks section pinned at the bottom.
- Folder header hosts `+ Folder`, `+ Note`, and `Import` buttons. There is no separate Notes tab — Projects is the unified home for the notes file system.

Field mapping for notes:
- JS `parent_id` ↔ DB `parent_id`
- JS `is_folder` ↔ DB `is_folder`
- existing: JS `name`/`content`/`updatedAt` ↔ DB `name`/`content`/`updated_at`

---

## Calendar + blocks

`CalendarWindow` accepts `events` and `blocks={ recurring, dates }`. Events render as positioned cards using `start_time`/`end_time` (or `time` as a fallback). Blocks render as translucent striped bands behind events via `blockBandsForDate()` (CalendarWindow.jsx).

`viewMode` supports `week`, `month`, and `year`. The Year view (`YearGrid`) is a 3×4 grid of mini-month cells with event-density dots; clicking a month switches `viewMode` to `month` at that month.

Events table now has `start_time`, `end_time`, `description`, `location`, `priority` (migration `20260508_events_time_columns.sql`); shape converters live in `src/lib/eventShape.js`.

Realtime: `App.jsx` subscribes to `postgres_changes` on `events`, `notes`, `tasks`, `recurring_blocks`, `date_blocks` for the current `user_id` so calendar / notes update without a page refresh. Standalone `/calendar` route does the same in `src/pages/CalendarPage.jsx`.

---

## Home screen (opt-in)

`HomeScreen.jsx` — calm landing surface inside the studio. Disabled by default (`sos_home_enabled` localStorage key). When enabled, a Home button appears in the top bar and `activePanel === 'home'` renders the screen.

Configurable in Settings → Home screen:
- Background: 5 curated gradients (`HOME_BACKGROUNDS` in `HomeScreen.jsx`). No upload yet.
- Focus element: today's top task / next upcoming event / custom message.
- Custom message text (when focus = message).

Persisted in `sos_home_*` localStorage keys; not in Supabase.

---

## Resizable columns

`useColumnLayout()` (in `src/hooks/useColumnLayout.js`) owns three fr-weighted column widths and a lock state, persisted in `sos_column_layout` localStorage. Drag handles between columns trigger `startDrag(dividerIdx, e, containerEl)`. Widths clamp to `[0.18, 4.0]` fr and persist on mouseup. The lock toggle (`ColumnLockToggle`) hides the handles; double-click the lock to reset to defaults.

---

## Key state in `App.jsx`

| State | Purpose |
|-------|---------|
| `tasks` | array of task objects |
| `blocks` | `{ recurring: [], dates: {} }` |
| `notes` | array of note objects (each may have `parent_id`/`is_folder`) |
| `events` | array of event objects (with `time`/`end_time`/`description`/`location`/`priority`) |
| `messages` | chat history (capped at `CHAT_MAX_MESSAGES` = 60) |
| `user` | Supabase auth user or null |
| `syncStatus` | `'saving'|'saved'|'error'` |
| `activePanel` | `'dashboard'|'settings'|'home'` |
| `isLoading` | true while awaiting AI response |
| `pipelineProgress` | latest `ProgressEvent` from a streaming planning/intent_plan pipeline; drives `PipelineProgressIndicator` |
| `previewPlanEntry` | pass-1 draft plan shown as a "preview · refining…" card until the refined plan arrives |
| `pendingQueue` | actions queued when RPM near limit |
| `rpmSnapshot` | reactive RPM snapshot for UI |
| `currentModel` | last model string reported by backend (note `fallback_used` flag in response) |
| `homePrefs` | mirror of `sos_home_*` localStorage |
| `activeTimers` | array of `{ id, label, fireAt, startedAt, userId }` — live countdown timers |
| `pendingClarification` | renders `ClarificationCard` or `MultiFieldClarificationCard` |
| `pendingProposal` | renders yes/no card |
| `savedChats` | array for saved chat sidebar |
| `pomodoroSession` | `'pomodoro'|'short_break'|'long_break'` — preset tab for PomodoroTimer |

**Refs** (no re-render):
- `rpmStateRef` — raw RPM data, updated from response headers
- `recentlyExecutedActionsRef` — last 10 actions, injected as RECENTLY COMPLETED ACTIONS
- `timerTimeoutsRef` — Map of `timer.id → setTimeout handle`; cleared on cancel/fire

---

## Supabase

```
Client:  src/lib/supabase.js  →  sb
CHAT_MAX_MESSAGES = 60
```

**Tables**: `profiles`, `tasks`, `events`, `recurring_blocks`, `date_blocks`, `notes`, `chat_messages`, `analytics_events`, `content_generations`, `entity_links`, `timers`, `task_events`, `memory_embeddings`, `study_plans`, `flashcard_decks`.

**Active migrations**:
- `20260507_entity_links.sql` — bidirectional link graph for backlinks/suggestions.
- `20260508_events_time_columns.sql` — adds `start_time`, `end_time`, `description`, `location`, `priority` to `events`.
- `20260508_notes_hierarchy.sql` — adds `parent_id` (self-FK, cascade delete) and `is_folder` to `notes`.
- `20260517_timers.sql` — `timers` table (`id`, `user_id`, `label`, `fire_at`, `fired`, `dismissed_at`); RLS owner-only policy; index on `(user_id, fire_at) where fired = false`.
- `20260518_task_events.sql` — `task_events` table (`id`, `user_id`, `task_id|event_id` xor-check, `event_type` enum, `from_status`, `to_status`, `occurred_at`, `metadata` jsonb); RLS owner-only; `analytics_events` table; adds `completed_at`, `postpone_count`, `last_attempted_at` to `tasks`. **Must be applied to production before behavioral signals or priority engine have real data.**
- `20260519_study_plans.sql` — `study_plans` table (`id`, `user_id`, `title`, `applied_at`, `status`, `plan_json` jsonb, `total_tasks`, `review_cadence_days`); RLS owner-only. Backs the Library "Study Plans" view.
- `20260520_flashcard_decks.sql` — `flashcard_decks` table (`id`, `user_id`, `title`, `summary`, `cards` jsonb `[{q,a}]`, `source` `'ai'|'manual'`, `card_count`, `created_at`); `(user_id, created_at desc)` index; RLS owner-only. Backs the Library "Flashcards" view.

**Field mapping (JS ↔ DB)**:
- `dueDate` ↔ `due_date`, `estTime` ↔ `est_time`, `focusMinutes` ↔ `focus_minutes`, `completedAt` ↔ `completed_at`, `postponeCount` ↔ `postpone_count`, `lastAttemptedAt` ↔ `last_attempted_at`
- Events: JS `date` ↔ DB `event_date`; JS `time` ↔ DB `start_time`; JS `end_time` ↔ DB `end_time`
- Notes: JS `parent_id`/`is_folder` ↔ DB `parent_id`/`is_folder`
- Blocks: recurring templates → `recurring_blocks`; per-date overrides → `date_blocks`

---

## localStorage keys

| Key | Controls |
|-----|----------|
| `sos_show_analytics` | RPM+model badge in topbar |
| `sos_ai_auto_approve` | skip confirmation for actions |
| `sos_response_style` | `'concise'`/`'balanced'`/`'detailed'` |
| `sos_right_widget_order` | draggable widget order in LofiRightPanel |
| `sos_sidebar_companion_panel` | `'notes'|'schedule'` |
| `sos_companion_collapsed` | companion panel collapse state |
| `sos_column_layout` | `{ widths: [num, num, num], locked: bool }` |
| `sos_home_enabled` | opt-in home screen toggle |
| `sos_home_background` | curated background id |
| `sos_home_focus` | `'task'|'event'|'message'` |
| `sos_home_message` | custom message string |
| `sos_perf_indicator_*` | perf pill visibility (sidebar/topbar) |
| `sos-notif-prefs` | notification preferences JSON |

Removed (tutor mode is gone): `sos_tutor_mode`, `sos_skill_hub_mode`, `sos_tutor_indicator_sidebar`, `sos_tutor_indicator_topbar`.

---

## Conventions

- **No new tool definitions in `api/chat.js` or `sos-chat/index.ts`** — all tools live in `chat-core.js ACTION_TOOLS` only.
- **Single source of truth for model strings** — import `MODEL_DEEP` / `MODEL_FAST` from `shared/ai/chat-core.js`. Never redeclare them.
- **Field name conflicts**: AI sees camelCase; Supabase gets snake_case. Conversion happens in load/save functions in App.jsx and in `src/lib/eventShape.js`.
- **Layout guard**: realtime subscriptions use the shared `dbEventToApp` / `dbNoteToApp` so all event/note metadata flows through one place.
- **Content generation**: set `isContentGen: true` in the chat payload to constrain available tools to `CONTENT_ACTION_TOOLS` and enforce rate limits via `content_generations` table.
- **Streaming**: backend emits named SSE frames — `delta` (token text), `tool_call`, `usage`, `progress`, `done` (final `chatData` with actions/clarifications), `error`. `src/lib/streamChat.js` consumes them and transparently falls back to JSON for non-streaming responses. The `progress` frame carries a `ProgressEvent` and drives the live pipeline stepper for `planning`/`intent_plan` modes.
- **Pipeline progress**: `planning.ts` / `intent_plan.ts` accept an optional `onProgress` callback emitting a `ProgressEvent` (`{phase, label, step, totalSteps, draft?}`) per pass. `chat-handler.ts` wires it into the SSE `progress` frame. The frontend (`App.jsx`) renders `PipelineProgressIndicator` (4-step stepper + moving slider) and shows the `reviewing` event's `draft` as a "preview · refining…" `IntentPlanCard` that swaps for the refined plan on `done`.
- **Wikilinks never auto-commit** — `LinkSuggestionCard` is approval-first, one tap to confirm or dismiss.
