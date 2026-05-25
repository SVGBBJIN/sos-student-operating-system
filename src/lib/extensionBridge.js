// Bridge to the SOS browser extension.
//
// The extension's background service worker exposes a chrome.runtime
// messaging API for the SOS web app via `externally_connectable` in
// manifest.json. The SOS app calls chrome.runtime.sendMessage(extensionId,
// {type, ...}) — Chrome routes it to the extension only if the page's origin
// is in externally_connectable.matches.
//
// The extension ID is variable in dev (each unpacked load gets a new ID), so
// the user pastes it into Settings. Once stored in localStorage, calls just
// work.

const EXT_ID_KEY = "sos.extensionId";

export function getExtensionId() {
  try { return localStorage.getItem(EXT_ID_KEY) || ""; } catch { return ""; }
}

export function setExtensionId(id) {
  try { localStorage.setItem(EXT_ID_KEY, (id || "").trim()); } catch { /* noop */ }
}

export function hasChromeRuntime() {
  return typeof chrome !== "undefined" && Boolean(chrome?.runtime?.sendMessage);
}

// Send a message to the extension. Resolves with the response or rejects if
// the extension isn't installed / ID is wrong / origin not allowed.
export function callExtension(msg) {
  return new Promise((resolve, reject) => {
    if (!hasChromeRuntime()) { reject(new Error("Chrome extension API not available")); return; }
    const id = getExtensionId();
    if (!id) { reject(new Error("Extension ID not set")); return; }
    try {
      chrome.runtime.sendMessage(id, msg, (response) => {
        const err = chrome.runtime?.lastError;
        if (err) { reject(new Error(err.message || "Extension call failed")); return; }
        resolve(response);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// Convenience wrappers — keep call sites declarative.
export const ext = {
  getState:        () => callExtension({ type: "sos:get-state" }),
  setConfig:       (patch) => callExtension({ type: "sos:set-config", patch }),
  requestHost:     (origin) => callExtension({ type: "sos:request-host", origin }),
  revokeHost:      (origin) => callExtension({ type: "sos:revoke-host", origin }),
  addCustom:       (connector) => callExtension({ type: "sos:add-custom", connector }),
  removeCustom:    (connectorId) => callExtension({ type: "sos:remove-custom", connectorId }),
  flush:           () => callExtension({ type: "sos:flush" }),
};
