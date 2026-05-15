// Daily content-generation rate limit, shared across Vercel + Supabase Edge.
// Uses the Supabase REST API directly so it has no Node-specific dependencies.

import { getEnv } from "./env.js";

const DAILY_LIMIT = 5;

function todayEstDate(): string {
  const now = new Date();
  const est = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return `${est.getUTCFullYear()}-${String(est.getUTCMonth() + 1).padStart(2, "0")}-${String(est.getUTCDate()).padStart(2, "0")}`;
}

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
}

export async function checkContentRateLimit(userId: string): Promise<RateLimitResult> {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return { allowed: true, used: 0, limit: DAILY_LIMIT };
  }
  const date = todayEstDate();
  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
  };

  const getRes = await fetch(
    `${supabaseUrl}/rest/v1/content_generations?user_id=eq.${userId}&date=eq.${date}&select=count`,
    { headers }
  );
  const rows = (await getRes.json().catch(() => [])) as Array<{ count: number }>;
  const used = rows?.[0]?.count ?? 0;

  if (used >= DAILY_LIMIT) {
    return { allowed: false, used, limit: DAILY_LIMIT };
  }

  await fetch(`${supabaseUrl}/rest/v1/content_generations`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, date, count: used + 1 }),
  });

  return { allowed: true, used: used + 1, limit: DAILY_LIMIT };
}
