# SOS — Student Operating System: Full Project Context

> Paste this file into a Claude project to give the AI full awareness of the codebase, architecture, features, and conventions.

---

## Mission

SOS (Student Operating System) is a **chat-first AI student planner and study assistant**. Students type (or speak) natural language; the AI routes intent to structured tools; the client executes those tools against Supabase. The core UX premise: students should never open a form — they should just describe what they need and the system handles the rest.

Key goals:
- Reduce friction for managing academic workload (tasks, events, calendar blocks)
- Surface personalized study materials at the right time
- Learn behavioral patterns to proactively surface the right tasks
- Support exam prep via AI-generated study packs, flashcards, quizzes, and outlines
- Integrate with LMS platforms (Google Classroom, Canvas) to auto-track submissions

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18.3.1 + React Router 7.14.1, Vite 6.2.0 |
| Database | Supabase (PostgreSQL + Auth + pgvector) |
| Backend compute | Vercel Node.js serverless (`api/*`) + Supabase Deno Edge Functions |
| AI — Primary | Groq (gpt-oss-20b flash, gpt-oss-120b pro, llama-4-scout vision, whisper-large-v3-turbo voice) |
| AI — Fallback | Google Gemini (2.5-flash, 2.5-pro, gemini-embedding-002 embeddings) |
| Schema validation | Zod 3.23.8 (single source of truth for all action schemas) |
| Content safety | DOMPurify 3.2.4 |
| PDF parsing | pdfjs-dist 3.11.174 |

---

## Repository Structure

```
/
├── api/                          # Vercel Node.js serverless handlers
│   ├── chat.ts                   # Chat transport adapter (SSE or JSON)
│   ├── embed.ts                  # Batch embeddings endpoint
│   ├── lms-courses.ts            # LMS course listing
│   ├── lms-tracked-courses.ts    # User's tracked courses
│   ├── lms-oauth-callback.ts     # Google Classroom OAuth redirect
│   ├── lms-ingest.ts             # Assignment structure ingestion
│   ├── lms-event.ts              # Submission evidence receiver
│   ├── lms-sync-trigger.ts       # Manual sync trigger
│   └── lms-confirm.ts            # Confirm matched task
│
├── shared/                       # Isomorphic TS — runs in both Node and Deno
│   ├── ai/
│   │   ├── router.ts             # ONLY place model strings live; tier → provider → model
│   │   ├── chat-handler.ts       # Transport-agnostic chat orchestrator
│   │   ├── chat-core.ts          # callModel(): single LLM call entry point
│   │   ├── grounding.ts          # Anti-hallucination: lexical + vector grounding for names
│   │   ├── voice.ts              # Groq Whisper transcription helper
│   │   ├── resilience.ts         # Retry classification + circuit breaker
│   │   ├── telemetry.ts          # Token counter, cost estimator, request log
│   │   ├── schemas/
│   │   │   ├── actions.ts        # All scheduling/task/note/timer action schemas (Zod)
│   │   │   ├── studio.ts         # Content generation schemas (flashcards, quiz, etc.)
│   │   │   ├── study_pack.ts     # make_study_pack schema
│   │   │   ├── intent_plan.ts    # make_intent_plan schema + MakeIntentPlanSchema
│   │   │   ├── plan.ts           # make_plan schema
│   │   │   ├── library.ts        # FlashcardDeckSchema + FlashcardSchema
│   │   │   ├── coaching.ts       # Coaching schemas (make_clue, make_work_check)
│   │   │   ├── lms.ts            # LMS action schemas
│   │   │   ├── versions.ts       # Schema version pins per surface
│   │   │   └── _helpers.ts       # Shared Zod primitives
│   │   ├── pipelines/
│   │   │   ├── planning.ts       # 3-pass plan generation pipeline
│   │   │   ├── intent_plan.ts    # 3-pass intent-plan pipeline
│   │   │   ├── brain_dump.ts     # 3-pass brain-dump → batch action pipeline
│   │   │   └── agentic.ts        # Agentic reasoning pipeline (iterative problem-solving)
│   │   ├── context/
│   │   │   ├── assembler.ts      # assembleContext: aggregate behavioral, RAG, study signals
│   │   │   ├── enrich.ts         # enrichDynamicContext: parallel best-effort enrichment
│   │   │   └── ranker.ts         # Task ranking helpers
│   │   ├── signals/
│   │   │   ├── behavioral.ts     # getBehavioralSignals, formatSignalsForContext
│   │   │   └── study.ts          # getStudySignals (mastery, quiz performance, weak topics)
│   │   ├── rag/
│   │   │   ├── retrieve.ts       # pgvector cosine retrieval (match_memories RPC)
│   │   │   └── embeddings.ts     # Embedding utilities
│   │   └── providers/
│   │       ├── types.ts          # LlmProvider interface, ChatRequest/ChatResponse
│   │       ├── gemini.ts         # Gemini SDK wrapper (chat, stream, embed)
│   │       ├── groq.ts           # Groq fetch-based REST wrapper (chat, stream)
│   │       └── index.ts          # Provider registry + getProvider()
│   ├── scheduling/
│   │   └── priority.ts           # computePriority, rankTasks, buildCalendarDensity
│   ├── lms/                      # LMS integration helpers
│   ├── subjects.js               # Canonical subject list, aliases, inference helpers
│   ├── env.ts                    # Cross-runtime env var helper
│   ├── auth.ts                   # JWT extraction
│   ├── rate-limit.ts             # RPM + daily content-gen rate limiting
│   └── sse.ts                    # SSE frame helpers
│
├── src/                          # React frontend
│   ├── App.jsx                   # Single ~7800-line component: all state + action execution
│   ├── AppRouter.jsx             # Route definitions
│   ├── main.jsx                  # Entry point
│   ├── components/
│   │   ├── ActionCards.jsx
│   │   ├── AppearanceSettings.jsx
│   │   ├── AuthScreen.jsx
│   │   ├── BrandMark.jsx
│   │   ├── ChatBubble.jsx
│   │   ├── ConnectorsSettings.jsx
│   │   ├── DecisionRollup.jsx     # Decision tree UI widget
│   │   ├── DynamicIsland.jsx      # Floating status/timer indicator
│   │   ├── ErrorBoundary.jsx
│   │   ├── FocusLauncher.jsx      # Quick-start focus launcher
│   │   ├── FocusSession.jsx       # Focused study UI
│   │   ├── FocusWidget.jsx
│   │   ├── GooglePermissionSummary.jsx
│   │   ├── HomeDecisionGate.jsx   # Home onboarding/gating flow
│   │   ├── HomeScreen.jsx
│   │   ├── Onboarding.jsx
│   │   ├── PomodoroTimer.jsx
│   │   ├── ProjectPanel.jsx
│   │   ├── ProjectsBar.jsx
│   │   ├── ProjectsTree.jsx
│   │   ├── RateLimitBanner.jsx
│   │   ├── ScheduleWidget.jsx
│   │   ├── SidebarNav.jsx         # Unified sidebar navigation
│   │   ├── SosNotification.jsx
│   │   ├── StartWidget.jsx        # New quick-start launcher
│   │   ├── StudioDashboard.jsx    # Studio layout container
│   │   ├── StudioHomeView.jsx     # Studio home variant
│   │   ├── StudioIcons.jsx
│   │   ├── StudioPanels.jsx       # Studio panel management
│   │   ├── StudioSidebar.jsx
│   │   ├── StudyTopBar.jsx
│   │   └── TweaksPanel.jsx        # Settings/tweaks panel
│   ├── pages/
│   │   ├── Landing.jsx
│   │   ├── Library.jsx
│   │   ├── CalendarPage.jsx
│   │   └── ProjectsPage.jsx
│   └── hooks/
│       ├── useColumnLayout.js
│       └── useSettings.js
│
├── supabase/
│   ├── migrations/               # All DDL in chronological order
│   └── functions/
│       ├── sos-chat/             # Deno mirror of api/chat.ts
│       ├── sos-voice/            # Groq Whisper transcription
│       ├── embed-batch/          # Server-side batch embedding upserter
│       ├── sync-submissions/     # Cron: LMS submission reconciliation
│       └── sos-lms-event/        # LMS submission event webhook
│
├── extension/                    # Browser extension (LMS submission tracking)
├── scripts/                      # Eval harness scripts
│   ├── eval-harness.mjs
│   ├── eval-cost.mjs
│   └── eval-planning-fallback.mjs
├── eval/fixtures/                # conversations.json + sample-runs.jsonl
├── CLAUDE.md                     # AI development instructions
├── SOScontext.md                 # Feature lookup table
└── .env.example                  # All environment variable keys
```

