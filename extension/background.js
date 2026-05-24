// Background service worker.
//
// Responsibilities:
//   - hold the Supabase JWT (chrome.storage.local) and refresh-on-demand
//   - batch incoming evidence events from content scripts and POST them to the
//     SOS backend in groups (every 5s or on demand)
//   - expose chrome.runtime.onMessage RPC for popup ↔ background
//   - expose chrome.runtime.onMessageExternal RPC for the SOS web app to
//     read + edit connector state (Settings → Connectors)
//   - register dynamic content scripts for user-added custom LMS domains
//
// Auth model (per the approved plan): Supabase OAuth popup. The popup opens
// the SOS app's /extension-auth page in a launchWebAuthFlow window which posts
// the resulting Supabase JWT back via location-hash; this script stores it.

const CONFIG_KEY    = "sos.config";
const TOKEN_KEY     = "sos.token";
const QUEUE_KEY     = "sos.queue";
const CUSTOM_KEY    = "sos.customConnectors"; // [{ id, name, originPattern, addedAt }]
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 25;

const DEFAULT_CONFIG = {
  apiBase: "https://sos.example.com",
  enabled: true,
};

// Built-in connectors mirror the manifest's static content scripts. The
// Settings UI uses this list to render the always-available LMS toggles.
const BUILTIN_CONNECTORS = [
  { id: "classroom", name: "Google Classroom", originPattern: "https://classroom.google.com/*" },
  { id: "canvas",    name: "Canvas (Instructure)", originPattern: "https://*.instructure.com/*" },
  { id: "schoology", name: "Schoology", originPattern: "https://*.schoology.com/*" },
];

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
  if (token === null) await chrome.storage.local.remove(TOKEN_KEY);
  else await chrome.storage.local.set({ [TOKEN_KEY]: token });
}
async function getCustomConnectors() {
  const out = await chrome.storage.local.get(CUSTOM_KEY);
  return out[CUSTOM_KEY] || [];
}
async function setCustomConnectors(list) {
  await chrome.storage.local.set({ [CUSTOM_KEY]: list });
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
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events: cur }),
    });
    if (res.status === 401) {
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

chrome.alarms.create("sos-flush", { periodInMinutes: Math.max(0.1, FLUSH_INTERVAL_MS / 60000) });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sos-flush") flush().catch(() => {});
});

// ── connectors ───────────────────────────────────────────────────────────────
// A connector is a host pattern + a content script registration. Built-ins are
// pre-declared in manifest.json so they're static. Custom ones use the runtime
// permissions + scripting APIs:
//   1. chrome.permissions.request({origins: [pattern]}) — user accepts in a
//      Chrome-native dialog (we never see the password / cookies)
//   2. chrome.scripting.registerContentScripts({...}) — injects generic.js
//      into matching pages
//
// On startup we re-register any custom connectors whose host permission is
// still granted (chrome.scripting registrations are persistent in MV3 but the
// permission can be revoked externally).

