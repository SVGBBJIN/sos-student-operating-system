/**
 * Minimal ambient bottom hint strip.
 * Replaces the heavy keyboard shortcuts bar with floating, low-opacity hints.
 */
export default function AmbientUI() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      gap: 16,
      marginTop: 6,
      fontSize: '0.68rem',
      color: 'var(--text-dim)',
      opacity: 0.55,
      flexWrap: 'wrap',
      letterSpacing: '0.01em',
    }}>
      <span>/ focus</span>
      <span>S schedule</span>
      <span>N notes</span>
      <span>H history</span>
      <a
        href="privacy.html"
        style={{ color: 'var(--text-dim)', textDecoration: 'none', opacity: 0.6, transition: 'opacity .15s' }}
        onMouseEnter={e => e.target.style.opacity = 1}
        onMouseLeave={e => e.target.style.opacity = 0.6}
      >
        Privacy
      </a>
    </div>
  );
}
