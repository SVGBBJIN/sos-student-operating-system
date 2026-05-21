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
export { runPlanningPipeline, PlanningPipelineError } from "./pipelines/planning.js";
export { runIntentPlanPipeline, IntentPlanPipelineError } from "./pipelines/intent_plan.js";
export { runProofread, PROOFREAD_BUCKETS } from "./pipelines/proofread.js";
export { embedBatch, embedQuery } from "./rag/embeddings.js";
export { retrieve } from "./rag/retrieve.js";
export { assembleContext } from "./context/assembler.js";
export { enrichDynamicContext } from "./context/enrich.js";
export { SCHEMA_VERSIONS } from "./schemas/versions.js";
export { buildActionToolDefs, validateAction } from "./schemas/actions.js";
export { buildStudioToolDefs, validateStudio } from "./schemas/studio.js";
export { buildIntentPlanToolDefs, validateIntentPlan } from "./schemas/intent_plan.js";
export { buildStudyPackToolDefs, validateStudyPack } from "./schemas/study_pack.js";
export type { MakeStudyPackInput } from "./schemas/study_pack.js";
export type { BehavioralSignals } from "./signals/behavioral.js";
export { getBehavioralSignals, formatSignalsForContext } from "./signals/behavioral.js";
