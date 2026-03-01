# SOS — Student Operating System (Codebase Context)

> **Purpose of this file:** Auto-loaded by Claude Code at session start. Provides full architectural context so agents never need to re-explore the 3,800+ line codebase from scratch. If you're an AI reading this — you already know everything you need to start working.

---

## Project Snapshot

- **Single file app:** `index.html` (~3,816 lines, ~230 KB)
- **Framework:** React 18.2.0 + Babel Standalone 7.23.9 (JSX transpiled in-browser, no build step)
- **Backend:** Supabase (PostgreSQL + Auth + Edge Functions)
- **AI providers:** Groq (Llama 3.1 8B) for chat, Google Gemini 2.5 Flash for actions/content
- **All code lives in `index.html`** — state, UI, AI routing, DB sync, Google OAuth. Never split into multiple files; the CDN Babel setup requires a single `<script type="text/babel">` block.

---

## CDN Dependencies (loaded in `<head>`)

| Library | Version | Purpose |
|---|---|---|
| React + ReactDOM | 18.2.0 UMD | UI framework |
| @supabase/supabase-js | 2.x UMD | Backend client + auth |
| @babel/standalone | 7.23.9 | In-browser JSX transpilation |
| pdfjs-dist | **3.11.174** (v3 UMD only — v4 ESM breaks Babel) | PDF text extraction |
| Google Identity Services | latest | OAuth2 token client |
| Inter font | Google Fonts | UI typography |

---

## Key Constants

```
SUPABASE_URL          = 'https://evqylqgkzlbbrvogxsjn.supabase.co'   (line 406)
SUPABASE_ANON_KEY     = [hardcoded JWT — acceptable for anon client]  (line 407)
EDGE_FN_URL           = SUPABASE_URL + '/functions/v1/sos-chat'       (line 411)
CHAT_MAX_MESSAGES     = 60                                            (line 472)
DAILY_CONTENT_LIMIT   = 5  (per-day AI content gen cap)               (line 2586)

Google OAuth Client ID = '504839570150-i4s8urseqgrjucbhqfjc9phiavrcn08d.apps.googleusercontent.com'
Google OAuth scopes    = calendar.events, documents, docs, userinfo.email
Authorized origins     = https://lucky-pika-26ed5b.netlify.app, https://svgbbijn.github.io
```

---

## Section Map (line ranges)

| Lines | Section |
|---|---|
| 1–344 | `<style>` — CSS variables, animations, all component classes |
| 345–402 | React hook destructuring + SVG icon system (`Icon.calendar`, `Icon.check`, etc.) |
| 403–526 | Supabase config, EDGE_FN_URL, date/time helpers (`fmt`, `today`, `uid`, `daysUntil`, etc.) |
| 527–818 | Supabase data layer — `loadAllFromSupabase`, DB converters (`dbTaskToApp`/`appTaskToDb`), CRUD helpers |
| 819–1073 | `buildSystemPrompt(tasks, blocks, events, notes, tier)` — tier 1 (lean Llama) vs tier 2 (full Gemini) |
| 1074–1082 | `parseActions(text)` + `stripActionTags(text)` |
| 1084–1107 | `extractDocsText(doc)` — **top-level** shared utility (Google Docs JSON → plain text) |
| 1109–1233 | `classifyMessage(text)`, `inferActionFromMessage(text)` — AI routing + fail-safe |
| 1234–1349 | `AuthModal` component |
| 1350–1447 | `ConfirmationCard` component |
| 1448–1619 | Content display components: `ContentCard`, `FlashcardDisplay`, `QuizDisplay`, `GenericContentDisplay`, `ContentTypeRouter` |
| 1620–1808 | `DailyBriefCard` component |
| 1809–2103 | `GoogleImportModal` — calendar/docs/PDF import tabs |
| 2104–2275 | `SchedulePeek` — slide-up panel with today's blocks, overdue tasks, upcoming |
| 2276–2544 | `NotesPanel` — reference notes viewer/editor with fullscreen mode |
| 2545–2552 | `Toast` notification component |
| 2553–3816 | **`App()` main component** — all state declarations, all logic, all JSX rendering |

---

