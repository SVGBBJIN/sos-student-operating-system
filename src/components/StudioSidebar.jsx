import React from 'react';
import DynamicIsland from './DynamicIsland';

/* Inline SVG icons */
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M12 5v14M5 12h14"/>
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

function isToday(dateVal) {
  if (!dateVal) return false;
  const d = new Date(dateVal);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

export default function StudioSidebar({
  user,
  savedChats = [],
  viewingSavedChatId,
  onPick,
  onNew,
  onAuthAction,
  onHome,
  aiThinking = false,
  syncStatus,
  nextEvent,
  deadlineWarning,
}) {
  const today = savedChats.filter(c => isToday(c.savedAt));
  const earlier = savedChats.filter(c => !isToday(c.savedAt));

  const displayName = user?.email ? user.email.split('@')[0] : (user?.user_metadata?.full_name || 'you');
  const avatarLetter = (user?.email || displayName || '?')[0].toUpperCase();

  return (
    <>
      <DynamicIsland
        aiThinking={aiThinking}
        syncStatus={syncStatus}
        nextEvent={nextEvent}
        deadlineWarning={deadlineWarning}
      />

      <div className="sb-section">
        <button className="sb-new" onClick={onNew}>
          <PlusIcon />
          <span>New chat</span>
        </button>
      </div>

      {onHome && (
        <div className="sb-section" style={{ paddingTop: 0 }}>
          <button className="sb-home" onClick={onHome} title="Back to home">
            <HomeIcon />
            <span>Home</span>
          </button>
        </div>
      )}

      <div className="sb-list">
        {savedChats.length === 0 ? (
          <div className="sb-group-label" style={{ textAlign: 'center', paddingTop: 20, opacity: 0.5 }}>
            no saved chats yet
          </div>
        ) : (
          <>
            {today.length > 0 && (
              <>
                <div className="sb-group-label">Today</div>
                {today.map(chat => (
                  <button
                    key={chat.id}
                    className={'sb-item' + (viewingSavedChatId === chat.id ? ' active' : '')}
                    onClick={() => onPick(chat.id)}
                  >
                    <span className="sb-item-title">{chat.title || 'Untitled chat'}</span>
                    <span className="sb-item-meta">{chat.messageCount ? `${chat.messageCount}m` : ''}</span>
                  </button>
                ))}
              </>
            )}
            {earlier.length > 0 && (
              <>
                <div className="sb-group-label">Earlier</div>
                {earlier.map(chat => (
                  <button
                    key={chat.id}
                    className={'sb-item' + (viewingSavedChatId === chat.id ? ' active' : '')}
                    onClick={() => onPick(chat.id)}
                  >
                    <span className="sb-item-title">{chat.title || 'Untitled chat'}</span>
                    <span className="sb-item-meta">{chat.messageCount ? `${chat.messageCount}m` : ''}</span>
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>

      <div className="sb-foot">
        <div className="sb-foot-avatar">{avatarLetter}</div>
        <div className="sb-foot-name">{displayName}</div>
        <button
          className="icon-btn"
          style={{ width: 26, height: 26 }}
          title={user ? 'Sign out' : 'Sign in'}
          aria-label={user ? 'Sign out' : 'Sign in'}
          onClick={onAuthAction}
        >
          <LogoutIcon />
        </button>
      </div>
    </>
  );
}
