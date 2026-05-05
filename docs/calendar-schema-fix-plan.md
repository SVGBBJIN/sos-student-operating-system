# Calendar Schema & Validation Fix Plan

## Overview (read this first)

The Create Calendar Event flow has three coupled problems that compound into "blanks/no dates/empty fields pass through":

1. **The validate‑and‑retry loop has an escape hatch that lets the model fabricate values.** When tool args fail validation, `callGroq` retries once with a "fix the listed fields and call the tool again OR call ask_clarification" instruction. The model takes the cheaper path — it invents a plausible title/date/subject — and the retry returns a passing call. The system prompt also says "respond with plain text asking…" which makes `ask_clarification` dead code in practice, so the UI never gets the structured clarification card the schema is meant to trigger.

2. **The standalone Calendar page cannot render events at all, and the in‑studio panel renders every event at midnight.** `CalendarPage.jsx` hands raw Supabase rows (with `event_date`, no `start_time`/`end_time`) into `CalendarWindow`, which reads `ev.date`, `ev.start_time`, `ev.end_time` — column lookup fails, the event is skipped. The lofi panel goes through `dbEventToApp` (so `date` is correct), but there is no time stored anywhere, so every event renders as a 1‑hour block at 00:00.

3. **The clarification payload is thin and inconsistent.** It tells the user what's missing but not what the model already has, not the in‑flight action, and not what defaults we'd accept. Worse, the same chat round can return *both* plain‑text "what date?" and a `clarifications[]` payload (or neither), so the UI behavior is non‑deterministic.

This plan tightens validation so the only legal escape from a missing required field is `ask_clarification`, fixes the data shape that breaks calendar rendering, and enriches the clarification payload so the UI can prompt with context instead of a generic question. It also flags a handful of related cleanups and a backend gap (the `events` row has no time column).

---

## What this plan changes

### A. Schema enforcement (`shared/ai/chat-core.js`)

1. **Remove the model's "fabricate" escape on the validate‑and‑retry path.** Rewrite `buildValidationFeedback` so the retry instruction explicitly says: *if the value is not in the student's last message, you MUST call `ask_clarification` — do not invent a value.* The current "Fix the listed fields … or call ask_clarification" wording lets the model pick fabrication.
2. **Tighten title‑like field validation.**
   - Raise `MIN_TITLE_LENGTH` from 2 → 3, and reject single‑word filler titles (`"add"`, `"new"`, `"the"`, `"todo"`).
   - Reject titles that are *only* a subject word (e.g. `"Math"`, `"Biology"`) — these are the model's compromise when it knows the subject but not the activity.
3. **Validate `time` strings even when they are not required.** Currently the schema's `time` field is treated as optional and unvalidated when present; a malformed value (e.g. `"morning"`) silently slips through. Validate format (`HH:MM`) at the schema layer, not just for required time fields.
4. **`update_event` must change at least one field.** Today it requires only `title`. A bare `update_event(title="X")` is a no‑op — promote a clarification ("what should I update?") when no second field is provided.
5. **`delete_event` / `delete_task` reject placeholder titles** the same way `add_event` does. Without this, `delete_event(title="event")` deletes whatever happens to match.
6. **`clear_all` requires `confirm:true` literal** (already required, keep) — but make the validator reject `confirm:false` as an explicit "missing confirm" so it routes to `ask_clarification`.

### B. Clarification payload (`toValidationClarification` in `chat-core.js`)

Promote it from `{question, reason, options, suggested_defaults, missing_fields}` to:

```
{
  question,          // single most-important question for the user
  reason,            // why we are asking
  context_action,    // which tool we were trying to run
  missing_fields,    // [field names]
  known_fields,      // {field: value} the model DID gather (NEW)
  suggested_defaults,// {field: default} we would accept (existing)
  severity,          // "blocking" | "soft"  (NEW)
  options,           // chips for quick reply (existing)
  multi_select,
}
```

`known_fields` lets the UI show "I have *Bio Quiz* on *Friday* — I just need a subject" instead of asking from scratch. `severity` lets `add_block` (which is destructive‑ish) be marked blocking while `add_event` with a missing optional time can be marked soft and skip the clarification prompt entirely.

### C. System‑prompt cleanup (`api/chat.js`)

