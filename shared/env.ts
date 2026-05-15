// Cross-runtime env access. Works in Node (Vercel) and Deno (Supabase Edge).

declare const Deno: { env: { get(key: string): string | undefined } } | undefined;

export function getEnv(key: string): string | undefined {
  if (typeof Deno !== "undefined" && Deno?.env?.get) {
    const v = Deno.env.get(key);
    if (typeof v === "string" && v.length > 0) return v;
  }
  if (typeof process !== "undefined" && process.env) {
    const v = process.env[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function requireEnv(key: string): string {
  const v = getEnv(key);
  if (!v) throw new Error(`${key} is not configured`);
  return v;
}
