# SOS Smart Calendar Engine — Handoff: Missing Features

**Branch shipped:** `claude/smart-calendar-engine-vpIi9` (PR #146)  
**Date:** 2026-05-18  
**Status of shipped branch:** Build ✅ · Vercel preview ✅ · Netlify in progress

This document covers every feature that was scoped, discussed, and explicitly deferred from the smart calendar engine branch. Each section describes the feature, its value to users, what already exists in the codebase that it can build on, and the concrete implementation work remaining.

---

## What shipped in PR #146

| Feature | Status |
|---------|--------|
| Behavioral telemetry (`task_events` table + `dbInsertTaskEvent` writes) | ✅ Shipped |
| Dynamic Priority Engine (`computePriority`, `rankTasks`, context injection) | ✅ Shipped |
| Intent-Based Scheduling (`plan_intent` action + 3-pass pipeline) | ✅ Shipped |
| Supabase migration (`20260518_task_events.sql`) | ✅ Shipped (needs `supabase db push`) |

---

## Feature 1 — Mode System

### What it is
A named operating mode (e.g. "Deep Work", "Exam Crunch", "Recovery") that modifies the AI's scheduling personality and suggestion behavior. In Deep Work mode the AI avoids fragmenting the calendar; in Exam Crunch it surfaces only high-priority tasks; in Recovery it avoids overloading the user.

### User value
Students have radically different contexts day-to-day. A mode toggle lets the engine serve both "I have 6 hours to study" and "I'm burned out, give me easy wins" without the user having to re-explain every time.

### What already exists to build on
- `workspaceContext` string is already threaded from the client through `streamChat.js` → `api/chat.ts` → `assembleContext`. Today it carries values like `"chat"` or `"studio"`. A mode string can be added alongside it.
- `assembleContext` in `shared/ai/context/assembler.ts` already has a pinned-sections pattern — mode context can be a new pinned section.
- `INTENT_PLAN_REGEX` pattern in `src/App.jsx` shows how a regex can detect intent from the message.

### Implementation sketch
1. **Schema**: add `ModeActivateSchema` to `shared/ai/schemas/actions.ts`:
   ```ts
   z.object({
     type: z.literal("activate_mode"),
     mode: z.enum(["deep_work", "exam_crunch", "recovery", "balanced"]),
     duration_hours: z.number().int().min(1).max(24).optional(),
   })
   ```
2. **State**: store `activeMode: string | null` in `src/App.jsx` React state.
3. **Context injection**: `assembleContext` receives `activeMode` and prepends a ≤30-token mode hint (e.g. `"ACTIVE MODE: deep_work — avoid fragmented scheduling, prefer 90-min blocks"`).
4. **Client**: `executeAction` case `'activate_mode'` sets state + shows a toast. Mode auto-expires after `duration_hours` via a `setTimeout` that nulls the state.
5. **Router**: no new tier needed — `activate_mode` routes through the existing `action_routing` flash tier.

### Open questions
- Should mode persist across sessions (stored in Supabase user preferences) or be session-only?
- Does mode affect `plan_intent` pipeline behavior, or only real-time chat suggestions?

---

## Feature 2 — Smart Recovery / Schedule Compression

### What it is
When the user has missed tasks or is behind, the AI detects the debt and proposes a compressed recovery schedule — collapsing low-priority tasks, rescheduling overdue items, and generating a realistic catch-up plan.

### User value
The most stressful student moment is staring at a backlog. Automatic recovery planning turns "I'm behind" into a concrete action list without the user having to triage manually.

### What already exists to build on
- `task_events` table (shipped in PR #146) already captures `postpone` and `abandon` events — these are the primary signal for debt detection.
- `postpone_count` column on `tasks` (shipped) is a ready-made debt gauge.
- `rankTasks` in `shared/scheduling/priority.ts` (shipped) already scores urgency; overdue tasks already receive `urgency = 1.0`.
- The planning pipeline (`shared/ai/pipelines/planning.ts`) provides the 3-pass draft→critique→refine pattern to copy.

### Implementation sketch
1. **Debt signal**: add `computeScheduleDebt(tasks: TaskForScoring[], now: Date)` to `shared/scheduling/priority.ts` — returns `{ overdue_count, total_postpone_days, high_priority_overdue }`.
2. **New action**: `RecoverScheduleSchema` in `shared/ai/schemas/actions.ts`:
   ```ts
   z.object({
     type: z.literal("recover_schedule"),
     horizon_days: z.number().int().min(1).max(14).optional(),
   })
   ```
3. **Pipeline**: `shared/ai/pipelines/recovery.ts` — mirrors `intent_plan.ts`. Draft pass gets debt signal injected. Critique checks that the compressed plan is achievable. Output schema reuses `MakeIntentPlanSchema` with a `compress: true` flag added.
4. **Trigger**: add `recovery_needed` detection to `sendMessage` — if `overdue_count >= 3` or any `high_priority_overdue`, inject a soft nudge into the system prompt suffix.

### Open questions
- Should recovery propose task deletions (reducing scope) or only rescheduling?
- How to handle tasks the user intentionally left undone vs. genuinely forgot?

---

## Feature 3 — Cognitive Load Awareness

### What it is
The engine estimates the cognitive demand of a schedule by weighting tasks by subject-switching cost, estimated time, and time-of-day fit from the behavioral histogram. It warns the user when a day is overloaded and suggests spreading work.

### User value
Students chronically underestimate cognitive switching cost. A "this day is overloaded" warning before it happens is more useful than a post-mortem.

### What already exists to build on
- `time_of_day_histogram` in `BehavioralSignals` (shipped in `shared/ai/signals/behavioral.ts`) — 24 buckets of historical completion times by hour.
- `blockedMinutesOnDate` in `CalendarDensity` (shipped in `shared/scheduling/priority.ts`) — calendar-side load already computed.
- `deadline_density` factor in `computePriority` (shipped) — day-level crowding already modelled.

### Implementation sketch
1. **Cognitive load scorer**: add `computeDailyLoad(tasks: TaskForScoring[], density: CalendarDensity, signals: BehavioralSignals, date: string): { load_score: number; overloaded: boolean; explanation: string }` to `shared/scheduling/priority.ts`.
   - `load_score` = sum of `(estTime * subject_switch_penalty * time_of_day_mismatch)` across tasks due that day.
   - `subject_switch_penalty` = 1.2 for each unique subject change in the day's task sequence.
   - `time_of_day_mismatch` = inverse of histogram bucket weight for the proposed slot.
2. **Context injection**: `assembleContext` appends a "Load forecast" section when `overloaded = true` for any day in the next 3 days (≤40 tokens).
3. **No new action needed** — this is purely advisory context; the existing AI will surface it conversationally.

### Open questions
- Is subject-switch penalty computable without explicit scheduling times (most tasks only have a due date, not a start time)?
- Should load warnings appear proactively as a DynamicIsland notification, or only when the user asks?

---

## Feature 4 — Friction Detection

### What it is
The engine identifies tasks the user repeatedly postpones or starts-then-abandons and surfaces them as "friction tasks" — proactively suggesting decomposition, delegation, or deletion.

### User value
Procrastination is the #1 student productivity failure. Naming the stuck task and offering a concrete next action (break it into 3 subtasks, drop it, ask for help) breaks the avoidance loop.

### What already exists to build on
- `postpone_count` on `tasks` (shipped) is the primary signal.
- `recent_abandons` in `BehavioralSignals` (shipped) captures abandonment history.
- `friction` factor in `computePriority` (shipped) — already raises score for high-postpone tasks; can be inverted to a "friction flag".
- `task_events` table captures the full postpone/abandon timeline.

### Implementation sketch
1. **Friction classifier**: add `classifyFriction(task: TaskForScoring, signals: BehavioralSignals): { is_friction: boolean; reason: string; suggestions: string[] }` to `shared/scheduling/priority.ts`.
   - `is_friction = postponeCount >= 2 || subject in recent_abandons`.
   - `suggestions` = heuristic list: `["Break into 3 subtasks", "Schedule a 25-min start block", "Ask for help or drop it"]`.
2. **Context injection**: `assembleContext` appends a "Friction tasks" section listing up to 2 flagged tasks with their `reason` (≤60 tokens).
3. **New action** (optional): `SuggestDecompositionSchema` — AI calls this to break a friction task into subtasks, which `executeAction` handles as a batch `add_task`.

### Open questions
- When does a task stop being a friction task after the user acts on it? (Reset on first `complete` or `update` event after flag?)
- Should friction suggestions appear unsolicited, or only when the user asks about a specific task?

---

## Feature 5 — Smart Habit Anchoring

### What it is
The engine detects when a user consistently does the same activity at the same time (from behavioral signals) and offers to "anchor" it as a recurring block — making the implicit schedule explicit.

### User value
Students have de facto routines they haven't formalized. Anchoring them into the calendar makes them defensible against ad-hoc scheduling pressure.

### What already exists to build on
- `time_of_day_histogram` in `BehavioralSignals` (shipped) — peaks in this histogram are candidate anchor times.
- `add_recurring_event` action in `executeAction` (existing, used by `plan_intent`) — the materialization path already exists.
- `median_hours_to_complete` by subject in `BehavioralSignals` (shipped) — can seed the duration estimate for the anchor block.

### Implementation sketch
1. **Anchor detector**: new function `detectHabitAnchors(signals: BehavioralSignals): Array<{ activity: string; hour: number; confidence: number }>` in `shared/ai/signals/behavioral.ts`.
   - Uses `time_of_day_histogram` peaks (local maxima above 2× mean) combined with `median_hours_to_complete` by subject.
   - Confidence = (peak_height / histogram_mean) capped at 1.
2. **Context injection**: if any anchor has `confidence >= 0.7`, `assembleContext` appends a ≤40-token "Detected habits" section (e.g. `"You consistently study chem Tue/Thu 8–10 AM."`).
3. **New action**: `AnchorHabitSchema`:
   ```ts
   z.object({
     type: z.literal("anchor_habit"),
     activity: titleLikeString("activity"),
     days: z.array(dayEnum).min(1),
     start: timeString, end: timeString,
   })
   ```
   `executeAction` case delegates to the existing `add_recurring_event` path.

### Open questions
- Minimum data window before a habit is considered stable? (Suggest: 2+ weeks of `task_events`.)
- Should detected habits trigger a proactive suggestion, or only respond to the user asking?

---

## Feature 6 — Real-Time Adaptive Sidebar / DynamicIsland

### What it is
A persistent sidebar panel (or DynamicIsland widget) showing the top 3 priority tasks, today's load score, and any friction/habit alerts — updated in real time as tasks change.

### User value
Reduces the reliance on asking the AI "what should I do?" — the answer is always visible on screen.

### What already exists to build on
- `rankTasks` (shipped) produces a sorted priority list on every chat turn already.
- `prioritize_tasks` action (shipped) returns a formatted priority list on demand.
- DynamicIsland component exists in `src/App.jsx` (existing, used for other notifications).

### Implementation sketch
1. **State**: add `prioritySnapshot: PriorityResult[] | null` to App.jsx state, updated whenever `clientTasks` changes (debounced, 30s minimum interval).
2. **Client-side compute**: run `rankTasks` directly in the browser (pure function, no server call needed) for the sidebar — `priority.ts` is importable from the client bundle since it has no I/O.
3. **UI**: new `PrioritySidebar` component — renders top 3 as compact cards with score, due date, and `explanation` string. Friction-flagged tasks get a ⚠️ badge.
4. **Wire-up**: sidebar opens via a keyboard shortcut or a floating button; state persists for the session.

### Open questions
- Does the sidebar need a dedicated panel slot, or should it overlay as a drawer?
- Should it auto-open when `overdue_count >= 1`?

---

## Feature 7 — Multi-Layer Time Horizons

### What it is
The AI maintains three concurrent planning horizons — Today (next 8 hours), This Week (next 7 days), and Semester (remaining weeks) — and surfaces context-appropriate advice for each layer.

### User value
Students often optimize locally (today's tasks) at the expense of medium-term (this week) or long-term (semester) goals. Horizon-aware advice prevents short-term tunnel vision.

### What already exists to build on
- `horizon_days` parameter already exists on `prioritize_tasks` (shipped) — today = 1, week = 7, semester ≈ 90.
- `plan_intent`'s `horizon: z.enum(["week", "month", "semester"])` (shipped) — horizon concept is already in the schema vocabulary.
- `assembleContext` already receives `clientTasks` and can be filtered by horizon.

### Implementation sketch
1. **Context layers**: extend `assembleContext` to produce three ranked sub-lists (today / week / semester) from `clientTasks`, each compressed to ≤2 tasks in the context string.
2. **Horizon intent routing**: add a `horizon` field to `PrioritizeTasksSchema` (already has `horizon_days`); the client pre-selects the horizon based on the message ("today" → 1, "this week" → 7, "finals" → 90).
3. **No new pipeline needed** — the existing `intent_plan` pipeline already accepts `horizon`.

### Open questions
- Semester start/end dates: where do they live? (Suggest: user profile preference in Supabase.)
- Does the semester horizon need a separate data source (syllabi, course schedule) to be useful?

---

## Feature 8 — Passive Context Awareness

### What it is
The engine reads ambient signals (time of day, day of week, upcoming calendar density) to proactively shift its advice without being asked — e.g. "It's Sunday evening; here's your week prep checklist."

### User value
Reduces friction for the user who doesn't know what to ask. The AI surfaces the right action at the right moment.

### What already exists to build on
- `time_of_day_histogram` (shipped) — behavioral baseline for time-of-day context.
- `clientCalendarDensity` (shipped) — already sent with every chat request.
- `assembleContext` already injects time-aware context into the system prompt.

### Implementation sketch
1. **Ambient trigger**: in `sendMessage` (App.jsx), before building `chatBody`, evaluate a `getAmbientContext(now, density, signals)` helper that returns a string like `"Sunday evening — week-ahead planning mode"` or `"High-density day tomorrow — heads up"`.
2. **Inject into `dynamicContext`**: append ambient context string (≤30 tokens) only when it adds non-obvious information.
3. **No new action needed** — purely advisory; the AI surfaces it conversationally.

### Open questions
- How to avoid the ambient context becoming repetitive noise across multiple messages?

---

## Feature 9 — AI Reflection & Progress Journaling

### What it is
At the end of the week (or on demand), the AI generates a brief reflection: tasks completed, tasks missed, patterns noticed, and a suggested adjustment for next week.

### User value
Metacognition is the highest-leverage study skill. A structured weekly review that writes itself removes the activation energy barrier.

### What already exists to build on
- `task_events` table (shipped) — 30-day history of completions, postponements, and abandonments.
- `BehavioralSignals` (shipped) — completion rate, subject breakdown, recent abandons already computed.
- `runIntentPlanPipeline` (shipped) — 3-pass pipeline pattern can be reused for reflection generation.

### Implementation sketch
1. **New action**: `GenerateReflectionSchema`:
   ```ts
   z.object({
     type: z.literal("generate_reflection"),
     window_days: z.number().int().min(1).max(30).optional(), // default 7
   })
   ```
2. **Pipeline**: `shared/ai/pipelines/reflection.ts` — single-pass (no critique needed). Gets `BehavioralSignals` injected as context. Returns a `reflection` action with a `markdown` field.
3. **Client**: `executeAction` case renders the markdown in a read-only card with a "Save to Notes" button.

### Open questions
- Should reflection be triggered automatically (weekly cron via Supabase Edge Function) or only on demand?

---

## Feature 10 — Adaptive Learning Scheduling

### What it is
Using spaced repetition principles, the engine schedules review sessions for material that was recently learned, spacing them optimally based on subject and estimated retention decay.

### User value
Students cram because they don't know when to review. Automatic spaced repetition scheduling turns "I studied this" into "study this again on Tuesday."

### What already exists to build on
- `task_events` table (shipped) — `complete` events with timestamps are the foundation for tracking what was studied and when.
- `median_hours_to_complete` by subject (shipped) — proxy for material density/difficulty.
- `add_task` action (existing) — review session creation path already exists.

### Implementation sketch
1. **Retention model**: add `computeReviewDate(completedAt: Date, subject: string, signals: BehavioralSignals): Date` to `shared/scheduling/priority.ts`.
   - Uses simplified SM-2 algorithm: first review = +1 day, second = +3 days, third = +7 days, then adaptive based on `completion_rate_30d` by subject.
2. **Auto-schedule**: after `complete_task` event in `executeAction`, if the completed task has a `subject`, call `computeReviewDate` and `add_task` a follow-up review task silently (no confirmation needed for the first review; configurable).
3. **Disclosure**: add a subtle note to the completion confirmation: "Review session scheduled for Tuesday."

### Open questions
- Should auto-scheduling be opt-in per subject, or global with an opt-out?
- How to handle subject tags that are too coarse (e.g. "math" covering calculus and statistics)?

---

## Dependency Map

```
Feature 1 (Mode System)           — standalone, no deps
Feature 2 (Recovery)              — needs task_events ✅, rankTasks ✅
Feature 3 (Cognitive Load)        — needs time_of_day_histogram ✅, CalendarDensity ✅
Feature 4 (Friction Detection)    — needs postpone_count ✅, recent_abandons ✅
Feature 5 (Habit Anchoring)       — needs time_of_day_histogram ✅, add_recurring_event (existing)
Feature 6 (Adaptive Sidebar)      — needs rankTasks ✅ — client-only, no server work
Feature 7 (Time Horizons)         — needs rankTasks ✅, horizon field (minor schema change)
Feature 8 (Passive Context)       — needs behavioral signals ✅, clientCalendarDensity ✅
Feature 9 (Reflection)            — needs task_events ✅, BehavioralSignals ✅
Feature 10 (Adaptive Learning)    — needs task_events ✅, add_task (existing)
```

All ten features depend on the behavioral telemetry foundation shipped in PR #146. The Supabase migration (`20260518_task_events.sql`) must be applied to production before any of them can function with real data.

---

## Recommended Sequencing

| Order | Feature | Effort | Why first |
|-------|---------|--------|-----------|
| 1 | **Friction Detection** (#4) | Small | Pure signal work; no new pipeline; immediate user value once telemetry accumulates |
| 2 | **Cognitive Load Awareness** (#3) | Small | Adds to existing context injection; no new action |
| 3 | **Mode System** (#1) | Medium | High perceived value; standalone; makes all other features more powerful |
| 4 | **Smart Recovery** (#2) | Medium | Reuses `intent_plan` pipeline pattern; high emotional value for stressed students |
| 5 | **Habit Anchoring** (#5) | Medium | Builds on detection already possible with shipped histogram |
| 6 | **Adaptive Sidebar** (#6) | Medium | Client-only; `rankTasks` is already the right primitive |
| 7 | **Reflection** (#9) | Medium | Single-pass pipeline; clean scope |
| 8 | **Adaptive Learning** (#10) | Medium | SM-2 model is well-understood; needs 30d of telemetry data first |
| 9 | **Passive Context** (#8) | Small | Polish feature; minimal code, high polish value |
| 10 | **Time Horizons** (#7) | Small | Minor extension of existing priority/plan_intent work |

---

## Pre-requisite: Apply the Migration

Before any of these features can use real behavioral data, the shipped migration must be applied:

```bash
# Local dev
supabase db reset

# Production
supabase db push
# or via Supabase MCP: apply_migration with the contents of
# supabase/migrations/20260518_task_events.sql
```

Tables created: `task_events`, `analytics_events`. Columns added to `tasks`: `completed_at`, `postpone_count`, `last_attempted_at`.
