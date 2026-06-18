import React, { useState } from 'react';

const ACCENT_BY_ACTION = {
  add_event:    'var(--accent)',
  add_task:     'var(--warning)',
  create_note:  'var(--accent)',
  create_quiz:  'var(--accent)',
  flashcards:   'var(--success)',
  plan:         'var(--success)',
};

export function CardShell({ action = 'add_event', title, children, actions }) {
  const accent = ACCENT_BY_ACTION[action] || 'var(--accent)';
  return (
    <div className="scale-in" style={{
      background: 'var(--bg-3)', border: '1px solid var(--line)',
      borderLeft: `2px solid ${accent}`, borderRadius: 'var(--r-md)',
      boxShadow: 'var(--shadow-sm)', maxWidth: 380, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderBottom: '1px solid var(--line)',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
          color: accent, textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>{title}</div>
      </div>
      <div style={{ padding: '12px 14px' }}>{children}</div>
      {actions ? (
        <div style={{
          display: 'flex', gap: 6, padding: '10px 14px',
          borderTop: '1px solid var(--line)',
        }}>{actions}</div>
      ) : null}
    </div>
  );
}

function Field({ k, v }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '4px 0', fontSize: 13 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)',
        textTransform: 'uppercase', letterSpacing: '0.08em', width: 56, paddingTop: 2
      }}>{k}</div>
      <div style={{ fontWeight: 500, color: 'var(--fg-1)', flex: 1 }}>{v}</div>
    </div>
  );
}

export function CardBtn({ tone = 'neutral', children, onClick }) {
  const styles = {
    yes:    { background: 'var(--accent-bg)', borderColor: 'var(--accent-line)', color: 'var(--fg-1)' },
    cancel: { background: 'transparent', borderColor: 'var(--line)', color: 'var(--fg-2)' },
    neutral:{ background: 'transparent', borderColor: 'var(--line)', color: 'var(--fg-2)' },
  }[tone];
  return (
    <button onClick={onClick} style={{
      padding: '5px 12px', borderRadius: 'var(--r-md)', fontWeight: 500, fontSize: 12,
      fontFamily: 'var(--font-body)', border: '1px solid', cursor: 'pointer',
      transition: 'background 150ms', ...styles
    }}>{children}</button>
  );
}

export function ConfirmCard({ data, onYes, onCancel }) {
  return (
    <CardShell
      action="add_event" title="Add to calendar?"
      actions={<>
        <CardBtn tone="yes" onClick={onYes}>Yes, add it</CardBtn>
        <CardBtn tone="cancel" onClick={onCancel}>Cancel</CardBtn>
      </>}
    >
      {Object.entries(data).map(([k, v]) => <Field key={k} k={k} v={v} />)}
    </CardShell>
  );
}

export function PlanCard({ title, steps }) {
  const [done, setDone] = useState({});
  return (
    <CardShell action="plan" title={title}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {steps.map((s, i) => {
          const isDone = !!done[i];
          return (
            <div key={i} onClick={() => setDone({ ...done, [i]: !isDone })} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0',
              borderBottom: i < steps.length - 1 ? '1px solid var(--line)' : 'none',
              cursor: 'pointer'
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2,
                border: '1px solid ' + (isDone ? 'var(--success-line)' : 'var(--line-2)'),
                background: isDone ? 'var(--success-bg)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: 'var(--success)', fontWeight: 700
              }}>{isDone ? '✓' : ''}</div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500, color: 'var(--fg-1)',
                  textDecoration: isDone ? 'line-through' : 'none',
                  opacity: isDone ? 0.5 : 1
                }}>{s.title}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-3)', marginTop: 2 }}>{s.meta}</div>
              </div>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}
