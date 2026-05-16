// sos-voice Edge Function — Groq Whisper transcription. Accepts either
// multipart/form-data (legacy clients) or JSON { audioBase64, audioMimeType }.

import { transcribeAudio } from "../../../shared/ai/voice.js";
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

  if (!getEnv("GROQ_API_KEY")) {
    return new Response(JSON.stringify({ error: "GROQ_API_KEY is not configured" }), {
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

    const transcript = await transcribeAudio({ audioBase64: base64, audioMimeType: mimeType });

    return new Response(JSON.stringify({ text: transcript.text }), {
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
