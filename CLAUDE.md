# CLAUDE.md — SOS Student Operating System

Chat-first AI student planner. Students type natural language; the AI routes to structured tools; the client executes against Supabase. See `SOScontext.md` for a detailed lookup table.

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # Production build (verifies the app compiles)
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit across shared/, api/, supabase/functions/
npm run eval:harness  # Score cached sample-runs.jsonl against fixtures
npm run eval:live     # Live Gemini calls, regenerate sample-runs.jsonl (needs GEMINI_API_KEY)
npm run eval:shadow   # Diff Flash vs Pro tier predictions across the fixture set
npm run eval:cost     # Cost-per-1k-requests projection across tiers
npm run eval:planning # Regression eval for the planning pipeline
```

Build must pass before pushing. Run `npm run build` and `npm run typecheck`.

## Architecture

```
src/App.jsx                       — Single 7800-line React component: state, chat, action execution
src/lib/streamChat.js             — SSE consumer for the chat endpoint

api/chat.ts                       — Vercel transport adapter over handleChatRequest. SSE (default) or JSON.
api/embed.ts                      — Vercel handler for batched embeddings.

supabase/functions/sos-chat/      — Edge Function (Deno) adapter over the same handleChatRequest.
supabase/functions/sos-voice/     — Edge Function: Groq Whisper audio → text.
supabase/functions/embed-batch/   — Server-side embedding upserter.

shared/ai/                        — Hybrid Groq + Gemini service layer (TS).
  providers/types.ts              — LlmProvider interface + ChatRequest/ChatResponse.
  providers/gemini.ts             — Gemini SDK wrapper (chat, stream, embed).
  providers/groq.ts               — Groq OpenAI-compatible REST wrapper (chat, stream).
  providers/index.ts              — Provider registry.
  voice.ts                        — Groq Whisper transcription helper.
  router.ts                       — Tier routing (embed / flash / pro). ONLY place model strings appear.
  schemas/                        — Zod schemas (actions, studio, plan, intent_plan, library, _helpers).
  schemas/versions.ts             — Schema version pins per surface (action_tools=v6-2026-05).
  schemas/library.ts              — FlashcardDeckSchema + FlashcardSchema (persisted flashcard decks).
  schemas/coaching.ts             — MakeClueSchema + MakeWorkCheckSchema (Hint & Work-Check tools).
  coaching.ts                     — clue/work-check system prompts + normalizeWorkCheckAction (post-validation invariants).
  schemas/intent_plan.ts          — MakeIntentPlanSchema + buildIntentPlanToolDefs + validateIntentPlan.
  context/                        — assembleContext (ranked tasks + behavioral signals), enrich.ts, ranker.
  context/enrich.ts               — enrichDynamicContext: parallel, best-effort, bounded context build.
  signals/behavioral.ts           — getBehavioralSignals, formatSignalsForContext (Supabase REST, hour-bucket cache).
  rag/                            — embeddings, retrieve (both abort-bounded).
  pipelines/                      — planning.ts, intent_plan.ts (each deadline-bounded).
  telemetry.ts                    — Token counter, cost estimator, request log.
  resilience.ts                   — Retry classification + circuit breaker.
  chat-core.ts                    — callModel(): the single entry point for inference.
  chat-handler.ts                 — handleChatRequest(): transport-agnostic chat orchestrator.
  index.ts                        — Public exports.

shared/scheduling/priority.ts     — computePriority, rankTasks, buildCalendarDensity (pure functions, no I/O).
shared/coaching/workcheck.ts      — classifyContentType, normalizeCheckCards, computeCoverage, proofreadState (pure, no I/O).
shared/{env,auth,rate-limit,sse}.ts — Cross-runtime helpers.

supabase/migrations/20260514_add_pgvector.sql — pgvector + memory_embeddings + match_memories RPC.
supabase/migrations/20260518_task_events.sql  — task_events table + analytics_events + tasks columns (completed_at, postpone_count, last_attempted_at).
supabase/migrations/20260520_flashcard_decks.sql — flashcard_decks table (AI-generated + manual decks) + owner RLS.

scripts/eval-harness.mjs          — Routing precision/recall + shadow eval.
scripts/eval-cost.mjs             — Per-tier cost projection.
scripts/eval-planning-fallback.mjs — Planning tier-downgrade fallback test.