## App() State Variables (line ~2556)

**Data stores:** `tasks`, `blocks` (`{recurring[], dates{}}`), `notes`, `events`, `messages`, `weatherData`

**UI flags:** `isLoading`, `chatError`, `pendingActions`, `pendingContent`, `showPeek`, `showNotes`, `toastMsg`, `syncStatus`, `contentGenUsed`

**Google OAuth:** `googleToken`, `googleExpiry`, `googleUser`, `showGoogleModal`, `googleClientRef` (ref)

**Calendar sync:** `calSyncEnabled`, `calSyncStatus`, `calSyncLastAt`, `calSyncCount`, `calSyncError`

**Daily Brief:** `dailyBrief`, `briefRequestedRef` (ref — prevents double-trigger)

**Chat:** `input`, `pendingPhoto`, `lightboxUrl`, `viewingSavedChatId`, `savedChats`

**Auth:** `user`, `dataLoaded`, `authChecked`

---

## AI Routing — `classifyMessage()` (line 1109)

Checked in order:

1. **Content gen keywords** (`flashcard|outline|summar|study\s*plan|quiz|practice|project\s*breakdown`) → Gemini 2.5 Flash, 4096 tokens, `isContentGen:true`
2. **Notes reference** (`notes?|reference|look\s*up|from\s+(my|the)\s+(pdf|doc|notes?)`) → Gemini, 2048 tokens
3. **Action signals** (huge regex: date words, school items, 25+ remove slang words, scheduling verbs, subject abbrevs, activity names) → Gemini, 1024 tokens
4. **Everything else** → Groq Llama 3.1 8B Instant, 1024 tokens (lean prompt, **no task list** — Llama hallucinates tasks)

---

## Action System

AI embeds JSON inside `<action>{...}</action>` tags at end of response. Frontend pipeline:
```
parseActions(rawContent)  →  resolution pipeline  →  ConfirmationCard or auto-execute  →  executeAction()
```

### Action Types

| Type | Confirm? | What it does |
|---|---|---|
| `add_task` | Yes | Creates task in state + DB |
| `add_event` | Yes | Creates event (dedup: same title+date → skip) |
| `add_block` | Yes | Adds time slots to schedule |
| `break_task` | Yes | Creates multiple subtasks from parent |
| `complete_task` | Auto | Marks done + sets `completedAt` |
| `update_task` | Auto | Updates title/due/estTime |
| `delete_task` | Yes | Resolved by title → removed from state + DB |
| `delete_event` | Yes | Resolved by title → removed from state + DB |
| `update_event` | Yes | Resolved by title → updates date/type |
| `delete_block` | Yes | Removes time slots (null-writes) |
| `add_note` | Auto | Appends to existing tab or creates new |
| `create_flashcards` | Content card | Interactive flip-card deck |
| `create_quiz` | Content card | Multiple-choice with scoring |
| `create_outline` / `create_summary` / `create_study_plan` / `create_project_breakdown` | Content card | Formatted display |

### Resolution Pipeline (delete/update)

AI sends title string → `resolveEvent(title, events)` or `resolveTask(title, tasks)` → `normalize()` expands teen abbrevs → `matchScore()` fuzzy match (100=exact, 80=contains, 70=reverse, 30-70=word overlap) → enriches action with real ID. If no match found → `resolutionFailed=true` → **AI's "got it!" response is suppressed** (prevents contradicting the error).

---

## Daily Brief System

Auto-triggers on fresh session when Google is connected and chat is empty.

| Function | Line | What it does |
|---|---|---|
| `getMorningContext()` | 3125 | Fetches today's Google Calendar events (with descriptions + attachments), scans for Doc IDs via regex, fetches first 3000 chars of each linked doc |
| `generateDailyBrief()` | 3195 | Single Gemini call → parses `DAILY_BRIEF` JSON: `{type, summary, schedule_items, plan_of_action, dropdown_options, encouragement}` |
| `DailyBriefCard` | 1623 | Renders brief as card; dropdown quick-actions call `sendChip()` to start chat |

**Trigger:** `useEffect` at line ~3268 fires when `dataLoaded && isGoogleConnected() && messages.length === 0 && !briefRequestedRef.current && !viewingSavedChatId`.