---

## AI Architecture

### LLM Routing — `shared/ai/router.ts`

**The only file in the codebase that references model strings.** All other code uses intent names.

#### Tiers

| Tier | Primary (Groq) | Fallback (Gemini) | Used for |
|------|---------------|-------------------|----------|
| `embed` | — | `gemini-embedding-002` | RAG, memory, semantic search |
| `flash` | `openai/gpt-oss-20b` | `gemini-2.5-flash` | Chat, action routing, classification, summarization |
| `pro` | `openai/gpt-oss-120b` | `gemini-2.5-pro` | Studio, planning, deep reasoning |

#### Intent → Tier mapping

| Intent | Tier |
|--------|------|
| `chat` | flash |
| `action_routing` | flash |
| `clue` | flash |
| `embed` | embed |
| `studio` | pro |
| `planning` | pro |
| `intent_plan` | pro |
| `study_pack` | pro |
| `work_check` | pro |

**Special cases:**
- **Vision**: any request with image attachments → `meta-llama/llama-4-scout-17b-16e-instruct` on Groq (override in `chat-core.ts`, fallback: `gemini-2.5-flash`)
- **Voice**: `whisper-large-v3-turbo` on Groq via `shared/ai/voice.ts`, bypasses `callModel()`
- **Emergency rollback**: `AI_PROVIDER_OVERRIDE=gemini` forces all intents to Gemini without redeployment

### Chat Handler — `shared/ai/chat-handler.ts`

Transport-agnostic orchestrator shared by both Vercel and Supabase runtimes. Dispatches based on `mode`:

| Mode | Pipeline | Output |
|------|----------|--------|
| `chat` (default) | Action routing with optional RAG + behavioral context enrichment | SSE stream or JSON |
| `planning` | 3-pass planning pipeline (Pro + thinking budget 4096) | Structured plan |
| `intent_plan` | 3-pass intent-plan pipeline | MakeIntentPlanInput |
| `brain_dump` | 3-pass brain-dump pipeline | Batch of tentative actions |
| `briefing` | Daily briefing rollup | Structured JSON (events + tasks + prep gaps) |
| `studio` | Forced tool call for content generation | Flashcards / quiz / outline / summary |
| `study_pack` | Bundled study artifact generation | Summary + concepts + flashcards + quiz |
| `voice` | Groq Whisper transcription | `{ text: string }` |

### SSE Streaming Frame Types

```
delta        — text content chunk
tool_call    — structured action call (the AI is invoking a tool)
usage        — token counts { input, output }
grounding    — RAG metadata/sources
progress     — pipeline phase update { phase, label, step, totalSteps, draft? }
done         — final aggregated result
error        — error details
```

