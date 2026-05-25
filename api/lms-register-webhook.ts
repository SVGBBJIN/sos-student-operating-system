// Vercel endpoint for push-mode setup. Generates (or reuses) a per-user webhook
// secret and stores the LMS-side user id so the receiver can route inbound
// events back to the SOS user. Push providers don't have an OAuth code; this is
// the equivalent of api/lms-oauth-callback.ts for them.
//
//   POST { provider: 'schoology', externalUserId: '12345' }

import { extractUserId } from "../shared/auth.js";
import { registerWebhookIntegration } from "../shared/lms/integrations.js";
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
  externalUserId?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const userId = extractUserId(req.headers.authorization as string | undefined);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const body = (typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {})) as Body;
    if (!body.provider || !body.externalUserId) {
      res.status(400).json({ error: "provider and externalUserId are required" });
      return;
    }

    const integration = await registerWebhookIntegration({
      userId,
      providerId: body.provider,
      externalUserId: body.externalUserId,
    });

    const base = getEnv("LMS_WEBHOOK_BASE_URL") || "";
    const webhookUrl = base ? `${base.replace(/\/$/, "")}/${body.provider}` : null;

    res.status(200).json({
      integration: {
        id: integration.id,
        provider_id: integration.provider_id,
        status: integration.status,
      },
      webhookUrl,
      webhookSecret: integration.webhook_secret,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/lms-register-webhook error:", message);
    res.status(500).json({ error: message });
  }
}
