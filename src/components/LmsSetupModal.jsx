import React, { useState, useEffect } from 'react';
import Icon from '../lib/icons';
import { sb, SUPABASE_ANON_KEY } from '../lib/supabase';
import { buildOAuthRedirectUrl } from '../lib/auth/oauthRedirect';

/* ═══════════════════════════════════════════════
   LMS SETUP MODAL — 3-step wizard for connecting an LMS
   for active server-side submission tracking.
   Step 1: pick provider (from lms_providers where enabled)
   Step 2: connect — OAuth popup (pull) or webhook secret (push)
   Step 3: pick courses (pull) or confirm (push), then immediate sync
   ═══════════════════════════════════════════════ */
export default function LmsSetupModal({ onClose, onToast }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [providers, setProviders] = useState([]);
  const [picked, setPicked] = useState(null);
  const [courses, setCourses] = useState([]);
  const [selected, setSelected] = useState(new Set());
  async function authHeader() {
    const session = await sb.auth.getSession();
    const token = session?.data?.session?.access_token;
    return { 'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY) };
  }

  // Load enabled providers on mount.
  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      try {
        const { data, error } = await sb.from('lms_providers').select('*').eq('enabled', true).order('display_name');
        if (error) throw new Error(error.message);
        setProviders(data || []);
      } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  function pickProvider(p) {
    setPicked(p);
    setStep(2);
    setErr(null);
  }

  // ── Step 2 (pull) — open Google's auth-code popup, exchange code server-side ──
  async function connectPull() {
    if (!window.google?.accounts?.oauth2) {
      setErr('Google sign-in not loaded yet — try again in a moment.');
      return;
    }
    setLoading(true); setErr(null);
    try {
      const redirectUri = buildOAuthRedirectUrl(window.location.href);
      const scope = [
        'https://www.googleapis.com/auth/classroom.courses.readonly',
        'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
        'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
      ].join(' ');
      // Public OAuth client id — safe to expose. Override per-deployment via VITE_GOOGLE_CLIENT_ID.
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '504839570150-i4s8urseqgrjucbhqfjc9phiavrcn08d.apps.googleusercontent.com';
      // Auth-code flow (not the implicit token flow) — backend needs the code
      // to exchange for both an access_token AND a refresh_token.
      const codeClient = window.google.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope,
        ux_mode: 'popup',
        access_type: 'offline',
        prompt: 'consent',
        callback: async (resp) => {
          if (!resp.code) { setErr('Did not receive an auth code from Google.'); setLoading(false); return; }
          try {
            const r = await fetch('/api/lms-oauth-callback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
              body: JSON.stringify({ provider: picked.id, code: resp.code, redirectUri }),
            });
            if (!r.ok) {
              const body = await r.json().catch(() => ({}));
              throw new Error(body.error || 'OAuth exchange failed: ' + r.status);
            }
            // Load the user's courses.
            const cr = await fetch('/api/lms-courses?provider=' + encodeURIComponent(picked.id), {
              headers: { ...(await authHeader()) },
            });
            if (!cr.ok) {
              const body = await cr.json().catch(() => ({}));
              throw new Error(body.error || 'Could not load courses: ' + cr.status);
            }
            const { courses: cs } = await cr.json();
            setCourses(cs || []);
            setSelected(new Set((cs || []).map(c => c.externalCourseId)));
            setStep(3);
          } catch (e) { setErr(e.message); }
          finally { setLoading(false); }
        },
      });
      codeClient.requestCode();
    } catch (e) { setErr(e.message); setLoading(false); }
  }

  function toggleCourse(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ── Step 3 finish — save courses, kick an immediate sync, close ──
  async function finish() {
    setLoading(true); setErr(null);
    try {
      const selections = courses
        .filter(c => selected.has(c.externalCourseId))
        .map(c => ({ externalCourseId: c.externalCourseId, courseName: c.name }));
      const r = await fetch('/api/lms-tracked-courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ provider: picked.id, selections }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || 'Saving courses failed: ' + r.status);
      }
      // Immediate first sync.
      await fetch('/api/lms-sync-trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      }).catch(() => {});
      onToast && onToast('Connected to ' + picked.display_name + ' ✓');
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <>
      <div className="g-overlay" onClick={loading ? undefined : onClose}/>
      <div className="g-modal" onClick={e=>e.stopPropagation()}>
        <div className="g-modal-hdr">
          <div className="g-modal-title">
            <span style={{display:'flex',color:'var(--accent)'}}>{Icon.link(18)}</span>
            Connect LMS — Step {step} of 3
          </div>
          <button className="g-modal-close" onClick={onClose} disabled={loading}>{Icon.x(16)}</button>
        </div>

        {err && <div className="g-err" style={{display:'flex',alignItems:'center',gap:6}}>{Icon.alertTriangle(14)} {err}</div>}

        {/* ── Step 1: pick provider ── */}
        {step === 1 && (
          <div className="g-section">
            <div className="g-note" style={{marginBottom:10}}>Pick the LMS you want to sync submissions from. SOS will auto-close tasks when an assignment is turned in.</div>
            {loading && <div className="g-note">Loading providers…</div>}
            {!loading && providers.length === 0 && <div className="g-note">No LMS providers are enabled. Ask an admin to flip <code>lms_providers.enabled</code>.</div>}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {providers.map(p => (
                <button key={p.id} onClick={()=>pickProvider(p)} style={{textAlign:'left',padding:'12px 14px',border:'1px solid var(--border)',background:'transparent',borderRadius:10,cursor:'pointer',color:'var(--text)'}}>
                  <div style={{fontWeight:700}}>{p.display_name}</div>
                  <div style={{fontSize:'0.74rem',color:'var(--text-dim)',marginTop:2}}>
                    {p.mode === 'pull' ? 'Server-side polling via OAuth — works automatically.' : 'Browser extension — installs once, syncs automatically.'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 2: connect ── */}
        {step === 2 && picked && (
          <div className="g-section">
            <div className="g-note" style={{marginBottom:10}}>
              Click Connect to authorize {picked.display_name}. SOS reads your assignments and submissions; it never posts on your behalf.
            </div>
            <button className="g-hdr-btn" disabled={loading} onClick={connectPull}>
              {loading ? 'Connecting…' : 'Connect ' + picked.display_name}
            </button>
            <div style={{marginTop:12}}>
              <button onClick={()=>{setStep(1);setPicked(null);}} style={{background:'transparent',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:'0.78rem'}}>← Back</button>
            </div>
          </div>
        )}

        {/* ── Step 3: course picker ── */}
        {step === 3 && picked && (
          <div className="g-section">
            <div className="g-note" style={{marginBottom:10}}>Pick the courses to track. Submissions from these will auto-close any matching open task.</div>
            <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:300,overflowY:'auto',marginBottom:12}}>
              {courses.length === 0 && <div className="g-note">No active courses found.</div>}
              {courses.map(c => (
                <label key={c.externalCourseId} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer'}}>
                  <input type="checkbox" checked={selected.has(c.externalCourseId)} onChange={()=>toggleCourse(c.externalCourseId)}/>
                  <span style={{fontSize:'0.84rem'}}>{c.name}</span>
                </label>
              ))}
            </div>
            <button className="g-hdr-btn" disabled={loading || selected.size === 0} onClick={finish}>
              {loading ? 'Saving…' : 'Save & sync now'}
            </button>
          </div>
        )}

      </div>
    </>
  );
}