The `progress` frame carries a `ProgressEvent`. Planning and intent_plan pipelines emit it per pass so the UI shows a live stepper + an early draft (~15s preview) before the final result.

### 3-Pass Pipelines

All three pipelines share the same pattern — graceful degradation if any pass fails or times out.

#### Planning Pipeline — `shared/ai/pipelines/planning.ts`
Converts a goal into a `make_plan` action:
1. **Draft** (22s cap) — full first-draft plan via Pro + `thinkingBudget: 4096`
2. **Critique** (10s cap, skipped if budget expires) — plain-text gap analysis
3. **Refine** (22s cap, skipped if budget expires) — final plan incorporating critique
- Total budget: 50s (within Vercel 60s limit)
- Progress phases: `analyzing → drafting → reviewing → finalizing`

#### Intent-Plan Pipeline — `shared/ai/pipelines/intent_plan.ts`
Converts a student goal (e.g., "help me survive finals week") into a structured weekly plan:
1. **Draft** — recurring blocks + milestone tasks + review cadence
2. **Critique** — schedule realism, review loop gaps, task estimate issues
3. **Refine** — final plan
- Output: `MakeIntentPlanInput` (recurring_blocks, milestone_tasks, review_cadence)
- Frontend renders as `IntentPlanCard`; "Apply" batch-creates blocks and tasks in one undoable snapshot

#### Brain-Dump Pipeline — `shared/ai/pipelines/brain_dump.ts`
Converts messy voice transcripts or text dumps into a batch of tentative action calls:
1. **Draft** — extracts every actionable item with confidence scoring
2. **Critique** — identifies missed items, miscalibrated confidence
3. **Refine** — full batch re-emission with corrected confidence
- `confidence >= 0.85` → verbatim from transcript, eligible for auto-apply
- `confidence < 0.7` → inferred date/time, marked `tentative`, routes to review rail
- `0.7 ≤ confidence < 0.85` → mixed signal, presented for confirmation

#### Agentic Pipeline — `shared/ai/pipelines/agentic.ts`
Iterative multi-turn reasoning pipeline for complex problem-solving:
1. Stages through multiple passes with intermediate checkpoints
2. Refines reasoning based on feedback at each stage
3. Supports long-context conversations with state management
- Used for deep reasoning tasks that benefit from iterative refinement
- Integrates with `work_check` coaching intent for intermediate validation

### Coaching System — `shared/ai/` + `shared/coaching/`

Student-focused hint and feedback system with two intents:

**`clue` intent (flash tier)** — Provides forward-looking hints
- Input: student's question or partial work
- Output: `make_clue` action with hint, direction, and optional scaffolding
- No solution given; guides problem-solving process

**`work_check` intent (pro tier)** — Evaluates student work with feedback
- Input: student's attempted solution + optional rubric
- Output: `make_work_check` action with breakdown, mistakes, and suggestions
- Caps at 2 rounds per 2-hour window; third round triggers self-read instead
- Tracks `proofreadRoundsUsed` in `App.jsx` to enforce limits

**Integration**: Both intents route through the main chat (`chat-handler.ts`), dispatching via `clue` or `work_check` mode labels.

### callModel() — `shared/ai/chat-core.ts`

Single entry point for all LLM inference. Takes `{ intent, messages, tools?, onChunk?, ... }`:
1. Routes via `router.ts` → gets `{ model, provider, fallbackModel, fallbackProvider }`
2. Dispatches to provider (Groq or Gemini)
3. Applies retry/circuit breaker from `resilience.ts`
4. Validates tool outputs against Zod schemas
5. Yields chunks through `onChunk` when streaming

### Name Grounding — `shared/ai/grounding.ts`

Anti-hallucination system that validates proposed task/event names are grounded in student's actual words. Runs after schema validation on default chat path only (not brain_dump or studio pipelines).

**Two layers:**
1. **Lexical (sync, free)** — Rejects names containing filler tokens ("untitled", "tbd", "placeholder", etc.) unless the student explicitly used them
2. **Vector (async, bounded)** — Validates proposed name has semantic association (cosine sim ≥ 0.4) with something student actually said; fails open (never blocks saves)

**On failure**: Non-destructive. Pulls the action and replaces with soft clarification asking student to confirm the name.

**Lexical overlap threshold**: ≥60% of content words from proposed name must appear verbatim in recent messages to skip embedding cost.

---

## Action Tool System

**Single source of truth**: `shared/ai/schemas/actions.ts` (and `studio.ts`, `study_pack.ts`, etc.)

All action tools defined as Zod schemas. The same schema generates:
- JSON Schema for the LLM tool-calling context
- Runtime validator for verifying LLM output before executing

### Full Action Catalogue

#### Scheduling
| Action | Key fields |
|--------|-----------|
| `add_event` | title, date, time, description, location, priority, event_type (test\|exam\|quiz\|practice\|game\|match\|meet\|tournament\|event\|other), subject, confidence (0–1), status (tentative\|confirmed) |
| `update_event` | event_id or title + ≥1 of: new_title, new_date, new_time, new_description, new_location |
| `delete_event` | event_id or title |
| `add_block` | date, start, end, activity, category (school\|swim\|debate\|free time\|sleep\|other) |
| `delete_block` | date, activity, start |
| `update_block` | date, activity, start + fields to update |
| `add_recurring_event` | title, event_type, subject, days (M-Su), start_date, end_date, time, confidence |
| `convert_event_to_block` | event_id or title |
| `convert_block_to_event` | date, activity, start |
| `read_calendar` | start_date, end_date (optional) |
| `view_schedule` | optional range specifier |

