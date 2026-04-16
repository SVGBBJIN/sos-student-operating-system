import { useState, useEffect } from 'react';
import { sb } from '../../lib/supabase';
import Icon from '../../lib/icons';

export default function AuthModal({ onAuth, onClose, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);

  useEffect(() => {
    if (rateLimitSeconds <= 0) return;
    const t = setInterval(() => setRateLimitSeconds(s => s <= 1 ? 0 : s - 1), 1000);
    return () => clearInterval(t);
  }, [rateLimitSeconds]);

  function fmtCountdown(s) {
    const m = Math.floor(s / 60);
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  }

  function friendlyAuthError(msg) {
    if (!msg) return 'Something went wrong — please try again.';
    const lower = msg.toLowerCase();
    if ((lower.includes('invalid') && lower.includes('email')) || lower.includes('email address') || lower.includes('not authorized')) {
      return "That email address wasn't accepted. Please try a different address or use Google sign-in.";
    }
    if (lower.includes('rate limit') || lower.includes('security purposes') || lower.includes('too many')) {
      const match = msg.match(/(\d+)\s*second/i);
      const secs = match ? parseInt(match[1], 10) : 300;
      setRateLimitSeconds(secs);
      const mins = Math.ceil(secs / 60);
      return `Too many sign-up attempts — please wait ${mins} minute${mins !== 1 ? 's' : ''} before trying again.`;
    }
    if (lower.includes('already registered') || lower.includes('already in use') || lower.includes('user already')) {
      return 'An account with that email already exists — try signing in instead.';
    }
    if (lower.includes('password') && lower.includes('short')) {
      return 'Password must be at least 6 characters.';
    }
    return msg;
  }

  async function handleGoogleSignIn() {
    setError(null); setLoading(true);
    try {
      const { error: err } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (err) throw err;
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      if (mode === 'signup') {
        const { data, error: err } = await sb.auth.signUp({
          email, password,
          options: { data: { display_name: displayName || 'Student' } },
        });
        if (err) throw err;
        if (data.user) {
          if (data.session) { onAuth(data.user); }
          else { setError(null); setMode('check-email'); }
        } else {
          setError("We couldn't create an account with that email — please try a different address or use Google sign-in.");
        }
      } else {
        const { data, error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) throw err;
        if (data.user) onAuth(data.user);
      }
    } catch (err) {
      setError(friendlyAuthError(err.message));
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'check-email') {
    return (
      <div className="g-overlay" onClick={onClose}>
        <div className="g-modal" onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 8, color: 'var(--accent)', display: 'flex', justifyContent: 'center' }}>{Icon.mail(32)}</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>Check your email</div>
          <div style={{ fontSize: '0.88rem', color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.5 }}>
            We sent a confirmation link to <strong style={{ color: 'var(--text)' }}>{email}</strong>. Click it, then come back and log in.
          </div>
          <button className="auth-btn auth-btn-primary" onClick={() => setMode('login')}>Back to login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="g-overlay" onClick={onClose}>
      <div className="g-modal" onClick={e => e.stopPropagation()} style={{ padding: '28px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 2 }}>Sign in to save your data across devices</div>
          </div>
          <button className="g-modal-close" onClick={onClose}>{Icon.x(16)}</button>
        </div>

        {error && (
          <div className="auth-error">
            {error}
            {rateLimitSeconds > 0 && (
              <span style={{ display: 'block', marginTop: 4, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                Try again in {fmtCountdown(rateLimitSeconds)}
              </span>
            )}
          </div>
        )}

        <button type="button" onClick={handleGoogleSignIn} disabled={loading}
          style={{ width: '100%', padding: '12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.92rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, transition: 'all .15s', marginBottom: 12, opacity: loading ? 0.6 : 1 }}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </button>

        <div className="auth-divider">or use email</div>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <input className="auth-input" type="text" placeholder="Your name" value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="name" />
          )}
          <input className="auth-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
          <input className="auth-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          <button className="auth-btn auth-btn-primary" type="submit" disabled={loading || rateLimitSeconds > 0}>
            {loading ? 'Loading...' : rateLimitSeconds > 0 ? `Wait ${fmtCountdown(rateLimitSeconds)}` : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <button type="button"
          style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.84rem', padding: '8px 0', marginTop: 4 }}
          onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); }}>
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
