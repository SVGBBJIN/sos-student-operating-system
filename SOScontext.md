
Student Operating System, a chat-first AI companion that replaces manual forms with a sleek conversational interface where all events and tasks are created through natural language (e.g., "Help me with a science project due Thursday") and intelligently parsed into structured scheduling data with brief confirmation summaries and easy correction prompts to ensure reliability; keep the current calendar infrastructure and integrations intact but move them behind the scenes so the traditional grid becomes invisible to users, and redesign the AI to adopt a chill, supportive friend personality focused on optimizing schedules, reducing stress, protecting sleep, predicting recurring events, breaking large tasks into manageable sessions, and automatically reallocating missed or overloaded work in a calm, collaborative way — positioning SOS not as a planner, but as a student-focused operating layer that manages time intelligently and adaptively through conversation.



---

## Architecture Overview

**File:** `command-center.html` (~2700 lines) — single-file React 18 app using Babel CDN transpilation. Everything lives here: state, UI, AI routing, action execution, DB sync.

**Backend:** Supabase Edge Function at `/functions/v1/sos-chat` (`supabase/functions/sos-chat/index.ts`)

**AI Providers:**
- **Tier 1 — Groq (Llama 3.1 8B Instant):** Pure chat, no action signals detected. Gets a *lean* prompt with no task list. Fast, cheap.
- **Tier 2 — Google Gemini 2.5 Flash:** Any message with scheduling/task/removal signals. Gets the full prompt with all tasks, events, action definitions. Handles all calendar/task mutations.
- **Tier 2 content gen — Gemini 2.5 Flash (4096 tokens):** Flashcards, outlines, quizzes, summaries, study plans, project breakdowns.

**Google OAuth:** Token client via `window.google.accounts.oauth2` for Calendar/Docs/Drive read access. Client ID: `504839570150-i4s8urseqgrjucbhqfjc9phiavrcn08d.apps.googleusercontent.com`. Authorized JS origins: `https://lucky-pika-26ed5b.netlify.app` and `https://svgbbijn.github.io` (set in Google Cloud Console). Google Drive Picker API enabled — `gapi.js` loaded via CDN, `GOOGLE_PICKER_API_KEY` constant near top of script (optional). ✅ **Working** — OAuth flow, Calendar auto-sync + manual import, Google Docs import (Docs API), Drive PDF import via Picker, user email display.

---

## Data Flow

```
User message
  → classifyMessage(text)        — regex decides Tier 1 (Llama) or Tier 2 (Gemini)
  → buildSystemPrompt(tier)      — lean prompt for Llama, full prompt for Gemini
  → Supabase Edge Function POST  — routes to Groq or Gemini API server-side
  → rawContent returned
  → parseActions(rawContent)     — extracts <action>{...}</action> JSON tags
  → Resolution pipeline          — resolveEvent/resolveTask translates AI titles → real IDs
  → needsConfirm / autoExec split
  → ConfirmationCard shown OR executeAction() called immediately
  → executeAction() updates React state + fire-and-forget Supabase sync
```

---

## Key Functions (with line numbers as of latest build)

| Function | Location | What it does |
|---|---|---|
| `buildSystemPrompt(tasks, blocks, events, notes, tier)` | GoogleImportModal | Builds AI context. `tier=1` → lean Llama prompt (no task list). `tier=2` → full Gemini prompt with actions. |
| `classifyMessage(text)` | App | Regex classifier. Returns `{provider, model, tier, isContentGen, maxTokens}`. |
| `normalize(str)` | App (top) | Lowercases + expands teen abbreviations (calc→calculus, bio→biology, etc.) |
| `matchScore(query, target)` | App (top) | Scores string similarity: 100=exact, 80=contains, 70=query contains target, 30-70=word overlap |
| `resolveEvent(nameOrId, eventsList)` | App (top) | Fuzzy-matches AI title to real event. Returns event object or null. |
| `resolveTask(nameOrId, tasksList)` | App (top) | Same for tasks. |
| `executeAction(action)` | App | Executes confirmed actions. Updates React state + syncs to Supabase. |
| `inferActionFromMessage(text)` | App | Fail-safe: if Gemini returns no action tags, client-side parses user message to build a fallback add_event/add_task. |
| `loadAllFromSupabase(userId)` | App (top) | Bulk-loads all user data on login. |
| `migrateLocalStorage(userId)` | App | One-time migration of localStorage data to Supabase on first login. |
| `syncOp(fn)` | App | Wraps DB writes with saving/saved/error status indicator. |
| `openDrivePicker(mimeType, onPick)` | GoogleImportModal | Opens Google's native Drive file picker filtered by mimeType. Calls `gapi.load('picker')` then builds a `PickerBuilder`. Fires `onPick(fileId, fileName)` on selection. |
| `extractDocsText(doc)` | GoogleImportModal | Converts Google Docs API JSON response to plain text. Recursively walks `body.content` — handles paragraphs and tables. |
| `timeAgo(iso)` | GoogleImportModal | Converts ISO timestamp to friendly relative string ("just now", "3 min ago", "1 hr ago"). Used in calendar sync status card. |
| `syncCalendar()` | App | Fetches next 14 days of Google Calendar events and silently imports them (no toast, no modal close). Updates `calSyncLastAt` + `calSyncCount`. |
| `toggleCalSync()` | App | Flips `calSyncEnabled`, persists to `localStorage` key `sos_cal_sync`. |
| `handleImportGoogleEvents(gevents, silent)` | App | Imports Google Calendar events with dedup. `silent=true` skips toast + modal close, returns count — used by auto-sync. |

