// Upsert normalized submissions and auto-close any linked open task.
//
// Shared by both the pull orchestrator and the push webhook receiver — neither
// transport should care which side a row came from. Idempotent on the
// (user_id, provider_id, external_submission_id) unique constraint.

import type { NormalizedSubmission, UserIntegrationRow } from "./adapters/types.js";
import {
  headers,
  insertRows,
  patchRow,
  selectRows,
  upsertRows,
  type SupabaseRest,
} from "./supabaseRest.js";

interface SubmissionRow {
  user_id: string;
  integration_id: string;
  provider_id: string;
  external_course_id: string;
  external_assignment_id: string;
  external_submission_id: string;
  assignment_title: string | null;
  state: string;
  submitted_at: string | null;
  graded_at: string | null;
  grade: number | null;
  url: string | null;
  raw_payload: unknown;
  source: "pull" | "push";
  fetched_at: string;
}

interface OpenTaskRow {
  id: string;
  status: string;
  lms_assignment_ref: { assignment_id?: string; externalAssignmentId?: string } | null;
}

const CLOSED_STATES = new Set(["submitted", "graded", "returned"]);

export async function upsertSubmissions(
  ctx: SupabaseRest,
  integration: UserIntegrationRow,
  subs: NormalizedSubmission[],
  source: "pull" | "push"
): Promise<{ upserted: number; tasksClosed: number }> {
  if (subs.length === 0) return { upserted: 0, tasksClosed: 0 };
  const nowIso = new Date().toISOString();

  const rows: SubmissionRow[] = subs.map((s) => ({
    user_id: integration.user_id,
    integration_id: integration.id,
    provider_id: integration.provider_id,
    external_course_id: s.externalCourseId,
    external_assignment_id: s.externalAssignmentId,
    external_submission_id: s.externalSubmissionId,
    assignment_title: s.assignmentTitle,
    state: s.state,
    submitted_at: s.submittedAt,
    graded_at: s.gradedAt,
    grade: s.grade,
    url: s.url,
    raw_payload: s.raw,
    source,
    fetched_at: nowIso,
  }));

  await upsertRows(ctx, "submissions", rows, "user_id,provider_id,external_submission_id");

  // Auto-close: for any submission that looks closed (submitted/graded/returned)
  // and is linked to a still-open task by lms_assignment_ref, flip the task.
  const closable = subs.filter((s) => CLOSED_STATES.has(s.state));
  if (closable.length === 0) return { upserted: rows.length, tasksClosed: 0 };

  const assignmentIds = Array.from(new Set(closable.map((s) => s.externalAssignmentId).filter(Boolean)));
  if (assignmentIds.length === 0) return { upserted: rows.length, tasksClosed: 0 };

  // Fetch candidate open tasks whose ref hits any of these assignment ids. We
  // use a broad fetch and filter in code because PostgREST can't easily compare
  // a single jsonb field across a list of values.
  const idClause = assignmentIds.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
  const tasks = await selectRows<OpenTaskRow>(
    ctx,
    "tasks",
    `user_id=eq.${encodeURIComponent(integration.user_id)}` +
      `&status=neq.done` +
      `&lms_assignment_ref->>assignment_id=in.(${encodeURIComponent(idClause)})` +
      `&select=id,status,lms_assignment_ref`
  ).catch(() => [] as OpenTaskRow[]);

  let closedCount = 0;
  for (const sub of closable) {
    const match = tasks.find((t) => {
      const ref = t.lms_assignment_ref || {};
      return (
        ref.assignment_id === sub.externalAssignmentId ||
        ref.externalAssignmentId === sub.externalAssignmentId
      );
    });
    if (!match) continue;
    try {
      await patchRow(
        ctx,
        "tasks",
        `id=eq.${encodeURIComponent(match.id)}&user_id=eq.${encodeURIComponent(integration.user_id)}`,
        {
          status: "done",
          completed_at: nowIso,
          completion_source: "lms",
          completion_confidence: 100,
        }
      );
      // Backfill the submission row with task_id so future syncs short-circuit.
      await patchRow(
        ctx,
        "submissions",
        `user_id=eq.${encodeURIComponent(integration.user_id)}` +
          `&provider_id=eq.${encodeURIComponent(integration.provider_id)}` +
          `&external_submission_id=eq.${encodeURIComponent(sub.externalSubmissionId)}`,
        { task_id: match.id }
      );
      // Mirror into the existing event-replay pipeline so behavioral signals
      // see this exactly like an extension-detected submission.
      await insertRows(ctx, "lms_submission_events", [
        {
          user_id: integration.user_id,
          task_id: match.id,
          lms: integration.provider_id === "classroom" ? "classroom" : "custom",
          lms_course_id: sub.externalCourseId,
          lms_assignment_id: sub.externalAssignmentId,
          lms_assignment_title: sub.assignmentTitle,
          evidence_kind: "submission_post",
          evidence_weight: 100,
          evidence_detail: { source, provider: integration.provider_id, state: sub.state },
          confidence_after: 100,
          occurred_at: nowIso,
        },
      ]).catch(() => {
        // Dedupe index can reject same-second duplicates; that's fine.
      });
      closedCount++;
    } catch (err) {
      console.error("[lms-upsert] auto-close failed", {
        provider: integration.provider_id,
        userId: integration.user_id,
        assignmentId: sub.externalAssignmentId,
        error: String(err),
      });
    }
  }

  return { upserted: rows.length, tasksClosed: closedCount };
}

/** Inline use by the orchestrator — keep imports tidy. */
export { headers };
