// Groq provider — OpenAI-compatible REST against api.groq.com.
//
// Surface matches LlmProvider (types.ts):
//   - chat(): POST /openai/v1/chat/completions
//   - stream(): same endpoint with stream: true; normalizes SSE chunks
//   - embed(): throws — embeddings live on the Gemini provider
//
// Per-request knob translation:
//   ChatRequest.responseSchema → response_format: { type: "json_schema", ... }
//                                 (passes through geminiToOpenAISchema)
//   ChatRequest.thinkingBudget → reasoning_effort: "low"|"medium"|"high"
//   ChatRequest.staticSystemPrompt + systemPrompt + dynamicContext →
//                                 two separate system messages so Groq prefix
//                                 caching kicks in on the stable portion.
//
// Tool calling:
//   - Out: tools[] mapped to { type: "function", function: {...} }
//   - In (non-streaming): tool_calls[].function.arguments is a stringified JSON
//     blob; JSON.parse inside the provider, surface to callers as
//     ToolCall.args: Record<string, unknown>.
//   - In (streaming): args arrive as incremental fragments keyed by index;
//     buffer until finish_reason === "tool_calls", then emit one
//     {type:"tool_call"} chunk.

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
  ToolDef,
  TokenUsage,
} from "./types.js";

const GROQ_BASE = "https://api.groq.com/openai/v1";

// ── Schema translation: Gemini-flavored JSON Schema → OpenAI strict ─────────
// Gemini uses `nullable: true`. OpenAI uses `type: [..., "null"]`. OpenAI strict
// mode also requires `additionalProperties: false` on every object. We walk the
// schema recursively; this is safe because all our Zod-generated schemas are
// closed-shape (no open dictionaries).

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  enum?: unknown[];
  description?: string;
  format?: string;
  nullable?: boolean;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: boolean;
  [k: string]: unknown;
};

function geminiToOpenAISchema(input: unknown): JsonSchema {
  if (input === null || typeof input !== "object") return input as JsonSchema;
  if (Array.isArray(input)) {
    return input.map((v) => geminiToOpenAISchema(v)) as unknown as JsonSchema;
  }
  const src = input as JsonSchema;
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "nullable") continue; // handled below
    if (k === "properties" && v && typeof v === "object") {
      const mapped: Record<string, JsonSchema> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, JsonSchema>)) {
        mapped[pk] = geminiToOpenAISchema(pv);
      }
      out.properties = mapped;
    } else if (k === "items") {
      out.items = Array.isArray(v)
        ? (v.map((x) => geminiToOpenAISchema(x)) as unknown as JsonSchema[])
        : geminiToOpenAISchema(v);
    } else if (k === "anyOf" || k === "oneOf" || k === "allOf") {
      out[k] = (v as JsonSchema[]).map((x) => geminiToOpenAISchema(x));
    } else {
      (out as Record<string, unknown>)[k] = v as unknown;
    }
  }
  if (src.nullable) {
    if (typeof out.type === "string") out.type = [out.type, "null"];
    else if (Array.isArray(out.type) && !out.type.includes("null")) out.type = [...out.type, "null"];
  }
  if (out.type === "object" && out.additionalProperties === undefined) {
    out.additionalProperties = false;
  }
  return out;
}

// ── Thinking budget → reasoning effort ──────────────────────────────────────

function thinkingBudgetToReasoningEffort(n: number | undefined): "low" | "medium" | "high" | undefined {
  if (n == null) return undefined;
  if (n <= 0) return "low"; // gpt-oss can't disable reasoning entirely
  if (n <= 512) return "low";
  if (n <= 1024) return "medium";
  return "high";
}

// ── Tool translation ────────────────────────────────────────────────────────

interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

function toGroqTools(tools?: ToolDef[]): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: geminiToOpenAISchema(t.parameters as JsonSchema),
    },
  }));
}

