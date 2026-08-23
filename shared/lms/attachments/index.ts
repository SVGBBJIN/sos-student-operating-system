// One-hop attachment resolution.
//
// Given the content items that changed in this sync, follow the links they
// carry, extract text, persist it, and index it for retrieval. The crawl is
// strictly one hop: we never follow links found *inside* an attachment, so the
// reachable set is exactly what a teacher attached or linked from course
// material.
//
// Budgets exist because this runs inside a cron invocation shared by every
// user: a course that links 300 PDFs must not starve the next user's sync.

import { contentHash } from "../html.js";
import { indexItems, type IndexableItem } from "../embed.js";
import { classifyLink, extractFromUrl } from "./extract.js";
import { selectRows, upsertRowsReturning, type SupabaseRest } from "../supabaseRest.js";
import type { NormalizedContentItem, UserIntegrationRow } from "../adapters/types.js";
import type { ContentItemRow } from "../content.js";

/** Per-sync ceilings, tuned to stay well inside a cron invocation. */
const MAX_ATTACHMENTS_PER_SYNC = 40;
const MAX_ATTACHMENTS_PER_ITEM = 8;
const CONCURRENCY = 4;

export interface AttachmentSyncResult {
  attempted: number;
  extracted: number;
  skipped: number;
  indexed: number;
}

interface AttachmentRow {
  id: string;
  url_hash: string;
  status: string;
  content_hash: string | null;
}

interface Candidate {
  url: string;
  title: string | null;
  mimeType: string | null;
  byteSize: number | null;
  urlHash: string;
  contentItemId: string;
  courseName: string | null;
}

/**
 * Resolve attachments for the content items that changed this sync.
 *
 * `authToken`/`authOrigin` let Canvas-hosted files be fetched with the user's
 * token; extract.ts attaches it only on an exact origin match so the token
 * can't leak to a publisher site an assignment links out to.
 */
export async function syncAttachments(
  ctx: SupabaseRest,
  integration: UserIntegrationRow,
  changed: Array<{ row: ContentItemRow; item: NormalizedContentItem }>,
  opts: { authToken?: string; authOrigin?: string } = {}
): Promise<AttachmentSyncResult> {
  const result: AttachmentSyncResult = { attempted: 0, extracted: 0, skipped: 0, indexed: 0 };
  if (changed.length === 0) return result;

  // 1. Gather candidates, deduped by URL across the whole sync.
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const { row, item } of changed) {
    let perItem = 0;
    for (const ref of item.attachments ?? []) {
      if (perItem >= MAX_ATTACHMENTS_PER_ITEM) break;
      if (candidates.length >= MAX_ATTACHMENTS_PER_SYNC) break;

      const decision = classifyLink(ref.url, item.url ?? undefined);
      if (!decision.follow) continue;

      const absolute = decision.fetchUrl ?? ref.url;
      if (seen.has(absolute)) continue;
      seen.add(absolute);

      candidates.push({
        url: absolute,
        title: ref.title ?? item.title ?? null,
        mimeType: ref.mimeType ?? null,
        byteSize: ref.byteSize ?? null,
        urlHash: await contentHash(absolute),
        contentItemId: row.id,
        courseName: item.courseName,
      });
      perItem++;
    }
  }
  if (candidates.length === 0) return result;

  // 2. Skip anything already extracted — attachments are immutable in practice,
  //    and re-fetching a 5MB PDF every 10 minutes would be indefensible.
  const hashes = candidates.map((c) => `"${c.urlHash}"`).join(",");
  const existing = await selectRows<AttachmentRow>(
    ctx,
    "lms_attachments",
    `user_id=eq.${encodeURIComponent(integration.user_id)}` +
      `&url_hash=in.(${encodeURIComponent(hashes)})` +
      `&select=id,url_hash,status,content_hash`
  ).catch(() => []);

  const done = new Set(
    existing.filter((e) => e.status === "extracted" || e.status === "unsupported").map((e) => e.url_hash)
  );
  const todo = candidates.filter((c) => !done.has(c.urlHash));
  result.skipped = candidates.length - todo.length;
  if (todo.length === 0) return result;

  // 3. Fetch with bounded concurrency.
  const rows: Array<Record<string, unknown>> = [];
  const indexable: Array<{ urlHash: string; item: Omit<IndexableItem, "sourceId"> }> = [];
  const nowIso = new Date().toISOString();

  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const idx = cursor++;
      const candidate = todo[idx];
      if (!candidate) return;

      result.attempted++;
      const extracted = await extractFromUrl(candidate.url, {
        ...(opts.authToken ? { authToken: opts.authToken } : {}),
        ...(opts.authOrigin ? { authOrigin: opts.authOrigin } : {}),
      });

      const text = extracted.text;
      rows.push({
        user_id: integration.user_id,
        content_item_id: candidate.contentItemId,
        provider_id: integration.provider_id,
        source_url: candidate.url,
        url_hash: candidate.urlHash,
        title: candidate.title,
        mime_type: extracted.mimeType ?? candidate.mimeType,
        byte_size: extracted.byteSize ?? candidate.byteSize,
        body_text: text,
        status: extracted.status,
        error: extracted.error,
        content_hash: text ? await contentHash(text) : null,
        fetched_at: nowIso,
      });

      if (extracted.status === "extracted" && text && text.trim().length >= 40) {
        result.extracted++;
        indexable.push({
          urlHash: candidate.urlHash,
          item: {
            source: "attachment",
            title: candidate.title,
            text,
            metadata: {
              provider: integration.provider_id,
              course_name: candidate.courseName,
              url: candidate.url,
              mime_type: extracted.mimeType,
            },
          },
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker()));

  // 4. Persist, then index using the stored row ids.
  const stored = await upsertRowsReturning<Record<string, unknown>, AttachmentRow>(
    ctx,
    "lms_attachments",
    rows,
    "user_id,url_hash"
  ).catch((err) => {
    console.error("[lms-attachments] upsert failed", { error: String(err) });
    return [] as AttachmentRow[];
  });

  const idByHash = new Map(stored.map((r) => [r.url_hash, r.id]));
  const toIndex: IndexableItem[] = [];
  for (const entry of indexable) {
    const id = idByHash.get(entry.urlHash);
    if (id) toIndex.push({ ...entry.item, sourceId: id });
  }

  result.indexed = await indexItems(ctx, integration.user_id, toIndex);
  return result;
}

export { classifyLink, extractFromUrl } from "./extract.js";
export { extractPdfText } from "./pdf.js";
