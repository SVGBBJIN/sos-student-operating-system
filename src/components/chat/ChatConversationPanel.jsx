import React from 'react';
import ErrorBoundary from '../ErrorBoundary';

function ChatConversationPanel(props) {
  const {
    chatAreaRef,
    messagesEndRef,
    messages,
    isLoading,
    viewingSavedChatId,
    resumeSavedChat,
    exitSavedChatView,
    welcomeContent,
    dbMessageCount,
    setLightboxUrl,
    pendingTemplateSelector,
    handleSelectTemplate,
    handleCustomPlan,
    handleDismissTemplateSelector,
    PlanTemplateSelector,
    pendingClarification,
    handleClarificationSubmit,
    pendingClarificationAnswers,
    setPendingClarification,
    setPendingClarificationAnswers,
    ClarificationCard,
    pendingActions,
    BulkConfirmationCard,
    today,
    toDateStr,
    executeAction,
    setPendingActions,
    setToastMsg,
    layoutMode,
    openCompanionPanel,
    showSideBySide,
    setShowPeek,
    RecurringEventPopup,
    handleCancelAction,
    ConfirmationCard,
    handleConfirmAction,
    pendingContent,
    ContentTypeRouter,
    handleSaveContent,
    handleDismissContent,
    handleApplyPlan,
    handleStartPlanTask,
    handleExportPlanToGoogleDocs,
    isGoogleConnected,
    TypingDots,
    chatError,
    user,
    guestMsgCount,
    GUEST_DEMO_LIMIT,
    setAuthModalInitialMode,
    setShowAuthModal,
    quickChips,
    sendChip,
    saveChat,
    setShowChatSidebar,
    pendingPhoto,
    setPendingPhoto,
    Icon,
    isRecording,
    recordingTime,
    waveformRef,
    cancelRecording,
    stopRecording,
    isTranscribing,
    handleSubmit,
    photoInputRef,
    handlePhotoSelect,
    inputRef,
    input,
    setInput,
    welcomePlaceholders,
    welcomeIdx,
    startRecording,
    workspaceModeLabel,
    chatFooter,
    customClassName = '',
    inputPlaceholder,
  } = props;

  return (
    <div className={customClassName}>
      <ErrorBoundary>
        <div className="sos-chat-area" ref={chatAreaRef} style={{ animation: 'fadeIn .22s ease' }}>
          {viewingSavedChatId && (
            <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.2)', borderRadius: 12, margin: '0 16px 8px', animation: 'fadeIn .2s ease' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--accent)', fontWeight: 600 }}>Viewing saved conversation</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => resumeSavedChat(viewingSavedChatId)} style={{ background: 'var(--teal,#2bd5ba)', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}>Resume</button>
                <button onClick={exitSavedChatView} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}>Back</button>
              </div>
            </div>
          )}
          {messages.length === 0 && !isLoading && !viewingSavedChatId && welcomeContent}
          {messages.map((msg, i) => (
            <React.Fragment key={i}>
              {i === 0 && dbMessageCount > 0 && messages.length > dbMessageCount && (
                <div className="chat-history-separator">
                  <span>Earlier in conversation</span>
                </div>
              )}
              {i === dbMessageCount && dbMessageCount > 0 && messages.length > dbMessageCount && (
                <div className="chat-history-separator">
                  <span>New messages</span>
                </div>
              )}
              <div className={`sos-msg ${msg.role === 'user' ? 'sos-msg-user' : 'sos-msg-ai'}`}>
                <div className={`sos-bubble ${msg.role === 'user' ? 'sos-bubble-user' : 'sos-bubble-ai'}`}>
                  {(msg.photoUrl || msg.photoPreview) && (
                    <img
                      src={msg.photoUrl || msg.photoPreview}
                      alt="photo"
                      onClick={() => setLightboxUrl(msg.photoUrl || msg.photoPreview)}
                      onError={(e) => { e.target.style.display = 'none'; }}
                      style={{ maxWidth: 240, maxHeight: 200, borderRadius: 10, marginBottom: msg.content ? 8 : 0, cursor: 'pointer', display: 'block' }}
                    />
                  )}
                  {msg.content && <span>{msg.content}</span>}
                  <div className="sos-bubble-time">{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</div>
                </div>
              </div>
            </React.Fragment>
          ))}
          {pendingTemplateSelector && (
            <div className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}>
              <PlanTemplateSelector
                onSelectTemplate={(tmpl) => handleSelectTemplate(tmpl, pendingTemplateSelector.context)}
                onCustomPlan={handleCustomPlan}
                onDismiss={handleDismissTemplateSelector}
              />
            </div>
          )}
          {pendingClarification && (
            <div className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}>
              <ClarificationCard clarification={pendingClarification} onSubmit={handleClarificationSubmit} onSkip={() => { setPendingClarification(null); setPendingClarificationAnswers(null); }} savedAnswers={pendingClarificationAnswers} onAnswersChange={setPendingClarificationAnswers} />
            </div>
          )}
          {!pendingClarification && pendingActions.length > 1 ? (
            <div className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}>
              <BulkConfirmationCard
                actions={pendingActions}
                onConfirmSelected={(checkedArr) => {
                  const toExec = pendingActions.filter((_, i) => checkedArr[i]);
                  toExec.forEach((pa) => {
                    if (pa.action.type === 'add_recurring_event') {
                      const dayNameToIndex = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
                      const dayIndices = (pa.action.days || []).map(d => dayNameToIndex[d]).filter(d => d !== undefined);
                      const start = new Date(pa.action.start_date || today());
                      const endDef = new Date(); endDef.setMonth(endDef.getMonth() + 3);
                      const end = new Date(pa.action.end_date || toDateStr(endDef));
                      const cursor = new Date(start); let count = 0;
                      while (cursor <= end && count < 100) {
                        if (dayIndices.includes(cursor.getDay())) {
                          const ds = toDateStr(cursor);
                          executeAction({ type: 'add_event', title: pa.action.title, date: ds, event_type: pa.action.event_type || 'event', subject: pa.action.subject || '' });
                          count++;
                        }
                        cursor.setDate(cursor.getDate() + 1);
                      }
                    } else {
                      executeAction(pa.action);
                    }
                  });
                  setPendingActions(prev => prev.filter((_, i) => !checkedArr[i]));
                  if (toExec.length > 0) {
                    setToastMsg('Added ' + toExec.length + ' items');
                    const calTypes = ['add_event', 'add_block', 'add_task', 'delete_event', 'delete_task', 'delete_block', 'update_event', 'convert_event_to_block', 'convert_block_to_event', 'add_recurring_event'];
                    if (toExec.some(pa => calTypes.includes(pa.action.type))) {
                      if (layoutMode === 'sidebar') { openCompanionPanel('schedule'); }
                      else if (!showSideBySide) { setShowPeek(true); }
                    }
                  }
                }}
                onCancel={() => setPendingActions([])}
              />
            </div>
          ) : !pendingClarification && pendingActions.map((pa, idx) => (
            <div key={'pa-' + idx} className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}>
              {pa.action.type === 'add_recurring_event' ? (
                <RecurringEventPopup
                  action={pa.action}
                  onConfirm={(checkedEvents) => {
                    checkedEvents.forEach(ev => executeAction({ type: 'add_event', title: ev.title, date: ev.date, event_type: ev.event_type, subject: ev.subject }));
                    setPendingActions(prev => prev.filter((_, i) => i !== idx));
                    setToastMsg('Added ' + checkedEvents.length + ' recurring events');
                  }}
                  onCancel={() => handleCancelAction(idx)}
                />
              ) : (
                <ConfirmationCard action={pa.action} onConfirm={(action) => handleConfirmAction(idx, action)} onCancel={() => handleCancelAction(idx)} isFallback={pa.isFallback} />
              )}
            </div>
          ))}
          {pendingContent.map((pc, idx) => (
            <div key={'pc-' + idx} className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}>
              <ContentTypeRouter content={pc} onSave={() => handleSaveContent(idx)} onDismiss={() => handleDismissContent(idx)} onApplyPlan={(steps) => handleApplyPlan(idx, steps)} onStartPlanTask={(step) => handleStartPlanTask(step)} onExportGoogleDocs={(planData) => handleExportPlanToGoogleDocs(idx, planData)} googleConnected={isGoogleConnected()} />
            </div>
          ))}
          {isLoading && <TypingDots />}
          {chatError && <div style={{ padding: '8px 16px' }}><div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)', fontSize: '0.84rem', color: 'var(--danger)', maxWidth: '80%' }}>{chatError}</div></div>}
          <div ref={messagesEndRef} style={{ height: 1 }} />
        </div>
      </ErrorBoundary>
      {!user && (
        <div style={{ padding: '6px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '0.8rem', color: 'var(--text-dim)', animation: 'fadeIn .3s ease' }}>
          <span>
            {guestMsgCount < GUEST_DEMO_LIMIT
              ? <>Demo mode — <strong style={{ color: 'var(--accent)' }}>{GUEST_DEMO_LIMIT - guestMsgCount} free message{GUEST_DEMO_LIMIT - guestMsgCount !== 1 ? 's' : ''} left</strong></>
              : <strong style={{ color: 'var(--warning)' }}>Demo limit reached — sign up to keep going</strong>
            }
          </span>
          <button onClick={() => { setAuthModalInitialMode('signup'); setShowAuthModal(true); }} style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.76rem', fontWeight: 700, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>Sign up free →</button>
        </div>
      )}
      <div className="sos-input-area">
        {messages.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {quickChips.map((chip, i) => (<button key={i} className="sos-chip" onClick={() => chip.action ? chip.action() : sendChip(chip.msg)}>{chip.label}</button>))}
            {!viewingSavedChatId && <button className="sos-chip" onClick={saveChat} style={{ background: 'rgba(46,213,115,0.08)', borderColor: 'rgba(46,213,115,0.2)', color: 'var(--success)' }}>Save chat</button>}
            {viewingSavedChatId && <button className="sos-chip" onClick={() => resumeSavedChat(viewingSavedChatId)} style={{ background: 'rgba(46,213,115,0.08)', borderColor: 'rgba(46,213,115,0.2)', color: 'var(--success)' }}>Resume chat</button>}
            {viewingSavedChatId && <button className="sos-chip" onClick={exitSavedChatView} style={{ background: 'rgba(108,99,255,0.08)', borderColor: 'rgba(108,99,255,0.2)', color: 'var(--accent)' }}>Back</button>}
            <button className="sos-chip" onClick={() => setShowChatSidebar(true)} style={{ background: 'rgba(108,99,255,0.06)', borderColor: 'rgba(108,99,255,0.15)', color: 'var(--accent)' }}>History</button>
          </div>
        )}
        {pendingPhoto && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--border)', animation: 'fadeIn .2s ease' }}>
            <img src={pendingPhoto.preview} alt="attached" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)', flex: 1 }}>Photo attached</span>
            <button onClick={() => setPendingPhoto(null)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px 8px', display: 'flex' }}>{Icon.x(16)}</button>
          </div>
        )}
        {isRecording ? (
          <div className="voice-bar">
            <div className="voice-bar-indicator">
              <div className="voice-bar-dot" />
              <div className="voice-bar-timer">{Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}</div>
            </div>
            <div className="voice-bar-waveform" ref={waveformRef}>
              {Array.from({ length: 40 }, (_, i) => <div key={i} className="voice-bar-bar" style={{ height: '3px' }} />)}
            </div>
            <button className="voice-bar-cancel" onClick={cancelRecording} title="Cancel">{Icon.trash(16)}</button>
            <button className="voice-bar-send" onClick={stopRecording} title="Send voice">{Icon.send(18)}</button>
          </div>
        ) : isTranscribing ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 16px', background: 'linear-gradient(135deg,rgba(26,26,46,0.97),rgba(15,15,26,0.97))', border: '1px solid rgba(108,99,255,0.15)', borderRadius: 28 }}>
            <div style={{ width: 18, height: 18, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .6s linear infinite' }} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Transcribing...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhotoSelect} />
            {workspaceModeLabel && (
              <span style={{ padding: '4px 9px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)', background: 'rgba(108,99,255,0.1)', border: '1px solid rgba(108,99,255,0.24)', whiteSpace: 'nowrap' }}>{workspaceModeLabel}</span>
            )}
            <button type="button" onClick={() => photoInputRef.current?.click()} disabled={isLoading}
              style={{ width: 40, height: 40, borderRadius: '50%', background: 'transparent', border: '1px solid ' + (pendingPhoto ? 'var(--accent)' : 'var(--border)'), color: pendingPhoto ? 'var(--accent)' : 'var(--text-dim)', cursor: isLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .2s', opacity: isLoading ? 0.5 : 1 }}>
              {Icon.camera(18)}
            </button>
            <button type="button" onClick={startRecording} disabled={isLoading || !!viewingSavedChatId}
              style={{ width: 40, height: 40, borderRadius: '50%', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: (isLoading || viewingSavedChatId) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .2s', opacity: (isLoading || viewingSavedChatId) ? 0.5 : 1 }}>
              {Icon.mic(18)}
            </button>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              placeholder={inputPlaceholder || (viewingSavedChatId ? "viewing saved chat — click 'Resume' to continue" : pendingPhoto ? 'add a message or just send the photo...' : messages.length === 0 ? welcomePlaceholders[welcomeIdx] : 'type anything...')}
              disabled={isLoading || !!viewingSavedChatId}
              style={{ flex: 1, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 24, padding: '12px 20px', fontSize: '0.92rem', outline: 'none', opacity: (isLoading || viewingSavedChatId) ? 0.5 : 1, transition: 'all .25s cubic-bezier(0.16,1,0.3,1)' }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }} />
            <button type="submit" disabled={isLoading || !!viewingSavedChatId || (!input.trim() && !pendingPhoto)} style={{ width: 44, height: 44, borderRadius: '50%', background: (isLoading || !!viewingSavedChatId || (!input.trim() && !pendingPhoto)) ? 'var(--border)' : 'linear-gradient(135deg,var(--accent),#5a54d4)', color: '#fff', border: 'none', cursor: (isLoading || !!viewingSavedChatId || (!input.trim() && !pendingPhoto)) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s', flexShrink: 0, boxShadow: (isLoading || !!viewingSavedChatId || (!input.trim() && !pendingPhoto)) ? 'none' : '0 2px 12px rgba(108,99,255,0.3)' }}>{Icon.send(18)}</button>
          </form>
        )}
        {chatFooter}
      </div>
    </div>
  );
}

export default ChatConversationPanel;
