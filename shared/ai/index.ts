// Public entrypoint for shared/ai. Handlers should import from here.

export { callModel, RpmExhaustedError } from "./chat-core.js";
export type {
  CallModelRequest,
  CallModelResponse,
  ChatAction,
  ClarificationCard,
} from "./chat-core.js";
export { getRpmStatus, aggregateRpmStatus, nearLimit, overLimit, type RpmStatus } from "./rpm-tracker.js";
export { route, modelForTier, fallbackForTier, type Intent, type Tier } from "./router.js";
export { getProvider, type ProviderName } from "./providers/index.js";
export type { LlmProvider, ChatRequest, ChatResponse, StreamChunk, Message, ToolCall } from "./providers/types.js";
export { runPlanningPipeline, PlanningPipelineError } from "./pipelines/planning.js";
export { runProofread, PROOFREAD_BUCKETS } from "./pipelines/proofread.js";
export { embedBatch, embedQuery } from "./rag/embeddings.js";
export { retrieve } from "./rag/retrieve.js";
export { assembleContext } from "./context/assembler.js";
export { compressOlderTurns } from "./context/compressor.js";
export { SCHEMA_VERSIONS } from "./schemas/versions.js";
export { buildActionToolDefs, validateAction } from "./schemas/actions.js";
export { buildStudioToolDefs, validateStudio } from "./schemas/studio.js";
