// Tiny REST wrapper around the Supabase PostgREST + RPC endpoints. Used by the
// LMS sync orchestrator and webhook receiver so we don't pull in supabase-js in
// Deno. Service-role only — never call from the browser.

import { requireEnv } from "../env.js";

export interface SupabaseRest {
  url: string;
  key: string;
}

export function supabaseService(): SupabaseRest {
  return { url: requireEnv("SUPABASE_URL"), key: requireEnv("SUPABASE_SERVICE_ROLE_KEY") };
}

export function headers(ctx: SupabaseRest, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${ctx.key}`,
    apikey: ctx.key,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function selectRows<T>(
  ctx: SupabaseRest,
  table: string,
  query: string
): Promise<T[]> {
  const res = await fetch(`${ctx.url}/rest/v1/${table}?${query}`, { headers: headers(ctx) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase select ${table} ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T[];
}

export async function patchRow(
  ctx: SupabaseRest,
  table: string,
  query: string,
  patch: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${ctx.url}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: headers(ctx, { Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase patch ${table} ${res.status}: ${body.slice(0, 200)}`);
  }
}

export async function upsertRows<T>(
  ctx: SupabaseRest,
  table: string,
  rows: T[],
  onConflict: string
): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(
    `${ctx.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: "POST",
      headers: headers(ctx, {
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase upsert ${table} ${res.status}: ${body.slice(0, 200)}`);
  }
}

export async function insertRows<T>(
  ctx: SupabaseRest,
  table: string,
  rows: T[],
  prefer = "return=minimal"
): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(`${ctx.url}/rest/v1/${table}`, {
    method: "POST",
    headers: headers(ctx, { Prefer: prefer }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase insert ${table} ${res.status}: ${body.slice(0, 200)}`);
  }
}
