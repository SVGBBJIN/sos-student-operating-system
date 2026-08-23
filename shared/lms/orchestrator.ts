// Pull-mode orchestrator. Invoked by pg_cron every 10 minutes (no body) and by
// the UI's immediate-sync trigger (`{ userId }`). For each active integration
// whose provider is in pull mode, we run its adapter in a try/catch so one
// user's failure can never block another's.

import { supabaseService, patchRow, selectRows } from "./supabaseRest.js";
import { getPullAdapter } from "./adapters/registry.js";
import { upsertSubmissions } from "./upsert.js";
import { storeContentItems } from "./content.js";
import { syncAttachments } from "./attachments/index.js";
import { mirrorCalendarEvents } from "./calendar.js";
import { normalizeInstanceUrl } from "./adapters/canvas.js";
import type { TokenPatch, TrackedCourseRow, UserIntegrationRow } from "./adapters/types.js";

export interface SyncReport {
  ranAt: string;
  integrations: number;
  succeeded: number;
  failed: number;
  details: Array<{
    integrationId: string;
    providerId: string;
    userId: string;
    ok: boolean;
    upserted?: number;
    tasksClosed?: number;
    contentItems?: number;
    contentIndexed?: number;
    attachmentsExtracted?: number;
    calendarEvents?: number;
    /** Passes that failed on their own without failing the whole integration. */
    partialErrors?: string[];
    error?: string;
  }>;
}

export interface RunSyncOptions {
  /** If provided, only sync this user's integrations (used by the post-Step-3 immediate-sync). */
  userId?: string;
}

export async function runSync(opts: RunSyncOptions = {}): Promise<SyncReport> {
  const ctx = supabaseService();
  const report: SyncReport = {
    ranAt: new Date().toISOString(),
    integrations: 0,
    succeeded: 0,
    failed: 0,
    details: [],
  };

  // Load active pull integrations. We embed the provider row so we can filter
  // on mode='pull' in a single query.
  const userFilter = opts.userId ? `&user_id=eq.${encodeURIComponent(opts.userId)}` : "";
  const integrations = await selectRows<
    UserIntegrationRow & { lms_providers: { mode: string; enabled: boolean } | null }
  >(
    ctx,
    "user_integrations",
    `status=eq.active${userFilter}&select=*,lms_providers!inner(mode,enabled)`
  );

  const pullable = integrations.filter(
    (i) => i.lms_providers?.mode === "pull" && i.lms_providers?.enabled
  );
  report.integrations = pullable.length;

  for (const integration of pullable) {
    const adapter = getPullAdapter(integration.provider_id);
    if (!adapter) continue;

    try {
      const courses = await selectRows<TrackedCourseRow>(
        ctx,
        "tracked_courses",
        `integration_id=eq.${encodeURIComponent(integration.id)}&enabled=eq.true&select=*`
      );
      if (courses.length === 0) {
        report.details.push({
          integrationId: integration.id,
          providerId: integration.provider_id,
          userId: integration.user_id,
          ok: true,
          upserted: 0,
          tasksClosed: 0,
        });
        report.succeeded++;
        continue;
      }

      const saveTokens = async (patch: TokenPatch) => {
        await patchRow(ctx, "user_integrations", `id=eq.${encodeURIComponent(integration.id)}`, {
          ...patch,
          updated_at: new Date().toISOString(),
        });
      };

      const adapterCtx = { integration, courses, saveTokens };
      const subs = await adapter.fetchSubmissions(adapterCtx);
      const { upserted, tasksClosed } = await upsertSubmissions(ctx, integration, subs, "pull");

      // The passes below are enrichment, not the sync's reason for existing.
      // Each is isolated: a publisher site timing out during the attachment
      // walk must not roll back the submissions we just reconciled, and must
      // not mark the integration errored.
      const partialErrors: string[] = [];
      let contentItems = 0;
      let contentIndexed = 0;
      let attachmentsExtracted = 0;
      let calendarEvents = 0;

      if (adapter.fetchContent) {
        try {
          const items = await adapter.fetchContent(adapterCtx);
          const stored = await storeContentItems(ctx, integration, items);
          contentItems = stored.upserted;
          contentIndexed = stored.indexed;

          // One hop from the material that actually changed this run.
          try {
            const attachmentAuth =
              integration.provider_id === "canvas" && integration.access_token && integration.instance_url
                ? {
                    authToken: integration.access_token,
                    authOrigin: normalizeInstanceUrl(integration.instance_url),
                  }
                : {};
            const att = await syncAttachments(ctx, integration, stored.changed, attachmentAuth);
            attachmentsExtracted = att.extracted;
          } catch (err) {
            partialErrors.push(`attachments: ${err instanceof Error ? err.message : String(err)}`);
          }
        } catch (err) {
          partialErrors.push(`content: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (adapter.fetchCalendar) {
        try {
          const events = await adapter.fetchCalendar(adapterCtx);
          const mirrored = await mirrorCalendarEvents(ctx, integration, events);
          calendarEvents = mirrored.upserted;
        } catch (err) {
          partialErrors.push(`calendar: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (partialErrors.length > 0) {
        console.error("[lms-sync] partial pass failures", {
          provider: integration.provider_id,
          userId: integration.user_id,
          errors: partialErrors,
        });
      }

      await patchRow(ctx, "user_integrations", `id=eq.${encodeURIComponent(integration.id)}`, {
        last_sync_at: new Date().toISOString(),
        // Surface partial failures without flipping the integration to errored —
        // the student's submissions did sync, and a red banner would be a lie.
        last_error: partialErrors.length > 0 ? partialErrors.join("; ").slice(0, 500) : null,
        updated_at: new Date().toISOString(),
      });

      report.succeeded++;
      report.details.push({
        integrationId: integration.id,
        providerId: integration.provider_id,
        userId: integration.user_id,
        ok: true,
        upserted,
        tasksClosed,
        contentItems,
        contentIndexed,
        attachmentsExtracted,
        calendarEvents,
        ...(partialErrors.length > 0 ? { partialErrors } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[lms-sync] integration failed", {
        provider: integration.provider_id,
        userId: integration.user_id,
        integrationId: integration.id,
        error: message,
      });
      try {
        await patchRow(ctx, "user_integrations", `id=eq.${encodeURIComponent(integration.id)}`, {
          last_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        });
      } catch (_) {
        // already logged
      }
      report.failed++;
      report.details.push({
        integrationId: integration.id,
        providerId: integration.provider_id,
        userId: integration.user_id,
        ok: false,
        error: message,
      });
      // Loop continues — one user's failure never blocks others.
    }
  }

  return report;
}
