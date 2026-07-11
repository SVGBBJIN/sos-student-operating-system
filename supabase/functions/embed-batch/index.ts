// embed-batch Edge Function. Authoritative server-side worker for backfilling
// memory_embeddings rows. Accepts:
//   POST { user_id, items: [{ source, source_id, text, metadata?, chunk_idx? }] }
//
// Computes embeddings, upserts via REST. Safe to invoke from a cron schedule
// or from the client after a note edit.

import { embedBatch } from "../../../shared/ai/index.js";
import { getEnv } from "../../../shared/env.js";
import { extractUserId } from "../../../shared/auth.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Item {
  source: string;
  source_id: string;
  text: string;
  metadata?: Record<string, unknown>;
  chunk_idx?: number;
}

interface Body {
  items: Item[];
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = getEnv("GEMINI_API_KEY");
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Required env not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // The caller's own bearer token is the source of truth for whose rows this
  // writes — a client-supplied user_id in the body would let anyone embed
  // (and later retrieve via match_memories) content under another user's id.
  const userId = extractUserId(req.headers.get("authorization"));
  if (!userId) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as Body;
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return new Response(JSON.stringify({ error: "items[] is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (body.items.length > 50) {
      return new Response(JSON.stringify({ error: "Too many items (max 50 per request)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const texts = body.items.map((i) => i.text);
    const vectors = await embedBatch(texts, "RETRIEVAL_DOCUMENT", 1536);

    const rows = body.items.map((item, i) => ({
      user_id: userId,
      source: item.source,
      source_id: item.source_id,
      chunk_idx: item.chunk_idx ?? 0,
      text: item.text,
      embedding: vectors[i],
      metadata: { ...(item.metadata ?? {}), created_at: new Date().toISOString() },
    }));

    const res = await fetch(`${supabaseUrl}/rest/v1/memory_embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase upsert failed: ${res.status} ${text}`);
    }
    return new Response(JSON.stringify({ embedded: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("embed-batch error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
