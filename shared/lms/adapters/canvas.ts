// Canvas LMS adapter — pull mode, full course depth.
//
// Auth: a personal access token, not OAuth2. Canvas OAuth2 needs a developer
// key that only a school's Canvas admin can issue, which puts it out of reach
// for an individual student; any user can mint a personal access token from
// Account → Settings. The token and the school's own Canvas hostname both live
// on the integration row (access_token / instance_url).
//
// Depth: Canvas exposes far more than assignments, and the parts a student
// actually gets blindsided by — a syllabus change, a quiz that only appears in
// a module, an announcement rescheduling a test — live outside the assignment
// list. fetchContent() walks all of it.
//
// API reference: https://canvas.instructure.com/doc/api/

import { htmlToText, extractLinks } from "../html.js";
import type {
  AttachmentRef,
  NormalizedCalendarEvent,
  NormalizedContentItem,
  NormalizedSubmission,
  PullAdapter,
  PullAdapterCtx,
  SubmissionState,
} from "./types.js";

/** Canvas paginates everything; without a cap a busy course could walk forever. */
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

interface CanvasSubmission {
  id: number;
  assignment_id: number;
  course_id?: number;
  user_id?: number;
  workflow_state?: string;
  submitted_at?: string | null;
  graded_at?: string | null;
  score?: number | null;
  grade?: string | null;
  missing?: boolean;
  late?: boolean;
  html_url?: string | null;
  preview_url?: string | null;
  assignment?: { id: number; name?: string; html_url?: string | null } | null;
}

interface CanvasAssignment {
  id: number;
  name?: string;
  description?: string | null;
  due_at?: string | null;
  html_url?: string | null;
  published?: boolean;
  quiz_id?: number | null;
  is_quiz_assignment?: boolean;
  external_tool_tag_attributes?: { url?: string | null } | null;
}

interface CanvasCourse {
  id: number;
  name?: string;
  course_code?: string;
  syllabus_body?: string | null;
}

interface CanvasFileRef {
  id?: number;
  display_name?: string;
  filename?: string;
  url?: string;
  "content-type"?: string;
  content_type?: string;
  size?: number;
}

/** Canvas returns absolute instance URLs; normalise whatever the user pasted. */
export function normalizeInstanceUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:") {
    throw new Error("Canvas instance URL must use https");
  }
  return `${url.protocol}//${url.host}`;
}

function credentials(ctx: PullAdapterCtx): { base: string; token: string } {
  const token = ctx.integration.access_token;
  if (!token) throw new Error("Canvas integration has no access token — reconnect to add one");
  const instance = ctx.integration.instance_url;
  if (!instance) throw new Error("Canvas integration has no instance_url — reconnect to set your school's Canvas address");
  return { base: `${normalizeInstanceUrl(instance)}/api/v1`, token };
}

/** Canvas signals the next page through a Link header, not a body token. */
function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(part.trim());
    if (m && m[1]) return m[1];
  }
  return null;
}

async function canvasGet<T>(
  token: string,
  url: string,
  opts: { optional?: boolean } = {}
): Promise<T | null> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    // A revoked or mistyped token is terminal for the whole integration; a 403
    // on one optional sub-resource (a course that hides its files, say) is not.
    if (opts.optional) return null;
    throw new Error(`Canvas ${res.status} — token rejected; the student may need to regenerate it`);
  }
  if (!res.ok) {
    if (opts.optional) return null;
    const body = await res.text().catch(() => "");
    throw new Error(`Canvas GET ${res.status} ${url}: ${body.slice(0, 200)}`);
  }
  return (await res.json().catch(() => null)) as T | null;
}

