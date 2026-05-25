// Vercel endpoint that completes an LMS OAuth handshake.
//
//   POST { provider: 'classroom', code: string, redirectUri: string }
//
// Authentication: a Supabase user JWT in the Authorization header. We use
// extractUserId (same as api/embed.ts) so the integration row is created under
// the right user. Provider credentials live in env vars only — never hardcoded.

import { extractUserId } from "../shared/auth.js";
import { completeOAuth } from "../shared/lms/integrations.js";
import { getEnv } from "../shared/env.js";

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
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  provider?: string;
  code?: string;
  redirectUri?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const userId = extractUserId(req.headers.authorization as string | undefined);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const body = (typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {})) as Body;
    if (!body.provider || !body.code || !body.redirectUri) {
      res.status(400).json({ error: "provider, code, redirectUri are required" });
      return;
    }
    if (body.provider === "classroom" && (!getEnv("GOOGLE_CLIENT_ID") || !getEnv("GOOGLE_CLIENT_SECRET"))) {
      res.status(500).json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured" });
      return;
    }

    const integration = await completeOAuth({
      userId,
      providerId: body.provider,
      code: body.code,
      redirectUri: body.redirectUri,
    });
    res.status(200).json({
      integration: {
        id: integration.id,
        provider_id: integration.provider_id,
        status: integration.status,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/lms-oauth-callback error:", message);
    res.status(500).json({ error: message });
  }
}
