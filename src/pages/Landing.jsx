import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BrandMark from '../components/BrandMark.jsx';

/* ─── Inline icon set (2px stroke, currentColor) ─────────────── */
const Icon = ({ name, size = 18, sw = 1.75 }) => {
  const p = {
    calendar:  <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>,
    book:      <><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5z"/><path d="M8 7h8M8 11h8M8 15h5"/></>,
    check:     <><path d="M4 12l5 5L20 6"/></>,
    arrow:     <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    plus:      <><path d="M12 5v14M5 12h14"/></>,
    paperclip: <><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-2.8-2.8L14 8"/></>,
    mic:       <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>,
    arrowUp:   <><path d="M12 19V5M6 11l6-6 6 6"/></>,
    bell:      <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9zM10 21a2 2 0 0 0 4 0"/></>,
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
         strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[name]}
    </svg>
  );
};

/* ─── Scene controller — drives all the children ─────────────── */
const SCENES = [
  { id: 'compose', dur: 7000, di: { state: 'idle',     label: 'idle' } },
  { id: 'focus',   dur: 6500, di: { state: 'focus',    label: 'focus · 25:00' } },
  { id: 'quiz',    dur: 6500, di: { state: 'thinking', label: 'quiz · derivatives' } },
  { id: 'notif',   dur: 5000, di: { state: 'idle',     label: 'synced' } },
];

function useScene(paused) {
  const [scene, setScene] = useState(0);
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setScene(s => (s + 1) % SCENES.length), SCENES[scene].dur);
    return () => clearTimeout(t);
  }, [scene, paused]);
  return scene;
}

/* ─── Mouse-follow tilt on the shared 3D stage ───────────────── */
function useTilt() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = (e.clientX - cx) / r.width;
      const dy = (e.clientY - cy) / r.height;
      const rx = 4 + (-dy * 6);
      const ry = -11 + (dx * 10);
      el.style.setProperty('--rx', rx.toFixed(2) + 'deg');
      el.style.setProperty('--ry', ry.toFixed(2) + 'deg');
    };
    const reset = () => {
      el.style.setProperty('--rx', '4deg');
      el.style.setProperty('--ry', '-11deg');
    };
    window.addEventListener('mousemove', handle);
    el.addEventListener('mouseleave', reset);
    return () => {
      window.removeEventListener('mousemove', handle);
      el.removeEventListener('mouseleave', reset);
    };
  }, []);
  return ref;
}

/* ─── Typewriter for the compose scene ───────────────────────── */
function useTypewriter(active, full, delayStart = 200, speed = 60) {
  const [out, setOut] = useState('');
  useEffect(() => {
    if (!active) { setOut(''); return; }
    let iv;
    const t0 = setTimeout(() => {
      let i = 0;
      iv = setInterval(() => {
        i++;
        setOut(full.slice(0, i));
        if (i >= full.length) clearInterval(iv);
      }, speed);
    }, delayStart);
    return () => { clearTimeout(t0); if (iv) clearInterval(iv); };
  }, [active, full, delayStart, speed]);
  return out;
}

