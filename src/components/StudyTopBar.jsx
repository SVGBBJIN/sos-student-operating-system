import React, { useState, useEffect } from 'react';

/* Inline SVG icons — 2px stroke, currentColor, 24px viewBox */
function Si({ name, size = 15 }) {
  const p = {
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    plus:     <><path d="M12 5v14M5 12h14"/></>,
    sun:      <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon:     <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
    panel:    <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></>,
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

export default function StudyTopBar({
  user,
  syncStatus,
  onNewChat,
  onImport,
  onSettings,
  onAuthAction,
  onSwitchLayout,
  onHome,
  homeEnabled = false,
  queueCount = 0,
  theme = 'dark',
  onTheme,
}) {
  const [time, setTime] = useState('');

  useEffect(() => {
    function tick() {
      setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  const dotClass =
    syncStatus === 'saving' ? 'saving'
    : syncStatus === 'error' ? 'error'
    : user ? 'saved'
    : 'offline';

  return (
    <div className="study-topbar study-glass stb-v2">
      {/* Brand */}
      <div className="stb-left">
        <span className="stb-brand-img">
          <img src="/brain-logo.svg" alt="SOS" style={{ width: 22, height: 22, display: 'block' }} />
        </span>
        <span className="stb-brand-word">
          S<em>O</em>S
        </span>
      </div>

      {/* Right cluster */}
      <div className="stb-right">
        {/* Sync pill */}
        {user && (
          <span className="stb-sync-pill">
            <span className={'study-sync-dot ' + dotClass} />
            <span className="stb-sync-label">
              {syncStatus === 'saving' ? 'syncing'
               : syncStatus === 'error' ? 'offline'
               : 'saved'}
            </span>
          </span>
        )}

        {queueCount > 0 && (
          <span className="study-queue-badge">{queueCount} queued</span>
        )}

        {/* Clock */}
        <span className="stb-clock">{time}</span>

        {/* Theme toggle */}
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

        {/* Home */}
        {homeEnabled && onHome && (
          <button className="stb-icon-btn" onClick={onHome} title="Home screen" aria-label="Home screen">
            <Si name="home" />
          </button>
        )}

        {/* Settings */}
        <button className="stb-icon-btn" onClick={onSettings} title="Settings" aria-label="Settings">
          <Si name="settings" />
        </button>

        {/* New chat — dashed ghost pill */}
        <button className="stb-new-chat" onClick={onNewChat} title="New chat" aria-label="New chat">
          <Si name="plus" size={13} />
          <span>New chat</span>
        </button>

        {/* Layout toggle */}
        <button className="stb-icon-btn" onClick={onSwitchLayout} title="Switch layout" aria-label="Switch to sidebar layout">
          <Si name="panel" />
        </button>

        {/* Auth */}
        <button className="stb-icon-btn" onClick={onAuthAction} title={user ? 'Sign out' : 'Sign in'} aria-label={user ? 'Sign out' : 'Sign in'}>
          <Si name="logout" />
        </button>
      </div>
    </div>
  );
}