The current `CLARIFICATION RULE` instruction in `chat.js` tells the model to "respond with plain text asking for the specific missing detail." That competes with `ask_clarification`. Replace it with a single rule: *the structured `ask_clarification` tool is the only way to ask for missing info; never call action tools with placeholder values; only respond with plain text for non‑actionable conversation.* Same instruction in `add_event`/`add_task`/`add_block`/`add_recurring_event` tool descriptions.

### D. Calendar render fix

1. **`src/pages/CalendarPage.jsx`** — convert rows through `dbEventToApp` (currently exported only inside `App.jsx`; lift it into `src/lib/dataHandlers.js` or a small `src/lib/eventShape.js` and re‑use in both places). Without this, the standalone `/calendar` route renders nothing.
2. **`CalendarWindow.jsx`** — render an event with no time as an "all‑day" pill at the top of the day column instead of synthesizing a 00:00–01:00 block. Add a `cw-event-allday` row above `cw-grid-body`. Keep the timed grid for events that have `time` (single field) or `start_time` + `end_time`.
3. **Pass `time` from add_event through to event state and DB.** Today `executeAction.add_event` writes `time:action.time||null` into local state but `appEventToDb` drops it on save (the DB row has no time column). See backend gap below.

### E. Wire add_event optional fields end‑to‑end

`description`, `location`, `priority` come back from the schema but `appEventToDb` drops them. Either persist them (preferred — add columns) or strip them at the action level so they don't appear to be supported.

---

## Push‑back / features I think are necessary

These are not in the user's request but are blockers for "reliability cornerstone":

1. **Backend: add `start_time`, `end_time`, `description`, `location`, `priority` columns to the `events` table.** Without this, the schema accepts data the system silently throws away. This is the root cause of every event rendering at midnight. Needs a migration.
2. **Make `ask_clarification` mandatory at the executor (`App.jsx`) when validation already failed at chat-core.** Right now `App.jsx` re‑does its own title/date check inside `executeAction.add_event`, then again in `handleConfirmAction`. If chat‑core has already produced a validated action, the client should trust it. Two layers of half‑working validation is what lets blanks through — the schema is the single source of truth.
3. **Add a regression test for missing‑date / placeholder‑title / fabricated‑subject.** `eval/fixtures/conversations.json` has one such case (`missing-event-date`) but no runner. Add `scripts/eval-conversations.js` that calls `parseLlmResponse` on a fixed Groq response and asserts validation behavior; this gives us a fast feedback loop on schema regressions.
4. **Drop the `subject` requirement on non‑academic events.** Right now `add_event` requires `subject` even for "dentist appointment Friday at 2pm". The schema then forces `inferSubjectFromTitle` to invent one or to clarify. Either accept `personal`/`appointment` as a non‑academic subject (cheap fix) or split the tool into `add_academic_event` / `add_calendar_appointment`.
5. **Stop sending `withNullableOptionals` to Groq for required fields.** It already preserves required types, but `confirm` on `clear_all` could be safer if we *also* enforced `enum: [true]` on the schema instead of just `boolean`. Current schema accepts `false` and the executor has to remember to gate.
6. **Telemetry on clarification path.** `chat_request_event` records `validation_error` outcomes but not whether a clarification was actually shown to the user vs. swallowed by the retry. Add a `clarification_emitted` boolean so we can measure how often the schema's safety net reaches the UI.

## Out of scope (intentionally)

- Adding new event types (recurring/all‑day) beyond what the schema already exposes.
- UI polish on the clarification card itself.
- Migration to a strict tool‑choice model — `tool_choice: "auto"` stays.

---

## File touch list

- `shared/ai/chat-core.js` — validator, clarification payload, retry feedback, schema descriptions.
- `api/chat.js` — `CLARIFICATION RULE` rewrite.
- `src/pages/CalendarPage.jsx` — row conversion.
- `src/components/CalendarWindow/CalendarWindow.jsx` — all‑day rendering.
- `src/lib/eventShape.js` (new, small) — shared `dbEventToApp` / `appEventToDb`.
- `src/App.jsx` — drop redundant validation in `executeAction.add_event` and `handleConfirmAction`; pass `time` through to DB once schema migration lands.
- `supabase/migrations/<date>_events_time_columns.sql` (new, flagged) — adds time columns. Not done in this PR; flagged here because it gates the time render fix.
- `eval/fixtures/conversations.json` + `scripts/eval-conversations.js` — regression coverage (flagged for follow-up PR).
