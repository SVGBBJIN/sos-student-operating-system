import React, { useState } from 'react';

export default function AuthScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (!email) return setErr('email is required');
    if (pw.length < 4) return setErr('password too short');
    setErr(null); setBusy(true);
    setTimeout(() => onLogin && onLogin({ name: email.split('@')[0] || 'friend', email }), 400);
  }

  return (
    <div className="auth-screen">
      <form className="auth-form" onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <img src="/brain-logo.svg" alt="" style={{ width: 32, height: 32 }} />
          <div className="brand-word" style={{ fontSize: 22 }}>S<em>O</em>S</div>
        </div>
        <h1 className="auth-headline">welcome <em>back</em></h1>
        <div className="auth-sub">sign in to continue</div>
        {err && <div className="auth-error">{err}</div>}
        <input className="auth-input" type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className="auth-input" type="password" placeholder="password" value={pw} onChange={e => setPw(e.target.value)} />
        <button className="auth-btn primary" type="submit" disabled={busy}>{busy ? 'signing in…' : 'sign in →'}</button>
        <div className="auth-divider"><span>or</span></div>
        <button type="button" className="auth-btn secondary" onClick={() => onLogin && onLogin({ name: 'sam', email: 'sam@example.com' })}>
          continue with google
        </button>
      </form>
    </div>
  );
}
