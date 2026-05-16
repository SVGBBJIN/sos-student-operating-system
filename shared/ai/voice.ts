// Voice transcription via Groq Whisper.
//
// Used by the three voice entry points (api/chat.ts voice mode, sos-chat voice
// branch, and sos-voice edge function). Replaces the previous Gemini-Flash
// multimodal transcription path.
//
// Uses Web APIs only (fetch + FormData + Blob + atob) so it runs unchanged in
// Node (Vercel) and Deno (Supabase Edge Functions).

import { getEnv } from "../env.js";

const GROQ_WHISPER_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-large-v3-turbo";

export interface TranscribeRequest {
  audioBase64: string;
  audioMimeType?: string;
  language?: string;
}

export interface TranscribeResponse {
  text: string;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function extForMime(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

export async function transcribeAudio(req: TranscribeRequest): Promise<TranscribeResponse> {
  const apiKey = getEnv("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const mime = req.audioMimeType ?? "audio/webm";
  const blob = base64ToBlob(req.audioBase64, mime);

  const form = new FormData();
  form.append("file", blob, `audio.${extForMime(mime)}`);
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "json");
  if (req.language) form.append("language", req.language);

  const res = await fetch(GROQ_WHISPER_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Groq transcription failed (${res.status}): ${text.slice(0, 500)}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  const data = (await res.json()) as { text?: string };
  return { text: (data.text ?? "").trim() };
}