#### Tasks
| Action | Key fields |
|--------|-----------|
| `add_task` | task_name, due_date, subject, confidence (0–1), commitment (tentative\|confirmed) |
| `update_task` | task_id or title + ≥1 of: new_title, due, estimated_minutes, confidence, commitment |
| `delete_task` | task_id or title |
| `complete_task` | task_id or title |
| `manage_task` | task_id or title, operation (update\|delete\|complete\|postpone) + operation-specific fields (chat menu only; expands to canonical action) |
| `break_task` | parent_title; subtasks[]{title, due, estimated_minutes} |
| `prioritize_tasks` | horizon_days (1–30), limit (1–10) |
| `postpone_task` | task_id or title |
| `bulk_complete` | task_ids[] |
| `read_tasks` | optional filters |

#### Notes & Folders
| Action | Key fields |
|--------|-----------|
| `add_note` | title, content, subject, source (user\|ai_generated\|imported) |
| `edit_note` | note_id or title, new_content |
| `delete_note` | note_id or title |
| `rename_note` | note_id or title, new_title |
| `move_note` | note_id or title, parent_folder_title |
| `create_folder` | title |
| `read_notes` | optional folder filter |
| `read_project` | project_title |

#### Timers
| Action | Key fields |
|--------|-----------|
| `set_timer` | label, duration_seconds OR fire_at OR preset (pomodoro\|short_break\|long_break) |
| `cancel_timer` | timer_id or label |

#### Content Generation (Studio)
| Action | Output | Limits |
|--------|--------|--------|
| `create_flashcards` | title, summary, cards[]{q, a} | 1–40 cards |
| `create_quiz` | title, summary, questions[]{q, choices[], answer, explanation} | 1–30 questions |
| `create_outline` | title, sections[]{heading, points[]} | 1–20 sections |
| `create_summary` | title, bullets[] | 1–20 bullets |
| `create_project_breakdown` | title, phases[]{phase, deadline?, tasks[]} | 1–12 phases |
| `make_plan` | title, summary?, steps[]{title, date?, time?, estimated_minutes?} | 1–40 steps |

#### Study Pack
| Action | Output |
|--------|--------|
| `make_study_pack` | title, subject?, topic?, summary[], key_concepts[], flashcards[], quiz[] |

#### Intent Plan
| Action | Output |
|--------|--------|
| `make_intent_plan` | summary, recurring_blocks[], milestone_tasks[], review_cadence |

`recurring_blocks`: activity, days (M–Su), start/end times, category, optional dates
`milestone_tasks`: task_name, due_date, subject, estimated_minutes
`review_cadence`: every_n_days (1–14), optional review_block, optional notes

#### Coaching
| Action | Output |
|--------|--------|
| `make_clue` | question_rephrased, hint, hint_category (conceptual\|procedural\|strategic), scaffolding? |
| `make_work_check` | assessment, mistakes[], strengths[], next_steps[], rubric_match? |

#### Grades
| Action | Key fields |
|--------|-----------|
| `log_grade` | subject, assignment, grade (0–100), grade_type (exam\|quiz\|homework\|project\|other) |

#### Study Sets (Flashcard Decks)
| Action | Key fields |
|--------|-----------|
| `read_study_sets` | subject (optional), limit (optional) |
| `delete_study_set` | study_set_id or title |
| `update_study_set` | study_set_id or title, new_title, new_content |

#### Meta / Control Flow
| Action | Key fields |
|--------|-----------|
| `ask_clarification` | question, reason, context_action, missing_fields[], known_fields{}, options[], multi_select (bool) |
| `propose_action` | title, description, action_summary |

### Confidence & Commitment Gating

Every `add_task` and `add_event` carries optional confidence (0–1) and commitment/status fields:
- `confidence >= 0.85` → eligible for auto-apply (if user has `aiAutoApprove` enabled)
- `confidence < 0.7` OR `status: 'tentative'` / `commitment: 'tentative'` → routed to review rail for user confirmation
- `0.7 ≤ confidence < 0.85` → shown for confirmation regardless of `aiAutoApprove`

---

## Database Schema

All tables use Supabase Auth (`auth.uid() = user_id`) Row-Level Security.

### Core Tables

**tasks**
```sql
id uuid PK, user_id uuid FK auth.users
title text, description text, due_date date
status enum: not_started | in_progress | done
priority enum: low | medium | high
subject text, estimated_minutes int, estimated_pomodoros int
notes text, tags text[]
confidence numeric(4,3),  -- 0..1
commitment enum: tentative | confirmed  DEFAULT confirmed
completed_at timestamptz, postpone_count int DEFAULT 0
last_attempted_at timestamptz
completion_source enum: manual | ai | lms
completion_confidence int,  -- 0-100 integer
lms_assignment_ref jsonb
study_plan_id uuid FK study_plans
study_pack_id uuid FK study_packs
created_at timestamptz
```

**events**
```sql
id uuid PK, user_id uuid FK auth.users
title text, event_date date, start_time time, end_time time
description text, location text
event_type enum: test|exam|quiz|practice|game|match|meet|tournament|event|other
subject text, priority text
confidence numeric(4,3)  -- 0..1
status enum: tentative | confirmed  DEFAULT confirmed
created_at timestamptz
```

**blocks**
```sql
id uuid PK, user_id uuid FK auth.users
activity text, date date, start_time time, end_time time
category enum: school | swim | debate | free time | sleep | other
```

**notes**
```sql
id uuid PK, user_id uuid FK auth.users
title text, content text, subject text
source enum: user | ai_generated | imported
parent_id uuid FK notes (self-referential, cascade delete) -- folder nesting
is_folder boolean DEFAULT false
created_at timestamptz, updated_at timestamptz
```

