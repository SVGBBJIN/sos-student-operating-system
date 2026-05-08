import React from 'react';
import Icon from '../lib/icons';
import { trackEvent } from '../lib/analytics';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, errorMessage: err?.message || '' };
  }

  componentDidCatch(err, info) {
    console.error('ErrorBoundary caught:', err, info);
    try {
      trackEvent('error_boundary_triggered', {
        message: err?.message || 'unknown',
        stack: (err?.stack || '').slice(0, 500),
        component_stack: (info?.componentStack || '').slice(0, 500),
      });
    } catch (_) {}
  }

  handleReload = () => {
    try { window.location.reload(); } catch (_) {}
  };

  render() {
    if (this.state.hasError) {
      const looksLikeChatRender = /chat|message|action|stream/i.test(this.state.errorMessage);
      const heading = looksLikeChatRender
        ? "Something crashed while showing this reply."
        : "Something went wrong rendering this view.";
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '40px 20px', textAlign: 'center', color: 'var(--text-dim)', gap: 12, flex: 1
        }}>
          <div style={{ color: 'var(--warning)', display: 'flex' }}>{Icon.alertTriangle(32)}</div>
          <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
            {heading}
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', maxWidth: 360 }}>
            The AI itself is fine — this was a display error. Reload to recover, or dismiss to keep working.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => this.setState({ hasError: false, errorMessage: '' })}
              style={{
                background: 'rgba(108,99,255,0.1)', border: '1px solid rgba(108,99,255,0.3)',
                color: 'var(--accent)', borderRadius: 10, padding: '8px 20px',
                cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, transition: 'all .15s'
              }}
            >
              Dismiss
            </button>
            <button
              onClick={this.handleReload}
              style={{
                background: 'var(--accent)', border: '1px solid var(--accent)',
                color: '#fff', borderRadius: 10, padding: '8px 20px',
                cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, transition: 'all .15s'
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
