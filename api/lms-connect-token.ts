// Vercel endpoint that connects a token-authenticated LMS (Canvas).
//
//   POST { provider: 'canvas', token: string, instanceUrl: string }
//
// Canvas OAuth2 needs a developer key only a school's Canvas admin can issue,
// so a student's own personal access token is the only self-service path. The
// token is verified against the provider before it's stored — see
// connectWithToken — so a typo fails here rather than silently every 10 minutes.

import { extractUserId } from "../shared/auth.js";
import { connectWithToken } from "../shared/lms/integrations.js";

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
  token?: string;
  instanceUrl?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const userId = extractUserId(req.headers.authorization as string | undefined);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const body = (typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {})) as Body;
    if (!body.provider || !body.token) {
      res.status(400).json({ error: "provider and token are required" });
      return;
    }

    const integration = await connectWithToken({
      userId,
      providerId: body.provider,
      token: body.token,
      ...(body.instanceUrl ? { instanceUrl: body.instanceUrl } : {}),
    });

    // Never echo the token back, not even partially.
    res.status(200).json({
      integration: {
        id: integration.id,
        provider_id: integration.provider_id,
        status: integration.status,
        instance_url: integration.instance_url ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/lms-connect-token error:", message);
    // A rejected token is the user's problem to fix, not a server fault.
    const status = /token rejected|required|https/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
}