---

## The Action System

The AI embeds JSON inside `<action>...</action>` tags at the end of its response. The frontend parses them with a regex, routes them through the resolution pipeline, then either queues for confirmation or auto-executes.

### Action Types

| Type | Requires Confirm | What it does |
|---|---|---|
| `add_task` | ✅ | Creates a new task in state + DB |
| `add_event` | ✅ | Creates a new calendar event; dedup check (same title+date = skipped) |
| `add_block` | ✅ | Adds 30-min slots to date_blocks |
| `break_task` | ✅ | Creates multiple subtasks from one parent |
| `complete_task` | ❌ auto | Marks task done + sets completedAt timestamp |
| `update_task` | ❌ auto | Updates task title/due/estTime |
| `delete_task` | ✅ | Resolved by title via resolveTask(), then removes from state + DB |
| `delete_event` | ✅ | Resolved by title via resolveEvent(), then removes from state + DB |
| `update_event` | ✅ | Resolved by title via resolveEvent(), updates date/type, syncs to DB |
| `delete_block` | ✅ | Removes time slots from schedule (null-writes to date_blocks) |
| `add_note` | ❌ auto | Appends content to existing tab or creates new tab |
| `create_flashcards` | content card | Shows interactive flashcard UI |
| `create_quiz` | content card | Shows interactive quiz UI |
| `create_outline` / `create_summary` / `create_study_plan` / `create_project_breakdown` | content card | Shows formatted content card |

### Resolution Pipeline (critical — this is how delete/update actually works)

**The problem it solves:** Gemini doesn't know real event IDs. It sends `{"type":"delete_event","title":"Math Test"}`. The pipeline translates that title to the actual event object.

**Steps (in sendMessage(), ~line 2094):**
1. `resolveEvent(a.title, events)` → tries exact ID → scores all events by title similarity → returns best match ≥ 30 score
2. If match found → enriches action with real `event_id` and actual `title`
3. If no match → sets `resolutionFailed = true` → pushes "couldn't find that event" error message → **skips adding AI's response** (prevents "got it, removed!" contradicting the error)
4. Dedup check for `add_event`: if same title+date already exists in state → silently skip

### Why `resolutionFailed` suppresses the AI response

Before this fix, when an event couldn't be found, two messages appeared:
1. System: "hmm, I couldn't find that event"
2. AI: "got it, removed it! 🗑"

The flag ensures only the error shows when resolution fails.

---

## The Two System Prompts

### Tier 1 — Llama (lean, ~10 lines)
- Only gets: today's date, today's schedule blocks, completed-this-week count, and an `allClear` status
- **No task list.** Llama 8B hallucinates tasks when given a list — it confidently invents overdue items
- Has an explicit rule: "NEVER invent specific tasks, deadlines, or events"
- If `allClear` is true (no active tasks, no overdue, no upcoming events) → responds with upbeat "you're free, go enjoy yourself" message
- Does NOT output `<action>` tags (explicitly forbidden)

### Tier 2 — Gemini (full, ~150 lines)
- Gets everything: full task list with IDs, overdue tasks, today's schedule, week summary, upcoming events
- Has full action definitions, trigger phrase list, 9+ examples including slang
- Rules include: always generate action tags, never describe instead of doing, no duplicate events
- Action schemas: delete/update use only `title` — no IDs required (resolver handles it)

---

## classifyMessage() — How Routing Works

Located ~line 756. Checks in order:

1. **Content gen keywords** (flashcard, outline, summary, quiz, etc.) → Gemini + 4096 tokens + `isContentGen:true`
2. **Action signals regex** → huge regex covering:
   - Date words: mon/tue/fri/tmrw/today/tonight/next week/times with am/pm
   - School items: test/exam/quiz/hw/essay/project/lab/practice/game/etc.
   - **Remove slang (new):** cancel/remove/delete/clear/scratch/drop/ditch/wipe/axe/nix/scrap/erase/purge/yeet/bin/toss/dump/trash/strike/pull/cut/nevermind/forget + phrase patterns like "no longer", "called off", "scratch that"
   - Scheduling verbs: add/schedule/remind/mark/move/reschedule/push back/postpone/bump/finish/done
   - Subject abbreviations: calc/math/bio/chem/phys/eng/hist/sci/span/econ/psych/gov/geo/pe/gym
   - School activities: swim/debate/band/choir/track/soccer/basketball/football/etc.
   → Gemini + 1024 tokens
