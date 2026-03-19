import React from 'react';
import ErrorBoundary from '../ErrorBoundary';

function ChatWorkspace({
  showSettings,
  settingsView,
  chatPanel,
  showSidebarCompanion,
  companionCollapsed,
  compactCompanionToggle,
  setCompanionCollapsed,
  closeSidebarCompanion,
  sidebarCompanionPanel,
  sendChip,
  SchedulePeek,
  NotesPanel,
  tasks,
  blocks,
  events,
  weatherData,
  notes,
  handleDeleteNote,
  handleUpdateNote,
  handleCreateNote,
  Icon,
}) {
  if (showSettings) {
    return <div className="sos-chat-area" style={{ animation: 'fadeIn .25s ease' }}>{settingsView}</div>;
  }

  return (
    <>
      <div className={'sos-chat-shell' + (showSidebarCompanion ? ' companion-open' : '') + (showSidebarCompanion && companionCollapsed ? ' companion-collapsed' : '')}>
        <div className="sos-chat-column">{chatPanel}</div>
        {showSidebarCompanion && (
          <div className={'sos-chat-companion' + (companionCollapsed ? ' collapsed' : '')}>
            <button
              className={'sos-companion-toggle' + (compactCompanionToggle ? ' icon-only' : ' classic-bar')}
              onClick={() => setCompanionCollapsed(prev => !prev)}
              title={companionCollapsed ? 'Expand side panel' : 'Collapse side panel'}
              aria-label={companionCollapsed ? 'Expand side panel' : 'Collapse side panel'}
            >
              <span>{Icon.panel(14)}</span>
              {!compactCompanionToggle && <span>{companionCollapsed ? 'Open panel' : 'Collapse'}</span>}
            </button>
            {!companionCollapsed && (sidebarCompanionPanel === 'schedule' || sidebarCompanionPanel === 'notes') && (
              <div style={{ padding: '6px 10px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                    {sidebarCompanionPanel === 'schedule' ? 'Schedule workflows' : 'Notes workflows'}
                  </div>
                  <button className="settings-toggle" onClick={closeSidebarCompanion} style={{ padding: '4px 8px', fontSize: '0.68rem' }}>Close panel</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {sidebarCompanionPanel === 'schedule' && ['Plan today', 'Find free block', 'Due soon'].map((chip) => (
                    <button key={chip} className="sos-chip" onClick={() => sendChip(chip)}>{chip}</button>
                  ))}
                  {sidebarCompanionPanel === 'notes' && ['Summarize note', 'Make flashcards', 'Quiz me'].map((chip) => (
                    <button key={chip} className="sos-chip" onClick={() => sendChip(chip)}>{chip}</button>
                  ))}
                </div>
              </div>
            )}
            {!companionCollapsed && sidebarCompanionPanel === 'schedule' && (
              <ErrorBoundary><SchedulePeek tasks={tasks} blocks={blocks} events={events} weatherData={weatherData} embedded /></ErrorBoundary>
            )}
            {!companionCollapsed && sidebarCompanionPanel === 'notes' && (
              <NotesPanel notes={notes} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} onCreateNote={handleCreateNote} embedded />
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default ChatWorkspace;
