/**
 * search-lesson Edge Function
 *
 * Uses Gemini with Google Search grounding for up-to-date web information.
 * Requires only GEMINI_API_KEY — Google Search grounding is built into Gemini.
 *
 * Flow:
 *   1. Receives { topic } or { query, mode } from client
 *   2. Calls gemini-2.0-flash with googleSearch tool — it automatically searches the web
 *   3. Returns { report: string, screens: LessonScreen[], usedWebSearch: boolean }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL   = "gemini-2.0-flash";

// ── Gemini LLM call with Google Search grounding ──────────────────────────────
async function callGeminiSearch(
  systemPrompt: string,
  userContent: string,
  maxTokens = 3000,
): Promise<{ content: string; usedWebSearch: boolean }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini search error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const parts: Array<{ text?: string }> = data?.candidates?.[0]?.content?.parts || [];
  const content = parts.map((p) => p.text || "").join("").trim();

  // Detect whether web search grounding was used
  const groundingMetadata = data?.candidates?.[0]?.groundingMetadata;
  const usedWebSearch = Boolean(
    Array.isArray(groundingMetadata?.webSearchQueries) &&
    groundingMetadata.webSearchQueries.length > 0
  );

  return { content, usedWebSearch };
}

// ── Parse lesson JSON from LLM response ──────────────────────────────────────
function parseLessonResponse(raw: string): { report: string; screens: unknown[] } {
  // Strip markdown fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: { report?: string; screens?: unknown[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    // Try to extract JSON object from response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not parse LLM response as JSON");
    parsed = JSON.parse(match[0]);
  }

  if (!parsed.screens || !Array.isArray(parsed.screens)) {
    throw new Error("Missing screens array in response");
  }
  if (parsed.screens.length < 2) {
    throw new Error("Not enough lesson screens generated");
  }

  return {
    report:  parsed.report ?? "(AI-generated lesson from web search)",
    screens: parsed.screens,
  };
}

function parseReferenceResponse(raw: string): {
  summary: string;
  quotes: Array<{ quote: string; title?: string; url?: string; source?: string }>;
  sources: Array<{ title?: string; url?: string }>;
} {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let parsed: {
    summary?: string;
    quotes?: Array<{ quote?: string; title?: string; url?: string; source?: string }>;
    sources?: Array<{ title?: string; url?: string }>;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Failed to parse reference JSON response");
  }
  const quotes = Array.isArray(parsed.quotes)
    ? parsed.quotes
        .filter((q) => typeof q?.quote === "string" && q.quote.trim().length > 0)
        .map((q) => ({ quote: q.quote!.trim(), title: q.title, url: q.url, source: q.source }))
    : [];
  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
        .filter((s) => typeof s?.url === "string" || typeof s?.title === "string")
        .map((s) => ({ title: s.title, url: s.url }))
    : [];
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    quotes,
    sources,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { topic, query, mode, quote_count } = await req.json();
    const normalizedMode = typeof mode === "string" ? mode.trim().toLowerCase() : "lesson";
    const effectiveQuery = (typeof query === "string" && query.trim())
      ? query.trim()
      : (typeof topic === "string" ? topic.trim() : "");
    if (!effectiveQuery) {
      return new Response(JSON.stringify({ error: "topic or query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (normalizedMode === "reference" || normalizedMode === "search") {
      const requestedQuotes = Math.max(1, Math.min(6, Number(quote_count) || 3));
      const systemPrompt = `You are a research assistant with web browsing.
Search the web for up-to-date sources about the user's query and return ONLY valid JSON:
{
  "summary": "A concise 4-8 sentence answer grounded in sources.",
  "quotes": [
    {
      "quote": "Short direct quote (<= 180 chars)",
      "title": "Source title",
      "url": "https://...",
      "source": "Publisher/site name"
    }
  ],
  "sources": [
    { "title": "Source title", "url": "https://..." }
  ]
}

Rules:
- Include exactly ${requestedQuotes} quotes when possible.
- Quotes must be verbatim snippets from the source.
- Prioritize reputable primary sources.
- Do not include markdown fences or extra prose.`;

      console.log(`[search-lesson] Generating web references for: ${effectiveQuery}`);
      const { content, usedWebSearch } = await callGeminiSearch(
        systemPrompt,
        `Search the web and answer: "${effectiveQuery}"`,
        2200,
      );
      const { summary, quotes, sources } = parseReferenceResponse(content);
      return new Response(JSON.stringify({ summary, quotes, sources, usedWebSearch, mode: "reference" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert educator. A student wants to learn about a topic.
Search the web for accurate, up-to-date information about the topic, then create a structured educational lesson.

Return ONLY a valid JSON object (no markdown fences, no prose outside JSON):
{
  "report": "A 300-400 word educational summary of the topic in clear plain text, based on your web search",
  "screens": [
    5-7 lesson screens in this exact format:
    concept screens: { "type": "concept", "content": "2-3 sentences" }
    example screens: { "type": "example", "content": "worked example", "annotation": "brief note" }
    question screens: { "type": "question", "question": "...", "options": {"A":"..","B":"..","C":"..","D":".."}, "correct": "A", "hint": "..." }
  ]
}

Rules:
- Start with 1-2 concept screens, then 1-2 examples, then at least 2 questions
- Base content on what you find via web search
- Questions must have exactly one correct answer (A/B/C/D)`;

    console.log(`[search-lesson] Generating web search lesson for: ${effectiveQuery}`);
    const { content, usedWebSearch } = await callGeminiSearch(
      systemPrompt,
      `Search the web and create an educational lesson about: "${effectiveQuery}"`,
    );
    const { report, screens } = parseLessonResponse(content);
    console.log(`[search-lesson] Done. usedWebSearch=${usedWebSearch}, screens=${screens.length}`);
    return new Response(JSON.stringify({ report, screens, usedWebSearch, mode: "lesson" }), {
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
