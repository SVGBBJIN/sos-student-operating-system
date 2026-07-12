// Settings → Connectors. Shows which LMS apps the SOS browser extension is
// connected to and lets the user add custom domains.
//
// All state lives in the extension; this component is a thin client over the
// `ext` bridge in src/lib/extensionBridge.js. If the extension isn't installed
// or the extension ID isn't set yet, we show a setup hint instead of the
// connector list.

import { useEffect, useState, useCallback } from "react";
import { ext, getExtensionId, setExtensionId, hasChromeRuntime } from "../lib/extensionBridge";

const HELP_URL = "/extension"; // future docs route

function StatusPill({ ok, label }) {
  return (
    <span style={{
      fontSize: "0.7rem",
      fontWeight: 600,
      padding: "2px 8px",
      borderRadius: 10,
      letterSpacing: "0.02em",
      background: ok ? "rgba(46,213,115,0.15)" : "rgba(255,107,107,0.12)",
      color: ok ? "var(--success)" : "var(--danger)",
    }}>{label}</span>
  );
}

export default function ConnectorsSettings({
  onToast,
  googleConnected,
  googleUser,
  calSyncEnabled,
  calSyncStatus,
  calSyncLastAt,
  onConnectGoogle,
  onDisconnectGoogle,
  onOpenGoogleImport,
}) {
  const [extId, setExtIdLocal] = useState(getExtensionId());
  const [state, setState] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newHost, setNewHost] = useState("");
  const [newName, setNewName] = useState("");

  const refresh = useCallback(async () => {
    setErr(null);
    if (!hasChromeRuntime()) { setErr("This browser doesn't expose the Chrome extension API. Open SOS in Chrome with the extension installed."); setState(null); return; }
    if (!getExtensionId()) { setErr("Set the extension ID below to connect."); setState(null); return; }
    try {
      const s = await ext.getState();
      setState(s);
    } catch (e) {
      setState(null);
      setErr(e.message || String(e));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function withBusy(fn) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  function notify(msg) { onToast?.(msg); }

  async function toggleBuiltin(connector) {
    return withBusy(async () => {
      try {
        const r = connector.granted
          ? await ext.revokeHost(connector.originPattern)
          : await ext.requestHost(connector.originPattern);
        if (r?.granted || r?.removed) notify(`${connector.granted ? "Revoked" : "Connected"} ${connector.name}`);
        else if (r?.granted === false) notify("Permission denied");
        await refresh();
      } catch (e) { notify(`Failed: ${e.message || e}`); }
    });
  }

  async function addCustom() {
    if (!newHost.trim()) return;
    await withBusy(async () => {
      try {
        const r = await ext.addCustom({ name: newName.trim(), originPattern: newHost.trim() });
        if (!r?.ok) { notify(r?.error || "Failed to add"); return; }
        setNewHost(""); setNewName("");
        notify(`Added ${r.connector.name}`);
        await refresh();
      } catch (e) { notify(`Failed: ${e.message || e}`); }
    });
  }

  async function removeCustom(connector) {
    if (!confirm(`Remove ${connector.name}? SOS will stop monitoring this site.`)) return;
    await withBusy(async () => {
      try {
        const r = await ext.removeCustom(connector.id);
        if (!r?.ok) { notify(r?.error || "Failed to remove"); return; }
        notify(`Removed ${connector.name}`);
        await refresh();
      } catch (e) { notify(`Failed: ${e.message || e}`); }
    });
  }

  function saveExtId(value) {
    setExtensionId(value);
    setExtIdLocal(value);
    refresh();
  }

  const rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" };

  return (
    <div className="settings-card settings-fullscreen-card">
      <div className="settings-row" style={{paddingBottom:6}}>
        <div style={{fontWeight:700,fontSize:"0.88rem",color:"var(--teal)"}}>Connectors</div>
        <button className="settings-toggle" disabled={busy} onClick={refresh}>Refresh</button>
      </div>
      <div className="settings-row" style={{paddingTop:0}}>
        <div style={{fontSize:"0.78rem",color:"var(--text-dim)"}}>
          The SOS browser extension watches your LMS pages for submission activity and auto-completes matching tasks. Access is granted per school — never to your full browsing history.
        </div>
      </div>

      {/* Google Calendar */}
      <div style={rowStyle}>
        <div>
          <div style={{fontWeight:600,fontSize:"0.88rem"}}>Google Calendar</div>
          <div style={{fontSize:"0.72rem",color:"var(--text-dim)"}}>
            {googleConnected
              ? (googleUser?.email ? `Connected as ${googleUser.email}` : "Connected")
              : "Import events and two-way sync your Google Calendar."}
          </div>
          {googleConnected && (
            <div style={{fontSize:"0.7rem",color:"var(--text-dim)",marginTop:2}}>
              Sync: {calSyncEnabled ? (calSyncStatus === 'syncing' ? 'syncing…' : calSyncStatus === 'error' ? 'error' : 'on') : 'off'}
              {calSyncLastAt ? ` · last synced ${new Date(calSyncLastAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
            </div>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <StatusPill ok={!!googleConnected} label={googleConnected ? "Connected" : "Not connected"} />
          {googleConnected ? (
            <>
              <button className="settings-toggle" onClick={() => onOpenGoogleImport?.()}>Import</button>
              <button className="settings-toggle" onClick={() => onDisconnectGoogle?.()}>Disconnect</button>
            </>
          ) : (
            <button className="settings-toggle settings-toggle-active" onClick={() => onConnectGoogle?.()}>Connect</button>
          )}
        </div>
      </div>

      {/* Extension ID setup */}
      <div className="settings-row">
        <div style={{flex:1}}>
          <div style={{fontWeight:600,fontSize:"0.88rem"}}>Extension ID</div>
          <div style={{fontSize:"0.78rem",color:"var(--text-dim)"}}>Open the SOS extension popup in Chrome and copy the ID shown there.</div>
        </div>
        <input
          type="text"
          value={extId}
          onChange={(e) => setExtIdLocal(e.target.value)}
          onBlur={(e) => saveExtId(e.target.value)}
          placeholder="abcdefghijklmnopabcdefghijklmnop"
          style={{
            width: 260, padding: "5px 8px", borderRadius: 6,
            border: "1px solid var(--border)", background: "var(--bg)",
            color: "var(--text)", fontFamily: "var(--font-mono, monospace)", fontSize: "0.75rem",
          }}
        />
      </div>

      {err && (
        <div className="settings-row" style={{color:"var(--danger)",fontSize:"0.78rem"}}>
          {err}
          {!hasChromeRuntime() && <span style={{marginLeft:6,color:"var(--text-dim)"}}>· <a href={HELP_URL} style={{color:"var(--teal)"}}>Install the extension</a></span>}
        </div>
      )}

      {state && (
        <>
          {/* Built-in LMS toggles */}
          <div style={{marginTop:8}}>
            <div style={{fontSize:"0.75rem",fontWeight:600,color:"var(--text-dim)",letterSpacing:"0.05em",textTransform:"uppercase",margin:"8px 0 4px"}}>Supported schools</div>
            {state.builtins.map((c) => (
              <div key={c.id} style={rowStyle}>
                <div>
                  <div style={{fontWeight:600,fontSize:"0.88rem"}}>{c.name}</div>
                  <div style={{fontSize:"0.72rem",color:"var(--text-dim)",fontFamily:"var(--font-mono, monospace)"}}>{c.originPattern}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <StatusPill ok={c.granted} label={c.granted ? "Connected" : "Not connected"} />
                  <button
                    className={"settings-toggle" + (c.granted ? "" : " settings-toggle-active")}
                    disabled={busy}
                    onClick={() => toggleBuiltin(c)}
                  >{c.granted ? "Revoke" : "Connect"}</button>
                </div>
              </div>
            ))}
          </div>

          {/* Custom domains */}
          <div style={{marginTop:14}}>
            <div style={{fontSize:"0.75rem",fontWeight:600,color:"var(--text-dim)",letterSpacing:"0.05em",textTransform:"uppercase",margin:"8px 0 4px"}}>Custom domains</div>
            {state.custom.length === 0 && (
              <div style={{fontSize:"0.78rem",color:"var(--text-dim)",padding:"4px 0"}}>No custom domains yet. Add your school's self-hosted LMS below.</div>
            )}
            {state.custom.map((c) => (
              <div key={c.id} style={rowStyle}>
                <div>
                  <div style={{fontWeight:600,fontSize:"0.88rem"}}>{c.name}</div>
                  <div style={{fontSize:"0.72rem",color:"var(--text-dim)",fontFamily:"var(--font-mono, monospace)"}}>{c.originPattern}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <StatusPill ok={c.granted} label={c.granted ? "Active" : "Permission revoked"} />
                  <button className="settings-toggle" disabled={busy} onClick={() => removeCustom(c)}>Remove</button>
                </div>
              </div>
            ))}

            <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 0 2px",flexWrap:"wrap"}}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Display name (e.g. District LMS)"
                style={{flex:"1 1 180px",padding:"5px 8px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:"0.82rem"}}
              />
              <input
                type="text"
                value={newHost}
                onChange={(e) => setNewHost(e.target.value)}
                placeholder="lms.myschool.org"
                style={{flex:"1 1 220px",padding:"5px 8px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:"0.82rem",fontFamily:"var(--font-mono, monospace)"}}
                onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
              />
              <button className="settings-toggle settings-toggle-active" disabled={busy || !newHost.trim()} onClick={addCustom}>Add</button>
            </div>
            <div style={{fontSize:"0.72rem",color:"var(--text-dim)",paddingTop:4}}>
              Chrome will prompt for permission to read pages on that domain. SOS only ever reads structured submission signals — never page content, cookies, or keystrokes.
            </div>
          </div>

          <div className="settings-row" style={{marginTop:14,fontSize:"0.72rem",color:"var(--text-dim)"}}>
            Extension v{state.version} · {state.queueLen} queued event(s) · {state.hasToken ? "Signed in" : "Sign in via extension popup"}
          </div>
        </>
      )}
    </div>
  );
}