**entity_links** — bidirectional knowledge graph edges
```sql
id uuid PK, user_id uuid FK auth.users
source_type enum: note | event | task
source_id uuid
target_type enum: note | event | task
target_id uuid
origin enum: manual | wikilink | heuristic | llm | rejected
confirmed_at timestamptz
UNIQUE (user_id, source_type, source_id, target_type, target_id)
```

**memory_embeddings** — pgvector RAG store
```sql
id uuid PK, user_id uuid FK auth.users
source enum: memory | event | task | note | lesson | block
source_id uuid, chunk_idx int
text text
embedding vector(1536)
metadata jsonb
UNIQUE (user_id, source, source_id, chunk_idx)
-- IVFFlat index with cosine similarity
```
RPC: `match_memories(query_embedding, user_id_in, match_count=8, source_filter=null, metadata_filter=null)`

**task_events** — behavioral signal source
```sql
id uuid PK, user_id uuid FK auth.users
task_id uuid FK tasks (nullable)
event_id uuid FK events (nullable)
event_type enum: status_change | postpone | abandon | retry | complete | create | delete
from_status text, to_status text
occurred_at timestamptz, metadata jsonb
-- Constraint: exactly one of task_id or event_id is set
-- Indexes: (user_id, occurred_at DESC), (user_id, event_type)
```

**timers**
```sql
id uuid PK, user_id uuid FK auth.users
label text, fire_at timestamptz
created_at timestamptz, fired boolean DEFAULT false, dismissed_at timestamptz
-- Index: (user_id, fire_at) WHERE fired = false
```

**study_plans**
```sql
id uuid PK, user_id uuid FK auth.users
title text, status enum: active | archived
plan_json jsonb  -- full MakeIntentPlanInput
total_tasks int, applied_at timestamptz
review_cadence_days int, created_at timestamptz
```

**study_packs**
```sql
id uuid PK, user_id uuid FK auth.users
title text, subject text, topic text
status enum: generating | ready | needs_review | mastered | archived
source_kind enum: manual | import | event
artifacts jsonb  -- array of { kind, data }
linked_event_id uuid FK events
mastery numeric, last_reviewed_at timestamptz
created_at timestamptz, updated_at timestamptz
```

**flashcard_decks**
```sql
id uuid PK, user_id uuid FK auth.users
title text, summary text
cards jsonb  -- array of { q, a }
source enum: ai | manual
card_count int, created_at timestamptz
```

**grades**
```sql
id uuid PK, user_id uuid FK auth.users
subject text, assignment text
grade numeric(5,2),  -- 0-100
grade_type enum: exam | quiz | homework | project | other
created_at timestamptz
-- Indexes: (user_id, subject), (user_id, created_at)
```

**lms_submission_events**
```sql
id uuid PK, user_id uuid FK auth.users, task_id uuid FK tasks
lms enum: classroom | canvas
lms_course_id text, lms_assignment_id text, lms_assignment_title text
evidence_kind enum: text_indicator | url_state | submission_post | upload | grade_posted | page_visit
evidence_weight int (1-5)
evidence_detail jsonb, confidence_after int
occurred_at timestamptz
-- Soft dedupe on (user_id, lms, lms_assignment_id, evidence_kind, date_trunc(second, occurred_at))
```

**skill_hub_sessions**
```sql
id uuid PK, user_id uuid FK auth.users
mode enum: cause-effect | interpretation | study
subject text, linked_task_id uuid
started_at timestamptz, ended_at timestamptz
score_correct int, score_incorrect int, hints_used int
struggled_topics text[], created_at timestamptz
```

**lessons**
```sql
id uuid PK, user_id uuid FK auth.users
topic text, subject text, mode text
screens jsonb, estimated_minutes int
status enum: not_started | in_progress | complete
current_screen int, score_correct int, score_incorrect int
source enum: manual | struggle | upcoming_test
completed_at timestamptz, created_at timestamptz
```

**trigger_dismissals** — suppress re-suggestion of dismissed triggers
```sql
user_id uuid, task_id uuid, dismissed_at timestamptz, expires_at timestamptz
-- Index: (user_id, expires_at)
```

**analytics_events**
```sql
user_id uuid, event_type text, metadata jsonb, created_at timestamptz
```

**study_attempts** — append-only log of quiz/lesson attempts for adaptive learning
```sql
id uuid PK, user_id uuid FK auth.users
study_pack_id uuid FK study_packs, question_idx int, selected_choice int
correct boolean, time_taken_seconds int
created_at timestamptz
-- Index: (user_id, study_pack_id, created_at)
```

**lms_providers** — catalog of supported LMS systems
```sql
provider_id text PK (e.g., "google_classroom", "canvas")
display_name text, oauth_enabled boolean, oauth_client_id text, oauth_redirect_uri text
scopes text[]
```

**user_integrations** — per-user OAuth tokens for LMS
```sql
id uuid PK, user_id uuid FK auth.users
provider_id text FK lms_providers
oauth_token text, oauth_refresh_token text, expires_at timestamptz
created_at timestamptz, updated_at timestamptz
-- Unique: (user_id, provider_id)
```

**tracked_courses** — courses the user wants synced
```sql
id uuid PK, user_id uuid FK auth.users
provider_id text FK lms_providers
lms_course_id text (provider-specific course ID)
course_name text, enabled boolean DEFAULT true
synced_at timestamptz, created_at timestamptz
```

**submissions** — normalized LMS submission records
```sql
id uuid PK, user_id uuid FK auth.users
tracked_course_id uuid FK tracked_courses
lms_assignment_id text, assignment_title text
submission_status enum: not_started | submitted | graded | late
submitted_at timestamptz, graded_at timestamptz, grade numeric(5,2)
created_at timestamptz, updated_at timestamptz
```

