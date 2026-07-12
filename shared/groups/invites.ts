// Invite-link redemption. Uses the service-role Supabase REST client
// (shared/lms/supabaseRest.ts) deliberately -- a brand-new user can't satisfy
// group_members' self-insert RLS policy until they're already a member, and
// an existing user's token still needs server-side expiry validation before
// the insert, so this bypasses RLS by design rather than working around it.

import { supabaseService, headers, selectRows, patchRow } from "../lms/supabaseRest.js";

interface GroupInviteRow {
  id: string;
  token: string;
  group_id: string;
  expires_at: string;
  used_by: string[];
}

export type RedeemResult = { ok: true; groupId: string } | { ok: false; error: string; status: number };

export async function redeemInvite(token: string, userId: string): Promise<RedeemResult> {
  if (!token || typeof token !== "string") return { ok: false, error: "Invalid invite link.", status: 400 };

  const ctx = supabaseService();
  const invites = await selectRows<GroupInviteRow>(
    ctx,
    "group_invites",
    `token=eq.${encodeURIComponent(token)}&select=id,token,group_id,expires_at,used_by&limit=1`
  );
  const invite = invites[0];
  if (!invite) return { ok: false, error: "This invite link is invalid.", status: 404 };
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "This invite link has expired.", status: 410 };
  }

  // Idempotent membership insert -- ignore-duplicate on the (group_id,user_id)
  // unique constraint so re-clicking an already-redeemed link is a no-op, not
  // an error.
  const res = await fetch(`${ctx.url}/rest/v1/group_members`, {
    method: "POST",
    headers: headers(ctx, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify([{ group_id: invite.group_id, user_id: userId, role: "member" }]),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Could not join the group (${res.status}): ${body.slice(0, 200)}`, status: 502 };
  }

  if (!invite.used_by.includes(userId)) {
    await patchRow(ctx, "group_invites", `id=eq.${invite.id}`, {
      used_by: [...invite.used_by, userId],
    }).catch(() => {}); // best-effort audit trail, never block the join on it
  }

  return { ok: true, groupId: invite.group_id };
}
