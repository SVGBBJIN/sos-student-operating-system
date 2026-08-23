// Mirror external calendar events into the `events` table.
//
// Deliberately not a new table: the planner, the daily briefing, and the
// schedule-density signal all read `events`, and none of them should have to
// learn that some events came from Google. The external_source/external_id
// columns carry provenance so a re-sync updates rather than duplicates, and so
// the UI can badge a row as mirrored.

import { deleteRows, upsertRows, type SupabaseRest } from "./supabaseRest.js";
import type { NormalizedCalendarEvent, UserIntegrationRow } from "./adapters/types.js";

export interface MirrorResult {
  upserted: number;
  cancelled: number;
}

export async function mirrorCalendarEvents(
  ctx: SupabaseRest,
  integration: UserIntegrationRow,
  events: NormalizedCalendarEvent[]
): Promise<MirrorResult> {
  if (events.length === 0) return { upserted: 0, cancelled: 0 };
  const nowIso = new Date().toISOString();
  const source = integration.provider_id;

  const live = events.filter((e) => !e.cancelled);
  const dropped = events.filter((e) => e.cancelled);

  const rows = live.map((e) => ({
    user_id: integration.user_id,
    title: e.title,
    event_date: e.date,
    start_time: e.startTime,
    end_time: e.endTime,
    description: e.description,
    location: e.location,
    // `event_type` is a fixed taxonomy shared with the AI schema, so a mirrored
    // event takes the generic member rather than inventing a value the client's
    // renderer wouldn't recognise. Provenance lives in external_source instead.
    event_type: "other",
    // Mirrored events are facts, not proposals — they skip the review rail.
    confidence: 1,
    status: "confirmed",
    external_source: source,
    external_id: e.externalId,
    external_url: e.url,
    synced_at: nowIso,
  }));

  if (rows.length > 0) {
    await upsertRows(ctx, "events", rows, "user_id,external_source,external_id");
  }

  // A cancelled source event should stop occupying the student's schedule.
  // Deleting is safe precisely because the filter pins external_source — it can
  // only ever reach a row this sync created, never a student-authored one.
  let cancelled = 0;
  for (const e of dropped) {
    try {
      await deleteRows(
        ctx,
        "events",
        `user_id=eq.${encodeURIComponent(integration.user_id)}` +
          `&external_source=eq.${encodeURIComponent(source)}` +
          `&external_id=eq.${encodeURIComponent(e.externalId)}`
      );
      cancelled++;
    } catch (err) {
      console.error("[lms-calendar] cancel failed", {
        userId: integration.user_id,
        externalId: e.externalId,
        error: String(err),
      });
    }
  }

  return { upserted: rows.length, cancelled };
}
