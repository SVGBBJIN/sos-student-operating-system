# SOS — Student Operating System · AI Context Directory

> **For AI bots**: This file is a lookup directory, not a tutorial. Use it to find the right file and line range, then Read only what you need. Do not re-read this whole file on every turn.

---

## What this app is

Chat-first AI student planner. All tasks, events, and notes are created through natural language. The AI parses intent into structured actions; the client executes them against Supabase. The current UI is a single **lofi** three-column layout (Calendar/Notes-Projects-Proofread on the left, chat in the center, widgets on the right). The non-lofi `sidebar` and `topbar` branches are dormant code.

---

## Quick lookup — "where is X?"

| Need | Go to |
|------|-------|
| Add/change an AI tool | `shared/ai/chat-core.js` → `ACTION_TOOLS` (~line 80) |
| AI model selection logic | `shared/ai/chat-core.js` lines 9–16, `resolveModel()` line 14 |
| AI fallback chain | `shared/ai/chat-core.js` `callGroq()` lines ~1001–1030 (try MODEL_DEEP → fallback to MODEL_FAST) |
| Planning pipeline (study plans) | `shared/ai/planning-pipeline.js` — 3-pass draft→critique→refine, each pass auto-falls-over |
| System prompt construction | `src/App.jsx` `buildSystemPrompt()` ~line 647 |
| Action execution (client-side) | `src/App.jsx` `executeAction()` ~line 4730 |
| Send message / streaming | `src/App.jsx` `sendMessage()` ~line 5970 |
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
| Vercel API handler | `api/chat.js` |
| Supabase edge function | `supabase/functions/sos-chat/index.ts` |
| Voice transcription edge fn | `supabase/functions/sos-voice/index.ts` |
| Regression eval (planning fallback) | `scripts/eval-planning-fallback.mjs` |

---

## Architecture (one-liner per layer)

- **Frontend** — React 18 + Vite SPA (`src/`). `App.jsx` owns state, chat, action execution.
- **Serverless** — Vercel `/api/chat` (Node) or Supabase Edge `sos-chat` (Deno); both import from `shared/ai/chat-core.js`.
- **AI** — Groq is the LLM provider. Heavy model handles planning + content gen + tool-heavy chat; fast model handles small content tasks AND auto-takes-over when the heavy model fails.
- **Storage** — Supabase Postgres + Auth. Client writes directly via `sb` client after action execution.
- **Shared core** — `shared/ai/chat-core.js` is the single source of truth for models, tools, and `callGroq()`.

---

## Models (current)

```
MODEL_DEEP = "openai/gpt-oss-120b"   // heavy: planning, proofreading, step generation
MODEL_FAST = "openai/gpt-oss-20b"    // fast: tagging, status updates, fallback
PRIMARY_MODEL = MODEL_DEEP
```

`resolveModel()` (chat-core.js:14) normalizes the requested model. **Single source of truth** — all client-side model references import from `shared/ai/chat-core.js`. `src/lib/aiClient.js` re-exports for convenience; do not redeclare model strings elsewhere.

**Reliability fallback** (chat-core.js `callGroq` ~line 1010): on any throw from MODEL_DEEP — timeout, rate limit, 5xx, network — the call retries once on MODEL_FAST. If both fail, throws an `Error` with `cause_code: "both_models_failed"`. The planning pipeline wraps each pass in a try/catch and re-throws `PlanningPipelineError` with `stage: 'draft'|'critique'|'refine'` so the UI can surface specific copy. The critique and refine passes degrade gracefully — if either fails, the pipeline still ships the draft plan.

Run the regression eval with `npm run eval:planning`.

---

## Action tools (`ACTION_TOOLS` in `shared/ai/chat-core.js`)

**Scheduling**
- `add_event` · `update_event` · `delete_event` — calendar events. Now persists `time`, `description`, `location`, `priority` (migration `20260508_events_time_columns.sql`).
- `add_block` · `delete_block` — time blocks (recurring or date-specific). Render as translucent bands behind events in `CalendarWindow`.
- `convert_event_to_block` · `convert_block_to_event`
- `add_recurring_event`
- `view_schedule` — no-op; redirects AI away from `add_task` when user asks what's on calendar

**Tasks**
- `add_task` · `update_task` · `delete_task` · `complete_task` · `break_task`

**Notes & projects** (notes table now has `parent_id` + `is_folder`; folders == projects)
- `add_note` · `edit_note` · `delete_note`

**Content generation** (only available when `isContentGen: true`)
- `create_flashcards` · `create_quiz` · `create_outline` · `create_summary`
- `create_study_plan` · `create_project_breakdown` · `make_plan`

**Meta**
- `ask_clarification` — always available; triggers `ClarificationCard` on client
- `propose_action` — surfaces yes/no confirmation card

To add a new tool: add to `ACTION_TOOLS` array + validator in `validateToolArguments()` (both in `chat-core.js`) + case in `executeAction()` switch (`App.jsx`).

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
| `pendingClarification` | renders `ClarificationCard` |
| `pendingProposal` | renders yes/no card |
| `savedChats` | array for saved chat sidebar |

**Refs** (no re-render):
- `rpmStateRef` — raw RPM data, updated from response headers
- `recentlyExecutedActionsRef` — last 10 actions, injected as RECENTLY COMPLETED ACTIONS

---

## Supabase

```
Client:  src/lib/supabase.js  →  sb
CHAT_MAX_MESSAGES = 60
```

**Tables**: `profiles`, `tasks`, `events`, `recurring_blocks`, `date_blocks`, `notes`, `chat_messages`, `analytics_events`, `content_generations`, `entity_links`.

**Active migrations**:
- `20260507_entity_links.sql` — bidirectional link graph for backlinks/suggestions.
- `20260508_events_time_columns.sql` — adds `start_time`, `end_time`, `description`, `location`, `priority` to `events`.
- `20260508_notes_hierarchy.sql` — adds `parent_id` (self-FK, cascade delete) and `is_folder` to `notes`.

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
