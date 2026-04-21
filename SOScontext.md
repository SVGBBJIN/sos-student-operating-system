# SOS — Student Operating System · AI Context Directory

> **For AI bots**: This file is a lookup directory, not a tutorial. Use it to find the right file and line range, then Read only what you need. Do not re-read this whole file on every turn.

---

## What this app is

Chat-first AI student planner. All tasks, events, and notes are created through natural language. The AI parses intent into structured actions; the client executes them against Supabase. Three UI modes: **lofi** (default), **sidebar**, **topbar**.

---

## Quick lookup — "where is X?"

| Need | Go to |
|------|-------|
| Add/change an AI tool | `shared/ai/chat-core.js` → `ACTION_TOOLS` (~line 150) |
| AI model selection logic | `shared/ai/chat-core.js` lines 1–30, `selectModel()` line 22 |
| System prompt construction | `src/App.jsx` `buildSystemPrompt()` line 647 |
| Action execution (client-side) | `src/App.jsx` `executeAction()` line 4454 |
| Send message / streaming | `src/App.jsx` `sendMessage()` line 5397 |
| RPM tracking + queue drain | `src/App.jsx` lines 4123–4142, `queueOrExecute()` line 6309 |
| Layout switching | `src/App.jsx` `layoutMode` state line 4052; render branch line 6457 |
| Lofi left panel (schedule+notes) | `src/components/LofiLeftPanel.jsx` |
| Lofi right panel (widgets) | `src/components/LofiRightPanel.jsx` |
| Lofi top bar | `src/components/StudyTopBar.jsx` |
| Tutor / SkillHub entry | `src/App.jsx` `enterTutorMode()` line 6378 |
| Settings UI (all toggles) | `src/App.jsx` ~line 6620–6980 (inside `activePanel === 'settings'` block) |
| Supabase client + constants | `src/lib/supabase.js` |
| Notes panel (overlay/embedded) | `src/App.jsx` `NotesPanel` component line 3503 |
| Clarification card | `src/App.jsx` `ClarificationCard` component (~line 1700) |
| DB field name mappings | `src/App.jsx` load functions ~line 4200–4400 |
| CSS: lofi layout | `src/styles/lofi-layout.css` |
| CSS: global / topbar / sidebar | `src/styles/index.css` |
| CSS: neon/lofi theme tokens | `src/styles/neon-lofi.css` |
| Vercel API handler | `api/chat.js` |
| Supabase edge function | `supabase/functions/sos-chat/index.ts` |
| Voice transcription edge fn | `supabase/functions/sos-voice/index.ts` |

---

## Architecture (one-liner per layer)

- **Frontend** — React 18 + Vite SPA (`src/`). `App.jsx` (~7000 lines) owns all state, chat, and action execution.
- **Serverless** — Vercel `/api/chat` (Node) or Supabase Edge `sos-chat` (Deno); both import from `shared/ai/chat-core.js`.
- **AI** — Groq as primary LLM provider; Gemini as cross-provider fallback. Tool-calling via `ACTION_TOOLS` schema.
- **Storage** — Supabase Postgres + Auth. Client writes directly via `sb` client after action execution.
- **Shared core** — `shared/ai/chat-core.js` is the single source of truth for models, tools, and `callGroq()`.

---

## Models (current)

```
PRIMARY_MODEL        = "openai/gpt-oss-120b"    // tool-heavy + agentic
BACKUP_MODEL         = "openai/gpt-oss-20b"     // groq fallback
FAST_MODEL           = "openai/gpt-oss-20b"     // short/simple turns
GEMINI_CONVERSATIONAL_BACKUP = "gemini-2.5-flash"
GEMINI_FAST_BACKUP           = "gemini-2.5-flash-lite"
```

`selectModel()` in `chat-core.js:22` — picks model per request. Fallback chain: Groq primary → Gemini backup → Groq backup → FAST_MODEL.

---

## Action tools (`ACTION_TOOLS` in `shared/ai/chat-core.js`)

**Scheduling**
- `add_event` · `update_event` · `delete_event` — calendar events
- `add_block` · `delete_block` — time blocks (recurring or date-specific)
- `convert_event_to_block` · `convert_block_to_event`
- `add_recurring_event`
- `view_schedule` — no-op; redirects AI away from `add_task` when user asks what's on calendar

**Tasks**
- `add_task` · `update_task` · `delete_task` · `complete_task` · `break_task`

**Notes**
- `add_note` · `edit_note` · `delete_note`

**Content generation** (only available when `isContentGen: true`)
- `create_flashcards` · `create_quiz` · `create_outline` · `create_summary`
- `create_study_plan` · `create_project_breakdown` · `make_plan`

**Meta**
- `ask_clarification` — always available; triggers `ClarificationCard` on client
- `propose_action` — surfaces yes/no confirmation card; stripped on FAST_MODEL

To add a new tool: add to `ACTION_TOOLS` array + validator in `validateToolArguments()` (both in `chat-core.js`) + case in `executeAction()` switch (`App.jsx:4454`).

