/**
 * dataHandlers — client-side data writers that don't belong to a component.
 */

import { sb } from './supabase';

/* ─── Task Event Telemetry ───────────────────────────────────────────────── */

/**
 * dbInsertTaskEvent — fire-and-forget behavioral telemetry write.
 * Exactly one of taskId or eventId must be provided.
 */
export async function dbInsertTaskEvent(
  { taskId = null, eventId = null, eventType, fromStatus = null, toStatus = null, metadata = {} },
  userId
) {
  if (!userId) return;
  if (!taskId && !eventId) return;
  try {
    await sb.from('task_events').insert({
      user_id: userId,
      task_id: taskId,
      event_id: eventId,
      event_type: eventType,
      from_status: fromStatus,
      to_status: toStatus,
      occurred_at: new Date().toISOString(),
      metadata,
    });
  } catch (e) {
    console.warn('[task_events] write failed:', e);
  }
}
