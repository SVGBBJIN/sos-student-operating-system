/**
 * ambientDismissals — durable suppression for the ambient status surface.
 *
 * Reuses the trigger_dismissals table (extended with `kind` + `signature` in
 * migration 20260607). Two responsibilities:
 *   - load: which specific items are still dismissed (by signature), and how
 *     many times each CLASS (kind) has been dismissed recently — the latter
 *     feeds the selector's per-class engagement penalty.
 *   - record: persist a new dismissal with a TTL so it expires on its own.
 *
 * All reads/writes are best-effort and never throw to the caller — a failed
 * load just means the surface starts with no suppression.
 */

import { sb } from './supabase';

// Per-class dismissal counts decay by only counting rows from the last N days.
const ENGAGEMENT_WINDOW_DAYS = 14;

/**
 * loadAmbientSuppression — read non-expired dismissals for a user.
 * @returns {Promise<{ dismissedSignatures: Set<string>, classDismissalCounts: Record<string, number> }>}
 */
export async function loadAmbientSuppression(userId) {
  const empty = { dismissedSignatures: new Set(), classDismissalCounts: {} };
  if (!userId) return empty;
  try {
    const nowIso = new Date().toISOString();
    const windowIso = new Date(Date.now() - ENGAGEMENT_WINDOW_DAYS * 86400000).toISOString();
    const { data, error } = await sb
      .from('trigger_dismissals')
      .select('kind, signature, dismissed_at, expires_at')
      .eq('user_id', userId)
      .not('signature', 'is', null)
      .gt('expires_at', nowIso);
    if (error || !data) return empty;

    const dismissedSignatures = new Set();
    const classDismissalCounts = {};
    for (const row of data) {
      if (row.signature) dismissedSignatures.add(row.signature);
      // Only recent dismissals raise the per-class bar (natural decay).
      if (row.kind && (!row.dismissed_at || row.dismissed_at >= windowIso)) {
        classDismissalCounts[row.kind] = (classDismissalCounts[row.kind] || 0) + 1;
      }
    }
    return { dismissedSignatures, classDismissalCounts };
  } catch (e) {
    console.warn('[ambient] loadAmbientSuppression failed:', e);
    return empty;
  }
}

/**
 * recordAmbientDismissal — persist a durable dismissal for one ambient item.
 * @param {string} userId
 * @param {{ kind: string, signature: string, ttlHours?: number, taskId?: string|null }} item
 */
export async function recordAmbientDismissal(userId, { kind, signature, ttlHours = 24, taskId = null }) {
  if (!userId || !signature) return;
  try {
    const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();
    await sb.from('trigger_dismissals').insert({
      user_id: userId,
      task_id: taskId,
      kind,
      signature,
      dismissed_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
  } catch (e) {
    console.warn('[ambient] recordAmbientDismissal failed:', e);
  }
}
