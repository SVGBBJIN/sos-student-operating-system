// Background service worker.
//
// Responsibilities:
//   - hold the Supabase JWT (chrome.storage.local) and refresh-on-demand
//   - batch incoming evidence events from content scripts and POST them to the
//     SOS backend in groups (every 5s or on demand)
//   - expose chrome.runtime.onMessage RPC for popup ↔ background and
//     content-script ↔ background communication
//   - request optional host permissions per LMS domain so the user grants
//     access one school at a time, not <all_urls>
//
// Auth model (per the approved plan): Supabase OAuth popup. The popup opens
// the SOS app's /extension-auth page in a launchWebAuthFlow window which posts
// the resulting Supabase JWT back via location-hash; this script stores it.

const CONFIG_KEY = "sos.config";
const TOKEN_KEY  = "sos.token";
const QUEUE_KEY  = "sos.queue";
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 25;

const DEFAULT_CONFIG = {
  apiBase: "https://sos.example.com",   // overridden via popup
  enabled: true,
};

// ── storage helpers ──────────────────────────────────────────────────────────

async function getConfig() {
  const out = await chrome.storage.local.get(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(out[CONFIG_KEY] || {}) };
}
async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}
async function getToken() {
  const out = await chrome.storage.local.get(TOKEN_KEY);
  return out[TOKEN_KEY] || null;
}
async function setToken(token) {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

// ── queue + flush ────────────────────────────────────────────────────────────
// Queue lives in chrome.storage.session so it survives the service-worker
// shutting down between events but doesn't bloat persistent storage.

async function enqueue(event) {
  const cur = (await chrome.storage.session.get(QUEUE_KEY))[QUEUE_KEY] || [];
  cur.push({ ...event, occurred_at: event.occurred_at || new Date().toISOString() });
  await chrome.storage.session.set({ [QUEUE_KEY]: cur });
  if (cur.length >= MAX_BATCH) flush().catch(() => {});
}

async function flush() {
  const cur = (await chrome.storage.session.get(QUEUE_KEY))[QUEUE_KEY] || [];
  if (cur.length === 0) return { ok: true, results: [] };
  const config = await getConfig();
  const token = await getToken();
  if (!config.enabled || !token) return { ok: false, reason: !token ? "no-token" : "disabled" };

  await chrome.storage.session.set({ [QUEUE_KEY]: [] });
  try {
    const res = await fetch(`${config.apiBase.replace(/\/$/, "")}/api/lms-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: cur }),
    });
    if (res.status === 401) {
      // Token rejected — clear and let the popup re-auth.
      await chrome.storage.local.remove(TOKEN_KEY);
      return { ok: false, reason: "auth" };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, ...json };
  } catch (err) {
    // Network failure — requeue so we don't drop evidence.
    const next = (await chrome.storage.session.get(QUEUE_KEY))[QUEUE_KEY] || [];
    await chrome.storage.session.set({ [QUEUE_KEY]: [...cur, ...next] });
    return { ok: false, reason: "network", error: String(err) };
  }
}

// MV3 alarms are the right primitive for periodic background work.
chrome.alarms.create("sos-flush", { periodInMinutes: Math.max(0.1, FLUSH_INTERVAL_MS / 60000) });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sos-flush") flush().catch(() => {});
});

// ── messages ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "sos:event") {
        await enqueue(msg.event);
        sendResponse({ ok: true });
      } else if (msg.type === "sos:flush") {
        sendResponse(await flush());
      } else if (msg.type === "sos:get-state") {
        sendResponse({
          config: await getConfig(),
          hasToken: Boolean(await getToken()),
          queueLen: ((await chrome.storage.session.get(QUEUE_KEY))[QUEUE_KEY] || []).length,
          grantedHosts: await chrome.permissions.getAll().then((p) => p.origins || []),
        });
      } else if (msg.type === "sos:set-config") {
        sendResponse({ config: await setConfig(msg.patch || {}) });
      } else if (msg.type === "sos:set-token") {
        await setToken(msg.token);
        sendResponse({ ok: true });
      } else if (msg.type === "sos:request-host") {
        const granted = await chrome.permissions.request({ origins: [msg.origin] });
        sendResponse({ granted });
      } else if (msg.type === "sos:revoke-host") {
        const removed = await chrome.permissions.remove({ origins: [msg.origin] });
        sendResponse({ removed });
      } else {
        sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // keep the channel open for the async response
});
