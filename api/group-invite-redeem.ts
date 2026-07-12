// Vercel endpoint: redeem a study-group invite link.
//
//   POST { token: string }  →  { groupId } | { error }
//
// Uses the service-role client (shared/groups/invites.ts) because a new
// member can't satisfy group_members' self-insert RLS policy until they're
// already a member -- see that module's header comment.

import { extractUserId } from "../shared/auth.js";
import { redeemInvite } from "../shared/groups/invites.js";

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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const userId = extractUserId(req.headers.authorization as string | undefined);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as { token?: string };
    if (!body?.token) { res.status(400).json({ error: "token is required" }); return; }

    const result = await redeemInvite(body.token, userId);
    if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
    res.status(200).json({ groupId: result.groupId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/group-invite-redeem error:", message);
    res.status(500).json({ error: message });
  }
}
