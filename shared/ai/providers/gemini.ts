// Gemini provider wrapping the official @google/genai SDK.
//
// Public surface matches LlmProvider (types.ts). Three responsibilities:
//   - chat(): non-streaming generateContent with tools / responseSchema / multimodal
//   - stream(): generateContentStream pumped through normalized StreamChunk events
//   - embed(): embedContent for Gemini Embedding 2 (gemini-embedding-002)
//
// Knobs surfaced through ChatRequest map to Gemini config:
//   responseSchema → strict typed JSON via responseMimeType: application/json
//   thinkingBudget → thinkingConfig.thinkingBudget (per-tier cost control)
//   grounding.googleSearch → enables Gemini's built-in web search tool
//   staticSystemPrompt/dynamicContext → composed into systemInstruction so callers
//     can preserve the prompt-cache contract from the previous Groq path.

import {
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Part,
  type Tool,
} from "@google/genai";

import type {
  Attachment,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  LlmProvider,
  Message,
  StreamChunk,
  ToolCall,
  TokenUsage,
} from "./types.js";

const EMBED_MODEL = "gemini-embedding-002";

function toGeminiParts(content: string, attachments?: Attachment[]): Part[] {
  const parts: Part[] = [];
  for (const a of attachments ?? []) {
    parts.push({ inlineData: { mimeType: a.mimeType, data: a.base64 } });
  }
  if (content && content.trim()) {
    parts.push({ text: content });
  }
  if (parts.length === 0) parts.push({ text: "" });
  return parts;
}

function toGeminiContents(messages: Message[], attachments?: Attachment[]): Content[] {
  const contents: Content[] = [];
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return i;
    }
    return -1;
  })();
  messages.forEach((m, idx) => {
    if (m.role === "system") return;
    const role = m.role === "assistant" ? "model" : "user";
    const text = typeof m.content === "string" ? m.content : "";
    const merged = idx === lastUserIdx ? [...(m.attachments ?? []), ...(attachments ?? [])] : m.attachments ?? [];
    contents.push({ role, parts: toGeminiParts(text, merged) });
  });
  return contents;
}

function toGeminiFunctionDeclarations(tools: ChatRequest["tools"]): FunctionDeclaration[] {
  return (tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as FunctionDeclaration["parameters"],
  }));
}

function composeSystemInstruction(req: ChatRequest): string | undefined {
  const parts = [req.staticSystemPrompt, req.systemPrompt, req.dynamicContext]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  if (parts.length === 0) return undefined;
  return parts.join("\n\n");
}

function normalizeUsage(res: GenerateContentResponse): TokenUsage {
  const meta = (res as { usageMetadata?: Record<string, number> }).usageMetadata;
  return {
    prompt_tokens: meta?.promptTokenCount,
    output_tokens: meta?.candidatesTokenCount,
    cached_tokens: meta?.cachedContentTokenCount,
    thinking_tokens: meta?.thoughtsTokenCount,
  };
}

function extractToolCalls(res: GenerateContentResponse): ToolCall[] {
  const calls: ToolCall[] = [];
  const candidates = (res as { candidates?: Array<{ content?: { parts?: Part[] } }> }).candidates ?? [];
  for (const c of candidates) {
    for (const p of c.content?.parts ?? []) {
      const fc = (p as { functionCall?: { name?: string; args?: Record<string, unknown> } }).functionCall;
      if (fc?.name) calls.push({ name: fc.name, args: fc.args ?? {} });
    }
  }
  return calls;
}

function extractText(res: GenerateContentResponse): string {
  const candidates = (res as { candidates?: Array<{ content?: { parts?: Part[] } }> }).candidates ?? [];
  let out = "";
  for (const c of candidates) {
    for (const p of c.content?.parts ?? []) {
      const t = (p as { text?: string }).text;
      if (typeof t === "string") out += t;
    }
  }
  return out.trim();
}

function extractGrounding(res: GenerateContentResponse): object | undefined {
  const meta = (res as { candidates?: Array<{ groundingMetadata?: object }> }).candidates?.[0]?.groundingMetadata;
  return meta ?? undefined;
}

