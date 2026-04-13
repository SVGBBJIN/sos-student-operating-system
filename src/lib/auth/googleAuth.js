/**
 * googleAuth — unified Google OAuth initialization and token management.
 *
 * Uses Google Identity Services (GSI) token client (implicit flow).
 * Requests all required scopes in a single consent screen so the user
 * only needs to approve once.
 *
 * Required scopes:
 *   openid, profile, email
 *   calendar.events (read + write for sync)
 *   calendar.readonly
 *   drive.file (files shared with the app)
 *   drive.readonly
 *   documents, docs (Google Docs import)
 *
 * On success:
 *   - Stores token + expiry in sessionStorage (short-lived, browser-tab scoped)
 *   - Persists expiry to Supabase profiles for cross-session awareness
 *   - Fetches user info (email, name) and calls onSuccess({ token, expiry, user })
 */

import { sb } from "../supabase.js";

const GOOGLE_CLIENT_ID = "504839570150-i4s8urseqgrjucbhqfjc9phiavrcn08d.apps.googleusercontent.com";

const SCOPES = [
  "openid",
  "profile",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/docs",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

/**
 * initGoogleClient — initialises the GSI token client.
 * Must be called once after the Google script has loaded.
 *
 * @param {{
 *   onSuccess: (result: {token: string, expiry: number, user: {email: string, name: string}}) => void,
 *   onError?: (err: unknown) => void,
 * }} callbacks
 * @returns {unknown} The GSI token client instance
 */
export function initGoogleClient({ onSuccess, onError }) {
  if (!window.google?.accounts?.oauth2) {
    console.warn("googleAuth: Google Identity Services not loaded yet");
    return null;
  }

  return window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: async (resp) => {
      if (!resp.access_token) return;

      const token = resp.access_token;
      const expiry = Date.now() + (resp.expires_in ?? 3600) * 1000;

      // Persist in sessionStorage (survives tab refreshes, not cross-tab)
      try {
        sessionStorage.setItem("sos_google_token", token);
        sessionStorage.setItem("sos_google_expiry", String(expiry));
      } catch (_) {}

      // Persist expiry to Supabase profiles (no raw token for security)
      try {
        const { data: { user } } = await sb.auth.getUser();
        if (user?.id) {
          await sb.from("profiles").update({ google_token_expiry: expiry }).eq("id", user.id);
        }
      } catch (_) {}

      // Fetch profile info
      let userInfo = { email: "", name: "" };
      try {
        const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) userInfo = await r.json();
      } catch (_) {}

      onSuccess({ token, expiry, user: { email: userInfo.email, name: userInfo.name } });
    },
    error_callback: (e) => {
      console.error("Google auth error:", e);
      onError?.(e);
    },
  });
}

/**
 * requestGoogleAccess — triggers the OAuth consent screen.
 * Pass prompt="consent" on first connection; "" to silently renew if already consented.
 *
 * @param {unknown} client — the GSI token client from initGoogleClient
 * @param {{ forceConsent?: boolean }} opts
 */
export function requestGoogleAccess(client, { forceConsent = false } = {}) {
  if (!client) return;
  client.requestAccessToken({ prompt: forceConsent ? "consent" : "" });
}

/**
 * revokeGoogleToken — revokes and clears the stored token.
 *
 * @param {string|null} token
 */
export function revokeGoogleToken(token) {
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  try {
    sessionStorage.removeItem("sos_google_token");
    sessionStorage.removeItem("sos_google_expiry");
  } catch (_) {}
}
