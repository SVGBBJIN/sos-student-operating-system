import React, { useState, useEffect } from 'react';
import Icon from '../lib/icons';
import {
  buildOnboardingDraft,
  draftToRecurringRows,
  COUNT_OPTIONS,
  DURATION_OPTIONS,
} from '../lib/onboardingDraft';

/*
 * SOS Onboarding — three-question setup → seven-day reactive calibration.
 *
 * Runs once, cold. Three tap-based questions draft a weekly skeleton; the kid
 * calibrates it day by day. The motion celebrates the plan clicking into place,
 * never the kid for completing a step. Voice throughout: terse, dry, high-tech,
 * on the kid's side. Never cheerful, never parental.
 *
 * The component owns the experience and hands a finished, calibrated week back
 * to the app via onComplete(); the app owns the Supabase writes.
 */

const KIND_META = {
  school: { color: 'var(--blue)', tint: 'rgba(78,164,255,0.16)', tag: 'committed' },
  commitment: { color: 'var(--orange)', tint: 'rgba(255,159,67,0.16)', tag: 'committed' },
  focus: { color: 'var(--accent)', tint: 'rgba(56,216,232,0.14)', tag: 'draft' },
  break: { color: 'var(--text-dim)', tint: 'rgba(201,216,255,0.08)', tag: 'draft' },
  lighter: { color: 'var(--violet)', tint: 'rgba(124,141,255,0.14)', tag: 'draft' },
};

const Q3_PLACEHOLDER = 'touching grass';

const BUILD_MSGS = [
  'Locking in your commitments…',
  'Placing study windows…',
  'Balancing the week…',
  'Filling the gaps…',
  'Almost there…',
];

