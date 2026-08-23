// Fetch a linked document and turn it into plain text.
//
// One hop only, and the hop is bounded three ways: by URL (we only follow what
// looks like course material, never arbitrary web pages), by size (a 40MB video
// is not reading material), and by time (an unresponsive publisher site can't
// stall the sync).

import { htmlToText } from "../html.js";
import { extractPdfText } from "./pdf.js";

export const MAX_BYTES = 8 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_TEXT_CHARS = 200_000;

export type ExtractStatus = "extracted" | "unsupported" | "failed";

export interface ExtractResult {
  status: ExtractStatus;
  text: string | null;
  mimeType: string | null;
  byteSize: number | null;
  error: string | null;
}

/** Extensions that are plainly not readable text, skipped before any request. */
const BINARY_EXT =
  /\.(?:mp4|mov|avi|mkv|webm|mp3|wav|m4a|ogg|zip|rar|7z|tar|gz|exe|dmg|iso|psd|ai|ttf|otf|woff2?)(?:$|\?)/i;

/** Hosts we never follow: trackers, auth walls, and social noise. */
const HOST_DENYLIST = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
];

export interface LinkDecision {
  follow: boolean;
  reason?: string;
  /** Rewritten URL — Google Docs get swapped for their plain-text export. */
  fetchUrl?: string;
  kind?: "google_doc" | "pdf" | "web";
}

/**
 * Decide whether a link is worth one hop, and rewrite it if a better
 * representation exists. Google Docs/Slides expose a text export endpoint that
 * needs no HTML scraping at all, so we prefer it when the doc is link-shared.
 */
export function classifyLink(rawUrl: string, baseUrl?: string): LinkDecision {
  let url: URL;
  try {
    url = new URL(rawUrl, baseUrl);
  } catch {
    return { follow: false, reason: "unparseable url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { follow: false, reason: `unsupported protocol ${url.protocol}` };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (HOST_DENYLIST.some((d) => host === d || host.endsWith(`.${d}`))) {
    return { follow: false, reason: `denylisted host ${host}` };
  }
  if (BINARY_EXT.test(url.pathname)) {
    return { follow: false, reason: "binary media" };
  }

  // Google Docs / Slides / Sheets → plain-text export.
  const gdoc = /^docs\.google\.com$/.test(host)
    ? /\/(document|presentation|spreadsheets)\/d\/([a-zA-Z0-9_-]+)/.exec(url.pathname)
    : null;
  if (gdoc) {
    const kindPath = gdoc[1];
    const docId = gdoc[2];
    if (docId) {
      const exportFormat = kindPath === "spreadsheets" ? "csv" : "txt";
      const path = kindPath === "spreadsheets" ? "spreadsheets" : kindPath;
      return {
        follow: true,
        kind: "google_doc",
        fetchUrl: `https://docs.google.com/${path}/d/${docId}/export?format=${exportFormat}`,
      };
    }
  }

  if (/\.pdf(?:$|\?)/i.test(url.pathname)) {
    return { follow: true, kind: "pdf", fetchUrl: url.toString() };
  }
  return { follow: true, kind: "web", fetchUrl: url.toString() };
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * Fetch and extract. `authToken` is attached only for same-origin LMS file
 * URLs — we must never leak a Canvas token to a publisher site the assignment
 * happens to link to.
 */
export async function extractFromUrl(
  rawUrl: string,
  opts: { authToken?: string; authOrigin?: string; baseUrl?: string } = {}
): Promise<ExtractResult> {
  const decision = classifyLink(rawUrl, opts.baseUrl);
  if (!decision.follow || !decision.fetchUrl) {
    return {
      status: "unsupported",
      text: null,
      mimeType: null,
      byteSize: null,
      error: decision.reason ?? "not followable",
    };
  }

  const target = decision.fetchUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.8",
    };
    if (opts.authToken && opts.authOrigin) {
      try {
        if (new URL(target).origin === opts.authOrigin) {
          headers.Authorization = `Bearer ${opts.authToken}`;
        }
      } catch {
        // Non-fatal: just don't attach credentials.
      }
    }

    const res = await fetch(target, { headers, signal: controller.signal, redirect: "follow" });
    if (!res.ok) {
      return {
        status: "failed",
        text: null,
        mimeType: null,
        byteSize: null,
        error: `HTTP ${res.status}`,
      };
    }

    const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() || null;
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return {
        status: "unsupported",
        text: null,
        mimeType,
        byteSize: declared,
        error: `too large (${declared} bytes)`,
      };
    }

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.byteLength > MAX_BYTES) {
      return {
        status: "unsupported",
        text: null,
        mimeType,
        byteSize: bytes.byteLength,
        error: `too large (${bytes.byteLength} bytes)`,
      };
    }

    const isPdf = mimeType === "application/pdf" || decision.kind === "pdf" ||
      (bytes.byteLength > 4 && bytes[0] === 0x25 && bytes[1] === 0x50);

    if (isPdf) {
      const result = await extractPdfText(bytes);
      if (result.likelyScanned) {
        return {
          status: "unsupported",
          text: null,
          mimeType: mimeType ?? "application/pdf",
          byteSize: bytes.byteLength,
          // Distinct from a failure — the file is fine, we just can't read
          // pixels. Camera-roll OCR is the source that would close this gap.
          error: "pdf has no text layer (scanned)",
        };
      }
      return {
        status: "extracted",
        text: normalizeText(result.text),
        mimeType: mimeType ?? "application/pdf",
        byteSize: bytes.byteLength,
        error: null,
      };
    }

    // Anything binary that isn't a PDF is out of scope.
    if (mimeType && !/^(?:text\/|application\/(?:json|xml|xhtml))/.test(mimeType)) {
      return {
        status: "unsupported",
        text: null,
        mimeType,
        byteSize: bytes.byteLength,
        error: `unsupported content-type ${mimeType}`,
      };
    }

    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const text = /html/i.test(mimeType ?? "") || /^\s*<(?:!doctype|html)/i.test(decoded)
      ? htmlToText(decoded)
      : decoded;
    const normalized = normalizeText(text);

    if (!normalized) {
      return {
        status: "unsupported",
        text: null,
        mimeType,
        byteSize: bytes.byteLength,
        error: "no extractable text",
      };
    }
    return {
      status: "extracted",
      text: normalized,
      mimeType,
      byteSize: bytes.byteLength,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      text: null,
      mimeType: null,
      byteSize: null,
      error: /abort/i.test(message) ? `timed out after ${FETCH_TIMEOUT_MS}ms` : message.slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}
