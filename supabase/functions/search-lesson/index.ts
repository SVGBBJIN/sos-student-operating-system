// search-lesson Edge Function — Gemini 2.5 Pro + native googleSearch grounding.
//
// Replaces the previous Groq compound model. Two modes:
//   - lesson (default): builds a structured 5-7 screen lesson with web research.
//   - reference|search: returns summary + quotes + sources for citation use.
//
// The model is forced to JSON via responseMimeType. Errors surface verbatim.

import { z } from "zod";
import { callModel } from "../../../shared/ai/index.js";
import { zodToGeminiSchema } from "../../../shared/ai/schemas/_helpers.js";
import { getEnv } from "../../../shared/env.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ConceptScreen = z.object({ type: z.literal("concept"), content: z.string().min(1).max(2000) });
const ExampleScreen = z.object({ type: z.literal("example"), content: z.string().min(1).max(2000), annotation: z.string().max(500).optional() });
const QuestionScreen = z.object({
  type: z.literal("question"),
  question: z.string().min(1).max(500),
  options: z.object({ A: z.string(), B: z.string(), C: z.string(), D: z.string() }),
  correct: z.enum(["A", "B", "C", "D"]),
  hint: z.string().max(500).optional(),
});
const LessonSchema = z.object({
  report: z.string().min(20).max(4000),
  screens: z.array(z.union([ConceptScreen, ExampleScreen, QuestionScreen])).min(2).max(10),
});

const ReferenceSchema = z.object({
  summary: z.string().min(1).max(2000),
  quotes: z.array(z.object({
    quote: z.string().min(1).max(400),
    title: z.string().max(300).optional(),
    url: z.string().max(500).optional(),
    source: z.string().max(200).optional(),
  })).max(8),
  sources: z.array(z.object({
    title: z.string().max(300).optional(),
    url: z.string().max(500).optional(),
  })).max(10),
});

const LESSON_SYS = `You are an expert educator. A student wants to learn about a topic.
Use the google_search tool to find accurate, up-to-date sources, then return ONLY a JSON object matching the response schema. Start with 1-2 concept screens, then 1-2 examples, then at least 2 questions.`;

const REFERENCE_SYS = (n: number) => `You are a research assistant. Use the google_search tool, then return ONLY a JSON object matching the response schema. Include exactly ${n} verbatim quotes when possible. Prioritize reputable primary sources.`;

interface Body {
  topic?: string;
  query?: string;
  mode?: string;
  quote_count?: number;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!getEnv("GEMINI_API_KEY")) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as Body;
    const mode = (body.mode ?? "lesson").toLowerCase();
    const query = (body.query ?? body.topic ?? "").trim();
    if (!query) {
      return new Response(JSON.stringify({ error: "topic or query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "reference" || mode === "search") {
      const n = Math.max(1, Math.min(6, Number(body.quote_count) || 3));
      const res = await callModel({
        intent: "search_reference",
        systemPrompt: REFERENCE_SYS(n),
        messages: [{ role: "user", content: `Search the web and answer: "${query}"` }],
        toolSet: "none",
        grounding: { googleSearch: true },
        responseSchema: zodToGeminiSchema(ReferenceSchema as unknown as z.ZodTypeAny),
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 2200,
      });
      const parsed = JSON.parse(res.content);
      const checked = ReferenceSchema.parse(parsed);
      const usedWebSearch = Boolean(res.grounding);
      return new Response(JSON.stringify({ ...checked, usedWebSearch, mode: "reference" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await callModel({
      intent: "search_lesson",
      systemPrompt: LESSON_SYS,
      messages: [{ role: "user", content: `Search the web and create an educational lesson about: "${query}"` }],
      toolSet: "none",
      grounding: { googleSearch: true },
      responseSchema: zodToGeminiSchema(LessonSchema as unknown as z.ZodTypeAny),
      responseMimeType: "application/json",
      temperature: 0.3,
      maxOutputTokens: 3000,
    });
    const parsed = JSON.parse(res.content);
    const checked = LessonSchema.parse(parsed);
    const usedWebSearch = Boolean(res.grounding);
    return new Response(JSON.stringify({ ...checked, usedWebSearch, mode: "lesson" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[search-lesson] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
