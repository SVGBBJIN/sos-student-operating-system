# CLAUDE.md — SOS Student Operating System

Chat-first AI student planner. Students type natural language; the AI routes to structured tools; the client executes against Supabase. See `SOScontext.md` for a detailed lookup table.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # Production build (verifies the app compiles)
npm run lint         # ESLint
npm run eval:harness # Evaluate AI routing against sample-runs.jsonl
npm run eval:live    # Run live Groq calls and write fresh sample-runs.jsonl (needs GROQ_API_KEY)
npm run eval:planning # Regression eval for the planning pipeline
```

Build must pass before pushing. Run `npm run build` to check.

## Architecture

```
src/App.jsx              — Single 7800-line React component: state, chat, action execution
api/chat.js              — Vercel serverless handler (Node)
supabase/functions/sos-chat/index.ts  — Supabase Edge Function (Deno)
shared/ai/chat-core.js   — SINGLE SOURCE OF TRUTH for models, tools, callGroq()
shared/ai/planning-pipeline.js — 3-pass draft→critique→refine for study plans
src/components/          — UI components
src/lib/supabase.js      — Supabase client + constants
scripts/eval-harness.mjs — AI routing eval harness
eval/fixtures/           — conversations.json (fixtures) + sample-runs.jsonl (results)
```

**Dual deployment**: `api/chat.js` (Vercel) and `supabase/functions/sos-chat/index.ts` both import from `shared/ai/chat-core.js`. Any AI logic change must work in both Node and Deno — use Web APIs only in `shared/`.

## Key patterns

**Adding/changing an AI tool**: edit `ACTION_TOOLS` in `shared/ai/chat-core.js` → add a case in `validateToolArguments()` in the same file → add a case in `executeAction()` in `src/App.jsx`.

**Models** (import from `shared/ai/chat-core.js`, never redeclare):
- `MODEL_DEEP = "openai/gpt-oss-120b"` — planning, proofreading, chat
- `MODEL_FAST = "openai/gpt-oss-20b"` — fast tasks, auto-fallback when DEEP fails
- `callGroq()` retries once on MODEL_FAST if MODEL_DEEP throws for any reason

**Pending state** (`src/App.jsx`): all AI-response pending state lives in one `pending` object (unified since 2026-05). Individual setter aliases (`setPendingActions`, `setPendingClarification`, etc.) still work — they call `updatePending()` internally. Use `clearPending()` to reset all at once.

**Clarification flow**: the AI calls `ask_clarification` → `parseLlmResponse` extracts it into `clarifications[]` → client shows `ClarificationCard` → `handleClarificationSubmit` sends a follow-up message.

**Planning pipeline** (`shared/ai/planning-pipeline.js`): three-pass agentic pipeline using `reasoning_effort: "high"`. Critique and refine degrade gracefully — if either fails, the draft ships. Errors surface as `PlanningPipelineError` with `.stage`.

## What NOT to do

- Do not call `callGroqStream` — it was removed (dead code). Use `callGroq` for all LLM calls.
- Do not redeclare `MODEL_DEEP`/`MODEL_FAST`/`PRIMARY_MODEL` outside `chat-core.js`.
- Do not add streaming to `api/chat.js` or `sos-chat/index.ts` — both use the non-streaming `callGroq`.
- Do not use Node-only APIs (`Buffer`, `require`) in `shared/` — it runs in Deno too.
- Do not bypass validation in `validateToolArguments()` — it catches placeholder values before they reach the user.

## Eval harness

`eval/fixtures/conversations.json` — test fixtures with expected tool routing.
`eval/fixtures/sample-runs.jsonl` — one JSON line per fixture run (written by `eval:live`).
`scripts/eval-harness.mjs` — reads both, prints precision/recall/latency report.

To regenerate `sample-runs.jsonl` against live Groq:
```bash
GROQ_API_KEY=... npm run eval:live
```

## Environment variables

```
GROQ_API_KEY              — required for all LLM calls
SUPABASE_URL              — Supabase project URL
SUPABASE_SERVICE_ROLE_KEY — service role key for server-side ops
VITE_SUPABASE_URL         — frontend Supabase URL
VITE_SUPABASE_ANON_KEY    — frontend anon key
```

See `.env.example` for the full list.
