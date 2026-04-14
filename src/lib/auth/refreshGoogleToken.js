/**
 * refreshGoogleToken — silently renews the Google access token when it is
 * about to expire (within 5 minutes).
 *
 * Uses GSI's implicit flow: calls requestAccessToken with prompt="" so the
 * user sees no UI if they have already granted consent. If the silent renewal
 * fails (e.g. consent revoked) the call is a no-op.
 *
 * Call this once on app load after the GSI script has initialised.
 *
 * @param {{
 *   client: unknown,      — GSI token client from initGoogleClient
 *   expiry: number,       — current token expiry timestamp (ms)
 *   onRenewed?: (result: {token: string, expiry: number}) => void,
 * }} params
 */

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function refreshGoogleTokenIfNeeded({ client, expiry, onRenewed }) {
  if (!client) return;
  if (!expiry || expiry <= 0) return;

  const msUntilExpiry = expiry - Date.now();
  if (msUntilExpiry > REFRESH_THRESHOLD_MS) return;

  // Token is expiring soon — attempt silent renewal
  try {
    await new Promise((resolve, reject) => {
      const originalCallback = client.callback;

      // Temporarily override callback to capture the renewed token
      client.callback = (resp) => {
        client.callback = originalCallback; // restore
        if (resp.access_token) {
          const newExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000;
          try {
            sessionStorage.setItem("sos_google_token", resp.access_token);
            sessionStorage.setItem("sos_google_expiry", String(newExpiry));
          } catch (_) {}
          onRenewed?.({ token: resp.access_token, expiry: newExpiry });
          resolve();
        } else {
          reject(new Error("No access token in renewal response"));
        }
      };

      client.requestAccessToken({ prompt: "" });

      // Fail-safe: resolve after 10s even if callback never fires
      setTimeout(resolve, 10_000);
    });
  } catch (err) {
    console.warn("refreshGoogleToken: silent renewal failed —", err?.message ?? err);
  }
}