/** Paged GET that follows Link: rel="next" up to MAX_PAGES. */
async function canvasList<T>(
  token: string,
  firstUrl: string,
  opts: { optional?: boolean } = {}
): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = firstUrl;
  let pages = 0;

  while (url && pages < MAX_PAGES) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      if (opts.optional || pages > 0) break;
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Canvas ${res.status} — token rejected; the student may need to regenerate it`);
      }
      const body = await res.text().catch(() => "");
      throw new Error(`Canvas GET ${res.status} ${url}: ${body.slice(0, 200)}`);
    }
    const page = (await res.json().catch(() => [])) as T[];
    if (Array.isArray(page)) out.push(...page);
    url = nextPageUrl(res.headers.get("link"));
    pages++;
  }
  return out;
}

function mapState(s: CanvasSubmission): SubmissionState {
  if (s.graded_at || (s.score != null && s.workflow_state === "graded")) return "graded";
  switch (s.workflow_state) {
    case "submitted":
    case "pending_review":
      return "submitted";
    case "graded":
      return "graded";
    case "unsubmitted":
      return s.missing ? "missing" : "draft";
    default:
      return s.submitted_at ? "submitted" : s.missing ? "missing" : "draft";
  }
}

function fileToAttachment(f: CanvasFileRef): AttachmentRef | null {
  if (!f.url) return null;
  return {
    url: f.url,
    title: f.display_name ?? f.filename ?? null,
    mimeType: f["content-type"] ?? f.content_type ?? null,
    byteSize: typeof f.size === "number" ? f.size : null,
  };
}

/** Body links plus any Canvas-hosted file rows, deduped by URL. */
function collectAttachments(
  html: string | null | undefined,
  files: CanvasFileRef[] = []
): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const ref = fileToAttachment(f);
    if (ref && !seen.has(ref.url)) {
      seen.add(ref.url);
      out.push(ref);
    }
  }
  for (const link of extractLinks(html)) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    out.push({ url: link.url, title: link.title });
  }
  return out;
}

function iso(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ── Submissions ─────────────────────────────────────────────────────────────

async function fetchSubmissionsForCourse(
  base: string,
  token: string,
  courseId: string
): Promise<CanvasSubmission[]> {
  // include[]=assignment gives us the title in the same round trip.
  const url =
    `${base}/courses/${encodeURIComponent(courseId)}/students/submissions` +
    `?student_ids[]=self&per_page=${PAGE_SIZE}&include[]=assignment`;
  return canvasList<CanvasSubmission>(token, url);
}

// ── Content passes ──────────────────────────────────────────────────────────
// Each returns [] on failure rather than throwing: a course that hides its
// discussions shouldn't cost us its syllabus.

async function fetchSyllabus(
  base: string,
  token: string,
  courseId: string,
  courseName: string | null
): Promise<NormalizedContentItem[]> {
  const course = await canvasGet<CanvasCourse>(
    token,
    `${base}/courses/${encodeURIComponent(courseId)}?include[]=syllabus_body`,
    { optional: true }
  );
  const body = course?.syllabus_body;
  if (!body) return [];
  const text = htmlToText(body);
  if (!text) return [];
  return [
    {
      externalCourseId: courseId,
      externalId: `${courseId}:syllabus`,
      kind: "syllabus",
      title: `${courseName ?? course?.name ?? "Course"} — Syllabus`,
      bodyText: text,
      url: null,
      courseName,
      dueAt: null,
      postedAt: null,
      attachments: collectAttachments(body),
      raw: { syllabus_body_length: body.length },
    },
  ];
}

async function fetchAnnouncements(
  base: string,
  token: string,
  courseId: string,
  courseName: string | null
): Promise<NormalizedContentItem[]> {
  const rows = await canvasList<{
    id: number;
    title?: string;
    message?: string | null;
    html_url?: string | null;
    posted_at?: string | null;
    attachments?: CanvasFileRef[];
  }>(
    token,
    `${base}/announcements?context_codes[]=course_${encodeURIComponent(courseId)}&per_page=${PAGE_SIZE}`,
    { optional: true }
  );
  return rows.map((a) => ({
    externalCourseId: courseId,
    externalId: `${courseId}:announcement:${a.id}`,
    kind: "announcement" as const,
    title: a.title ?? null,
    bodyText: htmlToText(a.message),
    url: a.html_url ?? null,
    courseName,
    dueAt: null,
    postedAt: iso(a.posted_at),
    attachments: collectAttachments(a.message, a.attachments ?? []),
    raw: a,
  }));
}

async function fetchAssignmentsAndQuizzes(
  base: string,
  token: string,
  courseId: string,
  courseName: string | null
): Promise<NormalizedContentItem[]> {
  const assignments = await canvasList<CanvasAssignment>(
    token,
    `${base}/courses/${encodeURIComponent(courseId)}/assignments?per_page=${PAGE_SIZE}`,
    { optional: true }
  );

  const items: NormalizedContentItem[] = assignments.map((a) => {
    const externalToolUrl = a.external_tool_tag_attributes?.url ?? null;
    // An assignment backed by an external tool is an LTI launch — the real
    // material lives in the tool, so record it as a link rather than pretending
    // the (usually empty) Canvas description is the content.
    const kind: NormalizedContentItem["kind"] = externalToolUrl
      ? "lti_link"
      : a.quiz_id || a.is_quiz_assignment
        ? "quiz"
        : "assignment";
    const attachments = collectAttachments(a.description);
    if (externalToolUrl) attachments.unshift({ url: externalToolUrl, title: a.name ?? null });
    return {
      externalCourseId: courseId,
      externalId: `${courseId}:assignment:${a.id}`,
      kind,
      title: a.name ?? null,
      bodyText: htmlToText(a.description),
      url: a.html_url ?? null,
      courseName,
      dueAt: iso(a.due_at),
      postedAt: null,
      attachments,
      raw: a,
    };
  });

  // Classic quizzes that aren't surfaced as assignments (survey/practice types)
  // never appear above, and those are exactly the low-stakes-but-graded things
  // students forget.
  const quizzes = await canvasList<{
    id: number;
    title?: string;
    description?: string | null;
    due_at?: string | null;
    html_url?: string | null;
    assignment_id?: number | null;
    quiz_type?: string;
  }>(
    token,
    `${base}/courses/${encodeURIComponent(courseId)}/quizzes?per_page=${PAGE_SIZE}`,
    { optional: true }
  );
  const seenAssignmentIds = new Set(assignments.map((a) => a.id));
  for (const q of quizzes) {
    if (q.assignment_id && seenAssignmentIds.has(q.assignment_id)) continue;
    items.push({
      externalCourseId: courseId,
      externalId: `${courseId}:quiz:${q.id}`,
      kind: "quiz",
      title: q.title ?? null,
      bodyText: htmlToText(q.description),
      url: q.html_url ?? null,
      courseName,
      dueAt: iso(q.due_at),
      postedAt: null,
      attachments: collectAttachments(q.description),
      raw: q,
    });
  }
  return items;
}

async function fetchDiscussions(
  base: string,
  token: string,
  courseId: string,
  courseName: string | null
): Promise<NormalizedContentItem[]> {
  const rows = await canvasList<{
    id: number;
    title?: string;
    message?: string | null;
    html_url?: string | null;
    posted_at?: string | null;
    todo_date?: string | null;
    is_announcement?: boolean;
    attachments?: CanvasFileRef[];
  }>(
    token,
    `${base}/courses/${encodeURIComponent(courseId)}/discussion_topics?per_page=${PAGE_SIZE}`,
    { optional: true }
  );
  return rows
    // Canvas models announcements as discussion topics; we already have those.
    .filter((d) => !d.is_announcement)
    .map((d) => ({
      externalCourseId: courseId,
      externalId: `${courseId}:discussion:${d.id}`,
      kind: "discussion" as const,
      title: d.title ?? null,
      bodyText: htmlToText(d.message),
      url: d.html_url ?? null,
      courseName,
      dueAt: iso(d.todo_date),
      postedAt: iso(d.posted_at),
      attachments: collectAttachments(d.message, d.attachments ?? []),
      raw: d,
    }));
}

async function fetchPages(
  base: string,
  token: string,
  courseId: string,
  courseName: string | null
): Promise<NormalizedContentItem[]> {
  // The page index omits bodies, so fetch each page's body individually. Cap
  // the fan-out — a wiki-heavy course can carry hundreds of pages and the
  // recently-edited ones are the ones that matter.
  const index = await canvasList<{
    url?: string;
    title?: string;
    html_url?: string | null;
    updated_at?: string | null;
    published?: boolean;
  }>(
    token,
    `${base}/courses/${encodeURIComponent(courseId)}/pages?per_page=${PAGE_SIZE}&sort=updated_at&order=desc`,
    { optional: true }
  );

  const recent = index.filter((p) => p.published !== false && p.url).slice(0, 25);
  const out: NormalizedContentItem[] = [];
  for (const p of recent) {
    const full = await canvasGet<{ body?: string | null; title?: string; html_url?: string | null }>(
      token,
      `${base}/courses/${encodeURIComponent(courseId)}/pages/${encodeURIComponent(p.url as string)}`,
      { optional: true }
    );
    const body = full?.body ?? null;
    const text = htmlToText(body);
    if (!text) continue;
    out.push({
      externalCourseId: courseId,
      externalId: `${courseId}:page:${p.url}`,
      kind: "page",
      title: full?.title ?? p.title ?? null,
      bodyText: text,
      url: full?.html_url ?? p.html_url ?? null,
      courseName,
      dueAt: null,
      postedAt: iso(p.updated_at),
      attachments: collectAttachments(body),
      raw: { ...p, body_length: body?.length ?? 0 },
    });
  }
  return out;
}

async function fetchModules(
  base: string,
  token: string,
  courseId: string,
  courseName: string | null
): Promise<NormalizedContentItem[]> {
  const modules = await canvasList<{
    id: number;
    name?: string;
    position?: number;
    unlock_at?: string | null;
    items?: Array<{
      id: number;
      title?: string;
      type?: string;
      html_url?: string | null;
      external_url?: string | null;
      content_id?: number | null;
    }>;
  }>(
    token,
    `${base}/courses/${encodeURIComponent(courseId)}/modules?per_page=${PAGE_SIZE}&include[]=items`,
    { optional: true }
  );

  const out: NormalizedContentItem[] = [];
  for (const m of modules) {
    const items = m.items ?? [];
    // The module itself is worth one row: its ordering is the course's own
    // statement of what comes next, which no individual item carries.
    const outline = items
      .map((it, i) => `${i + 1}. ${it.title ?? "Untitled"}${it.type ? ` (${it.type})` : ""}`)
      .join("\n");
    out.push({
      externalCourseId: courseId,
      externalId: `${courseId}:module:${m.id}`,
      kind: "module",
      title: m.name ?? null,
      bodyText: outline || null,
      url: null,
      courseName,
      dueAt: null,
      postedAt: iso(m.unlock_at),
      attachments: [],
      raw: m,
    });

    // ExternalUrl / ExternalTool items are the LTI links — publisher sites,
    // textbook portals — that hold material Canvas itself never stores.
    for (const it of items) {
      const target = it.external_url ?? null;
      if (!target || (it.type !== "ExternalUrl" && it.type !== "ExternalTool")) continue;
      out.push({
        externalCourseId: courseId,
        externalId: `${courseId}:lti:${it.id}`,
        kind: "lti_link",
        title: it.title ?? null,
        bodyText: null,
        url: it.html_url ?? target,
        courseName,
        dueAt: null,
        postedAt: null,
        attachments: [{ url: target, title: it.title ?? null }],
        raw: it,
      });
    }
  }
  return out;
}

// ── Calendar ────────────────────────────────────────────────────────────────

function splitTimestamp(value: string | null): { date: string | null; time: string | null } {
  if (!value) return { date: null, time: null };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: null, time: null };
  // Canvas returns UTC; render in the runtime's local zone so a 7pm event
  // doesn't land on the next calendar day.
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:00`,
  };
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export const canvasAdapter: PullAdapter = {
  id: "canvas",
  mode: "pull",

  async fetchSubmissions(ctx: PullAdapterCtx): Promise<NormalizedSubmission[]> {
    const { base, token } = credentials(ctx);
    const out: NormalizedSubmission[] = [];

    for (const course of ctx.courses) {
      const subs = await fetchSubmissionsForCourse(base, token, course.external_course_id);
      for (const s of subs) {
        out.push({
          externalCourseId: String(s.course_id ?? course.external_course_id),
          externalAssignmentId: String(s.assignment_id),
          externalSubmissionId: String(s.id),
          assignmentTitle: s.assignment?.name ?? null,
          state: mapState(s),
          submittedAt: iso(s.submitted_at),
          gradedAt: iso(s.graded_at),
          grade: typeof s.score === "number" ? s.score : null,
          url: s.html_url ?? s.assignment?.html_url ?? null,
          raw: s,
        });
      }
    }
    return out;
  },

  async listCourses(ctx: PullAdapterCtx): Promise<Array<{ externalCourseId: string; name: string }>> {
    const { base, token } = credentials(ctx);
    const courses = await canvasList<CanvasCourse>(
      token,
      `${base}/courses?enrollment_state=active&enrollment_type=student&per_page=${PAGE_SIZE}`
    );
    return courses
      .filter((c) => c.id != null)
      .map((c) => ({
        externalCourseId: String(c.id),
        name: c.name ?? c.course_code ?? `Course ${c.id}`,
      }));
  },

  async fetchContent(ctx: PullAdapterCtx): Promise<NormalizedContentItem[]> {
    const { base, token } = credentials(ctx);
    const out: NormalizedContentItem[] = [];

    for (const course of ctx.courses) {
      const courseId = course.external_course_id;
      const courseName = course.course_name;
      // Every pass is independently optional — one 403 shouldn't cost the rest.
      const passes = await Promise.allSettled([
        fetchSyllabus(base, token, courseId, courseName),
        fetchAnnouncements(base, token, courseId, courseName),
        fetchAssignmentsAndQuizzes(base, token, courseId, courseName),
        fetchDiscussions(base, token, courseId, courseName),
        fetchPages(base, token, courseId, courseName),
        fetchModules(base, token, courseId, courseName),
      ]);
      for (const pass of passes) {
        if (pass.status === "fulfilled") {
          out.push(...pass.value);
        } else {
          console.error("[canvas] content pass failed", {
            courseId,
            error: String(pass.reason),
          });
        }
      }
    }
    return out;
  },

  async fetchCalendar(ctx: PullAdapterCtx): Promise<NormalizedCalendarEvent[]> {
    const { base, token } = credentials(ctx);
    if (ctx.courses.length === 0) return [];

    // Canvas calendar_events need an explicit window; anything further out than
    // a term isn't actionable for a student anyway.
    const start = new Date();
    start.setDate(start.getDate() - 7);
    const end = new Date();
    end.setDate(end.getDate() + 120);

    const contextCodes = ctx.courses
      .map((c) => `context_codes[]=course_${encodeURIComponent(c.external_course_id)}`)
      .join("&");
    const url =
      `${base}/calendar_events?${contextCodes}` +
      `&start_date=${start.toISOString().slice(0, 10)}` +
      `&end_date=${end.toISOString().slice(0, 10)}` +
      `&per_page=${PAGE_SIZE}`;

    const rows = await canvasList<{
      id: number;
      title?: string;
      description?: string | null;
      start_at?: string | null;
      end_at?: string | null;
      location_name?: string | null;
      html_url?: string | null;
      workflow_state?: string;
      all_day?: boolean;
    }>(token, url, { optional: true });

    const out: NormalizedCalendarEvent[] = [];
    for (const e of rows) {
      const startParts = splitTimestamp(iso(e.start_at));
      if (!startParts.date) continue;
      const endParts = splitTimestamp(iso(e.end_at));
      out.push({
        externalId: `canvas:${e.id}`,
        title: e.title ?? "Untitled",
        date: startParts.date,
        startTime: e.all_day ? null : startParts.time,
        endTime: e.all_day ? null : endParts.time,
        description: htmlToText(e.description) || null,
        location: e.location_name ?? null,
        url: e.html_url ?? null,
        cancelled: e.workflow_state === "deleted",
        raw: e,
      });
    }
    return out;
  },
};
