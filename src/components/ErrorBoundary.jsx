import React from 'react';
import Icon from '../lib/icons';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err, info) {
    console.error('ErrorBoundary caught:', err, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '40px 20px', textAlign: 'center', color: 'var(--text-dim)', gap: 12, flex: 1
        }}>
          <div style={{ color: 'var(--warning)', display: 'flex' }}>{Icon.alertTriangle(32)}</div>
          <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
            Having trouble reaching my brain — try again in a sec.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              background: 'rgba(108,99,255,0.1)', border: '1px solid rgba(108,99,255,0.3)',
              color: 'var(--accent)', borderRadius: 10, padding: '8px 20px',
              cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, transition: 'all .15s'
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
