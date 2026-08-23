// Adapter contract for LMS pull adapters (polled by sync-submissions every 10 minutes).
//
// Extension-scraped providers (Schoology) bypass this layer entirely — they POST
// directly to api/lms-ingest. Both paths converge on NormalizedSubmission.

export type SubmissionState = "submitted" | "graded" | "returned" | "missing" | "draft";

export interface NormalizedSubmission {
  externalCourseId: string;
  externalAssignmentId: string;
  externalSubmissionId: string;
  assignmentTitle: string | null;
  state: SubmissionState;
  submittedAt: string | null;
  gradedAt: string | null;
  grade: number | null;
  url: string | null;
  raw: unknown;
}

/**
 * A piece of course material — not evidence that the student did something,
 * but the thing they were asked to do or read. Bodies are always plain text;
 * HTML is stripped at the adapter boundary so downstream consumers (embedding,
 * RAG, study-pack generation) never have to care where a row came from.
 */
export interface NormalizedContentItem {
  externalCourseId: string;
  externalId: string;
  kind: ContentKind;
  title: string | null;
  bodyText: string | null;
  url: string | null;
  courseName: string | null;
  dueAt: string | null;
  postedAt: string | null;
  /** Links found on this item, followed exactly one hop by the attachment pass. */
  attachments?: AttachmentRef[];
  raw: unknown;
}

export type ContentKind =
  | "syllabus"
  | "announcement"
  | "module"
  | "module_item"
  | "page"
  | "quiz"
  | "discussion"
  | "assignment"
  | "calendar_event"
  | "lti_link"
  | "file";

export interface AttachmentRef {
  url: string;
  title?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
}

/**
 * A structured event from a calendar the student already keeps. Mirrored into
 * `events` rather than stored separately, so the planner, briefing, and
 * schedule-density signals see it without any of them learning a new table.
 */
export interface NormalizedCalendarEvent {
  externalId: string;
  title: string;
  /** Local calendar date, YYYY-MM-DD — matches events.event_date. */
  date: string;
  /** HH:MM:SS local, or null for all-day. */
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  location: string | null;
  url: string | null;
  /** Set when the source marks this event cancelled, so we can retract it. */
  cancelled?: boolean;
  raw: unknown;
}

export interface UserIntegrationRow {
  id: string;
  user_id: string;
  provider_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  external_user_id: string | null;
  status: "active" | "pending" | "revoked" | "error";
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  /** Per-school base URL for self-hosted providers (Canvas). */
  instance_url?: string | null;
  settings?: Record<string, unknown> | null;
}

export interface TrackedCourseRow {
  id: string;
  integration_id: string;
  user_id: string;
  external_course_id: string;
  course_name: string | null;
  enabled: boolean;
}

export type TokenPatch = Partial<
  Pick<UserIntegrationRow, "access_token" | "refresh_token" | "token_expires_at" | "external_user_id" | "status">
>;

export interface PullAdapterCtx {
  integration: UserIntegrationRow;
  courses: TrackedCourseRow[];
  saveTokens: (patch: TokenPatch) => Promise<void>;
}

export interface PullAdapter {
  id: string;
  mode: "pull";
  fetchSubmissions(ctx: PullAdapterCtx): Promise<NormalizedSubmission[]>;
  /** Optional course directory listing for the Step 3 picker. */
  listCourses?(ctx: PullAdapterCtx): Promise<Array<{ externalCourseId: string; name: string }>>;
  /**
   * Optional course-material pass. Adapters that implement this are pulling
   * what the student has to *read and do*, not just what they've turned in.
   * Runs after fetchSubmissions and is allowed to fail on its own — a content
   * error never costs the caller its submission sync.
   */
  fetchContent?(ctx: PullAdapterCtx): Promise<NormalizedContentItem[]>;
  /** Optional structured-calendar pass, mirrored into `events`. */
  fetchCalendar?(ctx: PullAdapterCtx): Promise<NormalizedCalendarEvent[]>;
}

export type LMSAdapter = PullAdapter;
