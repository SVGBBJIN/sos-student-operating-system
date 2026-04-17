import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sb } from '../lib/supabase.js';

/* ─── Decorative Studio Mockup ──────────────────────────────────── */
function StudioMockup() {
  return (
    <div style={{
      background: 'var(--card)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-lg)',
      border: '1px solid hsla(170, 50%, 50%, 0.15)',
      overflow: 'hidden',
      width: '100%',
      maxWidth: 480,
      fontFamily: 'var(--font-ui)',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '10px 14px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 10, height: 10,
            borderRadius: 'var(--radius-full)',
            background: 'var(--muted)',
            display: 'inline-block',
          }} />
        ))}
        <span style={{
          marginLeft: 8,
          fontSize: 11,
          color: 'var(--muted-foreground)',
          fontFamily: 'var(--font-ui)',
          letterSpacing: '0.06em',
        }}>studio</span>
      </div>

      {/* Three-column body */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1.4fr 0.8fr',
        gap: 10,
        padding: 14,
        minHeight: 160,
      }}>
        {/* Left — schedule pills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {['Math', 'English', 'Physics', 'Review'].map(label => (
            <div key={label} style={{
              background: 'var(--muted)',
              borderRadius: 'var(--radius-full)',
              height: 20,
              padding: '0 8px',
              display: 'flex',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: 9, color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)' }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Center — message bubbles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 10px',
          }}>
            <div style={{ height: 6, background: 'var(--muted)', borderRadius: 3, marginBottom: 4 }} />
            <div style={{ height: 6, background: 'var(--muted)', borderRadius: 3, width: '70%' }} />
          </div>
          <div style={{
            background: 'hsla(155, 25%, 55%, 0.30)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 10px',
            alignSelf: 'flex-end',
            maxWidth: '80%',
          }}>
            <div style={{ height: 6, background: 'hsla(155,25%,75%,0.5)', borderRadius: 3 }} />
          </div>
        </div>

        {/* Right — timer widget */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{
            fontFamily: 'var(--font-ui)',
            fontWeight: 700,
            fontSize: 20,
            color: 'var(--foreground)',
            letterSpacing: '-0.02em',
          }}>25:00</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Stat Card ──────────────────────────────────────────────────── */
function StatCard({ number, label, delay }) {
  return (
    <div
      data-stat={number}
      style={{
        background: 'var(--card)',
        borderRadius: 'var(--radius-md)',
        borderLeft: '3px solid var(--primary)',
        padding: 'var(--spacing-6)',
        flex: '1 1 0',
        animation: `fadeUp 0.35s ease-out both`,
        animationDelay: `${delay}ms`,
      }}
    >
      <div style={{
        fontFamily: 'var(--font-heading)',
        fontWeight: 700,
        fontSize: 36,
        color: 'var(--foreground)',
        lineHeight: 1.1,
      }}>{number}</div>
      <div style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 13,
        color: 'var(--muted-foreground)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginTop: 4,
      }}>{label}</div>
    </div>
  );
}

/* ─── Feature Card ───────────────────────────────────────────────── */
function FeatureCard({ icon, title, body, delay }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--card)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--spacing-6)',
        border: hovered
          ? '1px solid hsla(170,50%,50%,0.25)'
          : '1px solid transparent',
        boxShadow: hovered ? 'var(--shadow-md)' : 'none',
        transition: `border-color var(--duration-normal) ease-out,
                     box-shadow var(--duration-normal) ease-out`,
        animation: `fadeUp 0.3s ease-out both`,
        animationDelay: `${delay}ms`,
        cursor: 'default',
      }}
    >
      <div style={{
        width: 40, height: 40,
        borderRadius: 'var(--radius-full)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
      }}>{icon}</div>
      <div style={{
        fontFamily: 'var(--font-heading)',
        fontWeight: 700,
        fontSize: 16,
        color: 'var(--foreground)',
        marginTop: 'var(--spacing-3)',
      }}>{title}</div>
      <div style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 13,
        color: 'var(--muted-foreground)',
        lineHeight: 1.6,
        marginTop: 'var(--spacing-2)',
      }}>{body}</div>
    </div>
  );
}