**experiment_assignments** — stable per-user experiment arm assignment
```sql
user_id uuid PK FK auth.users
experiment_id text, arm text
assigned_at timestamptz
-- Used for A/B testing feature allocation
```

**experiments** — experiment registry with status and graduation tracking
```sql
id text PK (unique experiment name)
description text, status enum: planning | running | completed
variant_a_arm text, variant_b_arm text
start_date date, end_date date
graduation_threshold numeric(5,2),
created_at timestamptz, updated_at timestamptz
```

---

## Frontend Architecture

### Single-Component Design

`src/App.jsx` is an intentional ~7800-line monolithic React component. All state, all data fetching, and all action execution live here for tight coordination between async AI responses and UI state.

### Layout Modes

The app supports four layout modes (switched via UI controls):

| Mode | Description |
|------|-------------|
| `studio` | Default. Two-column: sidebar nav + center chat. Glass-card aesthetic. |
| `sidebar` | Classic sidebar layout with collapsible nav + optional notes companion panel. |
| `topbar` | Horizontal top nav + full-width chat area. |
| `lofi` | Three-column study mode: left panel (schedule/tasks) + center chat + right panel (notes). Resizable columns with drag handles. |

### Active Panels

Within the main view area, `activePanel` switches between:
- `chat` — main AI chat interface (default); includes coaching modes via `clue` and `work_check` intents
- `home` — custom home screen with focus widget + optional background
- `settings` — appearance, API connectors, notification preferences

### Companion Panels (sidebar/lofi modes)

- Notes panel (`sidebarCompanionPanel: 'notes'`) — hierarchical notes tree alongside chat
- Peek panel — quick-preview of a task or event
- Chat sidebar — secondary chat history view

### Key State Variables

```javascript
// Data
tasks[]           events[]           blocks{}          // keyed by "YYYY-MM-DD"
notes[]           studyPlans[]        flashcardDecks[]
grades[]          entityLinks[]       messages[]        // chat history
weatherData

// Pending (queued AI actions)
pending: {
  actions[],         // awaiting user review
  content,           // AI response text
  clarification,     // ask_clarification pending response
  clarificationAnswers{},
  linkSuggestions[], // entity_link suggestions
  proposal,          // propose_action pending approval
  queue[],           // batch actions to execute
}

// Timers
activeTimers[]     pomodoroSession    activeWidgets{}

// Settings (persisted in localStorage)
aiAutoApprove      // confidence >= 0.85 auto-apply
notifPrefs         // per-action notification settings
contentGenUsed     // daily content-gen usage counter (resets at midnight)

// AI status
currentModel       modelFallbackUsed  rpmSnapshot
pipelineProgress   // { phase, label, step, totalSteps, draft? }
```

### localStorage Keys

| Key | Purpose |
|-----|---------|
| `sos_layout_config` | Resizable column widths |
| `sos_ai_auto_approve` | Confidence gating threshold |
| `sos_notification_prefs` | Per-action notification settings |
| `sos_content_gen_usage` | Daily content-gen usage counter |
| `sos_home_background` | Custom background URL |
| `sos_focus_element` | Current focus widget state |
| `sos_sidebar_companion_panel` | Which companion panel is open |

### executeAction() — the action execution engine

Located around line 5889. Switch statement on `action.type`. Every action:
1. Resolves entity references (task/event by id or fuzzy title match)
2. Applies confidence gating
3. Calls the appropriate Supabase operation
4. Pushes an undo snapshot
5. Records to `recentlyExecutedActionsRef`

---

## Dynamic Context Enrichment — `shared/ai/context/enrich.ts`

Before every LLM turn, the server enriches context in parallel (all bounded at 3s; failures degrade gracefully):

1. **Behavioral signals** (`getBehavioralSignals`): 30-day completion rate, postpone-rate by subject, time-of-day histogram, recent abandons — queried from `task_events` via Supabase REST; hour-bucket in-process cache.

2. **RAG retrieval** (`retrieve`): top-8 `memory_embeddings` matching the intent query via pgvector cosine similarity + recency weighting.

3. **Study signals** (`getStudySignals`): mastery levels per subject, quiz performance, weak topics from `skill_hub_sessions`.

The client passes `clientTasks` (active tasks with due dates and subjects) and `clientCalendarDensity` (tasks-per-day + blocked-minutes-per-day) on every chat request.

**Assembled context snippet injected into the system prompt:**
```
BEHAVIORAL CONTEXT:
- 30-day completion rate: 78%
- Postpone rate (math): 0.45
- Frequent study hours: 19:00-21:00
- Recent abandons: [...]

SCHEDULE DENSITY:
- Tasks due May 28: 3
- Blocked minutes May 28: 120

RETRIEVED MEMORIES:
- "Chapter 5: Quadratic Equations" (similarity 0.92)

STUDY INSIGHTS:
- Linear algebra: mastery 0.65 (last quiz: 73%)
- Weak: eigenvalues
```

---

## Priority Engine — `shared/scheduling/priority.ts`

Pure, sync, no-I/O scorer. Used **server-side** (in `assembleContext`) and **client-side** (for `prioritize_tasks` action display).

### Score = weighted sum of 5 factors (each 0–1)

| Factor | Weight | Logic |
|--------|--------|-------|
| **Urgency** | 35% | Days-to-due exponential decay (3-day half-life); overdue = 1.0 |
| **Importance** | 25% | priority field (high=1.0, medium=0.6, low=0.3) + 0.15 boost for high-stakes subjects (math, chemistry, physics, calculus, AP, SAT, ACT, finals) |
| **Momentum** | 15% | Per-subject postpone rate from behavioral signals; high postpone → higher score |
| **Deadline Density** | 15% | Fraction of 5 tasks sharing same due date |
| **Friction** | 10% | `postpone_count × 0.15` |

