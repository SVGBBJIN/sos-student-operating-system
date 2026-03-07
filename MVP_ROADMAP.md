# SOS — Student Operating System: MVP Roadmap

> **MVP Definition:** The minimum product that lets a student sign up, tell SOS what's on their plate, and trust it to keep them on track — all through conversation.

---

## Current State (What's Already Built)

| Area | Status |
|---|---|
| Chat UI with dark design system | ✅ Done |
| Multi-model AI routing (Groq Llama + Gemini 2.5 Flash) | ✅ Done |
| Natural language task/event creation via AI actions | ✅ Done |
| Fuzzy name resolution for delete/update (resolveEvent, resolveTask) | ✅ Done |
| Google Calendar sync (14-day auto-import, dedup) | ✅ Done |
| Google Docs + Drive PDF import | ✅ Done |
| Content generation: flashcards, quizzes, outlines, study plans | ✅ Done |
| Schedule peek panel (today, overdue, upcoming) | ✅ Done |
| Supabase auth + full data persistence | ✅ Done |
| Voice input UI + sos-voice Whisper backend | ✅ Done |
| Collapsible sidebar + settings page shell | ✅ Done |
| PWA manifest | ✅ Done |
| Vite build infrastructure | ✅ Done |

---

## Phase 0 — Foundation Fixes (Pre-Launch Blockers)

These are bugs and structural issues that must be resolved before any real users touch the product.

### 0.1 Migrate Off CDN Babel Transpilation
**Problem:** `index.html` loads React, Supabase, and Babel via CDN `<script>` tags and compiles JSX in-browser at runtime. This is slow, fragile, and prevents code splitting.
**Goal:** Wire the existing Vite config to a proper `src/` entry point. Move all component code into `.jsx` files. Keep the same UI and logic — just change the build pipeline.
**Acceptance:** `npm run dev` serves the full app. `npm run build` produces an optimized `dist/`. No CDN Babel.

### 0.2 Fix `break_task` Parent Cleanup
**Problem:** When the AI uses `break_task`, the parent task is not auto-deleted. Students end up with a phantom parent and N subtasks.
**Goal:** After `break_task` executes and subtasks are created, auto-execute a `delete_task` on the parent, or add it to the confirmation card batch so it's removed in the same step.

### 0.3 Wire Voice Input to `sos-voice` Backend
**Problem:** The voice recording UI and `sos-voice` Whisper edge function both exist independently. It's unclear if they are connected end-to-end.
**Goal:** Confirm the full path works: tap mic → record → send audio blob to `/functions/v1/sos-voice` → receive transcript → auto-populate chat input and send. Test on mobile (Chrome + Safari).

### 0.4 Consolidate to One API Route
**Problem:** Two parallel backend implementations exist: `supabase/functions/sos-chat/index.ts` (Supabase Edge Function) and `api/chat.js` (Vercel serverless). These can diverge.
**Goal:** Pick one as the canonical route. If deploying to Vercel, use `api/chat.js` as primary. Document which is active and remove or deprecate the other.

---

## Phase 1 — Core Loop (Week 1–2)

The "aha moment" for a student must be: *I told SOS what I have to do, and it handled it.* Phase 1 ensures this loop is tight and reliable.

### 1.1 Onboarding Flow
New users currently land in an empty chat with no guidance.
- Show a short onboarding screen on first login (3–4 steps max): name, school year, connect Google Calendar (optional), one example message.
- Persist `onboarded: true` to the `profiles` table so it only shows once.
- The example message should be pre-typed into the input to lower the barrier to the first action.

### 1.2 Empty State in Chat + Peek Panel
When a student has no tasks and no events:
- Show a welcoming empty state in the chat (not a blank screen).
- Peek panel should show an encouraging "you're all clear" state, not nothing.
- Suggest a first action: "Try: 'I have a bio test Friday and a history essay due next Tuesday'"

### 1.3 Smarter Confirmation Cards
Confirmation cards are the main trust-building moment. Make them clearer:
- Show exactly what will change: task name, due date, estimated time.
- For `add_event` vs `add_task`, make the type visually distinct (calendar icon vs checklist icon).
- Add a quick-edit inline on the card (e.g., tap the date to correct it before confirming).

### 1.4 Persistent Chat History
Chat messages are stored in Supabase (`chat_messages` table) but the load behavior on return visits needs to be confirmed.
- On app load, fetch the last 30 messages and hydrate the chat.
- Show a subtle "earlier in conversation" separator when history is loaded.
- Ensure the AI's context window gets recent history (not just current session).

---

## Phase 2 — Intelligence Layer (Week 2–3)

Phase 2 makes SOS feel like it's actually managing things on the student's behalf — not just recording them.

### 2.1 Proactive Overdue Nudges
When a student opens the app and has overdue tasks, SOS should say something about it — not wait to be asked.
- On app load, if `overduePeekTasks.length > 0`, inject a system message like: *"Hey — looks like [Math HW] is overdue. Want me to move it or mark it done?"*
- Keep this non-nagging: only trigger once per session, and only if the student hasn't interacted in 6+ hours.

### 2.2 Schedule Block Auto-Suggestion
When a student adds a task with a deadline, SOS should offer to block study time.
- After `add_task` confirms, if `estTime` is set, follow up: *"Want me to block [estTime] hours before [dueDate] to work on this?"*
- This drives `add_block` actions and makes the schedule feel managed.

### 2.3 Sleep Protection
Core to the SOS vision: never schedule work during sleep hours.
- Add a `sleepTime` and `wakeTime` setting to the `profiles` table (default: 11pm–7am).
- Surface these fields in the Settings panel.
- In the system prompt, pass today's sleep window to Gemini. Add a rule: "Never place study blocks or reminders inside the user's sleep window."
- If the AI tries to schedule something at 2am, the frontend should block it and rephrase.

