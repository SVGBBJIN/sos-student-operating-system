-- Widen lms_submission_events.lms to allow 'schoology'. PostgreSQL doesn't
-- support ALTER on a CHECK constraint in-place; drop and re-add.

alter table lms_submission_events
  drop constraint if exists lms_submission_events_lms_check;

alter table lms_submission_events
  add constraint lms_submission_events_lms_check
    check (lms in ('classroom', 'canvas', 'schoology'));