`rankTasks(tasks, now, density, signals, topN?)` returns tasks sorted by score descending.
`buildCalendarDensity(tasks, blocks)` returns a per-date density map.

---

## Behavioral Signals — `shared/ai/signals/behavioral.ts`

`getBehavioralSignals(userId)` queries `task_events` via Supabase REST and returns:
```typescript
{
  completionRate30d: number,           // 0-1
  postponeRateBySubject: Record<string, number>,
  medianStudyHoursBySubject: Record<string, number>,
  timeHistogram: number[],             // 24 buckets (hour of day)
  recentAbandons: string[],            // task titles abandoned in last 7d
}
```

Hour-bucket in-process cache prevents redundant queries within the same hour.
`formatSignalsForContext(signals)` renders it as a ≤5-line string for the AI prompt.

## Study Signals — `shared/ai/signals/study.ts`

`getStudySignals(userId)` queries study performance data and returns:
```typescript
{
  masteryBySubject: Record<string, number>,      // 0-1 mastery per subject
  quizPerformanceBySubject: Record<string, number>,  // avg percentage score
  weakTopics: string[],                          // topics with <60% performance
  recentAttempts: number,                        // study_attempts count in last 7d
  strugglePatterns: Record<string, number>,      // frequency of flagged topics
}
```

Used to surface struggling topics and adaptive study recommendations.

---

## WikiLinks & Entity Linking

Notes support `[[Title]]` wikilink syntax. Links are stored in `entity_links` with an `origin` field:

| Origin | Meaning |
|--------|---------|
| `manual` | User explicitly linked two items |
| `wikilink` | Parsed from `[[X]]` in note content |
| `heuristic` | Auto-suggested by embedding cosine similarity |
| `llm` | LLM-gated suggestion (requires user approval) |
| `rejected` | User dismissed (suppresses re-suggestion) |

**Approval-first design**: WikiLinks and AI suggestions never auto-commit. They route to `LinkSuggestionCard` for user review. Confirmed links get a `confirmed_at` timestamp.

---

## LMS Integration

### Architecture
Browser extension (Chrome/Firefox) + backend confidence engine:

1. Extension parses assignment DOM on Google Classroom and Canvas pages
2. Posts evidence events to `POST /api/lms-event` (or Supabase edge function `sos-lms-event`)
3. `lms_submission_events` table appends evidence with `evidence_weight` (1–5) and `evidence_kind`
4. `sync-submissions` edge function (cron every 10 min) replays evidence per assignment; flips matching tasks to `done` when cumulative confidence ≥ 85
5. Completed via LMS sets `completion_source = 'lms'` on the task; LMS badge shown in UI

### Evidence Kinds
`text_indicator`, `url_state`, `submission_post`, `upload`, `grade_posted`, `page_visit`

### OAuth Flow
Google Classroom: `GET /api/lms-oauth-callback` → stores tokens in Supabase for background sync.

### LMS Provider Expansion
The LMS integration supports multiple platforms via the `lms_providers` catalog and adapter pattern (`shared/lms/adapters/`):
- **Google Classroom** (primary; OAuth enabled)
- **Canvas** (via `canvas_api.ts` helpers)
- **Schoology** (adapter available)
- **Custom** (extensible via provider registry for self-hosted LMS)

User OAuth tokens stored in `user_integrations` with refresh token management. Provider registry (`shared/lms/adapters/registry.ts`) enables pluggable LMS adapters.

---

## A/B Testing & Experiments

The system supports feature experimentation via stable per-user arm assignment:

**`experiment_assignments` table**: Each user assigned once to an experiment arm (e.g., `"variant_a"` or `"variant_b"`) on first encounter. Assignment stable across sessions.

**`experiments` table**: Registry of active/completed experiments with:
- `status`: planning | running | completed
- `start_date` / `end_date`: experiment window
- `graduation_threshold`: success metric threshold to graduate a variant

**Usage**: In chat handler or frontend, check `experiment_assignments` to route user through feature variant. No rebalancing mid-experiment.

---

## API Endpoints

### Vercel Node.js (`api/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Main chat endpoint; SSE or JSON based on `Accept` header |
| `/api/embed` | POST | Batch embeddings (max 200 inputs) via `gemini-embedding-002` |
| `/api/lms-courses` | POST | List available LMS courses |
| `/api/lms-tracked-courses` | POST | User's tracked course list |
| `/api/lms-oauth-callback` | GET | Google Classroom OAuth redirect |
| `/api/lms-ingest` | POST | Ingest assignment structure |
| `/api/lms-event` | POST | Receive submission evidence |
| `/api/lms-sync-trigger` | POST | Manual sync trigger |
| `/api/lms-confirm` | POST | Confirm a matched task |

### Chat request body (`ChatBody`)
```typescript
{
  mode?: string,            // "chat" | "planning" | "intent_plan" | "brain_dump" | "briefing" | "studio" | "study_pack" | "voice"
  systemPrompt?: string,
  messages: ChatMessage[],
  imageBase64?: string,
  imageMimeType?: string,
  audioBase64?: string,
  workspaceContext?: string,
  clientTasks?: Task[],
  clientCalendarDensity?: CalendarDensity,
  maxTokens?: number,
}
```

Auth: Bearer token extracted from `Authorization` header via `extractUserId()`.

### Supabase Edge Functions (Deno)