eval/fixtures/                    — conversations.json (fixtures) + sample-runs.jsonl (results).
```

**Dual deployment**: `api/chat.ts` (Vercel/Node) and `supabase/functions/sos-chat/index.ts` (Deno) are thin transport adapters — each normalizes its runtime's request, calls `handleChatRequest` from `shared/ai/chat-handler.ts`, and serializes the outcome. All mode dispatch, enrichment, budgeting and error shaping live in `chat-handler.ts` so the two runtimes cannot drift. Any AI logic change must work in both runtimes — use Web APIs only in `shared/`. Deno consumes the `.ts` sources through `supabase/functions/deno.json` (sloppy-imports + npm specifiers for `zod` and `@google/genai`). The Groq provider is a plain `fetch`-based REST client; no SDK dependency.

## Key patterns

**Adding/changing an AI tool**: edit the Zod schema in `shared/ai/schemas/actions.ts` (or `studio.ts`) → the tool def + JSON Schema + validator are generated from there. Add a case in `executeAction()` in `src/App.jsx` if it's a new action type.

**Models** (never reference these strings outside `router.ts` — use `embedModel(role)` for embeds):
- Tier 0 — embeddings (memory, semantic search, clustering). Gemini stays here; Groq has no embedding model. Two models split the request budget (each capped ~100 RPM / 1k RPD, but ~30K TPM): `embedModel("primary")` = `gemini-embedding-002` backs the persisted RAG/memory store (all stored vectors must live in one model's space, so retrieval + upserts pin here); `embedModel("secondary")` = `gemini-embedding-001` serves ephemeral self-contained similarity (name grounding) so it never spends the primary's budget. `embedCoalesced()` in `rag/embeddings.ts` merges concurrent same-`(model,taskType,dim)` embed calls within a 15ms window into one upstream request (token-rich, request-poor).
- Tier 1 (flash) — `openai/gpt-oss-20b` on Groq — chat, action_routing, summarize, rerank.
- Tier 1 fallback — `gemini-2.5-flash` (cross-provider when Groq fails).
- Tier 2 (pro) — `openai/gpt-oss-120b` on Groq — studio, planning.
- Tier 2 fallback — `gemini-2.5-pro` (cross-provider when Groq fails).
- Vision override — `meta-llama/llama-4-scout-17b-16e-instruct` on Groq, applied in chat-core when a request carries image attachments. Fallback: `gemini-2.5-flash`.
- Voice — `whisper-large-v3-turbo` on Groq via `shared/ai/voice.ts` (bypasses callModel).

**callModel()** in `chat-core.ts` takes `{ intent, messages, ... }`, routes the intent through `router.ts`, dispatches to the provider, applies retry/circuit breaker, validates tool outputs against the Zod schemas, and (when streaming) yields chunks through `onChunk`.

**Streaming**: `api/chat.ts` and `sos-chat` honor `Accept: text/event-stream` and emit `delta`/`tool_call`/`usage`/`progress`/`done`/`error` SSE frames. The frontend uses `src/lib/streamChat.js` which transparently falls back to JSON for non-streaming responses. The `progress` frame carries `ProgressEvent` (`{phase, label, step, totalSteps, draft?}`) — the planning/intent_plan pipelines stream it so the UI shows a live stepper + an early draft instead of a silent 30-50s wait.

**Pending state** (`src/App.jsx`): unchanged from before. AI-response state lives in one `pending` object; `streamingMessage` holds the live delta text during streaming.

**Clarification flow**: AI calls `ask_clarification` → `callModel` converts it to a `ClarificationCard` → frontend renders it → `handleClarificationSubmit` sends a follow-up message.

**Planning pipeline** (`shared/ai/pipelines/planning.ts`): three-pass agentic pipeline on Pro tier with `thinkingBudget: 4096`. Critique and refine degrade gracefully — if either fails, the draft ships. Errors surface as `PlanningPipelineError` with `.stage`. Accepts an optional `onProgress` callback that emits a `ProgressEvent` per pass (`analyzing`/`drafting`/`reviewing`/`finalizing`); the `reviewing` event carries the pass-1 `draft` so the UI can show an early preview.

**Intent-plan pipeline** (`shared/ai/pipelines/intent_plan.ts`): same 3-pass pattern as planning, but produces `make_intent_plan` — recurring blocks + milestone tasks + review cadence. Triggered when the user says something like "help me survive finals week". Mode `"intent_plan"` in `api/chat.ts` / `sos-chat`. Surfaces as `IntentPlanCard` in the chat; "Apply" batch-creates blocks and tasks in one undoable snapshot. Also supports `onProgress` — the `reviewing` event's `draft` renders as a "preview · refining…" `IntentPlanCard` (~15s) that swaps for the refined plan on `done`.

**Hint & Work-Check** (`shared/ai/coaching.ts` + `shared/coaching/workcheck.ts`): two surfaces per task. The **clue** (`mode:"clue"` → `make_clue`, Flash tier) gives one forward hint tuned to "enough to attempt"; "still stuck" routes to the check, never a second clue. The **check** (`mode:"work_check"` → `make_work_check`, Pro tier) evaluates the student's own work and surfaces only the highest-leverage gaps as cards. Both are forced single tool calls (like studio). Content-type routing (procedure/fact/argument) comes from `classifyContentType`. The deterministic invariants live in the pure `workcheck.ts` and are re-applied server-side by `normalizeWorkCheckAction` regardless of model output: strengths first, ≤3 gaps, ≤5 cards, no padding; the coverage number ("N of 5 addressed") counts only text-verifiable structural criteria and is never a grade; low-confidence/qualitative gaps hedge as questions; grammar is the only just-fix lane; self-attested items never count. The **proofread cap** (2 rounds / 2h, `proofreadState`) is tracked client-side (`proofreadHistoryRef`, localStorage) and passed as `proofreadRoundsUsed`; the terminal round hands the work back with a directed self-read instead of a verdict. Surfaces as `ClueCard` / `WorkCheckCard`. Triggered by `CLUE_REGEX` / `WORK_CHECK_REGEX` in `src/App.jsx`.

**Priority engine** (`shared/scheduling/priority.ts`): pure-function, sync, no I/O. `computePriority(task, now, density, signals)` returns a score 0–1 from five weighted factors (urgency 35%, importance 25%, momentum 15%, deadline_density 15%, friction 10%). `rankTasks` runs it over a task list; `buildCalendarDensity` builds the density map from tasks + calendar blocks. Runs server-side inside `assembleContext` (top-3 snippet injected into AI context) and client-side for the `prioritize_tasks` action display.

**Behavioral signals** (`shared/ai/signals/behavioral.ts`): `getBehavioralSignals(userId)` queries `task_events` via Supabase REST and returns `BehavioralSignals` (completion rate, median hours by subject, postpone rate by subject, 24-bucket time histogram, recent abandons). Hour-bucket in-process cache. `formatSignalsForContext` renders it as a ≤5-line string for the AI context. Both runtimes safe (fetch-only).

**RAG**: `assembleContext({ userId, intentQuery, workspaceContext, clientTasks, clientCalendarDensity, behavioralSignals })` returns a context blob that mixes retrieved memories (cosine + recency weighted), ranked priority tasks, behavioral patterns, and workspace facts. Persisted in `memory_embeddings` (pgvector). The `match_memories` RPC backs vector search.

## What NOT to do

- Don't hardcode model strings — go through `router.ts`. The router is the only place tier→model decisions live. The vision override in `chat-core.ts` is the one exception (it depends on request payload, not static intent).
- Don't bypass the Zod schemas in `shared/ai/schemas/`. They catch placeholder values, instruction-as-title, and generic subjects before they reach the user.
- Don't use Node-only APIs (`Buffer`, `require`) in `shared/`. The same files run in Deno too.
- Don't import from `@google/genai` outside `shared/ai/providers/gemini.ts`. The provider seam is intentional.
- Don't import directly from `shared/ai/providers/groq.ts` either — go through `getProvider("groq")`.

## Eval harness

`eval/fixtures/conversations.json` — test fixtures with expected tool routing.
`eval/fixtures/sample-runs.jsonl` — one JSON line per fixture run (written by `eval:live`).
`scripts/eval-harness.mjs` — reads both, prints precision/recall/latency report.

To regenerate `sample-runs.jsonl` against live Gemini:
```bash
GEMINI_API_KEY=... npm run eval:live
```

Shadow eval (compares Flash vs Pro per fixture):
```bash
GEMINI_API_KEY=... npm run eval:shadow
```

## Environment variables

```
GROQ_API_KEY              — required for chat (gpt-oss-20b/120b), vision (llama-4-scout), voice (whisper)
GEMINI_API_KEY            — required for embeddings + cross-provider fallback
AI_PROVIDER_OVERRIDE      — optional; set to "gemini" to roll back chat to Gemini without redeploying
SUPABASE_URL              — Supabase project URL
SUPABASE_SERVICE_ROLE_KEY — service role key for server-side ops
VITE_SUPABASE_URL         — frontend Supabase URL
VITE_SUPABASE_ANON_KEY    — frontend anon key
```

See `.env.example` for the full list.