---

## Key state in `App.jsx`

| State | Line | Purpose |
|-------|------|---------|
| `tasks` | 4020 | array of task objects |
| `blocks` | 4021 | `{ recurring: [], dates: {} }` |
| `notes` | 4022 | array of note objects |
| `events` | 4023 | array of event objects |
| `messages` | 4024 | chat history (capped at `CHAT_MAX_MESSAGES` = 60) |
| `user` | 4009 | Supabase auth user or null |
| `syncStatus` | 4120 | `'saving'|'saved'|'error'` |
| `layoutMode` | 4052 | `'lofi'|'sidebar'|'topbar'` (localStorage `sos_layout_mode`) |
| `activePanel` | 4058 | `'chat'|'tutor'|'settings'|…` |
| `tutorMode` | 4062 | boolean; toggles guided-learning AI persona |
| `isLoading` | 4032 | true while awaiting AI response |
| `pendingQueue` | 4123 | `[{id, action, addedAt}]` — actions queued when RPM near limit |
| `rpmSnapshot` | 4050 | `{remaining, limit, resetAtMs}` — reactive copy of RPM state |
| `currentModel` | 4051 | last model string reported by backend |
| `showAnalytics` | 4049 | show RPM+model badge in topbar (localStorage `sos_show_analytics`) |
| `lofiNoteOpen` | 4047 | opens NotesPanel overlay in lofi mode |
| `lofiTutorTabActive` | 4048 | flips left panel to Studio tab in lofi mode |
| `agenticMode` | 4008 | via `useAgenticMode()` hook |
| `pendingClarification` | 4041 | current clarification payload → renders `ClarificationCard` |
| `pendingProposal` | 4044 | `{summary, action_type, prefilled}` → renders yes/no card |
| `showAttachMenu` | 4162 | + button dropdown (File / Google) |
| `showGoogleModal` | 4161 | Google import modal |
| `savedChats` | 4174 | array for saved chat sidebar |

