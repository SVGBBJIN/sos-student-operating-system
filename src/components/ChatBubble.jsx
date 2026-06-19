import React from 'react';

export function UserBubble({ text, time }) {
  return (
    <div className="msg-row fade-up" style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 24px' }}>
      <div style={{
        maxWidth: '78%', padding: '10px 14px',
        background: 'var(--accent-bg)', color: 'var(--fg-1)',
        border: '1px solid var(--accent-line)',
        borderRadius: 'var(--r-xl)', borderBottomRightRadius: 'var(--r-sm)',
        fontSize: '0.92rem', lineHeight: 1.55,
      }}>
        {text}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: 'right' }}>{time}</div>
      </div>
    </div>
  );
}

export function AiBubble({ text, time, loading, children }) {
  return (
    <div className="msg-row fade-up" style={{ display: 'flex', justifyContent: 'flex-start', padding: '6px 24px' }}>
      <div style={{
        maxWidth: '78%', padding: '12px 14px',
        background: 'var(--bg-3)', color: 'var(--fg-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-xl)', borderBottomLeftRadius: 'var(--r-sm)',
        fontSize: '0.92rem', lineHeight: 1.55,
      }}>
        {loading ? (
          <div className="loading-dots"><span /><span /><span /></div>
        ) : (
          <>
            <div>{text}</div>
            {children ? <div style={{ marginTop: 10 }}>{children}</div> : null}
            {time ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: 'right' }}>{time}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}

export function HistorySeparator({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px 6px' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-3)',
        textTransform: 'uppercase', letterSpacing: '0.10em', whiteSpace: 'nowrap'
      }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  );
}
