// Extension-posted assignment data intake.
//
// The SOS browser extension scrapes Schoology (or other LMSs) and POSTs batches
// here. No LMS API keys needed — the extension uses the user's existing browser
// session. Authentication is a Supabase user JWT (same as all other api/ routes).
//
//   POST /api/lms-ingest
//   Authorization: Bearer <supabase-jwt>
//   { provider: 'schoology', submissions: RawSubmission[] }

import { extractUserId } from "../shared/auth.js";
import { supabaseService, selectRows, upsertRows } from "../shared/lms/supabaseRest.js";
import { upsertSubmissions } from "../shared/lms/upsert.js";
import type { NormalizedSubmission, UserIntegrationRow } from "../shared/lms/adapters/types.js";

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

interface RawSubmission {
  externalCourseId?: string;
  externalAssignmentId?: string;
  externalSubmissionId?: string;
  assignmentTitle?: string | null;
  state?: string;
  submittedAt?: string | null;
  gradedAt?: string | null;
  grade?: number | string | null;
  url?: string | null;
  [key: string]: unknown;
}

function toState(s: string | undefined): NormalizedSubmission["state"] {
  const v = (s || "").toLowerCase();
  if (v === "graded") return "graded";
  if (v === "returned") return "returned";
  if (v === "missing") return "missing";
  if (v === "draft") return "draft";
  return "submitted";
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = req.headers["authorization"] as string | undefined;
  const userId = extractUserId(auth);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = (typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {})) as {
    provider?: string;
    submissions?: RawSubmission[];
  };

  const provider = body.provider || "schoology";
  const rawSubs = body.submissions;
  if (!Array.isArray(rawSubs) || rawSubs.length === 0) {
    res.status(400).json({ error: "submissions must be a non-empty array" });
    return;
  }

  const ctx = supabaseService();

  // Find or auto-create a minimal integration row for this user + provider.
  // Extension-scraped providers don't need OAuth tokens — the extension itself
  // holds the browser session.
  let integration: UserIntegrationRow;
  try {
    const rows = await selectRows<UserIntegrationRow>(
      ctx,
      "user_integrations",
      `user_id=eq.${encodeURIComponent(userId)}&provider_id=eq.${encodeURIComponent(provider)}&select=*`
    );
    if (rows.length > 0) {
      integration = rows[0]!;
    } else {
      await upsertRows<Record<string, unknown>>(
        ctx,
        "user_integrations",
        [{ user_id: userId, provider_id: provider, status: "active", updated_at: new Date().toISOString() }],
        "user_id,provider_id"
      );
      const created = await selectRows<UserIntegrationRow>(
        ctx,
        "user_integrations",
        `user_id=eq.${encodeURIComponent(userId)}&provider_id=eq.${encodeURIComponent(provider)}&select=*`
      );
      if (created.length === 0) throw new Error("Failed to create integration row");
      integration = created[0]!;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/lms-ingest: integration lookup failed", { userId, provider, error: message });
    res.status(500).json({ error: message });
    return;
  }

  const normalized: NormalizedSubmission[] = rawSubs.map((s) => ({
    externalCourseId: String(s.externalCourseId ?? ""),
    externalAssignmentId: String(s.externalAssignmentId ?? ""),
    externalSubmissionId: String(s.externalSubmissionId ?? s.externalAssignmentId ?? Math.random()),
    assignmentTitle: s.assignmentTitle != null ? String(s.assignmentTitle) : null,
    state: toState(s.state as string | undefined),
    submittedAt: s.submittedAt ? String(s.submittedAt) : null,
    gradedAt: s.gradedAt ? String(s.gradedAt) : null,
    grade: s.grade != null && s.grade !== "" ? Number(s.grade) : null,
    url: s.url ? String(s.url) : null,
    raw: s,
  }));

  try {
    const result = await upsertSubmissions(ctx, integration, normalized, "extension");
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/lms-ingest: upsert failed", { userId, provider, error: message });
    res.status(500).json({ error: message });
  }
}