**Reset:** `exitSavedChatView()` and saved chat deletion both reset `dailyBrief` + `briefRequestedRef`.

---

## Google Integration

**OAuth flow:** `connectGoogle()` → `googleClientRef.current.requestAccessToken()` → callback stores token in state + `sessionStorage`

**`isGoogleConnected()`** (line 2746): `!!googleToken && googleExpiry > Date.now()`

**Scopes:** `calendar.events`, `documents`, `docs`, `userinfo.email`

**API endpoints used:**
- Calendar: `https://www.googleapis.com/calendar/v3/calendars/primary/events`
- Docs: `https://docs.googleapis.com/v1/documents/{id}`

**Docs tab:** Text input for pasting URL or ID. `parseDocId(input)` extracts the ID from a URL or treats raw alphanumeric string as ID. No Drive Picker (removed).

**`extractDocsText(doc)`** (line 1084): Top-level utility. Walks `doc.body.content`, extracts text from paragraphs + tables. Shared by `importDoc()` and `getMorningContext()`.

---

## Database Schema

**Supabase project:** `evqylqgkzlbbrvogxsjn` | All tables have RLS (`auth.uid() = user_id`)

| Table | Key columns |
|---|---|
| `profiles` | `id`, `content_gen_count`, `content_gen_date` |
| `tasks` | `id`, `title`, `subject`, `due_date`, `est_time`, `status`, `focus_minutes`, `completed_at` |
| `events` | `id`, `title`, `event_type`, `subject`, `event_date`, `recurring`, `google_id`, `source` |
| `notes` | `id`, `name`, `content`, `source` (`pdf`/`google_docs`/`ai`), `updated_at` |
| `chat_messages` | `id`, `role`, `content`, `photo_url`, `created_at` |
| `recurring_blocks` | `id`, `name`, `category`, `start_time`, `end_time`, `days[]` |
| `date_blocks` | `id`, `block_date`, `time_slot`, `name`, `category` |
| `content_generations` | `id`, `user_id`, `count`, `date` |

**camelCase ↔ snake_case:** `dueDate↔due_date`, `estTime↔est_time`, `completedAt↔completed_at`, `event.date↔event_date`, `event.type↔event_type`

---

## Edge Function (`/functions/v1/sos-chat`)

- Routes to **Groq** (Llama 3.1 8B Instant) or **Gemini 2.5 Flash** based on `provider` field in POST body
- Gemini failure → fallback to Groq Llama 3.3 70B Versatile
- Rate-limits content gen: 5/day per user (tracked in `content_generations`)
- Required secrets: `GROQ_API_KEY`, `GEMINI_API_KEY`
- Deploy: `supabase functions deploy sos-chat`

---

## Key Functions Quick Reference

| Function | Line | Purpose |
|---|---|---|
| `loadAllFromSupabase(userId)` | 576 | Bulk-loads all tables in parallel on login |
| `normalize(str)` | 628 | Lowercase + expand teen abbrevs (calc→calculus) |
| `matchScore(query, target)` | 639 | String similarity: 100=exact, 80=contains, 30-70=word overlap |
| `resolveEvent(nameOrId, events)` | 655 | Fuzzy title → real event object |
| `resolveTask(nameOrId, tasks)` | 670 | Fuzzy title → real task object |
| `buildSystemPrompt(...)` | 822 | Tier 1: lean ~10 lines. Tier 2: full ~150 lines with actions |
| `parseActions(text)` | 1074 | Extracts `<action>{JSON}</action>` tags |
| `extractDocsText(doc)` | 1084 | Google Docs JSON → plain text (top-level shared) |
| `classifyMessage(text)` | 1109 | Returns `{provider, model, tier, isContentGen, maxTokens}` |
| `inferActionFromMessage(text)` | 1135 | Fail-safe client-side action parser |
| `isGoogleConnected()` | 2746 | `!!googleToken && googleExpiry > Date.now()` |
| `syncOp(fn)` | 2784 | Wraps DB writes with saving/saved/error indicator |
| `executeAction(action)` | 2802 | Executes action: updates React state + Supabase sync |
| `syncCalendar()` | 3029 | Auto-sync: fetches 14 days of Google Calendar events |
| `getMorningContext()` | 3125 | Fetches today's events + linked Google Docs text |
| `generateDailyBrief()` | 3195 | Single Gemini call → DAILY_BRIEF JSON |
| `sendMessage(text)` | 3363 | Core: classify → prompt → POST edge fn → parse actions → render |
| `sendChip(text)` | 3523 | Shortcut: sends chip text as a message |

