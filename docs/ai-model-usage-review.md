# AI model usage review and improvement opportunities

Date: 2026-04-09

## Current model usage (observed)

- The runtime uses a Groq-only stack with four configured models:
  - `openai/gpt-oss-120b` (primary)
  - `openai/gpt-oss-20b` (conversational)
  - `openai/gpt-oss-20b` (default backup)
  - `llama-3.1-8b-instant` (fast fallback)
- Chat requests route to conversational vs tool-heavy paths based on lightweight heuristics, plus an `isContentGen` flag.
- Streaming is enabled only for non-image, non-content-generation requests.
- Content generation is hard-limited to 5/day per user.
- Voice uses `whisper-large-v3-turbo` on Groq.
- Telemetry logs prompt metadata and estimated tokens, but not provider token usage, cost, or quality outcome labels.

## Potential improvements

### 1) Replace heuristic routing with telemetry-trained routing
Current routing depends on regex/context heuristics. Improve by learning a lightweight router from historical telemetry (latency, tool-call validity, fallback frequency, user follow-up corrections) and selecting model/tokens/tool-choice dynamically.

**Why:** Better quality/cost tradeoff and fewer misses in ambiguous prompts.

### 2) Add intent confidence and adaptive escalation
When router confidence is low, begin on `FAST_MODEL` for disambiguation, then escalate to larger models only when needed.

**Why:** Preserves quality while reducing average latency and spend.

### 3) Introduce provider-level failover (not only model failover)
Current fallback stays within Groq models. Add a second provider path for critical requests when Groq circuit opens repeatedly.

**Why:** Improves availability during upstream incidents.

### 4) Log real token usage + estimated cost per request
You already estimate input/output tokens. Extend telemetry to store provider-reported prompt/completion tokens (when available), model unit pricing version, and computed cost.

**Why:** Enables objective optimization and budget controls.

### 5) Add quality outcome signals to telemetry
Store post-response quality markers such as:
- tool validation pass/fail
- user correction within 1-2 turns
- “regenerate”/retry usage
- silent abandonment

**Why:** Lets you optimize for actual quality, not just latency.

### 6) Enforce stricter context budgeting + summarization memory
Large prompts can dilute tool reliability. Add hard token budgets per segment (policy/context/history), with automatic rolling summarization for older turns.

**Why:** Reduces overflow risk and improves consistency on long chats.

### 7) Move all routing/classification logic server-side
The client contains legacy classifier helpers and model labels that appear stale versus backend orchestration. Centralize routing in one backend source of truth and remove dead client classifier paths.

**Why:** Prevents drift, reduces accidental double-LLM calls, and simplifies debugging.

### 8) Improve action/tool reliability loop
For tool-heavy flows, add a structured self-check stage before returning actions (e.g., “missing required fields?” “date/time normalized?”), and auto-clarify if confidence is low.

**Why:** Fewer malformed tool calls and fewer client-side recovery loops.

### 9) Make content-generation limits adaptive
Instead of a fixed 5/day global cap, support per-plan tiers, cooldowns, and dynamic limits based on abuse/quality signals.

**Why:** Better user experience for legitimate heavy users while preserving abuse controls.

### 10) Expand eval harness into regression gates
Use `scripts/eval-harness.mjs` fixtures for automated scorecards per route type:
- action precision/recall
- content schema validity
- clarification quality
- latency percentiles

Gate model/prompt/routing changes behind these metrics.

**Why:** Safer iteration with measurable quality improvements.

## Suggested rollout order

1. Telemetry upgrades (real tokens/cost + quality labels).
2. Server-side routing consolidation + remove stale client classifier paths.
3. Learned/adaptive routing and escalation.
4. Provider-level failover.
5. Eval-gated deployment policy.
