import React, { useState, useEffect } from 'react';
import { Icon } from '../lib/icons';

export default function StudyTopBar({
  user,
  syncStatus,
  tutorMode,
  onNewChat,
  onTutorMode,
  onImport,
  onSettings,
  onAuthAction,
  onSwitchLayout,
  queueCount = 0,
}) {
  const [time, setTime] = useState('');

  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const syncDotClass =
    syncStatus === 'saving' ? 'saving'
    : syncStatus === 'error' ? 'error'
    : user ? 'saved'
    : 'offline';

  return (
    <div className="study-topbar study-glass">
      {/* Logo */}
      <div className="study-topbar-logo">
        <img src="/brain-logo.svg" alt="SOS" />
        SOS <span>/ study room</span>
      </div>

      <div className="study-topbar-spacer" />

      {/* Right side: sync, clock, actions */}
      <div className="study-topbar-right">
        {user && (
          <div className="study-topbar-sync">
            <span className={'study-sync-dot ' + syncDotClass} />
            <span>{syncStatus === 'saving' ? 'Saving…' : syncStatus === 'error' ? 'Sync error' : 'Synced'}</span>
          </div>
        )}

        {queueCount > 0 && (
          <span className="study-queue-badge">{queueCount} queued</span>
        )}

        <span className="study-topbar-clock">{time}</span>

        <button
          className={'study-icon-btn' + (tutorMode ? ' active' : '')}
          onClick={onTutorMode}
          title={tutorMode ? 'Exit tutor mode' : 'Enter tutor mode'}
          aria-label="Tutor mode"
        >
          {Icon.bookOpen(14)}
        </button>

        <button
          className="study-icon-btn"
          onClick={onImport}
          title="Import / Google"
          aria-label="Import"
        >
          {Icon.link(14)}
        </button>

        <button
          className="study-icon-btn"
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
        >
          {Icon.edit(14)}
        </button>

        <button
          className="study-icon-btn study-new-chat-btn"
          onClick={onNewChat}
          title="Start new chat"
          aria-label="Start new chat"
        >
          {Icon.plus(12)}
          <span>New chat</span>
        </button>

        <button
          className="study-icon-btn"
          onClick={onSwitchLayout}
          title="Switch layout"
          aria-label="Switch to sidebar layout"
        >
          {Icon.panel(14)}
        </button>

        <button
          className="study-icon-btn"
          onClick={onAuthAction}
          title={user ? 'Sign out' : 'Sign in'}
          aria-label={user ? 'Sign out' : 'Sign in'}
        >
          {user ? Icon.logout(14) : Icon.messageCircle(14)}
        </button>
      </div>
    </div>
  );
}
