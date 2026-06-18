import React from 'react';
import { StudioIcon } from './StudioIcons';

const NAV_ITEMS = [
  { id: 'home',      icon: 'home',     label: 'Home' },
  { id: 'calendar',  icon: 'calendar', label: 'Calendar' },
  { id: 'courses',   icon: 'book',     label: 'Courses' },
  { id: 'review',    icon: 'cards',    label: 'Review' },
  { id: 'proofread', icon: 'edit',     label: 'Proofread' },
];

export default function SidebarNav({ user, view, threads = [], activeThread, onNav, onNewChat, onPickThread }) {
  return (
    <>
      <nav className="nav">
        {NAV_ITEMS.map(it => (
          <button key={it.id}
            className={'nav-item' + (view === it.id ? ' active' : '')}
            onClick={() => onNav && onNav(it.id)}>
            <StudioIcon name={it.icon} size={17} />
            <span>{it.label}</span>
          </button>
        ))}
      </nav>

      <div className="nav-divider" />

      <div className="assist">
        <button className="assist-new" onClick={onNewChat}>
          <span className="assist-spark"><StudioIcon name="sparkles" size={14} /></span>
          <span>Ask SOS</span>
          <StudioIcon name="plus" size={13} />
        </button>
        <div className="nav-section-label">Recent</div>
        <div className="thread-list">
          {threads.map(t => (
            <button key={t.id}
              className={'thread' + (activeThread === t.id ? ' active' : '')}
              onClick={() => onPickThread && onPickThread(t.id)}>
              <span className="thread-title">{t.title}</span>
              <span className="thread-meta">{t.meta}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sb-foot">
        <div className="sb-foot-avatar">{(user?.name || '?')[0].toUpperCase()}</div>
        <div className="sb-foot-name">{user?.name || 'friend'}</div>
        <button className="icon-btn" title="Account" style={{ width: 26, height: 26 }}>
          <StudioIcon name="more" size={14} />
        </button>
      </div>
    </>
  );
}
