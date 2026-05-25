// Google Classroom adapter — pull mode.
//
// Reads OAuth2 access/refresh tokens from the integration row, refreshes the
// access token when within 60s of expiry, then walks every tracked course and
// pages through studentSubmissions. The Classroom REST shape is documented at
// https://developers.google.com/classroom/reference/rest/v1/courses.courseWork.studentSubmissions

import { refreshGoogleToken, expiryFromNow } from "../oauth/google.js";
import type {
  PullAdapter,
  PullAdapterCtx,
  NormalizedSubmission,
  SubmissionState,
} from "./types.js";

const API_BASE = "https://classroom.googleapis.com/v1";

interface ClassroomSubmission {
  id: string;
  courseId: string;
  courseWorkId: string;
  state?: string;
  assignedGrade?: number | null;
  draftGrade?: number | null;
  updateTime?: string;
  creationTime?: string;
  alternateLink?: string;
  courseWorkType?: string;
  late?: boolean;
}

interface CourseWorkLite {
  id: string;
  title?: string;
  alternateLink?: string;
}

async function ensureFreshToken(ctx: PullAdapterCtx): Promise<string> {
  const { integration, saveTokens } = ctx;
  const expiresAt = integration.token_expires_at ? Date.parse(integration.token_expires_at) : 0;
  const needsRefresh = !integration.access_token || expiresAt - Date.now() < 60_000;
  if (!needsRefresh) return integration.access_token as string;

  if (!integration.refresh_token) {
    throw new Error("Classroom integration has no refresh_token — user must reconnect");
  }
  try {
    const next = await refreshGoogleToken(integration.refresh_token);
    const patch = {
      access_token: next.access_token,
      token_expires_at: expiryFromNow(next.expires_in),
      ...(next.refresh_token ? { refresh_token: next.refresh_token } : {}),
    };
    await saveTokens(patch);
    // Mutate local copy so subsequent calls in this run see the new token.
    integration.access_token = patch.access_token;
    integration.token_expires_at = patch.token_expires_at;
    if (next.refresh_token) integration.refresh_token = next.refresh_token;
    return next.access_token;
  } catch (err) {
    // invalid_grant — flip integration to revoked so the UI prompts a reconnect.
    if (/invalid_grant/i.test(String(err))) {
      await saveTokens({ status: "revoked" });
    }
    throw err;
  }
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function mapState(s: ClassroomSubmission): SubmissionState {
  if (s.assignedGrade != null) return "graded";
  switch (s.state) {
    case "TURNED_IN":
      return "submitted";
    case "RETURNED":
      return "returned";
    case "RECLAIMED_BY_STUDENT":
    case "CREATED":
    case "NEW":
      return "draft";
    default:
      return s.late ? "missing" : "draft";
  }
}

async function fetchCourseWorkTitles(token: string, courseId: string): Promise<Map<string, string>> {
  // Best-effort: pull the courseWork list so we can attach titles to each submission.
  const url = `${API_BASE}/courses/${encodeURIComponent(courseId)}/courseWork?pageSize=200&fields=courseWork(id,title,alternateLink),nextPageToken`;
  const titles = new Map<string, string>();
  let pageToken: string | undefined;
  do {
    const u = pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url;
    const res = await fetch(u, { headers: authHeaders(token) });
    if (!res.ok) break;
    const data = (await res.json().catch(() => ({}))) as { courseWork?: CourseWorkLite[]; nextPageToken?: string };
    for (const cw of data.courseWork ?? []) {
      if (cw.id && cw.title) titles.set(cw.id, cw.title);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return titles;
}

async function fetchSubmissionsForCourse(
  token: string,
  courseId: string
): Promise<ClassroomSubmission[]> {
  const base = `${API_BASE}/courses/${encodeURIComponent(courseId)}/courseWork/-/studentSubmissions?userId=me&pageSize=200`;
  const all: ClassroomSubmission[] = [];
  let pageToken: string | undefined;
  do {
    const u = pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base;
    const res = await fetch(u, { headers: authHeaders(token) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Classroom studentSubmissions ${res.status} for course ${courseId}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { studentSubmissions?: ClassroomSubmission[]; nextPageToken?: string };
    for (const s of data.studentSubmissions ?? []) all.push(s);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}

export const classroomAdapter: PullAdapter = {
  id: "classroom",
  mode: "pull",

  async fetchSubmissions(ctx: PullAdapterCtx): Promise<NormalizedSubmission[]> {
    const token = await ensureFreshToken(ctx);
    const out: NormalizedSubmission[] = [];
    for (const course of ctx.courses) {
      const [submissions, titles] = await Promise.all([
        fetchSubmissionsForCourse(token, course.external_course_id),
        fetchCourseWorkTitles(token, course.external_course_id),
      ]);
      for (const s of submissions) {
        out.push({
          externalCourseId: s.courseId,
          externalAssignmentId: s.courseWorkId,
          externalSubmissionId: s.id,
          assignmentTitle: titles.get(s.courseWorkId) ?? null,
          state: mapState(s),
          submittedAt: s.state === "TURNED_IN" ? s.updateTime ?? null : null,
          gradedAt: s.assignedGrade != null ? s.updateTime ?? null : null,
          grade: typeof s.assignedGrade === "number" ? s.assignedGrade : null,
          url: s.alternateLink ?? null,
          raw: s,
        });
      }
    }
    return out;
  },

  async listCourses(ctx: PullAdapterCtx): Promise<Array<{ externalCourseId: string; name: string }>> {
    const token = await ensureFreshToken(ctx);
    const url = `${API_BASE}/courses?studentId=me&courseStates=ACTIVE&pageSize=200&fields=courses(id,name),nextPageToken`;
    const out: Array<{ externalCourseId: string; name: string }> = [];
    let pageToken: string | undefined;
    do {
      const u = pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url;
      const res = await fetch(u, { headers: authHeaders(token) });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Classroom courses.list ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { courses?: Array<{ id: string; name: string }>; nextPageToken?: string };
      for (const c of data.courses ?? []) out.push({ externalCourseId: c.id, name: c.name });
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  },
};
