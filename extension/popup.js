// Popup UI. Three things the user can do here:
//   1. Sign in via the SOS web app (launchWebAuthFlow opens /extension-auth,
//      which redirects back with the Supabase JWT in the URL hash).
//   2. Approve a specific LMS domain (chrome.permissions.request → granular
//      host permission, not <all_urls>).
//   3. Toggle monitoring on/off and configure the API base for dev.

const $ = (id) => document.getElementById(id);
const SOS_AUTH_PATH = "/extension-auth"; // SOS app surfaces this route in a future PR

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || {})));
}

async function render() {
  const state = await send({ type: "sos:get-state" });
  $("auth-status").textContent = state.hasToken ? "Signed in" : "Not signed in";
  $("sign-in").textContent = state.hasToken ? "Sign out" : "Sign in";
  $("enabled").checked = Boolean(state.config?.enabled);
  $("api-base").value = state.config?.apiBase || "";
  $("queue-status").textContent = `Queue: ${state.queueLen} event(s)`;

  const granted = new Set(state.grantedHosts || []);
  document.querySelectorAll(".domain button").forEach((btn) => {
    const origin = btn.dataset.origin;
    const isGranted = [...granted].some((g) => originsMatch(g, origin));
    btn.textContent = isGranted ? "Revoke" : "Allow";
    btn.dataset.granted = isGranted ? "1" : "0";
  });
}

function originsMatch(a, b) {
  // Cheap match — same origin pattern strings count as equal.
  return a === b;
}

async function signIn() {
  const config = (await send({ type: "sos:get-state" })).config || {};
  const base = (config.apiBase || "").replace(/\/$/, "");
  if (!base) { alert("Set the API base first."); return; }
  const redirectUri = chrome.identity.getRedirectURL("supabase");
  const url = `${base}${SOS_AUTH_PATH}?redirect=${encodeURIComponent(redirectUri)}`;
  try {
    const out = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    // Expect token in URL fragment: #access_token=...
    const hash = new URL(out).hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const token = params.get("access_token");
    if (!token) throw new Error("No access_token in callback");
    await send({ type: "sos:set-token", token });
    render();
  } catch (err) {
    alert("Sign-in failed: " + (err?.message || err));
  }
}

async function signOut() {
  await send({ type: "sos:set-token", token: null });
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  render();
  $("sign-in").addEventListener("click", async () => {
    const state = await send({ type: "sos:get-state" });
    if (state.hasToken) await signOut(); else await signIn();
  });
  $("flush").addEventListener("click", async () => {
    const r = await send({ type: "sos:flush" });
    $("queue-status").textContent = r.ok ? `Sent (${(r.results || []).length} result(s))` : `Send failed: ${r.reason || r.error || "unknown"}`;
    setTimeout(render, 500);
  });
  $("enabled").addEventListener("change", async (e) => {
    await send({ type: "sos:set-config", patch: { enabled: e.target.checked } });
  });
  $("api-base").addEventListener("change", async (e) => {
    await send({ type: "sos:set-config", patch: { apiBase: e.target.value.trim() } });
  });
  document.querySelectorAll(".domain button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const origin = btn.dataset.origin;
      const granted = btn.dataset.granted === "1";
      const result = granted
        ? await send({ type: "sos:revoke-host", origin })
        : await send({ type: "sos:request-host", origin });
      if (!result.granted && !result.removed) alert("Permission change failed.");
      render();
    });
  });
});