### 2.4 Recurring Event Pattern Detection
Students have predictable schedules (practice every Tuesday, quiz every Friday).
- After a user manually adds 2+ events with the same title on the same weekday, prompt: *"Looks like you have [Soccer Practice] every Tuesday — want me to auto-add these?"*
- This reduces friction for weekly commitments and makes the schedule feel intelligent.

### 2.5 Bump / Reschedule Overloaded Days
When adding a task would create a day with more work than available time:
- Detect overload: sum `estTime` of tasks due on the same day vs. available waking hours minus existing blocks.
- If overloaded, suggest: *"Thursday's looking packed. Want me to move [Essay Draft] to Wednesday instead?"*
- This is the "automatic reallocation" behavior from the product vision.

---

## Phase 3 — Retention & Stickiness (Week 3–4)

Phase 3 adds the features that make students come back every day.

### 3.1 Push Notifications (PWA)
Students need to be reminded outside the app.
- Implement Web Push via the PWA service worker.
- Store push subscription endpoints in Supabase.
- Send reminders from a Supabase scheduled job (pg_cron or Edge Function cron):
  - 24 hours before a task is due
  - Morning summary: "You have 3 things due today"
- Let students configure notification preferences in Settings.

### 3.2 Daily Digest Message
At the start of each session, inject a brief AI-generated day summary at the top of chat:
- What's due today, what's overdue, what's coming up in 48 hours.
- Keep it short (3–4 lines). Use Tier 1 (Llama) to keep cost low.
- Only show if the student hasn't seen one in the last 12 hours.

### 3.3 Raise Content Generation Rate Limit
Current limit: 3 content generations/day. This is too low for a student doing active study sessions.
- Raise to 10/day.
- Add a soft warning at 8/day ("2 generations left today") so students aren't surprised.
- Track usage visibly in the Settings panel.

### 3.4 Settings Panel — Complete the Shell
The settings page exists but needs its features wired up:
- Sleep window (wakeTime, sleepTime) — feeds Phase 2.3
- Notification preferences (on/off, quiet hours)
- Content generation limit display
- Google Calendar sync toggle + last-synced timestamp
- Account info (email, sign out)
- Data export (download tasks + events as JSON)

### 3.5 Mobile UX Polish
SOS will primarily be used on phones. Audit and fix:
- Chat input stays above the keyboard on iOS (requires `visualViewport` listener).
- Peek panel drag-to-open gesture feels native.
- Voice button is thumb-reachable.
- All modals are full-screen on small screens.
- No horizontal scroll anywhere.

---

## Phase 4 — Launch Readiness

### 4.1 Error Boundary + Fallback UI
If Gemini fails (503, rate limit) or Supabase is down, the app currently shows nothing.
- Add React error boundaries around the chat and peek panel.
- Show a user-friendly message: *"Having trouble reaching my brain — try again in a sec."*
- The Gemini → Groq 70B fallback in the edge function already handles AI failures; make sure it's deployed and active.

### 4.2 Analytics (Minimal)
Track only what's needed to understand retention:
- `session_started` — user opened the app
- `message_sent` — user sent a chat message
- `action_confirmed` — user confirmed an AI action
- `content_generated` — flashcards/quiz/etc. used

Use a lightweight self-hosted solution (Plausible, or just a `analytics_events` Supabase table). No third-party tracking scripts.

### 4.3 Privacy + Terms Pages
Both pages (`privacy.html`, `terms/`) already exist in the repo. Verify they are accurate and linked from the app footer/settings.

### 4.4 Deploy Checklist
- [ ] Supabase Edge Functions deployed: `sos-chat`, `sos-voice`
- [ ] Environment secrets set: `GROQ_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Google OAuth authorized origins updated for production domain
- [ ] Content generation rate-limit table (`content_generations`) migrated
- [ ] PWA service worker registered and tested on Android + iOS
- [ ] `vercel.json` routes configured correctly for SPA + API functions

---

## Out of Scope for MVP

The following are deliberately deferred to post-MVP to keep scope tight:

- **Collaborative features** (shared task lists, study groups)
- **LMS integrations** (Canvas, Google Classroom auto-import)
- **Grade tracking**
- **Cross-device calendar write-back** (SOS creating events on Google Calendar, not just reading)
- **Native mobile app** (iOS/Android)
- **Custom AI personas / tone settings**

---

## Priority Summary

| Priority | Phase | Item |
|---|---|---|
| P0 | 0.1 | Migrate off CDN Babel → Vite proper |
| P0 | 0.2 | Fix break_task parent cleanup |
| P0 | 0.3 | Wire voice input end-to-end |
| P0 | 0.4 | Consolidate API routes |
| P1 | 1.1 | Onboarding flow |
| P1 | 1.2 | Empty states |
| P1 | 1.3 | Smarter confirmation cards |
| P1 | 1.4 | Persistent chat history |
| P2 | 2.1 | Proactive overdue nudges |
| P2 | 2.2 | Schedule block auto-suggestion |
| P2 | 2.3 | Sleep protection |
| P2 | 2.4 | Recurring event detection |
| P2 | 2.5 | Overloaded day detection + bump |
| P3 | 3.1 | Push notifications |
| P3 | 3.2 | Daily digest message |
| P3 | 3.3 | Raise content gen limit |
| P3 | 3.4 | Complete Settings panel |
| P3 | 3.5 | Mobile UX polish |
| P4 | 4.1 | Error boundaries + fallback UI |
| P4 | 4.2 | Minimal analytics |
| P4 | 4.3 | Privacy/terms audit |
| P4 | 4.4 | Deploy checklist |
