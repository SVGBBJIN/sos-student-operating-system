import React, { useState, useEffect } from 'react';

/* Inline SVG icons — 2px stroke, currentColor, 24px viewBox */
function Si({ name, size = 15 }) {
  const p = {
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    plus:     <><path d="M12 5v14M5 12h14"/></>,
    sun:      <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon:     <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
    logout:   <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></>,
    home:     <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    message:  <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
    proofread:<><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></>,
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
  theme = 'dark',
  onTheme,
  onNewChat,
  onSettings,
  onAuthAction,
  onHome,
  onChat,
  onProofread,
  homeEnabled = false,
  queueCount = 0,
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
    : 'saved';

  return (
    <div className="topbar">
      <div className="topbar-left">
        <span
          className="sos-brand-mark"
          style={{ borderRadius: 7, padding: 4, cursor: onHome ? 'pointer' : 'default' }}
          onClick={onHome || undefined}
          title={onHome ? 'Home' : undefined}
          role={onHome ? 'button' : undefined}
          aria-label={onHome ? 'Home' : undefined}
        >
          <span className="sos-mark" style={{fontSize:20}}>
            <span className="sos-mark-s">S</span>
            <span className="sos-mark-bulb"><svg><use href="#sos-bulb"/></svg></span>
            <span className="sos-mark-s">S</span>
          </span>
        </span>
      </div>

      <div className="topbar-right">
        {/* Sync pill */}
        <span className="sync-pill" title="Sync status">
          <span className={`sync-dot ${dotClass}`} />
          <span>
            {syncStatus === 'saving' ? 'syncing'
             : syncStatus === 'error' ? 'offline'
             : 'saved'}
          </span>
        </span>

        {queueCount > 0 && (
          <span className="sync-pill" style={{ color: 'var(--warning)' }}>
            {queueCount} queued
          </span>
        )}

        {/* Clock */}
        <span className="sync-pill" style={{ letterSpacing: '0.04em' }}>{time}</span>

        {/* Theme toggle */}
        {onTheme && (
          <div className="theme-toggle" role="tablist" aria-label="theme">
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

        <button className="icon-btn" onClick={onSettings} title="Settings" aria-label="Settings">
          <Si name="settings" size={15} />
        </button>

        {onNewChat && (
          <button className="icon-btn primary" onClick={onNewChat} title="New chat" aria-label="New chat">
            <Si name="plus" size={15} />
          </button>
        )}

        {onAuthAction && (
          <button className="icon-btn" onClick={onAuthAction} title={user ? 'Sign out' : 'Sign in'} aria-label={user ? 'Sign out' : 'Sign in'}>
            <Si name="logout" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
