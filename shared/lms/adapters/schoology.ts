// Schoology adapter — push mode.
//
// Schoology Realtime Notifications POST a JSON body to a configured webhook URL
// signed with an HMAC-SHA256 of the raw body using a shared secret. The secret
// is set when the district admin configures the webhook in Schoology; we accept
// either the per-user `webhook_secret` stored on the integration row or a global
// fallback in SCHOOLOGY_WEBHOOK_SECRET. Real-world payload shapes vary across
// district configs, so we look for the common field names and fall back to the
// raw JSON for anything else.
//
// Routing back to the SOS user: the webhook payload includes `uid` (Schoology
// user id). We match that to `user_integrations.external_user_id` to find the
// owning integration.

import type {
  PushAdapter,
  PushParseResult,
  NormalizedSubmission,
  SubmissionState,
} from "./types.js";

interface SchoologyPayload {
  uid?: string | number;
  section_id?: string | number;
  course_id?: string | number;
  assignment_id?: string | number;
  grade_item_id?: string | number;
  submission_id?: string | number;
  id?: string | number;
  title?: string;
  assignment_title?: string;
  grade?: number | string | null;
  created?: string | number | null;
  submitted_at?: string | null;
  late?: number | boolean;
  state?: string;
  url?: string;
  [key: string]: unknown;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // Schoology timestamps are unix seconds.
    return new Date(v * 1000).toISOString();
  }
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && n > 1_000_000_000) return new Date(n * 1000).toISOString();
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

function mapState(p: SchoologyPayload): SubmissionState {
  const grade = toNum(p.grade);
  if (grade != null) return "graded";
  const s = (p.state || "").toString().toLowerCase();
  if (s === "returned") return "returned";
  if (s === "missing") return "missing";
  if (s === "draft") return "draft";
  if (p.created || p.submitted_at) return "submitted";
  return "draft";
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  return hex;
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const schoologyAdapter: PushAdapter = {
  id: "schoology",
  mode: "push",

  async parseWebhook(req: Request, rawBody: string, sharedSecret: string | null): Promise<PushParseResult> {
    // Schoology accepts JSON or form-encoded bodies; we accept both.
    let payload: SchoologyPayload = {};
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawBody);
      const obj: Record<string, unknown> = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      payload = obj as SchoologyPayload;
    } else {
      try {
        payload = JSON.parse(rawBody || "{}") as SchoologyPayload;
      } catch {
        payload = {};
      }
    }

    const provided = req.headers.get("x-schoology-signature") || req.headers.get("x-signature") || "";
    let signatureValid = false;
    if (sharedSecret && provided) {
      const expected = await hmacSha256Hex(sharedSecret, rawBody);
      signatureValid = timingSafeEq(expected.toLowerCase(), provided.toLowerCase());
    }

    const submission: NormalizedSubmission = {
      externalCourseId: toStr(payload.section_id ?? payload.course_id) ?? "",
      externalAssignmentId: toStr(payload.assignment_id ?? payload.grade_item_id) ?? "",
      externalSubmissionId:
        toStr(payload.submission_id ?? payload.id) ??
        // Fallback when Schoology doesn't expose a stable submission id — synthesize
        // a deterministic one from (uid, assignment_id) so re-deliveries dedupe.
        `${toStr(payload.uid) ?? "u"}:${toStr(payload.assignment_id ?? payload.grade_item_id) ?? "a"}`,
      assignmentTitle: toStr(payload.assignment_title ?? payload.title),
      state: mapState(payload),
      submittedAt: toIso(payload.submitted_at ?? payload.created),
      gradedAt: toNum(payload.grade) != null ? toIso(payload.created) : null,
      grade: toNum(payload.grade),
      url: toStr(payload.url),
      raw: payload,
    };

    return {
      externalUserId: toStr(payload.uid) ?? "",
      signatureValid,
      submission,
    };
  },
};