function toGroqToolChoice(choice: ChatRequest["toolChoice"]): string | undefined {
  if (choice === "auto" || choice === "required" || choice === "none") return choice;
  return undefined;
}

function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : { _malformed: raw };
  } catch {
    return { _malformed: raw };
  }
}

// ── Message translation ─────────────────────────────────────────────────────

interface GroqMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  tool_call_id?: string;
  name?: string;
}

function ensureNoAudio(attachments: Attachment[] | undefined, ctx: string): void {
  if (attachments?.some((a) => a.kind === "audio")) {
    throw new Error(`GroqProvider received audio attachment in ${ctx}; use the voice helper instead`);
  }
  if (attachments?.some((a) => a.kind === "pdf")) {
    throw new Error(`GroqProvider does not support PDF attachments (${ctx})`);
  }
}

function toGroqContent(text: string, attachments: Attachment[] | undefined): GroqMessage["content"] {
  if (!attachments || attachments.length === 0) return text;
  const images = attachments.filter((a) => a.kind === "image");
  if (images.length === 0) return text;
  const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
  if (text && text.trim()) parts.push({ type: "text", text });
  for (const img of images) {
    parts.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}` } });
  }
  return parts;
}

function buildSystemMessages(req: ChatRequest): GroqMessage[] {
  const out: GroqMessage[] = [];
  // Two-system-message split: stable static prompt first (cacheable across
  // requests), then the volatile portion that includes user-specific context.
  if (req.staticSystemPrompt && req.staticSystemPrompt.trim()) {
    out.push({ role: "system", content: req.staticSystemPrompt });
  }
  const dynamicParts = [req.systemPrompt, req.dynamicContext].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );
  if (dynamicParts.length > 0) {
    out.push({ role: "system", content: dynamicParts.join("\n\n") });
  }
  return out;
}

function buildMessages(req: ChatRequest): GroqMessage[] {
  const system = buildSystemMessages(req);
  const lastUserIdx = (() => {
    for (let i = req.messages.length - 1; i >= 0; i--) {
      if (req.messages[i]?.role === "user") return i;
    }
    return -1;
  })();
  const turns: GroqMessage[] = [];
  req.messages.forEach((m: Message, idx) => {
    if (m.role === "system") return; // any inline system messages already folded into staticSystemPrompt
    const merged: Attachment[] = idx === lastUserIdx
      ? [...(m.attachments ?? []), ...(req.attachments ?? [])]
      : (m.attachments ?? []);
    ensureNoAudio(merged, `message[${idx}]`);
    const text = typeof m.content === "string" ? m.content : "";
    turns.push({
      role: m.role === "assistant" ? "assistant" : m.role === "tool" ? "tool" : "user",
      content: toGroqContent(text, merged),
    });
  });
  return [...system, ...turns];
}

// ── Body construction ───────────────────────────────────────────────────────

function buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: buildMessages(req),
    temperature: req.temperature ?? 0.3,
    top_p: req.topP ?? 1,
    stream,
  };
  if (req.maxOutputTokens) body.max_tokens = req.maxOutputTokens;
  const tools = toGroqTools(req.tools);
  if (tools) body.tools = tools;
  const toolChoice = toGroqToolChoice(req.toolChoice);
  if (toolChoice) body.tool_choice = toolChoice;
  if (req.responseSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: geminiToOpenAISchema(req.responseSchema as JsonSchema),
        strict: true,
      },
    };
  }
  const effort = thinkingBudgetToReasoningEffort(req.thinkingBudget);
  if (effort) body.reasoning_effort = effort;
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

function normalizeUsage(raw: Record<string, unknown> | undefined): TokenUsage {
  if (!raw) return {};
  const usage = raw as { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } };
  return {
    prompt_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    cached_tokens: usage.prompt_tokens_details?.cached_tokens,
    thinking_tokens: usage.completion_tokens_details?.reasoning_tokens,
  };
}

// ── Provider ────────────────────────────────────────────────────────────────

interface GroqChoiceMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
}

interface GroqResponse {
  choices: Array<{ message: GroqChoiceMessage; finish_reason?: string }>;
  usage?: Record<string, unknown>;
}

interface GroqStreamChoice {
  delta?: {
    content?: string;
    reasoning?: string;
    tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason?: string | null;
}

interface GroqStreamEvent {
  choices?: GroqStreamChoice[];
  usage?: Record<string, unknown>;
  x_groq?: { usage?: Record<string, unknown> };
}

export class GroqProvider implements LlmProvider {
  readonly name = "groq";
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("GroqProvider: GROQ_API_KEY is required");
    this.apiKey = apiKey;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    ensureNoAudio(req.attachments, "chat()");
    const body = buildBody(req, false);
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`Groq request failed (${res.status}): ${text.slice(0, 500)}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    const data = (await res.json()) as GroqResponse;
    const choice = data.choices?.[0];
    const msg = choice?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? [])
      .filter((tc) => tc.function?.name)
      .map((tc) => ({
        id: tc.id,
        name: tc.function!.name!,
        args: parseToolArgs(tc.function?.arguments),
      }));
    return {
      content: typeof msg?.content === "string" ? msg.content.trim() : "",
      toolCalls,
      usage: normalizeUsage(data.usage),
      modelUsed: req.model,
      finishReason: choice?.finish_reason,
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<StreamChunk> {
    ensureNoAudio(req.attachments, "stream()");
    const body = buildBody(req, true);
    let res: Response;
    try {
      res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
      return;
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      yield { type: "error", message: `Groq stream failed (${res.status}): ${text.slice(0, 500)}` };
      return;
    }

    const buffers = new Map<number, { id?: string; name?: string; args: string }>();
    let lastUsage: TokenUsage | undefined;
    let finishReason: string | undefined;
    let emitted = false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let leftover = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        leftover += decoder.decode(value, { stream: true });
        const events = leftover.split("\n\n");
        leftover = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let parsed: GroqStreamEvent;
          try { parsed = JSON.parse(payload) as GroqStreamEvent; }
          catch { continue; }

          const choice = parsed.choices?.[0];
          const delta = choice?.delta;
          if (delta?.content) {
            yield { type: "delta", text: delta.content };
          }
          if (delta?.reasoning) {
            yield { type: "thinking", text: delta.reasoning };
          }
          for (const tcDelta of delta?.tool_calls ?? []) {
            const b = buffers.get(tcDelta.index) ?? { args: "" };
            if (tcDelta.id) b.id = tcDelta.id;
            if (tcDelta.function?.name) b.name = tcDelta.function.name;
            if (tcDelta.function?.arguments) b.args += tcDelta.function.arguments;
            buffers.set(tcDelta.index, b);
          }
          const usageBlock = parsed.usage ?? parsed.x_groq?.usage;
          if (usageBlock) {
            lastUsage = normalizeUsage(usageBlock);
            yield { type: "usage", usage: lastUsage };
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
            for (const b of buffers.values()) {
              if (!b.name) continue;
              yield {
                type: "tool_call",
                toolCall: { id: b.id, name: b.name, args: parseToolArgs(b.args) },
              };
            }
            buffers.clear();
            emitted = true;
          }
        }
      }
      // Drain any unemitted tool calls (e.g. provider didn't surface finish_reason
      // on a separate chunk).
      if (!emitted) {
        for (const b of buffers.values()) {
          if (!b.name) continue;
          yield {
            type: "tool_call",
            toolCall: { id: b.id, name: b.name, args: parseToolArgs(b.args) },
          };
        }
      }
      yield { type: "done", finishReason, usage: lastUsage };
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    } finally {
      reader.releaseLock?.();
    }
  }

  async embed(_req: EmbedRequest): Promise<EmbedResponse> {
    throw new Error("GroqProvider does not implement embed(); use the Gemini provider for embeddings");
  }
}