3. **Everything else** → Llama 8B + 1024 tokens

---

## SchedulePeek Panel (the slide-up "peek" panel)

The peek panel shows when user taps the schedule peek icon. Sections in order:
1. **Today's Schedule** — recurring blocks merged with date overrides, condensed into time ranges
2. **⚠️ Overdue (N)** — red section, only shows if `overduePeekTasks.length > 0`. Tasks where `daysUntil < 0`. Sorted most-overdue first.
3. **Upcoming Tasks (N)** — non-overdue active tasks, `daysUntil >= 0`, sorted by priority, max 5
4. **Upcoming Events** — events in next 7 days, max 4

Key useMemo variables in `SchedulePeek`:
- `overduePeekTasks` — `tasks.filter(t => status!=='done' && daysUntil(dueDate)<0)`
- `activeTasks` — `tasks.filter(t => status!=='done' && daysUntil(dueDate)>=0)` (only non-overdue)
- `upcomingEvents` — events in next 7 days

**Before this split:** Overdue tasks were mixed into the Tasks section with just a red dot indicator.

---

## Database Schema

**Supabase project:** `evqylqgkzlbbrvogxsjn` (East US)
**URL:** `https://evqylqgkzlbbrvogxsjn.supabase.co`

Tables: `profiles`, `tasks`, `recurring_blocks`, `date_blocks`, `events`, `notes`, `chat_messages` — all with RLS (`auth.uid() = user_id`).

**Data shape conversions (app ↔ DB):**
- `dueDate` ↔ `due_date`
- `estTime` ↔ `est_time`
- `focusMinutes` ↔ `focus_minutes`
- `completedAt` ↔ `completed_at`
- `date` (event) ↔ `event_date`
- `type` (event) ↔ `event_type`
- blocks split: `recurring[]` → `recurring_blocks` table, `dates{}` → `date_blocks` table

---

## Edge Function (`supabase/functions/sos-chat/index.ts`)

Routes to Groq or Gemini based on `provider` field in POST body.

- **`callGroq(model, systemPrompt, messages, maxTokens)`** → Groq API with `GROQ_API_KEY` secret
- **`callGemini(systemPrompt, messages, maxTokens)`** → Gemini API with `GEMINI_API_KEY` secret. Merges consecutive same-role messages (Gemini API requirement). If Gemini fails → fallback to `llama-3.3-70b-versatile` via Groq.
- **Rate limiting:** Content generation capped at 3/day per user. Tracked in `content_generations` table. Resets at midnight EST.

**Required Supabase secrets:**
- `GROQ_API_KEY`
- `GEMINI_API_KEY` = `AIzaSyDX8tiC9w0NHJpy0XZV7y6XZbNGMrzB5cQ`

---

## Known Issues / Fragile Spots

| Issue | Where | Notes |
|---|---|---|
| `<action>` tag parsing | `parseActions()` | Silently skips malformed JSON inside tags |
| `break_task` parent not deleted | AI response | AI is told to handle this in its text, but no auto-delete of parent |
| Blocks split across 2 DB tables | `loadAllFromSupabase()` | The reconstruction logic (`dates{}` object) is critical — don't touch without understanding both tables |
| Supabase Edge Function must be deployed manually | `supabase/functions/sos-chat/index.ts` | No fallback if not deployed |
| `resolveEvent` score threshold at 30 | `resolveEvent()` | Too-low threshold could match wrong event. Too-high could miss valid ones. |
| Gemini consecutive role merging | Edge Function `callGemini()` | First message must be `user`, same-role messages merged with newline separator |
| `SUBJECT_ALIASES` is static | `normalize()` | New subject abbreviations need to be manually added |

---

## Significant Changes Made (Conversation Log Summary)

### Multi-Model Architecture
- **Before:** Single Llama 8B model for everything. Didn't understand slang, sometimes described actions instead of doing them.
- **After:** 2-tier system. Gemini 2.0 Flash handles all scheduling/action messages. Llama 8B handles pure chat only. Edge function supports both providers with Gemini→Groq 70B fallback.

### Delete / Update Actions (missing, then built)
- **Before:** `delete_task`, `delete_event`, `update_event`, `delete_block` didn't exist. "Cancel my math test" was acknowledged but nothing happened.
- **After:** All 4 action types implemented in `executeAction()`, added to confirmation pipeline, added to system prompt with examples.

