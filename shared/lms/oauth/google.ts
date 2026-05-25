// Google OAuth2 helpers — code exchange + refresh. Used by both the Vercel
// callback handler (api/lms-oauth-callback.ts) and the Classroom pull adapter
// in the Edge orchestrator.

import { getEnv } from "../../env.js";

export interface GoogleTokenResult {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

function clientCreds(): { id: string; secret: string } {
  const id = getEnv("GOOGLE_CLIENT_ID");
  const secret = getEnv("GOOGLE_CLIENT_SECRET");
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  return { id, secret };
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string
): Promise<GoogleTokenResult> {
  const { id, secret } = clientCreds();
  const body = new URLSearchParams({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google code exchange failed (${res.status}): ${text}`);
  return JSON.parse(text) as GoogleTokenResult;
}

export async function refreshGoogleToken(refreshToken: string): Promise<GoogleTokenResult> {
  const { id, secret } = clientCreds();
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  return JSON.parse(text) as GoogleTokenResult;
}

/** Returns expiry ISO timestamp `expires_in` seconds from now. */
export function expiryFromNow(expiresIn: number): string {
  return new Date(Date.now() + Math.max(0, expiresIn - 60) * 1000).toISOString();
}