/* ─── The studio panel — mirrors the real studio kit ─────────── */
function StudioPanel({ scene, onHoverChange }) {
  const composing = scene === 0;
  const typed = useTypewriter(composing, 'study plan for friday', 600, 65);
  const typedDone = typed === 'study plan for friday';

  const [aiReady, setAiReady] = useState(false);
  const [pillReady, setPillReady] = useState(false);
  useEffect(() => {
    if (!composing) { setAiReady(false); setPillReady(false); return; }
    const t1 = setTimeout(() => setAiReady(true), 3300);
    const t2 = setTimeout(() => setPillReady(true), 4800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [composing]);

  const di = SCENES[scene].di;

  return (
    <div
      className="ld-panel"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div className="ld-p-topbar">
        <div className="ld-p-brand">
          <BrandMark fontSize={16} />
          <span>S<span className="o">O</span>S</span>
          <span className="ld-p-pill">studio</span>
        </div>
        <div className="ld-p-meta">
          <span className="ld-p-sync">saved</span>
          <span className="ld-p-clock">9:41</span>
        </div>
      </div>

      <div className="ld-p-body">
        {/* Sidebar */}
        <div className="ld-p-side">
          {/* Dynamic Island */}
          <div className="ld-di">
            <span className="ld-di-time">9:41</span>
            <span className="ld-di-sep"></span>
            <span className={"ld-di-state " + (di.state === 'thinking' ? 'thinking' : di.state === 'focus' ? 'focus' : '')}>
              {di.label}
              {di.state === 'thinking' && (
                <span className="ld-di-dots"><span></span><span></span><span></span></span>
              )}
            </span>
          </div>

          {/* New chat */}
          <div className="ld-p-new">
            <Icon name="plus" size={12} />
            <span>New chat</span>
          </div>

          {/* Folders */}
          <div>
            <div className="ld-p-section-label">Projects</div>
            <div className="ld-p-folders">
              <div className="ld-p-folder active" data-tone="math"><span className="blob"/><span className="name">Calc</span><span className="count">12</span></div>
              <div className="ld-p-folder" data-tone="english"><span className="blob"/><span className="name">English</span><span className="count">8</span></div>
              <div className="ld-p-folder" data-tone="physics"><span className="blob"/><span className="name">Physics</span><span className="count">5</span></div>
              <div className="ld-p-folder" data-tone="review"><span className="blob"/><span className="name">Review</span><span className="count">3</span></div>
              <div className={"ld-p-folder new" + (pillReady && composing ? ' show' : '')} data-tone="math">
                <span className="blob"/><span className="name">Fri · Study night</span><span className="count">new</span>
              </div>
            </div>
          </div>
        </div>

        {/* Chat */}
        <div className="ld-p-chat">
          <div className="ld-p-chat-spacer"/>

          {scene === 0 && (
            <>
              <div className="ld-p-bubble user">
                {typed || ' '}
                {!typedDone && <span className="ld-caret"/>}
              </div>
              <div className={"ld-p-bubble ai" + (aiReady ? ' show' : '')}>
                {aiReady ? (
                  <>
                    <span className="ld-check">✓</span>
                    <span>added 3 study blocks for friday</span>
                  </>
                ) : typedDone ? (
                  <span className="ld-dots"><span/><span/><span/></span>
                ) : null}
              </div>
            </>
          )}

          {scene === 1 && (
            <>
              <div className="ld-p-bubble user">start a focus session</div>
              <div className="ld-p-bubble ai show">
                <span className="ld-check">✓</span>
                <span>25-min focus running</span>
              </div>
            </>
          )}

          {scene === 2 && (
            <>
              <div className="ld-p-bubble user">quiz me on derivatives</div>
              <div className="ld-p-bubble ai show">
                <span className="ld-check">✓</span>
                <span>5-card set ready</span>
              </div>
            </>
          )}

          {scene === 3 && (
            <>
              <div className="ld-p-bubble user">make me a study guide for the calc midterm</div>
              <div className="ld-p-bubble ai show">
                <span className="ld-check">✓</span>
                <span>saved to Calc</span>
              </div>
            </>
          )}

          <div className="ld-p-comp">
            <span className="ld-p-iconbtn"><Icon name="paperclip" size={12} /></span>
            <span className="ld-p-input">ask sos anything…</span>
            <span className="ld-p-iconbtn"><Icon name="mic" size={12} /></span>
            <span className="ld-p-send"><Icon name="arrowUp" size={11} sw={2.5} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Floating Focus timer (scene 1) ─────────────────────────── */
function FloatTimer({ active }) {
  const [secs, setSecs] = useState(25 * 60);
  useEffect(() => {
    if (!active) { setSecs(25 * 60); return; }
    const iv = setInterval(() => setSecs(s => Math.max(0, s - 60)), 700);
    return () => clearInterval(iv);
  }, [active]);
  const fmt = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  return (
    <div className={'ld-float ld-timer' + (active ? ' show' : '')}>
      <div className="lab">Focus</div>
      <div className="ring-wrap">
        <div className="ring"/>
        <div className="num">{fmt(secs)}</div>
      </div>
      <div className="sub2">calc · midterm</div>
    </div>
  );
}

/* ─── Floating flashcard (scene 2) ───────────────────────────── */
function FloatCard({ active }) {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    if (!active) { setFlipped(false); return; }
    const t = setTimeout(() => setFlipped(true), 1600);
    return () => clearTimeout(t);
  }, [active]);
  return (
    <div className={'ld-float ld-card' + (active ? ' show' : '') + (flipped ? ' flipped' : '')}>
      <div className="flip">
        <div className="face">
          <div className="lab">card 1 of 5</div>
          <div className="q">What's d/dx of e^x?</div>
        </div>
        <div className="face back">
          <div className="lab">answer</div>
          <div className="a">e^x</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Floating notification (scene 3) ────────────────────────── */
function FloatNotif({ active }) {
  return (
    <div className={'ld-float ld-notif' + (active ? ' show' : '')}>
      <div className="icon"><Icon name="bell" size={16} /></div>
      <div className="stack">
        <div className="top">just now</div>
        <div className="bot">Study guide saved to <strong>Calc</strong></div>
      </div>
    </div>
  );
}

/* ─── 3D stage that hosts the panel + pop-ups ────────────────── */
function HeroStage() {
  const [hover, setHover] = useState(false);
  const scene = useScene(hover);
  const tiltRef = useTilt();

  return (
    <div className="ld-stage" aria-hidden="true">
      <div ref={tiltRef} className={'ld-stage-3d' + (hover ? ' hover' : '')}>
        <StudioPanel scene={scene} onHoverChange={setHover} />
        <FloatTimer active={scene === 1} />
        <FloatCard  active={scene === 2} />
        <FloatNotif active={scene === 3} />
      </div>
      <div className="ld-scene-row">
        {SCENES.map((_, i) => (
          <span key={i} className={'ld-scene-dot' + (i === scene ? ' on' : '')}/>
        ))}
      </div>
    </div>
  );
}

/* ─── Landing Page ───────────────────────────────────────────── */
export default function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'SOS — Student Operating System';
  }, []);

  function go(path) {
    return (e) => { e?.preventDefault?.(); navigate(path); };
  }

  return (
    <div className="ld-root">
      <style>{LANDING_CSS}</style>

      <div className="ld-topline"/>

      <nav className="ld-nav ld-fade-up">
        <div className="ld-nav-brand">
          <span className="sos-brand-mark" style={{ borderRadius: 7, padding: 4, borderColor: 'rgba(255,255,255,0.16)' }}>
            <img src="/brain-logo.svg" alt="" width="20" height="20" />
          </span>
          <span className="sos-brand-word" style={{ fontSize: 17, color: 'var(--ld-fg-1)' }}>S<em>O</em>S</span>
        </div>
        <div className="ld-nav-links">
          <a href="#features" onClick={(e) => { e.preventDefault(); document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); }}>features</a>
          <a href="#privacy" onClick={(e) => { e.preventDefault(); document.getElementById('privacy')?.scrollIntoView({ behavior: 'smooth' }); }}>privacy</a>
          <a href="/studio" onClick={go('/studio')}>studio</a>
        </div>
        <button className="ld-nav-cta" onClick={go('/studio?auth=login')}>sign in</button>
      </nav>

      <section className="ld-hero">
        <div className="ld-hero-text">
          <div className="ld-eyebrow ld-fade-up" style={{ animationDelay: '40ms' }}>
            student operating system
          </div>
          <h1 className="ld-headline ld-fade-up" style={{ animationDelay: '120ms' }}>
            your brain.<em>organized.</em>
          </h1>
          <p className="ld-sub ld-fade-up" style={{ animationDelay: '200ms' }}>
            tasks, calendar, notes, study tools — one chat box instead of five tabs.
            type "pset due friday" and it's just... on the calendar.
          </p>
          <div className="ld-cta-row ld-fade-up" style={{ animationDelay: '280ms' }}>
            <button className="ld-btn ld-btn-primary" onClick={go('/studio')}>
              enter studio
              <span className="arrow"><Icon name="arrow" size={16} /></span>
            </button>
            <button
              className="ld-btn ld-btn-ghost"
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            >
              see how it works
            </button>
          </div>
          <div className="ld-micro-row ld-fade-up" style={{ animationDelay: '360ms' }}>
            <span>free for students</span>
            <span className="sep"/>
            <span>no card required</span>
          </div>
        </div>

        <HeroStage />
      </section>

      <section className="ld-mechanic">
        <div className="ld-mechanic-inner">
          <div className="ld-mechanic-in">
            <div className="lab">you type</div>
            <div className="txt">"pset due friday, and block 2hrs for calc review tmrw"</div>
          </div>
          <div className="ld-mechanic-arrow"><Icon name="arrow" size={20} /></div>
          <div className="ld-mechanic-out">
            <div className="lab">sos does</div>
            <div className="chips">
              <span className="chip">✓ task added — due fri</span>
              <span className="chip">✓ block scheduled — tmrw 2h</span>
            </div>
          </div>
        </div>
      </section>

      <section className="ld-features" id="features">
        <h2>everything, one surface.</h2>
        <p className="ld-lede">no more tab-juggling between notion, calendar, and a flashcard app — sos unifies the surfaces that matter, and the AI does the busywork.</p>
        <div className="ld-showcase">
          <div className="ld-showcase-panel" aria-hidden="true">
            <div className="ld-sc-row">
              <div className="ld-sc-col">
                <div className="ld-sc-head"><Icon name="calendar" size={13} /> calendar</div>
                <div className="ld-sc-line"><span className="dot cal"/> calc review · 2:00–4:00</div>
                <div className="ld-sc-line"><span className="dot cal"/> swim practice · 5:30</div>
              </div>
              <div className="ld-sc-col">
                <div className="ld-sc-head"><Icon name="book" size={13} /> library</div>
                <div className="ld-sc-line"><span className="dot lib"/> derivatives — 12 cards</div>
                <div className="ld-sc-line"><span className="dot lib"/> midterm study guide</div>
              </div>
              <div className="ld-sc-col">
                <div className="ld-sc-head"><Icon name="check" size={13} /> tasks</div>
                <div className="ld-sc-line"><span className="dot task"/> pset 4 — due fri</div>
                <div className="ld-sc-line"><span className="dot task"/> lab writeup — due mon</div>
              </div>
            </div>
          </div>
          <div className="ld-showcase-callouts">
            <div className="ld-callout"><span className="dot cal"/> <strong>smart calendar</strong> — imports from Google, suggests study blocks, keeps you on track quietly.</div>
            <div className="ld-callout"><span className="dot lib"/> <strong>one library</strong> — notes, lessons, flashcards, AI podcasts, all searchable in one place.</div>
            <div className="ld-callout"><span className="dot task"/> <strong>task manager</strong> — natural language in, structured deadlines out.</div>
          </div>
        </div>
      </section>

      <section className="ld-privacy" id="privacy">
        <div className="ld-privacy-card">
          <div>
            <h4>privacy & data usage</h4>
            <p>read how sos handles account, calendar, and study data.</p>
          </div>
          <a className="read" href="/privacy.html">view policy →</a>
        </div>
      </section>

      <footer className="ld-footer">
        <div className="ft">made for students · powered by Claude · © 2026 SOS</div>
      </footer>
    </div>
  );
}

