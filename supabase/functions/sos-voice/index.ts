// sos-voice Edge Function — Gemini Flash audio transcription. Accepts either
// multipart/form-data (legacy clients) or JSON { audioBase64, audioMimeType }.

import { getProvider } from "../../../shared/ai/providers/index.js";
import { getEnv } from "../../../shared/env.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binary);
}

interface VoiceJsonBody {
  audioBase64?: string;
  audioMimeType?: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = getEnv("GEMINI_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let base64: string;
    let mimeType = "audio/webm";
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("file");
      if (!(file instanceof File)) {
        return new Response(JSON.stringify({ error: "No audio file provided" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      base64 = await bytesToBase64(bytes);
      mimeType = file.type || mimeType;
    } else {
      const body = (await req.json()) as VoiceJsonBody;
      if (!body.audioBase64) {
        return new Response(JSON.stringify({ error: "No audio data provided" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      base64 = body.audioBase64;
      mimeType = body.audioMimeType ?? mimeType;
    }

    const provider = getProvider("gemini", apiKey);
    const transcript = await provider.chat({
      model: "gemini-3-flash",
      systemPrompt: "Transcribe the attached audio to plain text. Return ONLY the transcript — no commentary, no markdown.",
      messages: [{
        role: "user",
        content: "Transcribe this clip.",
        attachments: [{ kind: "audio", mimeType, base64 }],
      }],
      temperature: 0.1,
      maxOutputTokens: 1024,
      thinkingBudget: 0,
    });

    return new Response(JSON.stringify({ text: transcript.content.trim() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Voice transcription error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
