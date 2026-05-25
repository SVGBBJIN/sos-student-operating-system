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
}

export type LMSAdapter = PullAdapter;