/* ─── Scoped CSS (keeps the page decoupled from the studio app) ── */
const LANDING_CSS = `
.ld-root {
  /* Scoped tokens — match the design bundle's dark palette */
  --ld-bg:        #0f1115;
  --ld-bg-2:      #12151e;
  --ld-bg-3:      #1a1f2b;
  --ld-fg-1:      #f0f2f6;
  --ld-fg-2:      #9aa3b8;
  --ld-fg-3:      rgba(240,242,246,0.50);
  --ld-line:      rgba(255,255,255,0.07);
  --ld-line-2:    rgba(255,255,255,0.14);
  --ld-mint:      #86efac;
  --ld-mint-strong: #a8f3c2;
  --ld-mint-bg:   rgba(134,239,172,0.14);
  --ld-mint-line: rgba(134,239,172,0.45);
  --ld-warning:   #fbbf24;
  --ld-accent-strong: #b6c6ff;
  --ld-font-display: 'Syne', system-ui, sans-serif;
  --ld-font-body:    'DM Sans', system-ui, -apple-system, sans-serif;
  --ld-font-mono:    'JetBrains Mono', 'SF Mono', monospace;
  --ld-r-md: 10px;
  --ld-ease-out: cubic-bezier(0.4, 0, 0.2, 1);

  min-height: 100vh;
  background:
    radial-gradient(900px 700px at 12% -10%, rgba(134,239,172,0.07), transparent 60%),
    radial-gradient(700px 500px at 92%  5%, rgba(143,168,255,0.05), transparent 60%),
    var(--ld-bg);
  color: var(--ld-fg-1);
  font-family: var(--ld-font-body);
  overflow-x: hidden;
}
.ld-root * { box-sizing: border-box; }

.ld-topline {
  position: fixed; inset: 0 0 auto 0; height: 1px; z-index: 10;
  background: linear-gradient(90deg, transparent, var(--ld-mint-line) 25%, var(--ld-mint-line) 75%, transparent);
  opacity: 0.55;
}

/* ── Nav ─────────────────────────────────────────────────── */
.ld-nav {
  position: relative; z-index: 8;
  max-width: 1280px; margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  padding: 22px 32px;
}
.ld-nav-brand { display: flex; align-items: center; gap: 10px; }
.ld-nav-brand img { width: 24px; height: 24px; }
.ld-nav-brand .word {
  font-family: var(--ld-font-display); font-weight: 800; font-size: 18px;
  letter-spacing: -0.02em; color: var(--ld-fg-1);
}
.ld-nav-brand .word em { color: var(--ld-mint); font-style: normal; }
.ld-nav-links { display: flex; gap: 28px; }
.ld-nav-links a {
  font-size: 13px; color: var(--ld-fg-2); text-decoration: none;
  transition: color 150ms var(--ld-ease-out);
}
.ld-nav-links a:hover { color: var(--ld-fg-1); }
.ld-nav-cta {
  font-family: var(--ld-font-body); font-weight: 500; font-size: 13px;
  color: var(--ld-mint); background: transparent;
  border: 1px solid var(--ld-mint-line); border-radius: var(--ld-r-md);
  padding: 7px 14px; cursor: pointer;
  transition: background 150ms var(--ld-ease-out), border-color 150ms var(--ld-ease-out);
}
.ld-nav-cta:hover { background: var(--ld-mint-bg); border-color: var(--ld-mint); }
@media (max-width: 640px) {
  .ld-nav { padding: 16px 20px; }
  .ld-nav-links { display: none; }
}

/* ── Hero stage ──────────────────────────────────────────── */
.ld-hero {
  position: relative;
  max-width: 1280px; margin: 0 auto;
  padding: 24px 32px 140px;
  min-height: 660px;
}
.ld-hero-text { position: relative; z-index: 6; max-width: 740px; }
.ld-eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--ld-font-mono); font-size: 11px; color: var(--ld-fg-3);
  text-transform: uppercase; letter-spacing: 0.12em;
}
.ld-eyebrow::before {
  content: ''; width: 6px; height: 6px; border-radius: 50%;
  background: var(--ld-mint); box-shadow: 0 0 12px var(--ld-mint);
}
.ld-headline {
  font-family: var(--ld-font-display); font-weight: 700;
  font-size: clamp(40px, 5.5vw, 84px); line-height: 1.02;
  letter-spacing: -0.04em; color: var(--ld-fg-1);
  margin: 18px 0 0;
}
.ld-headline em {
  color: var(--ld-mint); font-style: italic; font-weight: 700;
  display: block;
}
.ld-sub {
  font-size: 17px; color: var(--ld-fg-2); line-height: 1.6;
  margin: 28px 0 0; max-width: 44ch;
}
.ld-cta-row { display: flex; gap: 12px; margin-top: 32px; flex-wrap: wrap; align-items: center; }
.ld-btn {
  font-family: var(--ld-font-body); font-weight: 600; font-size: 14px;
  border-radius: var(--ld-r-md); padding: 13px 22px;
  cursor: pointer; border: 1px solid transparent;
  display: inline-flex; align-items: center; gap: 8px;
  transition: transform 150ms var(--ld-ease-out), background 150ms var(--ld-ease-out),
              border-color 150ms var(--ld-ease-out), color 150ms var(--ld-ease-out);
}
.ld-btn .arrow { transition: transform 200ms var(--ld-ease-out); display: inline-block; }
.ld-btn:hover .arrow { transform: translateX(3px); }
.ld-btn-primary { background: var(--ld-mint); color: #0a1410; border-color: var(--ld-mint); }
.ld-btn-primary:hover { background: var(--ld-mint-strong); border-color: var(--ld-mint-strong); }
.ld-btn-ghost { background: transparent; color: var(--ld-fg-2); border-color: var(--ld-line-2); }
.ld-btn-ghost:hover { color: var(--ld-fg-1); border-color: var(--ld-fg-3); background: rgba(255,255,255,0.02); }
.ld-micro-row {
  margin-top: 22px; display: flex; align-items: center; gap: 12px;
  font-family: var(--ld-font-mono); font-size: 11px; color: var(--ld-fg-3);
  text-transform: uppercase; letter-spacing: 0.10em;
}
.ld-micro-row .sep { width: 18px; height: 1px; background: var(--ld-line-2); }

/* ── 3D stage ────────────────────────────────────────────── */
.ld-stage {
  position: absolute;
  top: 40px; right: 0px;
  width: 700px; height: 480px;
  perspective: 1600px;
  perspective-origin: 30% 50%;
  z-index: 4;
  pointer-events: none;
}
.ld-stage > * { pointer-events: auto; }

.ld-stage-3d {
  position: absolute; inset: 0;
  transform-style: preserve-3d;
  transform: rotateX(var(--rx, 4deg)) rotateY(var(--ry, -11deg));
  transition: transform 600ms var(--ld-ease-out);
  animation: ld-stage-float 9s ease-in-out infinite;
  will-change: transform;
}
@keyframes ld-stage-float {
  0%, 100% { transform: rotateX(var(--rx, 4deg))                rotateY(var(--ry, -11deg))                 translateY(0); }
  50%      { transform: rotateX(calc(var(--rx, 4deg) - 1deg))   rotateY(calc(var(--ry, -11deg) + 1deg))    translateY(-6px); }
}

@media (max-width: 1180px) {
  .ld-stage { right: 0; width: 620px; height: 440px; opacity: 0.95; }
}
@media (max-width: 980px) {
  .ld-hero { padding-bottom: 560px; }
  .ld-stage { position: relative; top: 48px; right: auto; left: 50%; transform: translateX(-50%); width: min(680px, 100%); height: 520px; }
  .ld-hero-text { max-width: 100%; }
}

/* ── Studio panel mockup ─────────────────────────────────── */
.ld-panel {
  position: absolute; inset: 0;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255,255,255,0.025), transparent 60%), var(--ld-bg-2);
  border: 1px solid var(--ld-line-2);
  box-shadow:
    0 40px 80px rgba(0,0,0,0.55),
    0 0 0 1px rgba(255,255,255,0.02) inset,
    0 0 60px -10px rgba(134,239,172,0.10);
  transition: box-shadow 400ms var(--ld-ease-out);
  overflow: hidden;
}
.ld-stage-3d.hover .ld-panel {
  box-shadow:
    0 50px 100px rgba(0,0,0,0.65),
    0 0 0 1px var(--ld-mint-line) inset,
    0 0 80px -10px rgba(134,239,172,0.22);
}

.ld-p-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--ld-line);
  background: var(--ld-bg);
}
.ld-p-brand { display: flex; align-items: center; gap: 8px; font-family: var(--ld-font-display); font-weight: 800; font-size: 14px; }
.ld-p-brand .o { color: var(--ld-mint); }
.ld-p-pill {
  margin-left: 8px;
  font-family: var(--ld-font-mono); font-size: 9px; color: var(--ld-fg-3);
  text-transform: uppercase; letter-spacing: 0.10em;
  padding: 2px 8px; border: 1px solid var(--ld-line); border-radius: 999px;
}
.ld-p-meta { display: flex; align-items: center; gap: 10px; }
.ld-p-sync {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--ld-font-mono); font-size: 9px;
  color: var(--ld-mint); text-transform: uppercase; letter-spacing: 0.10em;
}
.ld-p-sync::before {
  content: ''; width: 5px; height: 5px; border-radius: 50%;
  background: var(--ld-mint); box-shadow: 0 0 6px var(--ld-mint);
}
.ld-p-clock { font-family: var(--ld-font-mono); font-size: 10px; color: var(--ld-fg-3); }

.ld-p-body { display: grid; grid-template-columns: 200px 1fr; height: calc(100% - 48px); }
.ld-p-side { padding: 14px 12px; border-right: 1px solid var(--ld-line); display: flex; flex-direction: column; gap: 14px; min-height: 0; }

/* Dynamic island */
.ld-di {
  background: #07090d; border-radius: 18px;
  padding: 8px 12px; display: flex; align-items: center; gap: 10px;
  min-height: 38px; color: #f0f2f6;
  border: 1px solid rgba(255,255,255,0.06);
  overflow: hidden;
  transition: height 320ms var(--ld-ease-out), background 320ms var(--ld-ease-out);
}
.ld-di-time { font-family: var(--ld-font-mono); font-size: 12px; font-weight: 500; flex-shrink: 0; }
.ld-di-sep { width: 1px; height: 12px; background: rgba(255,255,255,0.14); flex-shrink: 0; }
.ld-di-state {
  flex: 1; min-width: 0;
  font-family: var(--ld-font-mono); font-size: 9.5px;
  color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 0.10em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: color 220ms var(--ld-ease-out);
}
.ld-di-state.thinking { color: var(--ld-mint); }
.ld-di-state.focus { color: var(--ld-accent-strong); }
.ld-di-dots { display: inline-flex; gap: 3px; vertical-align: middle; margin-left: 4px; }
.ld-di-dots span {
  width: 3px; height: 3px; border-radius: 50%;
  background: currentColor; animation: ld-dotbounce 1.2s infinite;
}
.ld-di-dots span:nth-child(2) { animation-delay: 160ms; }
.ld-di-dots span:nth-child(3) { animation-delay: 320ms; }

/* New chat */
.ld-p-new {
  display: flex; align-items: center; gap: 8px;
  border: 1px dashed var(--ld-line-2); border-radius: 8px;
  padding: 7px 10px; color: var(--ld-fg-2); font-size: 11.5px;
  transition: all 220ms var(--ld-ease-out);
}
.ld-p-new:hover {
  color: var(--ld-mint-strong); border-color: var(--ld-mint-line);
  background: var(--ld-mint-bg); border-style: solid;
}

/* Folders */
.ld-p-section-label {
  font-family: var(--ld-font-mono); font-size: 9px; color: var(--ld-fg-3);
  text-transform: uppercase; letter-spacing: 0.12em;
  padding: 0 4px 4px;
}
.ld-p-folders { display: flex; flex-direction: column; gap: 2px; }
.ld-p-folder {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 6px;
  font-size: 12px; color: var(--ld-fg-2); cursor: default;
  transition: background 200ms var(--ld-ease-out), color 200ms var(--ld-ease-out);
}
.ld-p-folder:hover { background: var(--ld-bg-3); color: var(--ld-fg-1); }
.ld-p-folder.active { background: var(--ld-mint-bg); color: var(--ld-mint-strong); }
.ld-p-folder .blob { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--ld-fg-3); }
.ld-p-folder[data-tone="math"] .blob    { background: var(--ld-accent-strong); }
.ld-p-folder[data-tone="english"] .blob { background: #f9a8d4; }
.ld-p-folder[data-tone="physics"] .blob { background: var(--ld-warning); }
.ld-p-folder .name { flex: 1; }
.ld-p-folder .count { font-family: var(--ld-font-mono); font-size: 9.5px; color: var(--ld-fg-3); }
.ld-p-folder.active .count { color: var(--ld-mint); }
.ld-p-folder.new {
  opacity: 0; transform: translateY(8px); max-height: 0; overflow: hidden;
  padding-top: 0; padding-bottom: 0; pointer-events: none;
  transition: all 320ms var(--ld-ease-out);
}
.ld-p-folder.new.show {
  opacity: 1; transform: translateY(0); max-height: 32px;
  padding-top: 6px; padding-bottom: 6px;
}

/* Chat column */
.ld-p-chat { display: flex; flex-direction: column; padding: 14px 16px; gap: 8px; min-height: 0; overflow: hidden; }
.ld-p-chat-spacer { flex: 1; min-height: 0; }
.ld-p-bubble {
  border-radius: 10px; padding: 7px 11px; font-size: 11.5px; line-height: 1.5;
  max-width: 78%;
}
.ld-p-bubble.user {
  align-self: flex-end;
  background: var(--ld-mint-bg); color: var(--ld-mint-strong);
  border: 1px solid var(--ld-mint-line);
  min-width: 90px;
}
.ld-caret {
  display: inline-block; width: 1px; height: 12px; background: var(--ld-mint);
  vertical-align: -1px; margin-left: 1px; animation: ld-caret 1s steps(2) infinite;
}
@keyframes ld-caret { 50% { opacity: 0; } }
.ld-p-bubble.ai {
  background: var(--ld-bg-3); color: var(--ld-fg-2); border: 1px solid var(--ld-line);
  display: flex; align-items: center; gap: 8px;
  opacity: 0; transform: translateY(6px);
  transition: opacity 240ms var(--ld-ease-out), transform 240ms var(--ld-ease-out);
}
.ld-p-bubble.ai.show { opacity: 1; transform: translateY(0); }
.ld-check {
  flex: 0 0 14px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--ld-mint); display: inline-flex; align-items: center; justify-content: center;
  color: #0a1410; font-size: 9px; font-weight: 700;
}
.ld-dots { display: inline-flex; gap: 3px; }
.ld-dots span { width: 4px; height: 4px; border-radius: 50%; background: var(--ld-fg-3); animation: ld-dotbounce 1.2s infinite; }
.ld-dots span:nth-child(2) { animation-delay: 160ms; }
.ld-dots span:nth-child(3) { animation-delay: 320ms; }
@keyframes ld-dotbounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* Composer */
.ld-p-comp {
  flex-shrink: 0; margin-top: 8px;
  border: 1px solid var(--ld-line-2); border-radius: 14px;
  background: var(--ld-bg-3); padding: 6px 8px;
  display: flex; align-items: center; gap: 6px;
}
.ld-p-input { flex: 1; font-family: var(--ld-font-body); font-size: 11px; color: var(--ld-fg-3); padding: 4px 4px; }
.ld-p-send {
  width: 24px; height: 24px; border-radius: 6px;
  background: var(--ld-mint-bg); border: 1px solid var(--ld-mint-line);
  color: var(--ld-mint-strong); display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px;
}
.ld-p-iconbtn { width: 22px; height: 22px; color: var(--ld-fg-3); display: inline-flex; align-items: center; justify-content: center; }

/* ── Floating pop-ups ────────────────────────────────────── */
.ld-float {
  position: absolute;
  background: var(--ld-bg-3);
  border: 1px solid var(--ld-line-2);
  border-radius: 14px;
  box-shadow: 0 30px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.02) inset;
  opacity: 0;
  transform: translateZ(60px) translateY(12px) scale(0.95);
  transition: opacity 360ms var(--ld-ease-out), transform 360ms var(--ld-ease-out);
  backdrop-filter: blur(6px);
}
.ld-float.show { transform: translateZ(60px) translateY(0) scale(1); opacity: 1; }

.ld-timer {
  top: -18px; right: -48px;
  width: 168px; padding: 14px 14px 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.ld-timer .lab {
  font-family: var(--ld-font-mono); font-size: 9.5px; color: var(--ld-fg-3);
  text-transform: uppercase; letter-spacing: 0.12em;
  display: flex; align-items: center; gap: 6px;
}
.ld-timer .lab::before {
  content: ''; width: 5px; height: 5px; border-radius: 50%;
  background: var(--ld-mint); box-shadow: 0 0 8px var(--ld-mint);
  animation: ld-pulseDot 1.6s infinite ease-in-out;
}
@keyframes ld-pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.ld-timer .ring-wrap { display: flex; align-items: center; gap: 12px; }
.ld-timer .ring {
  width: 38px; height: 38px; border-radius: 50%;
  border: 2px solid var(--ld-line-2); border-top-color: var(--ld-mint);
  animation: ld-spin 3s linear infinite;
}
@keyframes ld-spin { to { transform: rotate(360deg); } }
.ld-timer .num {
  font-family: var(--ld-font-mono); font-weight: 600; font-size: 22px;
  color: var(--ld-mint); letter-spacing: 0.02em; font-variant-numeric: tabular-nums;
}
.ld-timer .sub2 {
  font-family: var(--ld-font-mono); font-size: 9.5px; color: var(--ld-fg-3);
  text-transform: uppercase; letter-spacing: 0.10em;
}

.ld-card {
  bottom: 24px; left: -88px;
  width: 224px; height: 140px;
  perspective: 600px;
  padding: 0;
  background: transparent; box-shadow: none; border: none;
  backdrop-filter: none;
}
.ld-card.show { transform: translateZ(60px) translateY(0) scale(1); }
.ld-card .flip {
  position: relative; width: 100%; height: 100%;
  transform-style: preserve-3d;
  transition: transform 700ms var(--ld-ease-out);
}
.ld-card.flipped .flip { transform: rotateY(180deg); }
.ld-card .face {
  position: absolute; inset: 0;
  background: var(--ld-bg-3); border: 1px solid var(--ld-line-2);
  border-radius: 14px; padding: 16px;
  display: flex; flex-direction: column; gap: 8px; justify-content: center;
  backface-visibility: hidden;
  box-shadow: 0 30px 50px rgba(0,0,0,0.5);
}
.ld-card .face.back { transform: rotateY(180deg); border-color: var(--ld-mint-line); background: var(--ld-mint-bg); }
.ld-card .lab {
  font-family: var(--ld-font-mono); font-size: 9.5px; color: var(--ld-fg-3);
  text-transform: uppercase; letter-spacing: 0.12em;
}
.ld-card .face.back .lab { color: var(--ld-mint); }
.ld-card .q { font-family: var(--ld-font-display); font-weight: 600; font-size: 16px; color: var(--ld-fg-1); letter-spacing: -0.01em; }
.ld-card .a { font-family: var(--ld-font-display); font-weight: 700; font-size: 22px; color: var(--ld-mint-strong); }

.ld-notif {
  top: -34px; right: 90px;
  width: 290px; padding: 12px 14px;
  display: flex; align-items: center; gap: 12px;
}
.ld-notif .icon {
  width: 32px; height: 32px; border-radius: 10px;
  background: var(--ld-mint-bg); border: 1px solid var(--ld-mint-line);
  color: var(--ld-mint); display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.ld-notif .stack { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ld-notif .top { font-family: var(--ld-font-mono); font-size: 9px; color: var(--ld-fg-3); text-transform: uppercase; letter-spacing: 0.12em; }
.ld-notif .bot { font-size: 12.5px; color: var(--ld-fg-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ld-notif .bot strong { color: var(--ld-mint-strong); font-weight: 600; }

/* Scene dots */
.ld-scene-row {
  position: absolute; bottom: -42px; left: 0; right: 0;
  display: flex; justify-content: center; gap: 8px;
  font-family: var(--ld-font-mono); font-size: 10px;
  color: var(--ld-fg-3); text-transform: uppercase; letter-spacing: 0.12em;
  align-items: center;
}
.ld-scene-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ld-line-2);
  transition: background 220ms var(--ld-ease-out), transform 220ms var(--ld-ease-out);
}
.ld-scene-dot.on { background: var(--ld-mint); transform: scale(1.2); }

/* ── Mechanic proof strip ────────────────────────────────── */
.ld-mechanic {
  border-top: 1px solid var(--ld-line); border-bottom: 1px solid var(--ld-line);
  background: rgba(255,255,255,0.012);
  margin-top: 16px;
}
.ld-mechanic-inner {
  max-width: 1100px; margin: 0 auto; padding: 28px 32px;
  display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap;
}
.ld-mechanic-in, .ld-mechanic-out { display: flex; flex-direction: column; gap: 6px; }
.ld-mechanic-in .lab, .ld-mechanic-out .lab {
  font-family: var(--ld-font-mono); font-size: 10px; color: var(--ld-fg-3);
  text-transform: uppercase; letter-spacing: 0.12em;
}
.ld-mechanic-in .txt {
  font-family: var(--ld-font-mono); font-size: 13px; color: var(--ld-fg-1);
  background: var(--ld-bg-2); border: 1px solid var(--ld-line-2); border-radius: 10px;
  padding: 10px 14px; max-width: 40ch;
}
.ld-mechanic-arrow { color: var(--ld-mint); flex-shrink: 0; }
.ld-mechanic-out .chips { display: flex; flex-direction: column; gap: 6px; }
.ld-mechanic-out .chip {
  font-family: var(--ld-font-mono); font-size: 12px; color: var(--ld-mint-strong);
  background: var(--ld-mint-bg); border: 1px solid var(--ld-mint-line); border-radius: 8px;
  padding: 6px 12px;
}
@media (max-width: 720px) { .ld-mechanic-inner { flex-direction: column; } .ld-mechanic-arrow { transform: rotate(90deg); } }

/* ── Features / unified showcase ─────────────────────────── */
.ld-features { max-width: 1100px; margin: 0 auto; padding: 96px 32px; }
.ld-features h2 { font-family: var(--ld-font-display); font-weight: 700; font-size: 32px; letter-spacing: -0.02em; margin: 0 0 8px; color: var(--ld-fg-1); }
.ld-lede { color: var(--ld-fg-2); font-size: 15px; max-width: 52ch; margin: 0 0 48px; }
.ld-showcase { display: flex; flex-direction: column; gap: 20px; }
.ld-showcase-panel {
  border: 1px solid var(--ld-line-2); border-radius: 16px;
  background: linear-gradient(180deg, rgba(255,255,255,0.02), transparent 60%), var(--ld-bg-2);
  padding: 22px; box-shadow: 0 30px 60px rgba(0,0,0,0.35);
}
.ld-sc-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
@media (max-width: 820px) { .ld-sc-row { grid-template-columns: 1fr; } }
.ld-sc-col { display: flex; flex-direction: column; gap: 8px; }
.ld-sc-head {
  display: flex; align-items: center; gap: 6px;
  font-family: var(--ld-font-mono); font-size: 11px; color: var(--ld-mint);
  text-transform: uppercase; letter-spacing: 0.10em;
  padding-bottom: 8px; border-bottom: 1px solid var(--ld-line);
}
.ld-sc-line { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ld-fg-2); }
.ld-sc-line .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot.cal { background: var(--ld-accent-strong); }
.dot.lib { background: #f9a8d4; }
.dot.task { background: var(--ld-mint); }
.ld-showcase-callouts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 820px) { .ld-showcase-callouts { grid-template-columns: 1fr; } }
.ld-callout { font-size: 13.5px; color: var(--ld-fg-2); line-height: 1.6; display: flex; gap: 8px; }
.ld-callout .dot { margin-top: 6px; }
.ld-callout strong { color: var(--ld-fg-1); font-weight: 700; }

/* ── Privacy + Footer ────────────────────────────────────── */
.ld-privacy { max-width: 1100px; margin: 0 auto 64px; padding: 0 32px; }
.ld-privacy-card {
  display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap;
  background: var(--ld-bg-2); border: 1px solid var(--ld-line); border-radius: 14px;
  padding: 22px 24px;
}
.ld-privacy-card h4 { font-family: var(--ld-font-display); font-weight: 700; font-size: 16px; margin: 0 0 4px; color: var(--ld-fg-1); }
.ld-privacy-card p { color: var(--ld-fg-2); font-size: 13px; margin: 0; }
.ld-privacy-card a.read {
  font-family: var(--ld-font-mono); font-size: 11px; color: var(--ld-mint);
  text-transform: uppercase; letter-spacing: 0.10em;
  border: 1px solid var(--ld-mint-line); border-radius: var(--ld-r-md);
  padding: 8px 12px; text-decoration: none;
  transition: background 150ms var(--ld-ease-out);
}
.ld-privacy-card a.read:hover { background: var(--ld-mint-bg); }
.ld-footer { border-top: 1px solid var(--ld-line); padding: 28px 32px; text-align: center; }
.ld-footer .ft { font-family: var(--ld-font-mono); font-size: 11px; color: var(--ld-fg-3); text-transform: uppercase; letter-spacing: 0.12em; }

@keyframes ld-fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.ld-fade-up { animation: ld-fadeUp 500ms var(--ld-ease-out) both; }
`;
