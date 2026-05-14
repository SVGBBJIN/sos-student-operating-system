// JWT user-id extraction. Web-API only — works in Node and Deno.

function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") return atob(b64);
  // Node fallback
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Buf = (globalThis as { Buffer?: { from: (s: string, enc: string) => { toString(enc: string): string } } }).Buffer;
  if (!Buf) throw new Error("No base64 decoder available");
  return Buf.from(b64, "base64").toString("utf8");
}

export function extractUserId(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1]!));
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
