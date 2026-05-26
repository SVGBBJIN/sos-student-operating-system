// Backend ingest for browser-extension LMS evidence.
//
// Called from api/lms-event.ts (Vercel/Node) and supabase/functions/sos-lms-event
// (Deno) — both transports are thin shims; the logic lives here so they cannot
// drift. Fetch-only, no SDK deps, identical in both runtimes.
//
// For each incoming event:
//   1. validate shape (Zod, in shared/ai/schemas/lms.ts)
//   2. fetch prior events for the same (user, lms, assignment_id), append the
//      new one, recompute confidence via the pure engine in ./confidence.ts
//   3. match a still-open SOS task by fuzzy title (./match.ts)
//   4. persist the event row with the computed confidence + matched task_id
//   5. if confidence crossed into the "submitted" bucket AND we have strong
//      evidence AND a matched task that isn't already done → flip the task
//      to done, source='lms', and append a task_events 'complete' row so the
//      behavioral signals pipeline picks it up exactly like a manual complete

import { getEnv } from "../env.js";
import { scoreEvidence, type Evidence, type EvidenceKind, type ConfidenceBucket } from "./confidence.js";
import { pickBestMatch, type CandidateTask } from "./match.js";
import { validateLmsEvents, type LmsEventInput } from "../ai/schemas/lms.js";

export interface IngestResult {
  assignmentId: string;
  lms: "classroom" | "canvas" | "schoology" | "custom";
  confidence: number;
  bucket: ConfidenceBucket;
  matchedTaskId: string | null;
  action: "auto_completed" | "pending_review" | "awaiting" | "unmatched" | "noop";
}

export interface HandleLmsEventArgs {
  userId: string;
  events: unknown;
}

export type HandleLmsEventOutcome =
  | { ok: true; results: IngestResult[] }
  | { ok: false; status: number; error: string; issues?: unknown };

export async function handleLmsEvent(args: HandleLmsEventArgs): Promise<HandleLmsEventOutcome> {
  const { userId } = args;
  if (!userId) return { ok: false, status: 401, error: "Authentication required" };

  const parsed = validateLmsEvents(args.events);
  if (!parsed.ok) return { ok: false, status: 400, error: "Invalid events", issues: parsed.issues };

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, status: 500, error: "Supabase not configured" };
  }
  const ctx: SupabaseCtx = { url: supabaseUrl, key: serviceKey };

  // Fetch the user's open tasks once — the matcher is called per event.
  const openTasks = await fetchOpenTasks(ctx, userId);

  const results: IngestResult[] = [];
  for (const ev of parsed.events) {
    results.push(await processOne(ctx, userId, ev, openTasks));
  }
  return { ok: true, results };
}

// ── internals ────────────────────────────────────────────────────────────────

interface SupabaseCtx { url: string; key: string }

