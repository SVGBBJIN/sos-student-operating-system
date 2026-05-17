# SOS — Student Operating System · AI Context Directory

> **For AI bots**: This file is a lookup directory, not a tutorial. Use it to find the right file and line range, then Read only what you need. Do not re-read this whole file on every turn.

---

## What this app is

Chat-first AI student planner. All tasks, events, and notes are created through natural language. The AI parses intent into structured actions; the client executes them against Supabase. The current UI is a single **lofi** three-column layout (Calendar/Notes-Projects-Proofread on the left, chat in the center, widgets on the right). The non-lofi `sidebar` and `topbar` branches are dormant code.

---

## Quick lookup — "where is X?"

| Need | Go to |
|------|-------|
| Add/change an AI tool | `shared/ai/schemas/actions.ts` (Zod schema = tool def + JSON Schema + validator in one place) |
| AI model selection logic | `shared/ai/router.ts` — intent → tier → model. Only file that references model strings. |
| AI fallback chain | `shared/ai/chat-core.ts` `callModel()` — in-tier (Flash 3 → 2.5 Flash) + tier downgrade (2.5 Pro → Flash 3) |
| Planning pipeline (study plans) | `shared/ai/pipelines/planning.ts` — 3-pass draft→critique→refine, Pro tier with thinkingBudget=4096 |
| Proofread pipeline | `shared/ai/pipelines/proofread.ts` — Flash classifier → Pro specialists per bucket |
| RAG / embeddings | `shared/ai/rag/` (`embeddings.ts`, `retrieve.ts`, `cache.ts`) + migration `20260514_add_pgvector.sql` |
| Context assembly | `shared/ai/context/assembler.ts` (workspace + retrieved memories + recency weight) |
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
| Calendar window (events + block bands) | `src/components/CalendarWindow/CalendarWindow.jsx` |
| Settings UI (all toggles) | `src/App.jsx` activePanel `'settings'` block |
| Home screen (opt-in) | `src/components/HomeScreen.jsx` |
| Wikilink autocomplete + popover | `src/components/WikilinkAutocomplete.jsx`, `src/lib/wikilinkSearch.js` |
| Backlinks panel (always visible on notes) | `src/components/BacklinksList.jsx` |
| Column resize + lock | `src/hooks/useColumnLayout.js`, `src/components/ColumnResizeHandles.jsx` |
| Supabase client + constants | `src/lib/supabase.js` |
| Vercel API handler | `api/chat.ts` (also `api/proofread.ts`, `api/embed.ts`) |
| Supabase edge function | `supabase/functions/sos-chat/index.ts` |
| Voice transcription edge fn | `supabase/functions/sos-voice/index.ts` — Gemini Flash audio input |
| Web search / lesson lookup | `supabase/functions/search-lesson/index.ts` — Gemini Pro + googleSearch grounding |
| Embedding worker | `supabase/functions/embed-batch/index.ts` |
| Regression eval (planning fallback) | `scripts/eval-planning-fallback.mjs` |

---

## Architecture (one-liner per layer)

- **Frontend** — React 18 + Vite SPA (`src/`). `App.jsx` owns state, chat, action execution. SSE consumer in `src/lib/streamChat.js`.
- **Serverless** — Vercel `/api/chat` (Node TS) or Supabase Edge `sos-chat` (Deno TS); both import from `shared/ai/index.js`.
- **AI** — Hybrid Groq + Gemini. Tier 1 (`openai/gpt-oss-20b` on Groq, fallback `gemini-2.5-flash`) handles chat, action routing, summarization, voice. Tier 2 (`openai/gpt-oss-120b` on Groq, fallback `gemini-2.5-pro`) handles planning, studio, proofread specialists. Tier 0 (`gemini-embedding-002` on Gemini) handles all embeddings.
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
- `read_calendar` — read-only schedule lookup; single-day shows blocks + events + tasks, multi-day separates important events (test/exam/game) with urgency flags.
- `view_schedule` — no-op; redirects AI away from `add_task` when user asks what's on calendar

**Tasks**
- `add_task` · `update_task` · `delete_task` · `complete_task` · `break_task`

**Timers** (Supabase `timers` table, migration `20260517_timers.sql`)
- `set_timer` — starts a countdown; persists to DB, fires browser Notification + chime + `SosNotification` toast. Active timers shown in the unified `PomodoroTimer` widget (`src/components/PomodoroTimer.jsx`). Active timer labels are injected into the system prompt as `ACTIVE TIMERS` so the AI can reference them.
- `cancel_timer` — cancels a running timer by label (fuzzy match: exact → startsWith → includes). Marks row `fired=true, dismissed_at=now` in DB.

**Notes & projects** (notes table now has `parent_id` + `is_folder`; folders == projects)
- `add_note` · `edit_note` · `delete_note`

**Content generation** (only available when `isContentGen: true`)
- `create_flashcards` · `create_quiz` · `create_outline` · `create_summary`
- `create_study_plan` · `create_project_breakdown` · `make_plan`

