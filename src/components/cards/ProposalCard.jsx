export default function ProposalCard({ proposal, onApprove, onDismiss }) {
  const actionIcons = { add_event: '📅', add_task: '✅', add_block: '⏳', add_note: '📝' };
  const icon = actionIcons[proposal.action_type] || '✨';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderLeft: '3px solid var(--accent)',
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '1.1rem' }}>{icon}</span>
        <span style={{ fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.4 }}>
          Want me to <strong style={{ color: 'var(--accent)' }}>{proposal.summary}</strong>?
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onApprove}
          style={{ background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.02em' }}
        >
          Yes, do it
        </button>
        <button
          onClick={onDismiss}
          style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--text-dim)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'var(--text-dim)'; }}
        >
          Nah
        </button>
      </div>
    </div>
  );
}
