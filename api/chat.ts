// Vercel serverless adapter — chat surface.
//
// Thin transport shim over shared/ai/chat-handler.ts. All routing, mode
// dispatch, context enrichment and error shaping live in handleChatRequest so
// this file and the Deno mirror (supabase/functions/sos-chat) cannot drift.
//
// Response modes:
//   - SSE  (Accept: text/event-stream) — streams delta/tool_call/done frames.
//   - JSON (otherwise) — returns the final aggregated payload.

import { handleChatRequest } from "../shared/ai/index.js";
import type { ChatBody, StreamChunk } from "../shared/ai/index.js";
import { extractUserId } from "../shared/auth.js";
import { createSSEWriterForNode, type NodeResponseLike } from "../shared/sse.js";

// Minimal request/response shapes — avoids the @vercel/node type dependency.
interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}
interface VercelResponse {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): void;
  json(payload: unknown): void;
  end(payload?: string): void;
  headersSent?: boolean;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;

function applyCors(res: VercelResponse): void {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

function wantsSSE(req: VercelRequest): boolean {
  const accept = String(req.headers.accept ?? req.headers.Accept ?? "");
  return /text\/event-stream/i.test(accept);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyCors(res);
  if (req.method === "OPTIONS") {
    res.status(200).end("ok");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as ChatBody;
    const authHeader = req.headers.authorization;
    const userId = extractUserId(typeof authHeader === "string" ? authHeader : null);

    const outcome = await handleChatRequest({ body, userId, wantsSSE: wantsSSE(req) });

    if (outcome.kind === "json") {
      if (outcome.headers) {
        for (const [k, v] of Object.entries(outcome.headers)) res.setHeader(k, v);
      }
      res.status(outcome.status).json(outcome.json);
      return;
    }

    // Streaming chat — own the SSE transport, delegate the model call.
    const writer = createSSEWriterForNode(res as unknown as NodeResponseLike);
    try {
      const done = await outcome.run((chunk: StreamChunk) => {
        if (chunk.type === "delta") writer.send({ event: "delta", data: { text: chunk.text } });
        else if (chunk.type === "tool_call") writer.send({ event: "tool_call", data: chunk.toolCall });
        else if (chunk.type === "usage") writer.send({ event: "usage", data: chunk.usage });
        else if (chunk.type === "grounding") writer.send({ event: "grounding", data: chunk.metadata });
        else if (chunk.type === "progress") writer.send({ event: "progress", data: chunk.event });
      });
      writer.send({ event: "done", data: done });
    } catch (err) {
      writer.send({ event: "error", data: { message: err instanceof Error ? err.message : String(err) } });
    } finally {
      writer.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/chat error:", message);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
}
