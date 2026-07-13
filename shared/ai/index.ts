// Public entrypoint for shared/ai. Handlers should import from here.

export { callModel, RpmExhaustedError } from "./chat-core.js";
export type {
  CallModelRequest,
  CallModelResponse,
  ChatAction,
  ClarificationCard,
} from "./chat-core.js";
export { handleChatRequest } from "./chat-handler.js";
export type { ChatBody, ChatOutcome, HandleChatInput } from "./chat-handler.js";
export { getRpmStatus, aggregateRpmStatus, nearLimit, overLimit, type RpmStatus } from "./rpm-tracker.js";
export { route, type Intent, type Tier } from "./router.js";
export { getProvider, type ProviderName } from "./providers/index.js";
export type { LlmProvider, ChatRequest, ChatResponse, StreamChunk, Message, ToolCall } from "./providers/types.js";
export { runPlanPipeline, PlanPipelineError } from "./pipelines/plan.js";
export { embedBatch, embedQuery } from "./rag/embeddings.js";
export { retrieve } from "./rag/retrieve.js";
export { assembleContext } from "./context/assembler.js";
export { enrichDynamicContext } from "./context/enrich.js";
export { SCHEMA_VERSIONS } from "./schemas/versions.js";
export { buildActionToolDefs, validateAction } from "./schemas/actions.js";
export { buildPlanToolDefs, validatePlan } from "./schemas/studio.js";
export { buildCoachingToolDefs, validateCoaching } from "./schemas/coaching.js";
export type { MakeClueInput, MakeWorkCheckInput } from "./schemas/coaching.js";
export {
  CLUE_SYSTEM,
  WORK_CHECK_SYSTEM,
  buildClueContext,
  buildWorkCheckContext,
  normalizeWorkCheckAction,
  resolveProofread,
} from "./coaching.js";
export {
  classifyContentType,
  normalizeCheckCards,
  computeCoverage,
  proofreadState,
  resolveAutoProofreadTrigger,
  type ContentType,
  type CheckCard,
  type Coverage,
  type ProofreadState,
  type ProofreadTrigger,
} from "../coaching/workcheck.js";
export type { BehavioralSignals } from "./signals/behavioral.js";
export { getBehavioralSignals, formatSignalsForContext } from "./signals/behavioral.js";
export type { StudySignals, WeakTopic } from "./signals/study.js";
export { getStudySignals, formatStudySignalsForContext } from "./signals/study.js";
