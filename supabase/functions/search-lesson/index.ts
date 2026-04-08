/**
 * search-lesson Edge Function
 *
 * Flow:
 *   1. Receives { topic } from client
 *   2. Calls Brave Search API (BRAVE_SEARCH_API_KEY env secret) to get top results
 *   3. Sends results + topic to Groq LLM to generate:
 *        - A 300-400 word educational report
 *        - 5-7 lesson screens as JSON
 *   4. Returns { report: string, screens: LessonScreen[] }
 *
 * Requires Supabase secret:
 *   supabase secrets set BRAVE_SEARCH_API_KEY=<your-key>
 *
 * Fallback: If BRAVE_SEARCH_API_KEY is not set, generates lesson from LLM knowledge only
 *           and marks report as "(generated from AI knowledge)".
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_API_KEY   = Deno.env.get("GROQ_API_KEY")   || "";
const BRAVE_API_KEY  = Deno.env.get("BRAVE_SEARCH_API_KEY") || "";
const GROQ_MODEL     = "llama-3.3-70b-versatile";

// ── Brave Search ───────────────────────────────────────────────────────────────
async function braveSearch(query: string): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&search_lang=en&text_decorations=false`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": BRAVE_API_KEY,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brave Search error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const results = data?.web?.results ?? [];

  return results
    .slice(0, 5)
    .map((r: { title: string; description: string; url: string }) =>
      `TITLE: ${r.title}\nSNIPPET: ${r.description || ""}\nURL: ${r.url}`
    )
    .join("\n\n---\n\n");
}

// ── Groq LLM call ─────────────────────────────────────────────────────────────
async function callGroq(systemPrompt: string, userContent: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userContent },
      ],
      max_tokens: 3000,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

// ── Parse lesson JSON from LLM response ──────────────────────────────────────
function parseLessonResponse(raw: string): { report: string; screens: unknown[] } {
  // Strip markdown fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let parsed: { report?: string; screens?: unknown[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    // Try to extract JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not parse LLM response as JSON");
    parsed = JSON.parse(match[0]);
  }

  if (!parsed.screens || !Array.isArray(parsed.screens)) {
    throw new Error("Missing screens array in LLM response");
  }
  if (parsed.screens.length < 2) {
    throw new Error("Not enough lesson screens generated");
  }

  return {
    report:  parsed.report  ?? "(AI-generated lesson)",
    screens: parsed.screens,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { topic } = await req.json();
    if (!topic?.trim()) {
      return new Response(JSON.stringify({ error: "topic is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!GROQ_API_KEY) {
      return new Response(JSON.stringify({ error: "GROQ_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let searchContext = "";
    let usedWebSearch = false;

    // Try web search if API key is configured
    if (BRAVE_API_KEY) {
      try {
        searchContext = await braveSearch(topic);
        usedWebSearch = true;
        console.log(`[search-lesson] Web search succeeded for: ${topic}`);
      } catch (searchErr) {
        console.warn(`[search-lesson] Search failed, falling back to LLM: ${searchErr}`);
      }
    } else {
      console.log("[search-lesson] No BRAVE_SEARCH_API_KEY — using LLM knowledge only");
    }

    const systemPrompt = `You are an expert educator creating a structured lesson for a student.
Return ONLY a valid JSON object (no markdown, no prose outside JSON) with this structure:
{
  "report": "A 300-400 word educational summary of the topic in clear plain text",
  "screens": [
    array of 5-7 lesson screens
  ]
}

Each screen in "screens":
- concept: { "type": "concept", "content": "2-3 sentences" }
- example: { "type": "example", "content": "worked example", "annotation": "brief note" }
- question: { "type": "question", "question": "...", "options": {"A":"..","B":"..","C":"..","D":".."}, "correct": "A", "hint": "..." }

Start with 1-2 concept screens, then examples, then questions (at least 2).`;

    const userContent = usedWebSearch
      ? `Create an educational lesson on: "${topic}"\n\nBased on these web search results:\n\n${searchContext}`
      : `Create an educational lesson on: "${topic}"\n\nUse your knowledge to write the report and generate the lesson screens.`;

    const rawResponse = await callGroq(systemPrompt, userContent);
    const { report, screens } = parseLessonResponse(rawResponse);

    return new Response(JSON.stringify({ report, screens, usedWebSearch }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[search-lesson] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