function normalizeOriginPattern(input) {
  let s = (input || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  // Force trailing /*
  if (!/\/\*$/.test(s)) s = s.replace(/\/?$/, "/*");
  try {
    const u = new URL(s.replace("/*", "/"));
    if (!u.hostname) return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch { return null; }
}

function customScriptId(connectorId) {
  return `sos-custom-${connectorId}`;
}

async function registerCustomScript(connector) {
  const id = customScriptId(connector.id);
  try {
    // Remove first to make this idempotent.
    await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
    await chrome.scripting.registerContentScripts([{
      id,
      matches: [connector.originPattern],
      js: ["content/shared/parse.js", "content/shared/net.js", "content/generic.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
      world: "ISOLATED",
    }]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function unregisterCustomScript(connector) {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [customScriptId(connector.id)] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function listConnectorState() {
  const granted = (await chrome.permissions.getAll()).origins || [];
  const isGranted = (pattern) => granted.includes(pattern);
  const customs = await getCustomConnectors();
  return {
    builtins: BUILTIN_CONNECTORS.map((c) => ({ ...c, granted: isGranted(c.originPattern), kind: "builtin" })),
    custom: customs.map((c) => ({ ...c, granted: isGranted(c.originPattern), kind: "custom" })),
    grantedOrigins: granted,
  };
}

async function addCustomConnector({ name, originPattern }) {
  const pattern = normalizeOriginPattern(originPattern);
  if (!pattern) return { ok: false, error: "Invalid origin pattern" };
  const customs = await getCustomConnectors();
  if (customs.some((c) => c.originPattern === pattern)) {
    return { ok: false, error: "Already added" };
  }
  // Request the host permission interactively. Chrome shows a native prompt.
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) return { ok: false, error: "Permission denied" };

  const connector = {
    id: `c${Date.now().toString(36)}`,
    name: (name || new URL(pattern.replace("/*", "/")).hostname).trim(),
    originPattern: pattern,
    addedAt: new Date().toISOString(),
  };
  await setCustomConnectors([...customs, connector]);
  const reg = await registerCustomScript(connector);
  if (!reg.ok) return { ok: false, error: `Registered permission but script injection failed: ${reg.error}` };
  return { ok: true, connector };
}

async function removeCustomConnector(connectorId) {
  const customs = await getCustomConnectors();
  const target = customs.find((c) => c.id === connectorId);
  if (!target) return { ok: false, error: "Not found" };
  await unregisterCustomScript(target);
  await chrome.permissions.remove({ origins: [target.originPattern] }).catch(() => {});
  await setCustomConnectors(customs.filter((c) => c.id !== connectorId));
  return { ok: true };
}

async function reconcileCustomScripts() {
  // Re-register everything in chrome.storage that still has a granted host
  // permission. This catches the case where the extension was updated and
  // dynamic registrations got dropped.
  const customs = await getCustomConnectors();
  const granted = (await chrome.permissions.getAll()).origins || [];
  for (const c of customs) {
    if (granted.includes(c.originPattern)) await registerCustomScript(c);
  }
}

chrome.runtime.onStartup.addListener(() => reconcileCustomScripts());
chrome.runtime.onInstalled.addListener(() => reconcileCustomScripts());

// ── messages ─────────────────────────────────────────────────────────────────

function rpcHandler(msg, _sender, sendResponse) {
  (async () => {
    try {
      if (msg.type === "sos:event") {
        await enqueue(msg.event);
        sendResponse({ ok: true });
      } else if (msg.type === "sos:flush") {
        sendResponse(await flush());
      } else if (msg.type === "sos:get-state") {
        sendResponse({
          extensionId: chrome.runtime.id,
          version: chrome.runtime.getManifest().version,
          config: await getConfig(),
          hasToken: Boolean(await getToken()),
          queueLen: ((await chrome.storage.session.get(QUEUE_KEY))[QUEUE_KEY] || []).length,
          ...(await listConnectorState()),
        });
      } else if (msg.type === "sos:set-config") {
        sendResponse({ config: await setConfig(msg.patch || {}) });
      } else if (msg.type === "sos:set-token") {
        await setToken(msg.token);
        sendResponse({ ok: true });
      } else if (msg.type === "sos:request-host") {
        // Used by the popup for the three built-ins.
        const granted = await chrome.permissions.request({ origins: [msg.origin] });
        sendResponse({ granted });
      } else if (msg.type === "sos:revoke-host") {
        const removed = await chrome.permissions.remove({ origins: [msg.origin] });
        sendResponse({ removed });
      } else if (msg.type === "sos:add-custom") {
        sendResponse(await addCustomConnector(msg.connector || {}));
      } else if (msg.type === "sos:remove-custom") {
        sendResponse(await removeCustomConnector(msg.connectorId));
      } else {
        sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // keep the channel open for the async response
}

chrome.runtime.onMessage.addListener(rpcHandler);
// SOS web app uses chrome.runtime.sendMessage(extId, ...) — gated by
// externally_connectable.matches in the manifest.
chrome.runtime.onMessageExternal.addListener(rpcHandler);