function buildToolsConfig(req: ChatRequest): Tool[] | undefined {
  const tools: Tool[] = [];
  if (req.tools && req.tools.length > 0) {
    tools.push({ functionDeclarations: toGeminiFunctionDeclarations(req.tools) });
  }
  if (req.grounding?.googleSearch) {
    tools.push({ googleSearch: {} } as Tool);
  }
  return tools.length > 0 ? tools : undefined;
}

function buildConfig(req: ChatRequest): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    temperature: req.temperature ?? 0.3,
    topP: req.topP ?? 1,
  };
  if (req.maxOutputTokens) cfg.maxOutputTokens = req.maxOutputTokens;
  const sys = composeSystemInstruction(req);
  if (sys) cfg.systemInstruction = sys;
  const tools = buildToolsConfig(req);
  if (tools) cfg.tools = tools;
  if (req.toolChoice === "required") {
    cfg.toolConfig = { functionCallingConfig: { mode: "ANY" } };
  } else if (req.toolChoice === "none") {
    cfg.toolConfig = { functionCallingConfig: { mode: "NONE" } };
  }
  if (req.responseSchema) {
    cfg.responseMimeType = req.responseMimeType ?? "application/json";
    cfg.responseSchema = req.responseSchema;
  } else if (req.responseMimeType) {
    cfg.responseMimeType = req.responseMimeType;
  }
  if (typeof req.thinkingBudget === "number") {
    cfg.thinkingConfig = { thinkingBudget: req.thinkingBudget };
  }
  if (req.signal) cfg.abortSignal = req.signal;
  return cfg;
}

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("GeminiProvider: apiKey is required");
    this.client = new GoogleGenAI({ apiKey });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const contents = toGeminiContents(req.messages, req.attachments);
    const config = buildConfig(req);
    const res = await this.client.models.generateContent({
      model: req.model,
      contents,
      config,
    });
    return {
      content: extractText(res),
      toolCalls: extractToolCalls(res),
      usage: normalizeUsage(res),
      modelUsed: req.model,
      groundingMetadata: extractGrounding(res),
      finishReason: (res as { candidates?: Array<{ finishReason?: string }> }).candidates?.[0]?.finishReason,
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<StreamChunk> {
    const contents = toGeminiContents(req.messages, req.attachments);
    const config = buildConfig(req);
    let lastUsage: TokenUsage | undefined;
    let finishReason: string | undefined;
    try {
      const it = await this.client.models.generateContentStream({
        model: req.model,
        contents,
        config,
      });
      for await (const chunk of it as AsyncIterable<GenerateContentResponse>) {
        const text = extractText(chunk);
        if (text) yield { type: "delta", text };
        const calls = extractToolCalls(chunk);
        for (const tc of calls) yield { type: "tool_call", toolCall: tc };
        const usage = normalizeUsage(chunk);
        if (usage.prompt_tokens || usage.output_tokens) {
          lastUsage = usage;
          yield { type: "usage", usage };
        }
        const grounding = extractGrounding(chunk);
        if (grounding) yield { type: "grounding", metadata: grounding };
        const fr = (chunk as { candidates?: Array<{ finishReason?: string }> }).candidates?.[0]?.finishReason;
        if (fr) finishReason = fr;
      }
      yield { type: "done", finishReason, usage: lastUsage };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: "error", message };
    }
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const dim = req.dim ?? 1536;
    const config: Record<string, unknown> = {
      taskType: req.taskType ?? "RETRIEVAL_DOCUMENT",
      outputDimensionality: dim,
    };
    if (req.signal) config.abortSignal = req.signal;
    const res = await this.client.models.embedContent({
      model: EMBED_MODEL,
      contents: req.inputs,
      config,
    });
    const embeddings = (res as { embeddings?: Array<{ values: number[] }> }).embeddings ?? [];
    return {
      vectors: embeddings.map((e) => e.values),
      model: EMBED_MODEL,
      dim,
    };
  }
}
