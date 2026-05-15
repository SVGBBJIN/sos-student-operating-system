import React, { useState, useEffect } from 'react';

function Si({ name, size = 15 }) {
  const p = {
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    plus:     <><path d="M12 5v14M5 12h14"/></>,
    sun:      <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon:     <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
    logout:   <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></>,
    home:     <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      {p[name]}
    </svg>
  );
}

/* Live clock */
function Clock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  useEffect(() => {
    const t = setInterval(
      () => setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      15000
    );
    return () => clearInterval(t);
  }, []);
  return <span className="dtb-clock">{time}</span>;
}

/* The morphing island pill in the center of the topbar */
function IslandPill({ aiThinking, syncStatus }) {
  let accent = 'idle';
  let right = null;

  if (aiThinking) {
    accent = 'accent';
    right = (
      <div className="dtb-pill-right">
        <span className="dtb-pill-label accent">sos is thinking</span>
        <span className="dtb-dots"><span/><span/><span/></span>
      </div>
    );
  } else if (syncStatus === 'saving') {
    accent = 'warn';
    right = (
      <div className="dtb-pill-right">
        <span className="dtb-pill-label warn">syncing</span>
      </div>
    );
  } else if (syncStatus === 'error') {
    accent = 'error';
    right = (
      <div className="dtb-pill-right">
        <span className="dtb-pill-label error">offline</span>
      </div>
    );
  } else {
    right = (
      <div className="dtb-pill-right">
        <span className="dtb-pill-label">all clear</span>
      </div>
    );
  }

  return (
    <div className="dtb-island" data-accent={accent}>
      <Clock />
      <span className="dtb-sep" />
      {right}
    </div>
  );
}

export default function DynamicTopBar({
  user,
  syncStatus,
  aiThinking = false,
  onNewChat,
  onSettings,
  onAuthAction,
  theme = 'dark',
  onTheme,
  queueCount = 0,
  homeEnabled = false,
  onHome,
}) {
  const dotClass =
    syncStatus === 'saving' ? 'saving'
    : syncStatus === 'error' ? 'error'
    : user ? 'saved'
    : 'offline';

  return (
    <div className="dtb-wrap">
      {/* Brand */}
      <div className="dtb-left">
        <span className="dtb-brand-img">
          <img src="/brain-logo.svg" alt="SOS" style={{ width: 20, height: 20, display: 'block' }} />
        </span>
        <span className="dtb-brand">S<em>O</em>S</span>
      </div>

      {/* Center: morphing island */}
      <div className="dtb-center">
        <IslandPill aiThinking={aiThinking} syncStatus={syncStatus} />
      </div>

      {/* Right actions */}
      <div className="dtb-right">
        {user && (
          <span className="dtb-sync-dot-wrap">
            <span className={'study-sync-dot ' + dotClass} />
          </span>
        )}

        {queueCount > 0 && (
          <span className="study-queue-badge">{queueCount} queued</span>
        )}

        {onTheme && (
          <div className="stb-theme-toggle" role="tablist" aria-label="theme">
            <button
              className={theme === 'light' ? 'on' : ''}
              onClick={() => onTheme('light')}
              title="Light mode"
            >
              <Si name="sun" size={13} />
            </button>
            <button
              className={theme === 'dark' ? 'on' : ''}
              onClick={() => onTheme('dark')}
              title="Dark mode"
            >
              <Si name="moon" size={13} />
            </button>
          </div>
        )}

        {homeEnabled && onHome && (
          <button className="stb-icon-btn" onClick={onHome} title="Home screen" aria-label="Home screen">
            <Si name="home" />
          </button>
        )}

        <button className="stb-icon-btn" onClick={onSettings} title="Settings" aria-label="Settings">
          <Si name="settings" />
        </button>

        <button className="stb-new-chat" onClick={onNewChat} title="New chat" aria-label="New chat">
          <Si name="plus" size={13} />
          <span>New chat</span>
        </button>

        <button className="stb-icon-btn" onClick={onAuthAction} title={user ? 'Sign out' : 'Sign in'} aria-label={user ? 'Sign out' : 'Sign in'}>
          <Si name="logout" />
        </button>
      </div>
    </div>
  );
}