**Meta**
- `ask_clarification` — always available; triggers `MultiFieldClarificationCard` (direct merge, no AI roundtrip) when `multi_field=true` + `known_fields` populated; falls back to legacy `ClarificationCard` (AI roundtrip) otherwise.
- `propose_action` — surfaces yes/no confirmation card

To add a new tool: add `ZodSchema` + entry in `ACTION_SCHEMAS` + description in `ACTION_DESCRIPTIONS` (all in `shared/ai/schemas/actions.ts`) → add a `case` in `executeAction()` switch (`App.jsx`).

---

## Layout

```
layoutMode === 'lofi'    → <div className="study-app">  3-column grid (resizable)
layoutMode === 'sidebar' → dormant, kept for migration
layoutMode === 'topbar'  → dormant, kept for migration
```

**Lofi render tree**:
```
StudyTopBar            ← src/components/StudyTopBar.jsx        (clock, settings, optional Home button)
LofiLeftPanel          ← src/components/LofiLeftPanel.jsx      (Calendar / Projects / Proofread tabs)
<div.study-center>     ← chat + settings + home (center column)
LofiRightPanel         ← src/components/LofiRightPanel.jsx     (weather, saved, radio, timer)
ColumnResizeHandles    ← src/components/ColumnResizeHandles.jsx (between columns 0/1 and 1/2 when unlocked)
ColumnLockToggle       ← lock icon at bottom-right; double-click to reset to defaults
```

`StudyTopBar` props: `user, syncStatus, onNewChat, onImport, onSettings, onAuthAction, onSwitchLayout, onHome, homeEnabled, queueCount`. **Import button is no longer rendered in the lofi top bar**; import lives in the Projects tab folder header.

`LofiLeftPanel` props: `events, blocks, tasks, entityLinks, userId, onEventUpdate, notes, onCreateNote, onUpdateNote, onDeleteNote, onImportClick`.

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

Events table now has `start_time`, `end_time`, `description`, `location`, `priority` (migration `20260508_events_time_columns.sql`); shape converters live in `src/lib/eventShape.js`.

Realtime: `App.jsx` subscribes to `postgres_changes` on `events`, `notes`, `tasks`, `recurring_blocks`, `date_blocks` for the current `user_id` so calendar / notes update without a page refresh. Standalone `/calendar` route does the same in `src/pages/CalendarPage.jsx`.

---

## WikiLinks

Discoverable, approval-first.

- **Autocomplete**: `useWikilinkAutocomplete` (in `WikilinkAutocomplete.jsx`) opens a popover when the user types `[[` in the chat input. Shows matching notes / events / tasks ranked by prefix match. ↑/↓ to navigate, ↵/Tab to commit, Esc to dismiss. On commit, inserts `[[Selected Name]]` and closes.
- **Search**: `searchEntities()` in `src/lib/wikilinkSearch.js` ranks by exact > prefix > substring > word-prefix.
- **Rendering**: existing `renderWikilinks()` in `src/lib/wikilinks.js` walks text nodes and wraps `[[Name]]` with `<a class="wikilink">`. Unresolved names get `.wikilink.unresolved`.
- **Backlinks**: `BacklinksList.jsx` queries `entity_links` table via `findBacklinks()` and is always visible on note detail views (no toggle).
- **Soft suggestions**: `LinkSuggestionCard` (existing) surfaces "Link this to `[[X]]`?" cards in chat. Approval is one tap; SOS never auto-links.

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
| `entityLinks` | `entity_links` graph; powers backlinks + suggestions |
| `messages` | chat history (capped at `CHAT_MAX_MESSAGES` = 60) |
| `user` | Supabase auth user or null |
| `syncStatus` | `'saving'|'saved'|'error'` |
| `layoutMode` | `'lofi'` (current default; sidebar/topbar branches dormant) |
| `activePanel` | `'chat'|'settings'|'home'` |
| `isLoading` | true while awaiting AI response |
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

**Tables**: `profiles`, `tasks`, `events`, `recurring_blocks`, `date_blocks`, `notes`, `chat_messages`, `analytics_events`, `content_generations`, `entity_links`, `timers`.

**Active migrations**:
- `20260507_entity_links.sql` — bidirectional link graph for backlinks/suggestions.
- `20260508_events_time_columns.sql` — adds `start_time`, `end_time`, `description`, `location`, `priority` to `events`.
- `20260508_notes_hierarchy.sql` — adds `parent_id` (self-FK, cascade delete) and `is_folder` to `notes`.
- `20260517_timers.sql` — `timers` table (`id`, `user_id`, `label`, `fire_at`, `fired`, `dismissed_at`); RLS owner-only policy; index on `(user_id, fire_at) where fired = false`.

**Field mapping (JS ↔ DB)**:
- `dueDate` ↔ `due_date`, `estTime` ↔ `est_time`, `focusMinutes` ↔ `focus_minutes`, `completedAt` ↔ `completed_at`
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
- **Streaming**: backend sends SSE `data: {...}` lines; client accumulates in `streamedText`; final `data: [DONE]` line carries `chatData` with actions/clarifications.
- **Wikilinks never auto-commit** — `LinkSuggestionCard` is approval-first, one tap to confirm or dismiss.
