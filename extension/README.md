# SOS — Submission Tracker (browser extension)

Ambient submission tracking PoC. Watches Google Classroom, Canvas, and Schoology in the
student's own browser and posts structured evidence to the SOS backend, which
applies a confidence engine and flips matching SOS tasks to `done` when an
assignment is turned in.

## Local install

1. Open `chrome://extensions`, enable Developer mode, choose **Load
   unpacked**, point at this `extension/` directory.
2. Open the popup, set the API base to your SOS deployment URL (e.g.
   `http://localhost:5173` for `npm run dev`, or your Vercel deployment).
3. Click **Sign in** — the popup opens `${apiBase}/extension-auth`, which
   needs to redirect back with `#access_token=<jwt>` in the URL hash. The
   chrome.identity callback URL is `https://<extension-id>.chromiumapp.org/supabase`.
4. Approve **Google Classroom**, **Canvas**, and/or **Schoology** — Chrome
   prompts for the specific host permission. No `<all_urls>` access is
   requested.

## Architecture

- `manifest.json` — MV3 with optional host permissions per LMS.
- `background.js` — service worker. Holds the JWT, batches incoming events,
  POSTs to `${apiBase}/api/lms-event` every ~5s.
- `content/shared/parse.js` — submission text/URL pattern primitives.
- `content/shared/net.js` + `net-page.js` — wraps `fetch`/XHR in page context
  via web-accessible resource injection, captures successful submission POSTs.
- `content/classroom.js`, `content/canvas.js`, `content/schoology.js` — LMS-specific parsers. Each
  watches URL changes, MutationObserver, file uploads, and emits structured
  evidence events.

## What is sent to the backend

Only structured evidence rows: `{ lms, course_id, assignment_id, title,
evidence_kind, evidence_detail, occurred_at }`. **Never** raw HTML, cookies,
keystrokes, screenshots, microphone or camera data, or browsing history.

See `shared/lms/confidence.ts` for the scoring rules and
`shared/lms/ingest.ts` for what the server does with each event.
