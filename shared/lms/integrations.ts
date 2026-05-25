// User-side flows: list providers, list a user's integrations, complete an
// OAuth code exchange, save tracked courses, surface a per-user webhook secret.
// Called from the Vercel API routes; the orchestrator and webhook receiver use
// the raw REST helpers in supabaseRest.ts directly.

import { exchangeGoogleCode, expiryFromNow } from "./oauth/google.js";
import { getPullAdapter } from "./adapters/registry.js";
import {
  supabaseService,
  selectRows,
  upsertRows,
  patchRow,
  insertRows,
  type SupabaseRest,
} from "./supabaseRest.js";
import type { TrackedCourseRow, UserIntegrationRow } from "./adapters/types.js";

export interface ProviderRow {
  id: string;
  display_name: string;
  mode: "pull" | "push";
  auth_type: "oauth2" | "webhook" | "none";
  enabled: boolean;
  setup_notes: string | null;
}

export async function listEnabledProviders(): Promise<ProviderRow[]> {
  return selectRows<ProviderRow>(supabaseService(), "lms_providers", "enabled=eq.true&select=*&order=display_name.asc");
}

export async function getIntegrationForUser(userId: string, providerId: string): Promise<UserIntegrationRow | null> {
  const rows = await selectRows<UserIntegrationRow>(
    supabaseService(),
    "user_integrations",
    `user_id=eq.${encodeURIComponent(userId)}&provider_id=eq.${encodeURIComponent(providerId)}&select=*`
  );
  return rows[0] ?? null;
}

export interface CompleteOAuthArgs {
  userId: string;
  providerId: string;
  code: string;
  redirectUri: string;
}

export async function completeOAuth(args: CompleteOAuthArgs): Promise<UserIntegrationRow> {
  const ctx = supabaseService();
  let patch: Partial<UserIntegrationRow>;

  if (args.providerId === "classroom") {
    const tokens = await exchangeGoogleCode(args.code, args.redirectUri);
    if (!tokens.refresh_token) {
      throw new Error("Google did not return a refresh_token — re-consent with access_type=offline and prompt=consent");
    }
    patch = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiryFromNow(tokens.expires_in),
      status: "active",
    };
  } else {
    throw new Error(`OAuth not implemented for provider ${args.providerId}`);
  }

  await upsertRows<Record<string, unknown>>(
    ctx,
    "user_integrations",
    [
      {
        user_id: args.userId,
        provider_id: args.providerId,
        ...patch,
        updated_at: new Date().toISOString(),
      },
    ],
    "user_id,provider_id"
  );

  const row = await getIntegrationForUser(args.userId, args.providerId);
  if (!row) throw new Error("Failed to load integration after OAuth");
  return row;
}


export async function listCoursesViaAdapter(
  userId: string,
  providerId: string
): Promise<Array<{ externalCourseId: string; name: string }>> {
  const adapter = getPullAdapter(providerId);
  if (!adapter || !adapter.listCourses) return [];

  const integration = await getIntegrationForUser(userId, providerId);
  if (!integration) throw new Error(`No integration for ${providerId} — connect first`);
  const ctx = supabaseService();
  const saveTokens = async (patch: Partial<UserIntegrationRow>) => {
    await patchRow(ctx, "user_integrations", `id=eq.${encodeURIComponent(integration.id)}`, {
      ...patch,
      updated_at: new Date().toISOString(),
    });
  };
  return adapter.listCourses({ integration, courses: [], saveTokens });
}

export async function saveTrackedCourses(
  userId: string,
  providerId: string,
  selections: Array<{ externalCourseId: string; courseName: string | null }>
): Promise<void> {
  const ctx = supabaseService();
  const integration = await getIntegrationForUser(userId, providerId);
  if (!integration) throw new Error(`No integration for ${providerId}`);

  // Disable all current rows for this integration, then upsert the new selection.
  await patchRow(
    ctx,
    "tracked_courses",
    `integration_id=eq.${encodeURIComponent(integration.id)}`,
    { enabled: false }
  ).catch(() => {});

  if (selections.length === 0) return;

  const rows: Array<Partial<TrackedCourseRow>> = selections.map((s) => ({
    integration_id: integration.id,
    user_id: userId,
    external_course_id: s.externalCourseId,
    course_name: s.courseName,
    enabled: true,
  }));
  await upsertRows(ctx, "tracked_courses", rows, "integration_id,external_course_id");
}

/** Helper for the immediate-sync API — re-export so callers don't import the orchestrator twice. */
export { supabaseService } from "./supabaseRest.js";
export type { SupabaseRest };
