// Webhook receiver logic. Dispatches an inbound POST to the matching push
// adapter, finds the SOS user via (provider_id, external_user_id), and runs
// the same upsert path used by the pull orchestrator.

import { getEnv } from "../env.js";
import { getPushAdapter } from "./adapters/registry.js";
import { supabaseService, selectRows, patchRow } from "./supabaseRest.js";
import { upsertSubmissions } from "./upsert.js";
import type { UserIntegrationRow } from "./adapters/types.js";

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleWebhook(providerId: string, req: Request): Promise<WebhookResult> {
  const adapter = getPushAdapter(providerId);
  if (!adapter) return { status: 404, body: { error: `unknown push provider: ${providerId}` } };

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return { status: 400, body: { error: "could not read request body" } };
  }

  // Resolve shared secret: prefer the per-user secret on the matching integration
  // (we look that up after parsing the payload because routing depends on
  // payload-level uid). Fall back to the global env secret for signature check.
  const globalSecret = getEnv(`${providerId.toUpperCase()}_WEBHOOK_SECRET`) || null;

  let parsed;
  try {
    parsed = await adapter.parseWebhook(req, rawBody, globalSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[lms-webhook] parse failed", { provider: providerId, error: message });
    return { status: 400, body: { error: "could not parse webhook", detail: message } };
  }

  const ctx = supabaseService();

  if (!parsed.externalUserId) {
    console.warn("[lms-webhook] payload missing external user id", { provider: providerId });
    return { status: 202, body: { ok: false, reason: "no external user id in payload" } };
  }

  // Look up the integration. Status filter omitted on purpose — we promote
  // 'pending' integrations to 'active' on first valid webhook arrival.
  const matches = await selectRows<UserIntegrationRow>(
    ctx,
    "user_integrations",
    `provider_id=eq.${encodeURIComponent(providerId)}` +
      `&external_user_id=eq.${encodeURIComponent(parsed.externalUserId)}` +
      `&select=*`
  ).catch(() => [] as UserIntegrationRow[]);

  if (matches.length === 0) {
    console.warn("[lms-webhook] no integration for external user", {
      provider: providerId,
      externalUserId: parsed.externalUserId,
    });
    return { status: 202, body: { ok: false, reason: "no matching integration" } };
  }
  const integration = matches[0]!;

  // Signature check: re-verify with the per-user secret if it differs from the
  // global one used during the initial parse.
  if (!parsed.signatureValid && integration.webhook_secret && integration.webhook_secret !== globalSecret) {
    try {
      const reparsed = await adapter.parseWebhook(req, rawBody, integration.webhook_secret);
      if (reparsed.signatureValid) parsed = reparsed;
    } catch {
      // fall through — will be rejected below
    }
  }
  if (!parsed.signatureValid) {
    console.warn("[lms-webhook] signature invalid", {
      provider: providerId,
      userId: integration.user_id,
    });
    return { status: 401, body: { error: "signature invalid" } };
  }

  try {
    const result = await upsertSubmissions(ctx, integration, [parsed.submission], "push");
    const patch: Record<string, unknown> = {
      last_sync_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    if (integration.status === "pending") patch.status = "active";
    await patchRow(ctx, "user_integrations", `id=eq.${encodeURIComponent(integration.id)}`, patch);
    return { status: 200, body: { ok: true, ...result } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[lms-webhook] upsert failed", {
      provider: providerId,
      userId: integration.user_id,
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
    return { status: 500, body: { error: message } };
  }
}
