// HTML → plain text, and link extraction. Web APIs only (Deno runs this too),
// and deliberately regex-based rather than DOM-based: Deno Edge has no DOMParser
// and we only ever handle LMS-authored fragments, not arbitrary hostile markup.
//
// The output feeds two consumers that both want prose, not tags: the embedding
// pipeline and the study-pack generator.

const BLOCK_TAGS =
  /<\/?(?:p|div|br|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|table)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Strip markup and collapse whitespace, keeping paragraph breaks legible. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const withoutInvisible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  return decodeEntities(
    withoutInvisible
      .replace(BLOCK_TAGS, "\n")
      // Inline tags carry no spacing of their own — "<b>-10%</b>/day" is one
      // word to a reader, so dropping them outright beats substituting a space.
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pull href targets out of an HTML fragment. Used for the one-hop attachment
 * crawl, so we return raw URLs and let the attachment layer decide what's
 * worth fetching.
 */
export function extractLinks(html: string | null | undefined): Array<{ url: string; title: string | null }> {
  if (!html) return [];
  const out: Array<{ url: string; title: string | null }> = [];
  const seen = new Set<string>();
  const anchor = /<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi;

  let m: RegExpExecArray | null;
  while ((m = anchor.exec(html)) !== null) {
    const href = decodeEntities((m[2] ?? m[3] ?? m[4] ?? "").trim());
    if (!href || href.startsWith("#") || /^(?:javascript|mailto|tel):/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const label = htmlToText(m[5] ?? "").slice(0, 200);
    out.push({ url: href, title: label || null });
  }
  return out;
}

/** Stable content fingerprint — lets a re-sync skip rows that haven't changed. */
export async function contentHash(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