**Refs** (not state, don't trigger renders):
- `rpmStateRef` (4124) — raw RPM data, updated from response headers
- `recentlyExecutedActionsRef` (4125) — last 10 actions, injected into system prompt as "RECENTLY COMPLETED ACTIONS" to prevent AI re-asking

---

## Layout modes

```
layoutMode === 'lofi'    → <div className="study-app">  3-column grid
layoutMode === 'sidebar' → <div className="sos-app">    left sidebar + main
layoutMode === 'topbar'  → <div className="sos-app">    topbar + main
```

**Lofi render tree** (all inside `layoutMode === 'lofi'` branches):
```
StudyTopBar          ← src/components/StudyTopBar.jsx
LofiLeftPanel        ← src/components/LofiLeftPanel.jsx   (schedule + notes/studio)
<div.study-center>   ← chat + settings (center column)
LofiRightPanel       ← src/components/LofiRightPanel.jsx  (weather, saved, radio, timer)
```

`StudyTopBar` props: `user, syncStatus, tutorMode, onNewChat, onTutorMode, onImport, onSettings, onAuthAction, onSwitchLayout, queueCount, analyticsInfo`

`LofiLeftPanel` props: `events, tasks, notes, onCreateNote, onSendChatMessage, onNoteClick, tutorMode, lofiTutorTabActive, onCloseTutorTab`

`LofiRightPanel` props: `weatherData, savedChats, onOpenSavedChat`

---

## RPM / queue system

```
rpmStateRef          ← ref, updated from response headers each request (chat-core.js getGroqRpmStatus())
rpmSnapshot state    ← reactive copy for UI rendering (set alongside rpmStateRef update)
pendingQueue state   ← actions deferred when RPM near limit
queueOrExecute()     ← App.jsx:6309 — wraps executeAction(); queues if RPM low
queue drain effect   ← App.jsx:4129–4142 — fires when pendingQueue changes
RPM_NEAR_LIMIT_THRESHOLD ← defined in chat-core.js (~10% of limit)
```

Backend response shape includes `rpm: getGroqRpmStatus()`. Client reads `chatData.rpm` at `App.jsx:5622`.

---

## Chat pipeline (brief)

1. `sendMessage()` (App.jsx:5397) — builds payload with `buildSystemPrompt()`, sends to `EDGE_FN_URL`
2. Backend streams SSE or returns JSON: `{content, actions, clarifications, rpm, model_used}`
3. Client applies streaming text → `messages` state
4. On `done` event: sets `rpmSnapshot`, `currentModel`, dispatches `actions` through `executeAction()`
5. `executeAction()` (App.jsx:4454) — switch on `action.type`, mutates local state + writes Supabase

**Clarification flow**: `ask_clarification` action → `pendingClarification` state → `ClarificationCard` (~App.jsx:1700) → user answers → `sendMessage()` called with answers

**Proposal flow**: `propose_action` → `pendingProposal` state → yes/no card → confirm calls `executeAction()`

---

## Supabase

```
URL:     https://evqylqgkzlbbrvogxsjn.supabase.co
Client:  src/lib/supabase.js  →  sb
CHAT_MAX_MESSAGES = 60  (also in lib/supabase.js)
```

**Tables**: `profiles`, `tasks`, `events`, `recurring_blocks`, `date_blocks`, `notes`, `chat_messages`, `analytics_events`, `content_generations`

**Field mapping** (JS ↔ DB):
- `dueDate` ↔ `due_date`, `estTime` ↔ `est_time`, `focusMinutes` ↔ `focus_minutes`
- `completedAt` ↔ `completed_at`, `event_date` ↔ `date`, `event_type` ↔ `type`
- Blocks: recurring templates → `recurring_blocks`; per-date overrides → `date_blocks`

---

## Components reference

| Component | File | Notes |
|-----------|------|-------|
| `NotesPanel` | App.jsx:3503 | `embedded` prop = sidebar inline; no prop = `position:fixed` overlay |
| `ClarificationCard` | App.jsx:~1700 | date inputs get a "Done" submit button |
| `StudyTopBar` | components/StudyTopBar.jsx | Lofi topbar; shows clock, queue badge, analytics badge |
| `LofiLeftPanel` | components/LofiLeftPanel.jsx | Schedule week grid + notes list; notes section flips to Studio tab when `lofiTutorTabActive` |
| `LofiRightPanel` | components/LofiRightPanel.jsx | Draggable widgets: weather, saved chats, radio, timer+smash |
| `SkyBackground` | components/SkyBackground.jsx | Animated sky (no city SVG) |
| `PomodoroTimer` | components/PomodoroTimer.jsx | Standalone timer |
| `ErrorBoundary` | components/ErrorBoundary.jsx | Top-level error catch |

---

## Key functions

| Function | Location | Does |
|----------|----------|------|
| `buildSystemPrompt()` | App.jsx:647 | Constructs system prompt with tiered context budgets; injects RECENTLY COMPLETED ACTIONS |
| `executeAction()` | App.jsx:4454 | Switch dispatch for all tool actions; records to `recentlyExecutedActionsRef` |
| `sendMessage()` | App.jsx:5397 | Full chat send + streaming; sets RPM/model state on response |
| `queueOrExecute()` | App.jsx:6309 | Wraps executeAction; defers to pendingQueue if RPM near limit |
| `enterTutorMode()` | App.jsx:6378 | Lofi: activates studio tab + posts activation message; other modes: `setActivePanel('tutor')` |
| `toggleTutorMode()` | App.jsx:6373 | Sets tutorMode state + localStorage |
| `detectCompanionIntent()` | App.jsx:4102 | Detects if message implies companion panel; only acts if `layoutMode === 'sidebar'` |
| `handleCreateNote()` | App.jsx:5353 | Optimistic state + Supabase insert |
| `handleUpdateNote()` | App.jsx:5347 | Optimistic state + Supabase update |
| `handleDeleteNote()` | App.jsx:5341 | Optimistic state + Supabase delete |
| `startNewChat()` | App.jsx:6321 | Clears messages, resets pending state |
| `callGroq()` | chat-core.js | LLM call with retries, circuit breaker, Gemini fallback chain |
| `parseLlmResponse()` | chat-core.js | Parses tool calls, runs validators, converts failures to clarifications |
| `getGroqRpmStatus()` | chat-core.js:89 | Returns current RPM snapshot from module-level GROQ_RPM object |

---

## localStorage keys

| Key | Controls |
|-----|----------|
| `sos_layout_mode` | `'lofi'|'sidebar'|'topbar'` |
| `sos_show_analytics` | RPM+model badge in topbar |
| `sos_ai_auto_approve` | skip confirmation for actions |
| `sos_tutor_mode` | tutor mode persistence |
| `sos_right_widget_order` | draggable widget order in LofiRightPanel |
| `sos_sidebar_companion_panel` | `'notes'|'schedule'` |
| `sos_companion_collapsed` | companion panel collapse state |
| `sos_skill_hub_mode` | SkillHub learning mode |
| `sos-notif-prefs` | notification preferences JSON |

---

## Conventions

- **No new tool definitions in `api/chat.js` or `sos-chat/index.ts`** — all tools live in `chat-core.js ACTION_TOOLS` only.
- **Field name conflicts**: AI sees camelCase; Supabase gets snake_case. Conversion happens in load/save functions in App.jsx ~4200–4400.
- **Lofi note actions**: always route through `onSendChatMessage` → `sendMessage()` → AI → `executeAction()`. Don't call `handleCreateNote` directly from lofi UI (except the Add Note shortcut which sends the message "Create a new note").
- **Layout guard**: `detectCompanionIntent()` only switches layout if already in sidebar mode. Never force-switch to sidebar from lofi.
- **Content generation**: set `isContentGen: true` in the chat payload to constrain available tools to `CONTENT_ACTION_TOOLS` and enforce rate limits via `content_generations` table.
- **Streaming**: backend sends SSE `data: {...}` lines; client accumulates in `streamedText`; final `data: [DONE]` line carries `chatData` with actions/clarifications.