### Name Resolution System (the key fix for calendar reliability)
- **Before:** AI had to guess event IDs from the system prompt. Almost always wrong → silent failure.
- **After:** `resolveEvent()` and `resolveTask()` translate fuzzy names to real objects using scored fuzzy matching. AI just sends `{"type":"delete_event","title":"Math Test"}` — no ID needed.
- **`normalize()`** expands teen abbreviations before matching (calc→calculus, bio→biology)
- **`matchScore()`** returns 100 for exact, 80 for contains, 70 for reverse contains, 30-70 for word overlap

### Remove-Slang Coverage
- **Before:** Only "cancel/remove/delete/nevermind" triggered Gemini routing.
- **After:** 25+ slang words route to Gemini: scratch, drop, ditch, wipe, axe, nix, scrap, erase, purge, yeet, bin, toss, dump, trash, strike, pull, cut, forget, nevermind + phrase patterns (no longer, called off, scratch that, off the books).

### Error Message Override
- **Before:** When resolution failed, both the error message AND the AI's "got it, removed!" appeared — contradictory.
- **After:** `resolutionFailed` flag in `sendMessage()`. If set, the AI's `displayContent` is NOT added to messages. Only the error shows.

### Overdue UI Section
- **Before:** Overdue tasks mixed into Tasks list with a red dot.
- **After:** Separate red `⚠️ Overdue (N)` section in peek panel above "Upcoming Tasks". Uses `overduePeekTasks` useMemo (tasks where `daysUntil < 0`). "Tasks" section renamed "Upcoming Tasks" (only non-overdue).

### Llama Hallucination Fix + All-Clear Message
- **Before:** Llama received full task list → invented overdue tasks that didn't exist.
- **After:** `buildSystemPrompt(tier)` — when `tier=1`, returns lean prompt with NO task list. Just date, schedule, completed count. `allClear` flag triggers "you're free, go enjoy yourself" response when nothing is pending.

### Duplicate Event Prevention
- AI `add_event` actions: dedup check before queueing (same title+date → silently skip)
- Google Calendar import: dedup check before inserting (same title+date → skip, shows count of skipped)

### System Prompt Action Definition Simplification
- **Before:** Delete/update schemas included `event_id`/`task_id` fields → AI hallucinated random IDs.
- **After:** `delete_event: {"type":"delete_event","title":"..."}` — only title needed. Resolver does the rest.
- Rule added to prompt: "the system will find the right one automatically. You do NOT need to guess IDs."

### Google Integration — OAuth Fixed and Confirmed Working ✅
- **Problem:** `invalid_client` 401 error on every Google sign-in attempt.
- **Root cause 1:** Wrong OAuth Client ID was hardcoded in line 1714. The original ID (`504839570150-fcbm0mielfi0qd63qrqerktcko4hmp8h`) was from a different/old OAuth client — not the active "Client 1" in GCP.
- **Root cause 2:** When re-reading the correct ID from a low-res screenshot, 5 characters were misread (`B→8`, `o→q`, extra `a` at end, missing `r`). Correct ID was finally confirmed by copying directly from GCP Console text field.
- **Correct Client ID:** `504839570150-i4s8urseqgrjucbhqfjc9phiavrcn08d.apps.googleusercontent.com`
- **GCP setup (already done):** Authorized JavaScript Origins: `https://lucky-pika-26ed5b.netlify.app` + `https://svgbbijn.github.io`. Authorized Redirect URIs: `https://svgbbijn.github.io/sos-student-operating-system/` + `https://lucky-pika-26ed5b.netlify.app`.
- **Important:** Google OAuth will ONLY work when served from one of those two authorized origins. Opening the HTML file directly (`file://`) will always fail — must deploy to Netlify or GitHub Pages first.
- **What works now:** Connect/disconnect flow, Calendar event import (next 14 days, dedup by title+date), Google Docs import (via Drive export as plain text), Drive PDF import (via pdf.js), user email display after connect.

---

## Content Creation Layer

When student asks for study materials, Gemini generates a content action tag. The frontend routes these to dedicated UI components:
- `FlashcardDisplay` — interactive flip cards
- `QuizDisplay` — multiple choice with scoring
- `GenericContentDisplay` — outlines, summaries, study plans, project breakdowns

Content actions are separate from calendar actions — they go to `pendingContent` state, shown as content cards (not confirmation cards), and can be saved to Notes or dismissed.

Rate limit: 3 content generations per day per user. Tracked server-side in `content_generations` table. Resets at midnight EST.

---

## Deployment

See `edge-function-deploy.md` for full step-by-step.

Quick version:
1. `supabase login` + `supabase link --project-ref evqylqgkzlbbrvogxsjn`
2. `supabase secrets set GROQ_API_KEY=... GEMINI_API_KEY=...`
3. `supabase functions deploy sos-chat`

The HTML file is standalone — drag to Netlify Drop or push to GitHub Pages.
