// Server-side URL import: fetch a public webpage and extract readable text.
// Web-API-only (fetch, no DOM parser) so it runs unchanged in Node (Vercel)
// and Deno (Supabase Edge). No headless browser — pages that only render
// content via client-side JS will come back thin/empty; that's an accepted
// limitation (no Playwright in this runtime).

const FETCH_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 20_000;

export class ImportUrlError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// SSRF guard: only allow http(s) to a public hostname. Blocks file://, other
// schemes, and obvious loopback/private/link-local/metadata targets. This is
// a hostname-level check (no DNS resolution), which is sufficient for a
// paste-a-URL feature but not a substitute for network-level egress controls.
function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportUrlError("Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImportUrlError("Only http(s) URLs are supported.");
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "metadata.google.internal" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (blocked) throw new ImportUrlError("This URL is not allowed.");
  return url;
}

function stripBoilerplate(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|nav|header|footer|noscript|svg|iframe|form)[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1] ?? "").trim().slice(0, 200) : "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

// Dependency-free readability-style extraction: strip non-content tags, then
// walk block-level tags into paragraph breaks and collapse the rest of the
// markup to plain text. Not a full DOM parse -- good enough for article-style
// static pages, which is the target use case (no JS-rendered pages).
function htmlToText(html: string): string {
  const cleaned = stripBoilerplate(html);
  const withBreaks = cleaned.replace(/<\/(p|div|li|h[1-6]|br|tr|blockquote)>/gi, "\n");
  const textOnly = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(textOnly);
  return decoded
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export async function extractArticle(rawUrl: string): Promise<{ title: string; text: string; url: string }> {
  const url = assertSafeUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SOS-StudyImport/1.0)" },
    });
  } catch (err) {
    throw new ImportUrlError(
      err instanceof Error && err.name === "AbortError" ? "The page took too long to load." : "Could not reach that URL.",
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new ImportUrlError(`The page returned an error (${res.status}).`, 502);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text")) {
    throw new ImportUrlError("That URL doesn't look like a readable webpage.");
  }

  const html = await res.text();
  const title = extractTitle(html) || url.hostname;
  const text = htmlToText(html).slice(0, MAX_TEXT_CHARS);
  if (text.length < 200) {
    throw new ImportUrlError("Couldn't find enough readable text on that page (it may require JavaScript to load content).");
  }

  return { title, text, url: url.toString() };
}
