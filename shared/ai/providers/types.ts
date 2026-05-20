// Provider-agnostic interface for chat, streaming, and embeddings.

export type Role = "system" | "user" | "assistant" | "tool";

export interface Attachment {
  kind: "image" | "audio" | "pdf";
  mimeType: string;
  base64: string;
}

export interface Message {
  role: Role;
  content: string;
  attachments?: Attachment[];
  toolCallId?: string;
  toolName?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: object;
}

export interface TokenUsage {
  prompt_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  thinking_tokens?: number;
}

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  systemPrompt?: string;
  staticSystemPrompt?: string;
  dynamicContext?: string;
  messages: Message[];
  tools?: ToolDef[];
  toolChoice?: "auto" | "required" | "none";
  responseSchema?: object;
  responseMimeType?: string;
  attachments?: Attachment[];
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  budgetMs?: number;
  grounding?: { googleSearch?: boolean };
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  modelUsed: string;
  groundingMetadata?: object;
  finishReason?: string;
}

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: TokenUsage }
  | { type: "grounding"; metadata: object }
  | { type: "done"; finishReason?: string; usage?: TokenUsage }
  | { type: "error"; message: string; code?: string };

export interface EmbedRequest {
  inputs: string[];
  taskType?:
    | "RETRIEVAL_DOCUMENT"
    | "RETRIEVAL_QUERY"
    | "SEMANTIC_SIMILARITY"
    | "CLASSIFICATION"
    | "CLUSTERING";
  dim?: number;
  signal?: AbortSignal;
}

export interface EmbedResponse {
  vectors: number[][];
  model: string;
  dim: number;
}

export interface LlmProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream(req: ChatRequest): AsyncIterable<StreamChunk>;
  embed(req: EmbedRequest): Promise<EmbedResponse>;
}