export default function Onboarding({ firstName, onComplete, onSkip }) {
  const [phase, setPhase] = useState('intro');
  const [count, setCount] = useState(null);
  const [durationId, setDurationId] = useState(null);
  const [q3, setQ3] = useState('');
  const [draft, setDraft] = useState([]);
  const [buildStep, setBuildStep] = useState(0);

  const durationMinutes = DURATION_OPTIONS.find((d) => d.id === durationId)?.minutes || 90;

  function beginAssembly(q3val) {
    const d = buildOnboardingDraft({ commitmentCount: count, commitmentMinutes: durationMinutes });
    setDraft(d);
    setQ3((q3val ?? q3).trim());
    setBuildStep(0);
    setPhase('assembling');
  }

  useEffect(() => {
    if (phase !== 'assembling') return;
    let step = 0;
    const reveal = setInterval(() => {
      step += 1;
      setBuildStep(step);
      if (step >= 7) clearInterval(reveal);
    }, 280);
    const done = setTimeout(() => setPhase('finale'), 2800);
    return () => { clearInterval(reveal); clearTimeout(done); };
  }, [phase]);

  function finish() {
    const rows = draftToRecurringRows(draft);
    onComplete({
      days: draft,
      rows,
      count,
      durationId,
      commitmentMinutes: durationMinutes,
      q3: q3 || null,
      signals: [],
    });
  }

  // ── Shell ──────────────────────────────────────────────────────────────
  const overlay = (children) => (
    <div className="sos-onb-overlay" role="dialog" aria-modal="true" aria-label="Set up your week">
      <div className="sos-onb-grid-bg" aria-hidden="true" />
      <div className="sos-onb-stage">{children}</div>
    </div>
  );

  // ── Intro ──
  if (phase === 'intro') {
    return overlay(
      <div className="sos-onb-card sos-onb-puzzle-card sos-onb-fade" style={{ textAlign: 'center', maxWidth: 440 }}>
        <div style={{ color: 'var(--accent)', display: 'flex', justifyContent: 'center', marginBottom: 14 }}>{Icon.calendarClock(34)}</div>
        <h1 className="sos-onb-h1">{firstName ? `${firstName}. Let's build your week.` : "Let's build your week."}</h1>
        <p className="sos-onb-sub">Three taps. I draft the rest. Under two minutes — no forms.</p>
        <button className="sos-onb-primary" onClick={() => setPhase('q1')}>
          Begin {Icon.arrowRight(16)}
        </button>
        <button className="sos-onb-ghost" onClick={onSkip}>Skip setup</button>
      </div>
    );
  }

  // ── Q1: count ──
  if (phase === 'q1') {
    return overlay(
      <div className="sos-onb-card sos-onb-puzzle-card sos-onb-fade">
        <div className="sos-onb-step">Question 1 / 3</div>
        <h2 className="sos-onb-h2">How many after-school commitments?</h2>
        <p className="sos-onb-sub">Sports, a job, clubs — whatever owns your afternoons.</p>
        <div className="sos-onb-options" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              className={`sos-onb-opt ${count === n ? 'sel' : ''}`}
              onClick={() => { setCount(n); setPhase('q2'); }}
            >
              <span style={{ fontSize: '1.4rem', fontWeight: 700 }}>{n === 5 ? '5+' : n}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Q2: duration ──
  if (phase === 'q2') {
    return overlay(
      <div className="sos-onb-card sos-onb-puzzle-card sos-onb-fade">
        <div className="sos-onb-step">Question 2 / 3</div>
        <h2 className="sos-onb-h2">How long do they run?</h2>
        <p className="sos-onb-sub">Ballpark. I'll leave room either way.</p>
        <div className="sos-onb-options" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          {DURATION_OPTIONS.map((d) => (
            <button
              key={d.id}
              className={`sos-onb-opt ${durationId === d.id ? 'sel' : ''}`}
              onClick={() => { setDurationId(d.id); setPhase('q3'); }}
            >
              <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{d.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Q3: whimsy (tone only) ──
  if (phase === 'q3') {
    return overlay(
      <div className="sos-onb-card sos-onb-puzzle-card sos-onb-fade">
        <div className="sos-onb-step">Question 3 / 3 · optional</div>
        <h2 className="sos-onb-h2">What would you rather be doing than homework?</h2>
        <p className="sos-onb-sub">Stays between us. Doesn't touch your schedule.</p>
        <input
          className="sos-onb-input"
          autoFocus
          value={q3}
          placeholder={Q3_PLACEHOLDER}
          maxLength={80}
          onChange={(e) => setQ3(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') beginAssembly(); }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="sos-onb-ghost" style={{ flex: 1, margin: 0 }} onClick={() => { setQ3(''); beginAssembly(''); }}>Skip</button>
          <button className="sos-onb-primary" style={{ flex: 2, margin: 0 }} onClick={() => beginAssembly()}>
            Draft my week {Icon.arrowRight(16)}
          </button>
        </div>
      </div>
    );
  }

  // ── Building schedule animation ──
  if (phase === 'assembling') {
    const msgIndex = Math.min(Math.floor(buildStep / 1.5), BUILD_MSGS.length - 1);
    return overlay(
      <div className="sos-onb-card sos-onb-puzzle-card sos-onb-fade" style={{ textAlign: 'center', maxWidth: 420 }}>
        <div className="sos-onb-build-grid" aria-hidden="true">
          {draft.length > 0 ? draft.map((day, i) => (
            <div key={day.dow} className="sos-onb-build-col" style={{ '--i': i }}>
              <div className="sos-onb-build-stack">
                {day.blocks.length === 0 ? (
                  <span className="sos-onb-build-bar" style={{ background: 'var(--border)', opacity: 0.18, height: 10 }} />
                ) : day.blocks.map((b) => {
                  const meta = KIND_META[b.kind] || KIND_META.focus;
                  return (
                    <span
                      key={b.id}
                      className={`sos-onb-build-bar ${buildStep > i ? 'sos-onb-build-bar-lit' : ''}`}
                      style={{
                        '--bar-color': meta.color,
                        opacity: buildStep > i ? (b.committed ? 0.95 : 0.55) : 0.12,
                      }}
                    />
                  );
                })}
              </div>
              <span className="sos-onb-week-label" style={{ opacity: buildStep > i ? 1 : 0.3, transition: 'opacity 0.25s' }}>{day.key}</span>
            </div>
          )) : Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="sos-onb-build-col" style={{ '--i': i }}>
              <div className="sos-onb-build-stack">
                <span className="sos-onb-build-bar" style={{ background: 'var(--border)', opacity: 0.15, height: 14 }} />
                <span className="sos-onb-build-bar" style={{ background: 'var(--border)', opacity: 0.15, height: 10 }} />
              </div>
              <span className="sos-onb-week-label" style={{ opacity: 0.2 }}>—</span>
            </div>
          ))}
        </div>
        <h2 className="sos-onb-h2" style={{ marginTop: 24 }}>Building your week…</h2>
        <p key={msgIndex} className="sos-onb-sub sos-onb-build-msg">{BUILD_MSGS[msgIndex]}</p>
      </div>
    );
  }

  // ── Finale ──
  if (phase === 'finale') {
    const jarvis = q3 ? `Week's set. Now go ${q3}.` : "Week's set. Go find something that isn't homework.";
    return overlay(
      <div className="sos-onb-card sos-onb-puzzle-card sos-onb-fade" style={{ maxWidth: 480, textAlign: 'center' }}>
        <div className="sos-onb-week" aria-hidden="true">
          {draft.map((d, i) => (
            <div key={d.dow} className="sos-onb-week-col" style={{ '--i': i }}>
              <span className="sos-onb-week-label">{d.key}</span>
              <div className="sos-onb-week-stack">
                {d.blocks.map((b) => {
                  const meta = KIND_META[b.kind] || KIND_META.focus;
                  return <span key={b.id} className="sos-onb-week-bar" style={{ background: meta.color, opacity: b.committed ? 0.95 : 0.5 }} />;
                })}
              </div>
            </div>
          ))}
        </div>
        <h1 className="sos-onb-h1" style={{ marginTop: 22 }}>{jarvis}</h1>
        <p className="sos-onb-sub">Your week's in. I'll keep what's certain and learn the rest as you go.</p>
        <button className="sos-onb-primary" onClick={finish}>Drop me in {Icon.arrowRight(16)}</button>
      </div>
    );
  }

  return null;
}
