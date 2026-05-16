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

api/chat.ts                       — Vercel handler. SSE (default) or JSON.
api/proofread.ts                  — Vercel handler for the proofread surface.
api/embed.ts                      — Vercel handler for batched embeddings.

supabase/functions/sos-chat/      — Edge Function (Deno) mirror of api/chat.ts.
supabase/functions/sos-proofread/ — Edge Function mirror of api/proofread.ts.
supabase/functions/sos-voice/     — Edge Function: Groq Whisper audio → text.
supabase/functions/embed-batch/   — Server-side embedding upserter.

shared/ai/                        — Hybrid Groq + Gemini service layer (TS).
  providers/types.ts              — LlmProvider interface + ChatRequest/ChatResponse.
  providers/gemini.ts             — Gemini SDK wrapper (chat, stream, embed).
  providers/groq.ts               — Groq OpenAI-compatible REST wrapper (chat, stream).
  providers/index.ts              — Provider registry.
  voice.ts                        — Groq Whisper transcription helper.
  router.ts                       — Tier routing (embed / flash / pro). ONLY place model strings appear.
  schemas/                        — Zod schemas (actions, studio, plan, proofread, _helpers).
  schemas/versions.ts             — Schema version pins per surface.
  context/                        — assembleContext, compressor, ranker.
  rag/                            — embeddings, retrieve, cache.
  pipelines/                      — planning.ts, proofread.ts.
  telemetry.ts                    — Token counter, cost estimator, request log.
  resilience.ts                   — Retry, timeout, circuit breaker.
  chat-core.ts                    — callModel(): the single entry point for inference.
  index.ts                        — Public exports.

shared/{env,auth,rate-limit,sse}.ts — Cross-runtime helpers.

supabase/migrations/20260514_add_pgvector.sql — pgvector + memory_embeddings + match_memories RPC.

scripts/eval-harness.mjs          — Routing precision/recall + shadow eval.
scripts/eval-cost.mjs             — Per-tier cost projection.
scripts/eval-planning-fallback.mjs — Planning tier-downgrade fallback test.

eval/fixtures/                    — conversations.json (fixtures) + sample-runs.jsonl (results).
```

**Dual deployment**: `api/chat.ts` (Vercel/Node) and `supabase/functions/sos-chat/index.ts` (Deno) both import from `shared/ai/index.js`. Any AI logic change must work in both runtimes — use Web APIs only in `shared/`. Deno consumes the `.ts` sources through `supabase/functions/deno.json` (sloppy-imports + npm specifiers for `zod` and `@google/genai`). The Groq provider is a plain `fetch`-based REST client; no SDK dependency.

## Key patterns

**Adding/changing an AI tool**: edit the Zod schema in `shared/ai/schemas/actions.ts` (or `studio.ts`) → the tool def + JSON Schema + validator are generated from there. Add a case in `executeAction()` in `src/App.jsx` if it's a new action type.

**Models** (never reference these strings outside `router.ts`):
- Tier 0 — `gemini-embedding-002` — embeddings (memory, semantic search, clustering). Gemini stays here; Groq has no embedding model.
- Tier 1 (flash) — `openai/gpt-oss-20b` on Groq — chat, action_routing, summarize, proofread_classify, rerank.
- Tier 1 fallback — `gemini-3-flash` (cross-provider when Groq fails).
- Tier 2 (pro) — `openai/gpt-oss-120b` on Groq — studio, planning, proofread_specialist.
- Tier 2 fallback — `gemini-2.5-pro` (cross-provider when Groq fails).
- Vision override — `meta-llama/llama-4-scout-17b-16e-instruct` on Groq, applied in chat-core when a request carries image attachments. Fallback: `gemini-3-flash`.
- Voice — `whisper-large-v3-turbo` on Groq via `shared/ai/voice.ts` (bypasses callModel).

**callModel()** in `chat-core.ts` takes `{ intent, messages, ... }`, routes the intent through `router.ts`, dispatches to the provider, applies retry/circuit breaker, validates tool outputs against the Zod schemas, and (when streaming) yields chunks through `onChunk`.

**Streaming**: `api/chat.ts` and `sos-chat` honor `Accept: text/event-stream` and emit `delta`/`tool_call`/`usage`/`done`/`error` SSE frames. The frontend uses `src/lib/streamChat.js` which transparently falls back to JSON for non-streaming responses (planning, studio).

**Pending state** (`src/App.jsx`): unchanged from before. AI-response state lives in one `pending` object; `streamingMessage` holds the live delta text during streaming.

**Clarification flow**: AI calls `ask_clarification` → `callModel` converts it to a `ClarificationCard` → frontend renders it → `handleClarificationSubmit` sends a follow-up message.

**Planning pipeline** (`shared/ai/pipelines/planning.ts`): three-pass agentic pipeline on Pro tier with `thinkingBudget: 4096`. Critique and refine degrade gracefully — if either fails, the draft ships. Errors surface as `PlanningPipelineError` with `.stage`.

**RAG**: `assembleContext({ userId, intentQuery, workspaceContext })` returns a context blob that mixes retrieved memories (cosine + recency weighted) with workspace facts. Persisted in `memory_embeddings` (pgvector). The `match_memories` RPC backs vector search.

## What NOT to do

- Don't hardcode model strings — go through `router.ts`. The router is the only place tier→model decisions live. The vision override in `chat-core.ts` is the one exception (it depends on request payload, not static intent).
- Don't bypass the Zod schemas in `shared/ai/schemas/`. They catch placeholder values, instruction-as-title, and generic subjects before they reach the user.
- Don't add streaming to `api/proofread.ts` — it uses enforced JSON via `responseSchema`.
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
