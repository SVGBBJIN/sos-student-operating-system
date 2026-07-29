// Daily content-generation rate limit, shared across Vercel + Supabase Edge.
// Uses the Supabase REST API directly so it has no Node-specific dependencies.

import { getEnv } from "./env.js";

const DAILY_LIMIT = 5;

// The reset boundary is "midnight America/New_York", which is UTC-5 in winter
// and UTC-4 under daylight saving. A hardcoded -5 offset drifted the reset an
// hour past local midnight for ~8 months of the year, so resolve the real
// offset instead of assuming one.
function todayEasternDate(): string {
  // en-CA gives ISO-shaped YYYY-MM-DD, and the timeZone option applies the
  // correct EST/EDT offset for the instant in question.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
}

function restConfig(): { url: string; key: string } | null {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;
  return { url: supabaseUrl, key: serviceKey };
}

// Consume one generation slot. This is a single atomic RPC: the previous
// read-then-write let two concurrent requests both observe the same count and
// each write count+1, handing out one extra generation per race (and the upsert
// overwrote rather than incremented). claim_content_generation does the
// increment and the cap check in one statement.
export async function checkContentRateLimit(userId: string): Promise<RateLimitResult> {
  const cfg = restConfig();
  if (!cfg) return { allowed: true, used: 0, limit: DAILY_LIMIT };

  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/claim_content_generation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        apikey: cfg.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id_in: userId,
        date_in: todayEasternDate(),
        limit_in: DAILY_LIMIT,
      }),
    });
    if (!res.ok) {
      // Fail OPEN: a limiter that is down must not take the whole feature with
      // it. Loud in logs so a broken migration doesn't hide as "no traffic".
      console.error("content rate limit RPC failed:", res.status, await res.text().catch(() => ""));
      return { allowed: true, used: 0, limit: DAILY_LIMIT };
    }
    const rows = (await res.json().catch(() => null)) as
      | Array<{ allowed: boolean; used: number }>
      | { allowed: boolean; used: number }
      | null;
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || typeof row.allowed !== "boolean") {
      return { allowed: true, used: 0, limit: DAILY_LIMIT };
    }
    return { allowed: row.allowed, used: row.used ?? 0, limit: DAILY_LIMIT };
  } catch (err) {
    console.error("content rate limit check errored:", err instanceof Error ? err.message : err);
    return { allowed: true, used: 0, limit: DAILY_LIMIT };
  }
}

// Hand a slot back when the work it was claimed for failed. Without this a
// student loses one of their five to a pipeline error they didn't cause.
// Best-effort: never throws, never blocks the error path it runs on.
export async function refundContentRateLimit(userId: string): Promise<void> {
  const cfg = restConfig();
  if (!cfg) return;
  try {
    await fetch(`${cfg.url}/rest/v1/rpc/release_content_generation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        apikey: cfg.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id_in: userId, date_in: todayEasternDate() }),
    });
  } catch {
    // Best-effort; the slot resets at midnight regardless.
  }
}
