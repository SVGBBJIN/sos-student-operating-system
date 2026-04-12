import { useState } from 'react';

const ONBOARDING_FEATURES = [
  { icon: '💬', label: 'Chat', desc: "Ask SOS anything — it knows your whole workload" },
  { icon: '✅', label: 'Tasks', desc: "Just say \"add essay due Friday\" and it's done" },
  { icon: '📅', label: 'Calendar', desc: "Syncs with Google so you never miss a deadline" },
  { icon: '🃏', label: 'Flashcards', desc: "AI-generated cards with spaced repetition built in" },
  { icon: '📝', label: 'Quiz', desc: "Auto-quizzes from any topic or uploaded PDF" },
  { icon: '📓', label: 'Notes', desc: "Your notes in context so answers are grounded in your work" },
];

export default function FirstRunModal({ onClose, onConnectGoogle, onSwitchLofi }) {
  const [step, setStep] = useState(1);
  const TOTAL = 4;

  function handleClose() {
    try { localStorage.setItem('sos_onboarded', '1'); } catch (_) {}
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', animation: 'overlayIn .2s ease' }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border-mid)', borderRadius: 24, padding: '28px 28px 24px', maxWidth: 460, width: 'calc(100% - 32px)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', animation: 'cardPop .25s ease', position: 'relative' }}>

        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 22 }}>
          {Array.from({ length: TOTAL }, (_, i) => (
            <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: i + 1 <= step ? 'var(--accent)' : 'var(--border)', transition: 'background .3s' }} />
          ))}
        </div>

        {step === 1 && (
          <>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 6, letterSpacing: '-0.5px' }}>Welcome to SOS 👋</div>
            <div style={{ fontSize: '0.86rem', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 16 }}>
              Your AI study sidekick — it talks to you like a friend and knows your whole workload.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              {ONBOARDING_FEATURES.map(f => (
                <div key={f.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: '1.1rem' }}>{f.icon} <span style={{ fontWeight: 700, fontSize: '0.83rem' }}>{f.label}</span></div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', lineHeight: 1.4 }}>{f.desc}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setStep(2)} style={{ flex: 1, width: '100%', background: 'var(--accent)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: '0.88rem', padding: '10px', cursor: 'pointer' }}>Let me in →</button>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 8, letterSpacing: '-0.5px' }}>Add your first task 📋</div>
            <div style={{ fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 16 }}>
              Just describe your work and SOS will add it. You can say things like:<br />
              <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>"Add a math essay due Friday, 45 mins"</span>
            </div>
            <div style={{ background: 'rgba(108,99,255,0.08)', border: '1px solid rgba(108,99,255,0.2)', borderRadius: 14, padding: '12px 16px', marginBottom: 20 }}>
              <div style={{ fontSize: '0.80rem', color: 'var(--text-dim)', marginBottom: 8, fontWeight: 600 }}>Quick examples to try:</div>
              {['I have a bio test on Thursday', 'Add essay due next Monday, 2 hours', 'Finish problem set by tomorrow'].map(ex => (
                <div key={ex} style={{ fontSize: '0.79rem', color: 'var(--text)', padding: '5px 10px', borderRadius: 8, background: 'var(--bg)', marginBottom: 4, border: '1px solid var(--border)' }}>{ex}</div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(3)} style={{ flex: 1, background: 'var(--accent)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: '0.88rem', padding: '10px', cursor: 'pointer' }}>Got it →</button>
              <button onClick={() => setStep(s => s - 1)} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-dim)', fontSize: '0.82rem', padding: '10px 14px', cursor: 'pointer' }}>← Back</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 8, letterSpacing: '-0.5px' }}>Connect your calendar 📅</div>
            <div style={{ fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 16 }}>
              Link Google Calendar so SOS knows what's coming up — and can plan around it automatically.
            </div>
            <div style={{ background: 'var(--bg)', borderRadius: 14, padding: '14px 16px', marginBottom: 12, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 4 }}>What you unlock:</div>
              <ul style={{ fontSize: '0.80rem', color: 'var(--text-dim)', paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
                <li>SOS sees your events while planning</li>
                <li>Exam countdowns and smart reminders</li>
                <li>Schedule blocks that don't clash with class</li>
              </ul>
            </div>
            <button onClick={() => { onConnectGoogle(); }} style={{ background: 'var(--accent)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: '0.86rem', padding: '10px', cursor: 'pointer', width: '100%', marginBottom: 10 }}>Connect Google Calendar →</button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(4)} style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-dim)', fontSize: '0.82rem', padding: '10px', cursor: 'pointer' }}>Skip for now →</button>
              <button onClick={() => setStep(s => s - 1)} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-dim)', fontSize: '0.82rem', padding: '10px 14px', cursor: 'pointer' }}>← Back</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 8, letterSpacing: '-0.5px' }}>Try Study Mode 🎧</div>
            <div style={{ fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 16 }}>
              Study Mode gives you a lo-fi vibe: a task panel, a cat window, a music player, and your AI — all in one focused grid.
            </div>
            <div style={{ background: 'rgba(134,239,172,0.08)', border: '1px solid rgba(134,239,172,0.2)', borderRadius: 14, padding: '14px 16px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {['Lo-fi grid layout with ambient breathing background', 'Spaced-repetition flashcard panel', 'Pomodoro timer + music player + cat widget', 'Works great on big screens and phones'].map(item => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.81rem', color: 'var(--text)' }}>
                  <span style={{ color: '#86efac', fontSize: '0.75rem', flexShrink: 0 }}>✓</span>{item}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { onSwitchLofi && onSwitchLofi(); handleClose(); }} style={{ flex: 1, background: 'rgba(134,239,172,0.15)', border: '1px solid rgba(134,239,172,0.35)', borderRadius: 12, color: '#86efac', fontWeight: 700, fontSize: '0.86rem', padding: '10px', cursor: 'pointer' }}>Switch to Study Mode</button>
              <button onClick={handleClose} style={{ flex: 1, background: 'var(--accent)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: '0.86rem', padding: '10px', cursor: 'pointer' }}>Start chatting →</button>
            </div>
            <button onClick={() => setStep(s => s - 1)} style={{ marginTop: 8, background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: '0.80rem', cursor: 'pointer', width: '100%' }}>← Back</button>
          </>
        )}
      </div>
    </div>
  );
}
