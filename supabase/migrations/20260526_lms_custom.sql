-- Widen lms_submission_events.lms to allow 'custom' — user-added LMS domains
-- handled by the extension's generic content script.

alter table lms_submission_events
  drop constraint if exists lms_submission_events_lms_check;

alter table lms_submission_events
  add constraint lms_submission_events_lms_check
    check (lms in ('classroom', 'canvas', 'schoology', 'custom'));
