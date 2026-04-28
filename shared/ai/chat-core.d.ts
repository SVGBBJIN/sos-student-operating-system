export type ChatMessage = { role: string; content: unknown };
export type ChatAction = { type: string; [key: string]: unknown };
export type ValidationWarning = {
  tool: string;
  missing_fields: string[];
  issues: Array<{ field: string; issue: string; expected?: string; actual?: string }>;
};
export type Clarification = {
  reason: string;
  question: string;
  options: string[];
  multi_select: boolean;
  context_action?: string;
  missing_fields?: string[];
};
export type ParsedLlmResponse = {
  content: string;
  actions: ChatAction[];
  clarification: Clarification | null;
  clarifications: Clarification[];
  validation_warnings: ValidationWarning[];
  model_used?: string;
  attempt_count?: number;
  retry_wait_ms_total?: number;
  fallback_used?: boolean;
};
export type CallGroqRequest = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  maxTokens?: number;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  includeTools?: boolean;
  toolsOverride?: any[] | null;
  toolChoiceOverride?: "auto" | "required";
  backupModel?: string | null;
  options?: {
    isContentGen?: boolean;
    budgetMs?: number;
    staticSystemPrompt?: string | null;
    dynamicContext?: string | null;
  };
};
export const CORE_VERSION: string;
export const CORE_CHECKSUM: string;
export const PRIMARY_MODEL: string;
export const MODEL_DEEP: string;
export const MODEL_FAST: string;
export const ACTION_TOOLS: any[];
export const STUDIO_TOOLS: any[];
export function resolveModel(requested: string | null | undefined): string;
export function getGroqRpmStatus(): {
  remaining: number; limit: number; resetAtMs: number; count: number; nearLimit: boolean;
};
export function parseLlmResponse(data: any): ParsedLlmResponse;
export function callGroq(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  maxTokens?: number,
  imageBase64?: string | null,
  imageMimeType?: string | null,
  includeTools?: boolean,
  toolsOverride?: any[] | null,
  toolChoiceOverride?: "auto" | "required",
  backupModel?: string | null,
  options?: CallGroqRequest["options"],
): Promise<ParsedLlmResponse>;