---

## Component Map

| Component | Line | What it renders |
|---|---|---|
| `AuthModal` | 1237 | Supabase email/password auth screen |
| `ConfirmationCard` | 1353 | Editable action confirmation before executing |
| `ContentCard` | 1451 | Wrapper card for generated content |
| `FlashcardDisplay` | 1471 | Interactive flip-card deck |
| `QuizDisplay` | 1503 | Multiple-choice quiz with scoring |
| `GenericContentDisplay` | 1569 | Outlines, summaries, study plans, project breakdowns |
| `ContentTypeRouter` | 1601 | Routes `pendingContent` to correct display component |
| `DailyBriefCard` | 1623 | Daily brief: schedule, plan, quick-actions dropdown |
| `GoogleImportModal` | 1812 | Calendar/Docs/PDF import tabs |
| `SchedulePeek` | 2107 | Slide-up panel: today's blocks, overdue tasks, upcoming |
| `NotesPanel` | 2279 | Reference notes viewer/editor with fullscreen |
| `App` | 2556 | Root component: header, chat area, input, all panels |

---

## Critical Gotchas

1. **No build step** — Babel transpiles JSX at runtime. Never use `import`/`require`/ES module syntax.
2. **Single file only** — All components, state, and logic must stay in `index.html`.
3. **Blocks use 2 DB tables** — `recurring[]` → `recurring_blocks`, `dates{}` → `date_blocks`. The reconstruction in `loadAllFromSupabase` is fragile.
4. **`extractDocsText` is top-level** — shared by `importDoc()` and `getMorningContext()`. Do NOT duplicate it inside components.
5. **PDF.js must be v3 UMD** — v4 uses ESM, breaks Babel setup.
6. **Google OAuth origin-locked** — only works from the two authorized Netlify/GitHub Pages origins. `file://` always fails.
7. **`briefRequestedRef`** — prevents daily brief double-trigger. Always check before calling `generateDailyBrief()`.
8. **`resolutionFailed` suppresses AI response** — when delete/update can't find the entity, AI's "got it!" is hidden. Don't remove this flag.
9. **Llama gets no task list** — intentional. Llama 8B hallucinates specific tasks from lists. Tier 1 prompt is deliberately lean.
10. **Dedup on event add** — `add_event` checks same title+date already in state. Google Calendar import also deduplicates.

---

## How to Add Things

### New action type
1. Add schema to `buildSystemPrompt()` tier 2 section (line ~969)
2. Add case to `executeAction()` (line 2802) — update state + `syncOp(() => dbUpsert...)`
3. Add to `ConfirmationCard` editable fields if needs confirmation
4. Add trigger phrases to `classifyMessage()` action signals regex if needed

### New content display type
1. Add case to `ContentTypeRouter` (line 1601)
2. Create display component (wrap in `ContentCard`, format data, expose `onSave`/`onDismiss`)
3. Tell Gemini the JSON schema in `buildSystemPrompt()` content gen section

### New UI panel
1. Add `useState` flag (e.g., `showMyPanel`) in App state
2. Add toggle button in header bar or quick chips
3. Render conditionally in App return JSX (follow `SchedulePeek`/`NotesPanel` pattern)

---

## Stale Documentation

`SOScontext.md` exists but is **outdated** — references removed file name (`command-center.html`), deleted Google Drive Picker, old OAuth scopes (`documents.readonly`, `drive.readonly`), wrong line numbers (~2700 vs actual 3816). **Use this `CLAUDE.md` as the source of truth.**

---

*Last updated: March 2026. If the line counts in this file drift significantly (>100 lines) from `index.html`, re-scan the section headers to update the map.*
