import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import BrandMark from '../components/BrandMark.jsx';

/* ─── Themed 404 — reuses the landing page's dark + mint palette ─── */
export default function NotFound() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Page not found — SOS';
  }, []);

  return (
    <div className="nf-root">
      <style>{NOT_FOUND_CSS}</style>
      <div className="nf-topline" />
      <div className="nf-card">
        <div className="nf-brand">
          <span className="sos-brand-mark" style={{ borderRadius: 7, padding: 4, borderColor: 'rgba(255,255,255,0.16)' }}>
            <img src="/brain-logo.svg" alt="" width="20" height="20" />
          </span>
          <span style={{ fontSize: 17, color: 'var(--nf-fg-1)', fontFamily: 'var(--nf-font-display)', fontWeight: 800, letterSpacing: '-0.02em' }}>
            S<em style={{ color: 'var(--nf-mint)', fontStyle: 'normal' }}>O</em>S
          </span>
        </div>
        <div className="nf-code">404</div>
        <h1 className="nf-headline">this page went missing.</h1>
        <p className="nf-sub">
          nothing lives at this address — check the link, or head back to the studio.
        </p>
        <div className="nf-cta-row">
          <button className="nf-btn nf-btn-primary" onClick={() => navigate('/studio')}>
            Enter studio
          </button>
          <button className="nf-btn nf-btn-ghost" onClick={() => navigate('/')}>
            Back home
          </button>
        </div>
      </div>
    </div>
  );
}

const NOT_FOUND_CSS = `
.nf-root {
  --nf-bg: #0f1115;
  --nf-bg-2: #12151e;
  --nf-fg-1: #f0f2f6;
  --nf-fg-2: #9aa3b8;
  --nf-line: rgba(255,255,255,0.07);
  --nf-line-2: rgba(255,255,255,0.14);
  --nf-mint: #86efac;
  --nf-mint-strong: #a8f3c2;
  --nf-mint-bg: rgba(134,239,172,0.14);
  --nf-mint-line: rgba(134,239,172,0.45);
  --nf-font-display: 'Syne', system-ui, sans-serif;
  --nf-font-body: 'DM Sans', system-ui, -apple-system, sans-serif;
  --nf-font-mono: 'JetBrains Mono', 'SF Mono', monospace;
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background:
    radial-gradient(900px 700px at 12% -10%, rgba(134,239,172,0.07), transparent 60%),
    radial-gradient(700px 500px at 92% 5%, rgba(143,168,255,0.05), transparent 60%),
    var(--nf-bg);
  color: var(--nf-fg-1);
  font-family: var(--nf-font-body);
  padding: 24px;
}
.nf-root * { box-sizing: border-box; }
.nf-topline {
  position: fixed; inset: 0 0 auto 0; height: 1px;
  background: linear-gradient(90deg, transparent, var(--nf-mint-line) 25%, var(--nf-mint-line) 75%, transparent);
  opacity: 0.55;
}
.nf-card {
  max-width: 480px; width: 100%; text-align: center;
  border: 1px solid var(--nf-line-2); border-radius: 18px;
  background: linear-gradient(180deg, rgba(255,255,255,0.025), transparent 60%), var(--nf-bg-2);
  box-shadow: 0 40px 80px rgba(0,0,0,0.45);
  padding: 48px 36px;
}
.nf-brand { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 28px; }
.nf-code {
  font-family: var(--nf-font-mono); font-size: 13px; color: var(--nf-mint);
  text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 10px;
}
.nf-headline {
  font-family: var(--nf-font-display); font-weight: 700; font-size: 32px;
  letter-spacing: -0.02em; margin: 0 0 12px; color: var(--nf-fg-1);
}
.nf-sub { font-size: 15px; color: var(--nf-fg-2); line-height: 1.6; margin: 0 0 28px; }
.nf-cta-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.nf-btn {
  font-family: var(--nf-font-body); font-weight: 600; font-size: 14px;
  border-radius: 10px; padding: 11px 20px; cursor: pointer; border: 1px solid transparent;
  transition: transform 150ms, background 150ms, border-color 150ms, color 150ms;
}
.nf-btn-primary { background: var(--nf-mint); color: #0a1410; border-color: var(--nf-mint); }
.nf-btn-primary:hover { background: var(--nf-mint-strong); border-color: var(--nf-mint-strong); }
.nf-btn-ghost { background: transparent; color: var(--nf-fg-2); border-color: var(--nf-line-2); }
.nf-btn-ghost:hover { color: var(--nf-fg-1); border-color: var(--nf-fg-2); }
`;
