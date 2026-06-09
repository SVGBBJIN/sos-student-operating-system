import React, { useState, useEffect, useRef } from 'react';
import Icon from '../lib/icons';
import {
  buildOnboardingDraft,
  draftToRecurringRows,
  makeBlock,
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

function parseMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}
function lastEnd(blocks) {
  return blocks.reduce((mx, b) => Math.max(mx, parseMin(b.end)), 15 * 60 + 30);
}

function BlockChip({ block, animateIn, index, removable, onRemove }) {
  const meta = KIND_META[block.kind] || KIND_META.focus;
  return (
    <div
      className={animateIn ? 'sos-onb-block' : undefined}
      style={{
        '--i': index,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px', borderRadius: 12,
        background: meta.tint,
        border: `1px solid ${meta.color}`,
        borderLeft: `3px solid ${meta.color}`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>{block.name}</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
          {block.start}–{block.end}
        </span>
      </div>
      {block.committed ? (
        <span style={{ fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: meta.color, opacity: 0.85 }}>
          locked in
        </span>
      ) : removable ? (
        <button
          onClick={onRemove}
          title="Drop this block"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', padding: 2 }}
        >
          {Icon.x(15)}
        </button>
      ) : (
        <span style={{ fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: meta.color, opacity: 0.65 }}>
          draft
        </span>
      )}
    </div>
  );
}

export default function Onboarding({ firstName, onComplete, onSkip }) {
  const [phase, setPhase] = useState('intro');
  const [count, setCount] = useState(null);
  const [durationId, setDurationId] = useState(null);
  const [q3, setQ3] = useState('');
  const [draft, setDraft] = useState([]);
  const [dayIndex, setDayIndex] = useState(0);
  const [adjusting, setAdjusting] = useState(false);
  const [workingBlocks, setWorkingBlocks] = useState([]);
  const [lockedDays, setLockedDays] = useState([]);
  const [signals, setSignals] = useState([]);
  const [locking, setLocking] = useState(false);
  const advanceRef = useRef(null);

  const durationMinutes = DURATION_OPTIONS.find((d) => d.id === durationId)?.minutes || 90;

  // Build the draft once the three questions are answered, then run a brief
  // "assembling" beat before the day-by-day review.
  function beginAssembly(q3val) {
    const d = buildOnboardingDraft({ commitmentCount: count, commitmentMinutes: durationMinutes });
    setDraft(d);
    setQ3((q3val ?? q3).trim());
    setPhase('assembling');
  }

  useEffect(() => {
    if (phase !== 'assembling') return;
    const t = setTimeout(() => { setPhase('calibrate'); setDayIndex(0); }, 1700);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => () => { if (advanceRef.current) clearTimeout(advanceRef.current); }, []);

  const currentDay = draft[dayIndex];
  const shownBlocks = adjusting ? workingBlocks : (currentDay?.blocks || []);

  function lockDay(finalBlocks, clean) {
    if (locking) return;
    const day = draft[dayIndex];
    const dropped = (day.blocks || []).filter((b) => !finalBlocks.some((f) => f.id === b.id));
    const added = finalBlocks.filter((b) => !(day.blocks || []).some((o) => o.id === b.id));
    setLockedDays((prev) => [...prev, { ...day, blocks: finalBlocks }]);
    setSignals((prev) => [...prev, {
      dow: day.dow,
      day: day.label,
      approvedClean: clean,
      removed: dropped.map((b) => b.kind),
      added: added.map((b) => b.kind),
      blockCount: finalBlocks.length,
    }]);
    setLocking(true);
    advanceRef.current = setTimeout(() => {
      setLocking(false);
      setAdjusting(false);
      setWorkingBlocks([]);
      if (dayIndex >= draft.length - 1) setPhase('finale');
      else setDayIndex((i) => i + 1);
    }, 780);
  }

  function startAdjust() {
    setWorkingBlocks((currentDay.blocks || []).map((b) => ({ ...b })));
    setAdjusting(true);
  }
  function removeWorking(id) {
    setWorkingBlocks((prev) => prev.filter((b) => b.id !== id));
  }
  function addWorking(kind) {
    const name = kind === 'focus' ? 'Focus block' : 'Break';
    const len = kind === 'focus' ? 60 : 30;
    const startMin = lastEnd(workingBlocks);
    if (startMin + len > 21 * 60) return; // keep it inside the evening
    setWorkingBlocks((prev) => [...prev, makeBlock(name, kind, 'free time', startMin, startMin + len)]);
  }

  function finish() {
    const rows = draftToRecurringRows(lockedDays);
    onComplete({
      days: lockedDays,
      rows,
      count,
      durationId,
      commitmentMinutes: durationMinutes,
      q3: q3 || null,
      signals,
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

  // ── Assembling beat ──
  if (phase === 'assembling') {
    return overlay(
      <div className="sos-onb-card sos-onb-puzzle-card sos-onb-fade" style={{ textAlign: 'center', maxWidth: 420 }}>
        <div className="sos-onb-assemble" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, i) => (
            <span key={i} className="sos-onb-assemble-col" style={{ '--i': i }} />
          ))}
        </div>
        <h2 className="sos-onb-h2" style={{ marginTop: 22 }}>Drafting your week…</h2>
        <p className="sos-onb-sub">Placing what's certain. Sketching the rest.</p>
      </div>
    );
  }

  // ── Day-by-day calibration ──
  if (phase === 'calibrate' && currentDay) {
    const draftCount = shownBlocks.filter((b) => !b.committed).length;
    return overlay(
      <div className="sos-onb-card sos-onb-puzzle-card" key={dayIndex}>
        <div className="sos-onb-progress" aria-hidden="true">
          {draft.map((_, i) => (
            <span key={i} className={`sos-onb-pip ${i < dayIndex ? 'done' : i === dayIndex ? 'cur' : ''}`} />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="sos-onb-h2" style={{ margin: 0 }}>{currentDay.label}</h2>
          <span className="sos-onb-step" style={{ margin: 0 }}>Day {dayIndex + 1} / 7</span>
        </div>
        <p className="sos-onb-sub" style={{ marginBottom: 14 }}>
          {adjusting
            ? 'Drop what doesn\'t fit. Add what does. Committed time stays put.'
            : currentDay.blocks.length === 0
              ? 'Left this one open. Nothing to prove on a free day.'
              : currentDay.hasCommitment ? 'School, your commitment, and a light study window.' : 'School and a study window. Adjust if it\'s too much.'}
        </p>

        <div className="sos-onb-column">
          {shownBlocks.length === 0 && (
            <div style={{ padding: '18px 12px', textAlign: 'center', color: 'var(--text-dim)', border: '1px dashed var(--border)', borderRadius: 12, fontSize: '0.82rem' }}>
              Open day
            </div>
          )}
          {shownBlocks.map((b, i) => (
            <BlockChip
              key={b.id}
              block={b}
              animateIn={!adjusting}
              index={i}
              removable={adjusting && !b.committed}
              onRemove={() => removeWorking(b.id)}
            />
          ))}
        </div>

        {adjusting ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="sos-onb-add" onClick={() => addWorking('focus')} disabled={lastEnd(workingBlocks) + 60 > 21 * 60}>
                {Icon.plus(14)} Focus
              </button>
              <button className="sos-onb-add" onClick={() => addWorking('break')} disabled={lastEnd(workingBlocks) + 30 > 21 * 60}>
                {Icon.plus(14)} Break
              </button>
            </div>
            <button className="sos-onb-primary" style={{ marginTop: 14, width: '100%' }} onClick={() => lockDay(workingBlocks, false)}>
              Lock it in {Icon.check(16)}
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="sos-onb-bad" onClick={startAdjust}>Looks bad</button>
            <button className="sos-onb-good" onClick={() => lockDay(currentDay.blocks, true)}>
              Looks good {Icon.check(16)}
            </button>
          </div>
        )}

        {locking && (
          <div className="sos-onb-locked" aria-hidden="true">
            <span className="sos-onb-locked-stamp">{currentDay.key} · LOCKED</span>
          </div>
        )}
      </div>
    );
  }

  // ── Finale ──
  if (phase === 'finale') {
    const jarvis = q3 ? `Week's set. Now go ${q3}.` : "Week's set. Go find something that isn't homework.";
    return overlay(
      <div className="sos-onb-card sos-onb-puzzle-card sos-onb-fade" style={{ maxWidth: 480, textAlign: 'center' }}>
        <div className="sos-onb-week" aria-hidden="true">
          {lockedDays.map((d, i) => (
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
