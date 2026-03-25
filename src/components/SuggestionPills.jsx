/**
 * Translucent suggestion pill chips for the welcome screen.
 * Fully rounded, glassmorphic, hover glow + lift.
 */
export default function SuggestionPills({ chips, onSelect }) {
  if (!chips || chips.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 10,
      justifyContent: 'center',
      marginTop: 20,
    }}>
      {chips.map((chip, i) => (
        <button
          key={i}
          onClick={() => onSelect(chip)}
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: '1px solid rgba(255,255,255,0.28)',
            color: 'var(--text)',
            padding: '10px 20px',
            borderRadius: 999,
            fontSize: '0.88rem',
            fontWeight: 500,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
            animation: `floatUp 0.4s ease ${i * 0.06}s both`,
            fontFamily: 'inherit',
            lineHeight: 1.4,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.32)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.44)';
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.28)';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