/* ─── Landing Page ───────────────────────────────────────────────── */
export default function Landing() {
  const navigate = useNavigate();
  const [primaryBtnHovered, setPrimaryBtnHovered] = useState(false);

  useEffect(() => {
    document.title = 'SOS — Student Operating System';
  }, []);

  function handleEnterStudio() {
    navigate('/studio');
  }

  const features = [
    {
      icon: '📅',
      title: 'Smart Calendar',
      body: 'Imports from Google. Suggests study blocks. Keeps you on track.',
    },
    {
      icon: '🤖',
      title: 'AI Tutor',
      body: 'Three tutoring modes built for STEM, writing, and recall.',
    },
    {
      icon: '📚',
      title: 'Library',
      body: 'Notes, lessons, flashcards, and AI podcasts unified.',
    },
    {
      icon: '✅',
      title: 'Task Manager',
      body: 'Natural language task creation with deadline awareness.',
    },
  ];

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, hsl(220,25%,10%) 0%, hsl(222,26%,8%) 100%)',
      overflowX: 'hidden',
    }}>
      {/* Amber gradient top-of-viewport line */}
      <div style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        height: 2,
        background: 'linear-gradient(90deg, hsl(35,70%,50%), hsl(30,70%,55%))',
        zIndex: 100,
      }} />

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        padding: 'var(--spacing-16) var(--spacing-8)',
        maxWidth: 1200,
        margin: '0 auto',
        gap: 'var(--spacing-12)',
      }}>
        {/* Left column (55%) */}
        <div style={{ flex: '0 0 55%', minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--muted-foreground)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            animation: 'fadeUp 0.4s ease-out both',
            animationDelay: '0ms',
          }}>
            Student Operating System
          </div>

          <h1 style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 700,
            fontSize: 56,
            color: 'var(--foreground)',
            lineHeight: 1.1,
            margin: 'var(--spacing-4) 0 0',
            animation: 'fadeUp 0.4s ease-out both',
            animationDelay: '80ms',
            whiteSpace: 'pre-line',
          }}>
            {'Your brain.\nOrganized.'}
          </h1>

          <p style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 15,
            color: 'var(--muted-foreground)',
            maxWidth: 480,
            lineHeight: 1.65,
            marginTop: 'var(--spacing-4)',
            animation: 'fadeUp 0.4s ease-out both',
            animationDelay: '160ms',
          }}>
            Tasks, calendar, AI tutor, and study tools — built for the
            way students actually think.
          </p>

          <div style={{
            display: 'flex',
            gap: 'var(--spacing-3)',
            marginTop: 'var(--spacing-8)',
            animation: 'fadeUp 0.4s ease-out both',
            animationDelay: '240ms',
            flexWrap: 'wrap',
          }}>
            <button
              onClick={handleEnterStudio}
              onMouseEnter={() => setPrimaryBtnHovered(true)}
              onMouseLeave={() => setPrimaryBtnHovered(false)}
              style={{
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
                fontFamily: 'var(--font-heading)',
                fontWeight: 700,
                fontSize: 16,
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: '14px 28px',
                cursor: 'pointer',
                transition: `filter var(--duration-normal) ease-out,
                             box-shadow var(--duration-normal) ease-out`,
                filter: primaryBtnHovered ? 'brightness(1.1)' : 'brightness(1)',
                boxShadow: primaryBtnHovered ? 'var(--shadow-md)' : 'none',
              }}
            >
              Enter Studio →
            </button>
            <button
              onClick={() => {
                document.getElementById('sos-features')?.scrollIntoView({ behavior: 'smooth' });
              }}
              style={{
                background: 'transparent',
                border: '1px solid var(--primary)',
                color: 'var(--primary)',
                fontFamily: 'var(--font-ui)',
                fontSize: 14,
                borderRadius: 'var(--radius)',
                padding: '14px 24px',
                cursor: 'pointer',
                transition: `background var(--duration-normal) ease-out`,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'hsla(155,25%,55%,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              See how it works
            </button>
          </div>
        </div>

        {/* Right column (45%) — decorative mockup */}
        <div style={{
          flex: '0 0 45%',
          display: 'flex',
          justifyContent: 'center',
          animation: 'fadeUp 0.5s ease-out both',
          animationDelay: '120ms',
        }}>
          <StudioMockup />
        </div>
      </section>

      {/* ── STATS STRIP ──────────────────────────────────────── */}
      <section style={{
        background: 'var(--surface)',
        padding: 'var(--spacing-8) var(--spacing-8)',
      }}>
        <div style={{
          display: 'flex',
          gap: 'var(--spacing-6)',
          maxWidth: 900,
          margin: '0 auto',
        }}>
          <StatCard number="10,000+" label="Students using SOS" delay={0} />
          <StatCard number="500K+"   label="Tasks completed"   delay={80} />
          <StatCard number="98%"     label="Would recommend"   delay={160} />
        </div>
      </section>

      {/* ── FEATURES GRID ────────────────────────────────────── */}
      <section
        id="sos-features"
        style={{
          background: 'linear-gradient(160deg, hsl(220,25%,10%) 0%, hsl(222,26%,8%) 100%)',
          padding: 'var(--spacing-16) var(--spacing-8)',
        }}
      >
        <h2 style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 700,
          fontSize: 28,
          color: 'var(--foreground)',
          textAlign: 'center',
          marginBottom: 'var(--spacing-8)',
        }}>
          Everything you need in one place
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 'var(--spacing-6)',
          maxWidth: 840,
          margin: '0 auto',
        }}>
          {features.map((f, i) => (
            <FeatureCard key={f.title} {...f} delay={i * 60} />
          ))}
        </div>
      </section>

      <section style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '0 var(--spacing-8) var(--spacing-12)',
      }}>
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface)',
          padding: 'var(--spacing-6)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--spacing-4)',
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Privacy & data usage</div>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--muted-foreground)' }}>Read how SOS handles account, calendar, and study data.</div>
          </div>
          <a href="/privacy.html" style={{
            textDecoration: 'none',
            background: 'var(--primary)',
            color: 'var(--primary-foreground)',
            padding: '10px 14px',
            borderRadius: 'var(--radius)',
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
            fontWeight: 600,
          }}>
            View Privacy Policy
          </a>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer style={{
        background: 'var(--sidebar)',
        padding: 'var(--spacing-6) var(--spacing-8)',
        textAlign: 'center',
      }}>
        <span style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 12,
          color: 'var(--muted-foreground)',
        }}>
          Made for students. Powered by Claude. © 2025 SOS.
        </span>
      </footer>
    </div>
  );
}