function headers(ctx: SupabaseCtx, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${ctx.key}`,
    apikey: ctx.key,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function fetchOpenTasks(ctx: SupabaseCtx, userId: string): Promise<CandidateTask[]> {
  const url = `${ctx.url}/rest/v1/tasks?user_id=eq.${encodeURIComponent(userId)}&status=neq.done&select=id,title,subject,status,lms_assignment_ref`;
  const res = await fetch(url, { headers: headers(ctx) });
  if (!res.ok) return [];
  const rows = (await res.json().catch(() => [])) as Array<{
    id: string; title: string; subject: string | null; status: string;
    lms_assignment_ref?: { lms?: string; assignment_id?: string } | null;
  }>;
  return rows.map((r) => ({ id: r.id, title: r.title, subject: r.subject, status: r.status }));
}

async function fetchPriorEvidence(
  ctx: SupabaseCtx,
  userId: string,
  lms: string,
  assignmentId: string
): Promise<Evidence[]> {
  const url =
    `${ctx.url}/rest/v1/lms_submission_events?user_id=eq.${encodeURIComponent(userId)}` +
    `&lms=eq.${encodeURIComponent(lms)}` +
    `&lms_assignment_id=eq.${encodeURIComponent(assignmentId)}` +
    `&select=evidence_kind,evidence_detail&order=occurred_at.asc`;
  const res = await fetch(url, { headers: headers(ctx) });
  if (!res.ok) return [];
  const rows = (await res.json().catch(() => [])) as Array<{ evidence_kind: EvidenceKind; evidence_detail: Record<string, unknown> }>;
  return rows.map((r) => ({ kind: r.evidence_kind, detail: r.evidence_detail }));
}

async function processOne(
  ctx: SupabaseCtx,
  userId: string,
  event: LmsEventInput,
  openTasks: CandidateTask[]
): Promise<IngestResult> {
  const prior = await fetchPriorEvidence(ctx, userId, event.lms, event.lms_assignment_id);
  const newEvidence: Evidence = { kind: event.evidence_kind, detail: event.evidence_detail ?? {} };
  const outcome = scoreEvidence([...prior, newEvidence]);

  // Try to match the assignment to an open SOS task.
  const match = pickBestMatch(
    { assignmentTitle: event.lms_assignment_title ?? "", courseName: event.lms_course_name ?? null },
    openTasks
  );
  const matchedTaskId = match?.task.id ?? null;

  // Persist the event row. Use Prefer: ignore-duplicates to absorb the unique
  // dedupe index quietly when the same evidence_kind fires in the same second.
  await fetch(`${ctx.url}/rest/v1/lms_submission_events`, {
    method: "POST",
    headers: headers(ctx, { Prefer: "return=minimal,resolution=ignore-duplicates" }),
    body: JSON.stringify({
      user_id: userId,
      task_id: matchedTaskId,
      lms: event.lms,
      lms_course_id: event.lms_course_id ?? null,
      lms_assignment_id: event.lms_assignment_id,
      lms_assignment_title: event.lms_assignment_title ?? null,
      evidence_kind: event.evidence_kind,
      evidence_weight: outcome.perEvidenceWeight[outcome.perEvidenceWeight.length - 1] ?? 0,
      evidence_detail: { ...(event.evidence_detail ?? {}), ...(event.lms_custom_host ? { custom_host: event.lms_custom_host } : {}) },
      confidence_after: outcome.score,
      occurred_at: event.occurred_at ?? new Date().toISOString(),
    }),
  });

  if (!matchedTaskId) {
    return { assignmentId: event.lms_assignment_id, lms: event.lms, confidence: outcome.score, bucket: outcome.bucket, matchedTaskId: null, action: "unmatched" };
  }

  if (outcome.autoCompletable) {
    // Corroborated by 2+ independent signals — safe to close immediately.
    await markTaskCompleted(ctx, userId, matchedTaskId, outcome.score, event);
    return { assignmentId: event.lms_assignment_id, lms: event.lms, confidence: outcome.score, bucket: outcome.bucket, matchedTaskId, action: "auto_completed" };
  }

  if (outcome.bucket === "submitted" && !outcome.corroborated) {
    // Score crossed 85 on a single strong signal. Don't close yet — flag the
    // task for student confirmation. The client will show an actionable toast;
    // a cron job auto-confirms after 5 min if the student doesn't respond.
    await markTaskPendingClose(ctx, userId, matchedTaskId, outcome.score, event);
    return { assignmentId: event.lms_assignment_id, lms: event.lms, confidence: outcome.score, bucket: outcome.bucket, matchedTaskId, action: "pending_review" };
  }

  return { assignmentId: event.lms_assignment_id, lms: event.lms, confidence: outcome.score, bucket: outcome.bucket, matchedTaskId, action: "awaiting" };
}

async function markTaskCompleted(
  ctx: SupabaseCtx,
  userId: string,
  taskId: string,
  score: number,
  event: LmsEventInput
): Promise<void> {
  const nowIso = new Date().toISOString();
  // PATCH the task. We don't bother to check `status` first — if it's already
  // done the update is a no-op on the user-visible state and the duplicate
  // task_events row is still useful telemetry.
  const patchUrl = `${ctx.url}/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}&user_id=eq.${encodeURIComponent(userId)}`;
  await fetch(patchUrl, {
    method: "PATCH",
    headers: headers(ctx, { Prefer: "return=minimal" }),
    body: JSON.stringify({
      status: "done",
      completed_at: nowIso,
      completion_source: "lms",
      completion_confidence: score,
      lms_assignment_ref: {
        lms: event.lms,
        custom_host: event.lms_custom_host ?? null,
        course_id: event.lms_course_id ?? null,
        assignment_id: event.lms_assignment_id,
        title: event.lms_assignment_title ?? null,
      },
    }),
  });

  // Append a task_events 'complete' row so behavioral signals see this exactly
  // like a manual complete (kept consistent with App.jsx's dbInsertTaskEvent
  // metadata shape; just add source='lms' so we can filter analytics later).
  await fetch(`${ctx.url}/rest/v1/task_events`, {
    method: "POST",
    headers: headers(ctx, { Prefer: "return=minimal" }),
    body: JSON.stringify({
      user_id: userId,
      task_id: taskId,
      event_type: "complete",
      from_status: null,
      to_status: "done",
      occurred_at: nowIso,
      metadata: {
        source: "lms",
        lms: event.lms,
        assignment_id: event.lms_assignment_id,
        confidence: score,
      },
    }),
  });
}

// Single strong signal crossed 85 but a second independent signal hasn't
// arrived yet. Flag the task so the student can confirm or dismiss. A pg_cron
// job in 20260528_lms_pending_close.sql auto-promotes after 5 min if there's
// no response — catch-and-confirm rather than catch-and-block.
async function markTaskPendingClose(
  ctx: SupabaseCtx,
  userId: string,
  taskId: string,
  score: number,
  event: LmsEventInput
): Promise<void> {
  const nowIso = new Date().toISOString();
  const patchUrl = `${ctx.url}/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}&user_id=eq.${encodeURIComponent(userId)}&status=neq.done`;
  await fetch(patchUrl, {
    method: "PATCH",
    headers: headers(ctx, { Prefer: "return=minimal" }),
    body: JSON.stringify({
      lms_pending_close: true,
      lms_pending_close_at: nowIso,
      completion_confidence: score,
      lms_assignment_ref: {
        lms: event.lms,
        custom_host: event.lms_custom_host ?? null,
        course_id: event.lms_course_id ?? null,
        assignment_id: event.lms_assignment_id,
        title: event.lms_assignment_title ?? null,
      },
    }),
  });
}
