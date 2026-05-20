// sos-chat Edge Function — chat surface. Deno adapter.
//
// Thin transport shim over shared/ai/chat-handler.ts; mirrors api/chat.ts.
// All routing, mode dispatch, context enrichment and error shaping live in
// handleChatRequest so the two runtimes cannot drift.

import { handleChatRequest, SCHEMA_VERSIONS } from "../../../shared/ai/index.js";
import type { ChatBody, StreamChunk } from "../../../shared/ai/index.js";
import { extractUserId } from "../../../shared/auth.js";
import { createSSEStream } from "../../../shared/sse.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

console.log(`[sos-chat] adapter=supabase providers=groq+gemini-embed schema_version=${SCHEMA_VERSIONS.action_tools}`);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
};

function wantsSSE(req: Request): boolean {
  return /text\/event-stream/i.test(req.headers.get("accept") ?? "");
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as ChatBody;
    const userId = extractUserId(req.headers.get("Authorization"));

    const outcome = await handleChatRequest({ body, userId, wantsSSE: wantsSSE(req) });

    if (outcome.kind === "json") {
      return new Response(JSON.stringify(outcome.json), {
        status: outcome.status,
        headers: { ...corsHeaders, "Content-Type": "application/json", ...(outcome.headers ?? {}) },
      });
    }

    // Streaming chat — own the SSE transport, delegate the model call. The run
    // is pumped in the background so the streaming Response returns immediately.
    const { response, writer } = createSSEStream();
    (async () => {
      try {
        const done = await outcome.run((chunk: StreamChunk) => {
          if (chunk.type === "delta") writer.send({ event: "delta", data: { text: chunk.text } });
          else if (chunk.type === "tool_call") writer.send({ event: "tool_call", data: chunk.toolCall });
          else if (chunk.type === "usage") writer.send({ event: "usage", data: chunk.usage });
          else if (chunk.type === "grounding") writer.send({ event: "grounding", data: chunk.metadata });
        });
        writer.send({ event: "done", data: done });
      } catch (err) {
        writer.send({ event: "error", data: { message: err instanceof Error ? err.message : String(err) } });
      } finally {
        writer.close();
      }
    })();
    return new Response(response.body, { headers: { ...corsHeaders, ...Object.fromEntries(response.headers) } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sos-chat error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
