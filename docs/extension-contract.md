# SOS Browser Extension — API Contract

The extension scrapes Schoology (and other LMSs) from within the browser and
posts batches of assignments to the SOS server. No LMS API keys, no admin setup.

## Authentication

Every request must include a Supabase user JWT in the `Authorization` header:

```
Authorization: Bearer <supabase-access-token>
```

The extension retrieves this token from `chrome.storage.local` after the user
signs into SOS in any tab.

## POST /api/lms-ingest

Post a batch of scraped assignments. Idempotent — safe to re-post the same
batch; rows deduplicate on `(user_id, provider_id, external_submission_id)`.

### Request

```json
{
  "provider": "schoology",
  "submissions": [
    {
      "externalCourseId": "12345",
      "externalAssignmentId": "67890",
      "externalSubmissionId": "67890-uid",
      "assignmentTitle": "Essay on photosynthesis",
      "state": "submitted",
      "submittedAt": "2026-05-24T14:30:00Z",
      "gradedAt": null,
      "grade": null,
      "url": "https://app.schoology.com/assignment/67890/submission"
    }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `provider` | string | yes | `"schoology"` (or future LMS ids) |
| `externalCourseId` | string | yes | Section/course id in the LMS |
| `externalAssignmentId` | string | yes | Assignment id |
| `externalSubmissionId` | string | no | Stable per-submission id; falls back to `externalAssignmentId` |
| `assignmentTitle` | string\|null | no | Human-readable name |
| `state` | string | no | `submitted`, `graded`, `returned`, `missing`, `draft` (default: `submitted`) |
| `submittedAt` | ISO8601\|null | no | When the student submitted |
| `gradedAt` | ISO8601\|null | no | When a grade appeared |
| `grade` | number\|null | no | Numeric grade value |
| `url` | string\|null | no | Deep link into the LMS |

### Response

```json
{ "ok": true, "upserted": 5, "tasksClosed": 2 }
```

`tasksClosed` is the count of open SOS tasks whose `lms_assignment_ref` matched
an incoming assignment and were automatically marked done.

## Scraping schedule

Use `chrome.alarms` to fire every 10 minutes:

```js
chrome.alarms.create("sos-lms-sync", { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "sos-lms-sync") return;
  await scrapeAndPost();
});
```

## Pages to scrape (Schoology)

| Data | URL |
|------|-----|
| All upcoming/overdue assignments | `/home` (dashboard widget) or `/assignment/list` |
| Submission status per course | `/course/:sectionId/materials` |
| Grades | `/grades/grades/gid/:sectionId` |

Parse the DOM using the existing selectors in `extension/content/schoology.js`
as a reference. Post the full batch to `/api/lms-ingest` after each scrape.

## What the server does with the data

1. Upserts rows into `submissions` (source = `'extension'`).
2. For each submitted/graded/returned assignment, looks for an open task whose
   `lms_assignment_ref->>'assignment_id'` matches `externalAssignmentId`.
3. If found, marks the task `status = 'done'`, sets `completed_at`, and writes
   an `lms_submission_events` row so the behavioral confidence engine sees it.