| Function | Description |
|----------|-------------|
| `sos-chat` | Deno mirror of `api/chat.ts` |
| `sos-voice` | Groq Whisper audio → text |
| `embed-batch` | Server-side embedding upserter |
| `sync-submissions` | Cron: LMS reconciliation |
| `sos-lms-event` | LMS webhook receiver |

**Dual-deployment contract**: Both `api/chat.ts` (Vercel) and `supabase/functions/sos-chat` call the same `handleChatRequest()` from `shared/ai/chat-handler.ts`. Only thin request normalization differs. All AI logic must work in both runtimes — use Web APIs only in `shared/`.

---

## Environment Variables

### Server-side
```
GROQ_API_KEY              — required for chat, vision, voice
GEMINI_API_KEY            — required for embeddings + fallback
SUPABASE_URL              — Supabase project URL
SUPABASE_SERVICE_ROLE_KEY — service role key for server-side ops
GOOGLE_CLIENT_ID          — LMS OAuth
GOOGLE_CLIENT_SECRET      — LMS OAuth
AI_PROVIDER_OVERRIDE      — set "gemini" to force Gemini rollback
```

### Client-side (VITE_ prefix)
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_GNEWS_TOKEN          — optional; 100 req/day free tier for news widget
VITE_GOOGLE_CLIENT_ID     — LMS setup popup
```

---

## Rate Limiting

- **Content generation modes** (studio, planning, intent_plan, study_pack): 5 per day per user
- **Chat / action_routing**: RPM (requests per minute) tier limits via `shared/rate-limit.ts`
- Daily content-gen usage tracked both server-side and in localStorage (`sos_content_gen_usage`)
- `RateLimitBanner` component displays current status and resets

---

## Key Conventions

1. **Model strings only in `router.ts`** — never reference model strings elsewhere. The vision override in `chat-core.ts` is the only exception (it depends on request payload).

2. **Zod as single source of truth** — schema defined once in `shared/ai/schemas/`, generates both LLM tool definitions and runtime validators.

3. **Transport agnosticism** — `chat-handler.ts` shared by both runtimes; both adapters are thin normalizers.

4. **Web APIs only in `shared/`** — no `Buffer`, no `require()`, no Node-only APIs. The same files run in Deno.

5. **No direct provider imports** — import from `shared/ai/providers/index.ts` via `getProvider()`, never directly from `gemini.ts` or `groq.ts`.

7. **Graceful degradation everywhere** — pipelines ship the draft if critique/refine fail; enrichment skips failed signals; provider falls back to Gemini.

8. **Confidence gating** — items below the threshold enter a review rail, never auto-apply.

9. **RLS everywhere** — all tables restrict to `auth.uid() = user_id`.

10. **Undo snapshots** — every action execution pushes a snapshot before mutation.

---

## Development Commands

```bash
npm run dev           # Vite dev server
npm run build         # Production build — must pass before pushing
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit (shared/, api/, supabase/functions/)
npm run eval:harness  # Score cached sample-runs.jsonl against fixtures
npm run eval:live     # Live AI calls, regenerate sample-runs.jsonl (needs GEMINI_API_KEY)
npm run eval:shadow   # Diff Flash vs Pro tier predictions
npm run eval:cost     # Cost-per-1k-requests projection
npm run eval:planning # Planning pipeline regression eval
```

**Build + typecheck must both pass before every push.**

---

## Feature Summary

| Feature | Where implemented |
|---------|------------------|
| AI chat with action routing | `shared/ai/chat-handler.ts`, `src/App.jsx executeAction()` |
| Natural language task/event creation | `actions.ts` schemas + `executeAction()` |
| 3-pass planning pipeline | `shared/ai/pipelines/planning.ts` |
| 3-pass intent-plan (weekly goal → schedule) | `shared/ai/pipelines/intent_plan.ts` |
| Brain-dump (voice/text → batch actions) | `shared/ai/pipelines/brain_dump.ts` |
| Daily briefing | `chat-handler.ts` mode: briefing |
| Flashcard decks | `flashcard_decks` table, `create_flashcards` action |
| Study packs (exam prep bundles) | `study_packs` table, `make_study_pack` action |
| AI quizzes + outlines + summaries | Studio actions via `studio.ts` schemas |
| Priority engine | `shared/scheduling/priority.ts` |
| Behavioral signals | `shared/ai/signals/behavioral.ts`, `task_events` table |
| RAG memory | `memory_embeddings` + pgvector + `match_memories` RPC |
| Dynamic context enrichment | `shared/ai/context/enrich.ts` |
| WikiLinks + entity graph | `entity_links` table, `WikilinkAutocomplete` component |
| Pomodoro + custom timers | `timers` table, `PomodoroTimer` component |
| Grades tracking | `grades` table, `log_grade` action |
| LMS submission sync | `lms_submission_events` table, browser extension, `sync-submissions` function |
| Skill Hub (interactive lessons) | `lessons` + `skill_hub_sessions` tables |
| Coaching system (hints + feedback) | `shared/coaching/`, `clue` and `work_check` intents |
| Agentic reasoning pipeline | `shared/ai/pipelines/agentic.ts` |
| Study performance signals | `shared/ai/signals/study.ts`, mastery tracking |
| A/B testing + experiments | `experiments` + `experiment_assignments` tables |
| Studio layout | `layoutMode: 'studio'`, `StudioDashboard`, `StudioSidebar` |
| Streaming AI with progress stepper | SSE frames + `pipelineProgress` state |
| Confidence gating + review rail | `pending.actions[]` + `aiAutoApprove` setting |
| Undo system | Snapshot stack in `App.jsx` |
| Cross-provider AI fallback | `router.ts` + `chat-core.ts` retry logic |
