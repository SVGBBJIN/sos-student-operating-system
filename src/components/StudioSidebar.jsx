import React, { useState } from 'react';
import DynamicIsland from './DynamicIsland';
import ProjectsBar from './ProjectsBar';

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

function isToday(dateVal) {
  if (!dateVal) return false;
  const d = new Date(dateVal);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function SavedChatRow({ chat, isActive, onPick, onDelete }) {
  return (
    <div className={'sb-item-wrap' + (isActive ? ' active' : '')} style={{ position: 'relative' }}>
      <button
        className={'sb-item' + (isActive ? ' active' : '')}
        onClick={() => onPick?.(chat.id)}
        style={{ width: '100%' }}
      >
        <span className="sb-item-title">{chat.title || 'Untitled chat'}</span>
        <span className="sb-item-meta">{chat.messageCount ? `${chat.messageCount}m` : ''}</span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(chat); }}
          className="sb-item-delete"
          title="Delete saved chat"
          aria-label="Delete saved chat"
        >×</button>
      )}
    </div>
  );
}

export default function StudioSidebar({
  user,
  savedChats = [],
  viewingSavedChatId,
  onPick,
  onNew,
  onDelete,
  onAuthAction,
  aiThinking = false,
  syncStatus,
  nextEvent,
  deadlineWarning,
  tasks = [],
  events = [],
  notes = [],
}) {
  const [activeSubject, setActiveSubject] = useState(null);
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

      <ProjectsBar
        tasks={tasks}
        events={events}
        notes={notes}
        activeSubject={activeSubject}
        onSelectSubject={setActiveSubject}
      />

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
                  <SavedChatRow
                    key={chat.id}
                    chat={chat}
                    isActive={viewingSavedChatId === chat.id}
                    onPick={onPick}
                    onDelete={onDelete}
                  />
                ))}
              </>
            )}
            {earlier.length > 0 && (
              <>
                <div className="sb-group-label">Earlier</div>
                {earlier.map(chat => (
                  <SavedChatRow
                    key={chat.id}
                    chat={chat}
                    isActive={viewingSavedChatId === chat.id}
                    onPick={onPick}
                    onDelete={onDelete}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      <div className="sb-foot">
        <div className="sb-foot-avatar">{avatarLetter}</div>
        <div className="sb-foot-name">{displayName}</div>
        {onAuthAction && (
          <button
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            title={user ? 'Sign out' : 'Sign in'}
            aria-label={user ? 'Sign out' : 'Sign in'}
            onClick={onAuthAction}
          >
            <LogoutIcon />
          </button>
        )}
      </div>
    </>
  );
}
