import React from 'react';
import TutorActions from './TutorActions';

export function TypingDots() {
  return (
    <div className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}>
      <div style={{ background: 'linear-gradient(135deg,rgba(26,26,46,0.95),rgba(15,15,26,0.95))', border: '1px solid rgba(108,99,255,0.12)', borderRadius: 16, borderBottomLeftRadius: 4, padding: '12px 18px', display: 'flex', gap: 6, alignItems: 'center', backdropFilter: 'blur(8px)', animation: 'borderGlow 2s ease-in-out infinite' }}>
        {[0, 1, 2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--teal))', display: 'inline-block', animation: 'dotPulse 1.2s ease-in-out infinite', animationDelay: (i * 0.15) + 's', boxShadow: '0 0 8px rgba(108,99,255,0.3)' }} />)}
      </div>
    </div>
  );
}

export default function TutorWorkspace(props) {
  const {
    viewingSavedChatId, resumeSavedChat, exitSavedChatView, messages, dbMessageCount,
    setLightboxUrl, pendingTemplateSelector, PlanTemplateSelector, handleSelectTemplate,
    handleCustomPlan, handleDismissTemplateSelector, pendingClarification, ClarificationCard,
    handleClarificationSubmit, setPendingClarification, pendingClarificationAnswers,
    setPendingClarificationAnswers, pendingActions, BulkConfirmationCard, today, toDateStr,
    executeAction, setPendingActions, setToastMsg, layoutMode, openCompanionPanel,
    showSideBySide, setShowPeek, RecurringEventPopup, handleCancelAction, ConfirmationCard,
    handleConfirmAction, pendingContent, StudyContentRouter, handleSaveContent,
    handleDismissContent, handleApplyPlan, handleStartPlanTask, handleExportPlanToGoogleDocs,
    isGoogleConnected, isLoading, chatError, messagesEndRef, quickChips, saveChat,
    setShowChatSidebar, pendingPhoto, setPendingPhoto, isRecording, recordingTime,
    waveformRef, cancelRecording, stopRecording, isTranscribing, handleSubmit,
    photoInputRef, handlePhotoSelect, workspaceModeLabel, inputRef, input, setInput,
    welcomeIdx, startRecording, TypingDotsComponent = TypingDots, sendChip, footerHints,
    welcomeVariants,
  } = props;

  const handleBulkConfirm = (checkedArr) => {
    const toExec = pendingActions.filter((_, i) => checkedArr[i]);
    toExec.forEach(pa => {
      if (pa.action.type === 'add_recurring_event') {
        const dayNameToIndex = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
        const dayIndices = (pa.action.days || []).map(d => dayNameToIndex[d]).filter(d => d !== undefined);
        const start = new Date(pa.action.start_date || today());
        const endDef = new Date();
        endDef.setMonth(endDef.getMonth() + 3);
        const end = new Date(pa.action.end_date || toDateStr(endDef));
        const cursor = new Date(start);
        let count = 0;
        while (cursor <= end && count < 100) {
          if (dayIndices.includes(cursor.getDay())) {
            executeAction({ type:'add_event', title:pa.action.title, date:toDateStr(cursor), event_type:pa.action.event_type || 'event', subject:pa.action.subject || '' });
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
      const calTypes = ['add_event','add_block','add_task','delete_event','delete_task','delete_block','update_event','convert_event_to_block','convert_block_to_event','add_recurring_event'];
      if (toExec.some(pa => calTypes.includes(pa.action.type))) {
        if (layoutMode === 'sidebar') openCompanionPanel('schedule');
        else if (!showSideBySide) setShowPeek(true);
      }
    }
  };

  return (
    <div className="sos-chat-column">
      <div className="sos-chat-area" style={{ animation: 'fadeIn .22s ease' }}>
        {viewingSavedChatId && (
          <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.2)', borderRadius: 12, margin: '0 16px 8px', animation: 'fadeIn .2s ease' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--accent)', fontWeight: 600 }}>Viewing saved conversation</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => resumeSavedChat(viewingSavedChatId)} style={{ background: 'var(--teal,#2bd5ba)', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>Resume</button>
              <button onClick={exitSavedChatView} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>Back</button>
            </div>
          </div>
        )}

        {messages.length === 0 && !isLoading && !viewingSavedChatId && (() => {
          const wv = welcomeVariants[welcomeIdx];
          return (
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ position: 'absolute', top: '28%', width: 240, height: 240, background: 'radial-gradient(circle, rgba(108,99,255,0.12) 0%, rgba(43,203,186,0.06) 40%, transparent 70%)', borderRadius: '50%', filter: 'blur(50px)', pointerEvents: 'none', animation: 'breathe 4s ease-in-out infinite, orbFloat 8s ease-in-out infinite' }} />
              <div style={{ fontSize: '3.2rem', marginBottom: 16, background: 'linear-gradient(135deg, #7B6CFF 0%, var(--teal) 50%, #45aaf2 100%)', backgroundSize: '200% 200%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 900, letterSpacing: '-1px', position: 'relative', animation: 'gradientShift 4s ease infinite, floatUp 0.6s cubic-bezier(0.16,1,0.3,1) both' }}>SOS</div>
              <div style={{ fontSize: '1.05rem', color: 'var(--text)', fontWeight: 600, marginBottom: 8, position: 'relative', animation: 'textReveal 0.5s ease 0.15s both' }}>{wv.greeting}</div>
              <div style={{ fontSize: '0.88rem', color: 'var(--text-dim)', maxWidth: 400, lineHeight: 1.65, marginBottom: 32, position: 'relative', animation: 'textReveal 0.5s ease 0.3s both' }}>{wv.desc}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 440, position: 'relative' }}>
                {wv.chips.map((s, i) => <button key={s} className="sos-chip" style={{ animation: `floatUp 0.4s cubic-bezier(0.16,1,0.3,1) ${0.4 + i * 0.08}s both` }} onClick={() => sendChip(s)}>{s}</button>)}
              </div>
            </div>
          );
        })()}

        {messages.map((msg, i) => (
          <React.Fragment key={i}>
            {i === 0 && dbMessageCount > 0 && messages.length > dbMessageCount && <div className="chat-history-separator"><span>Earlier in conversation</span></div>}
            {i === dbMessageCount && dbMessageCount > 0 && messages.length > dbMessageCount && <div className="chat-history-separator"><span>New messages</span></div>}
            <div className={`sos-msg ${msg.role === 'user' ? 'sos-msg-user' : 'sos-msg-ai'}`}>
              <div className={`sos-bubble ${msg.role === 'user' ? 'sos-bubble-user' : 'sos-bubble-ai'}`}>
                {(msg.photoUrl || msg.photoPreview) && <img src={msg.photoUrl || msg.photoPreview} alt="photo" onClick={() => setLightboxUrl(msg.photoUrl || msg.photoPreview)} onError={(e) => { e.target.style.display = 'none'; }} style={{ maxWidth: 240, maxHeight: 200, borderRadius: 10, marginBottom: msg.content ? 8 : 0, cursor: 'pointer', display: 'block' }} />}
                {msg.content && <span>{msg.content}</span>}
                <div className="sos-bubble-time">{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</div>
              </div>
            </div>
          </React.Fragment>
        ))}

        {pendingTemplateSelector && <div className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}><PlanTemplateSelector onSelectTemplate={(tmpl) => handleSelectTemplate(tmpl, pendingTemplateSelector.context)} onCustomPlan={handleCustomPlan} onDismiss={handleDismissTemplateSelector} /></div>}
        {pendingClarification && <div className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}><ClarificationCard clarification={pendingClarification} onSubmit={handleClarificationSubmit} onSkip={() => { setPendingClarification(null); setPendingClarificationAnswers(null); }} savedAnswers={pendingClarificationAnswers} onAnswersChange={setPendingClarificationAnswers} /></div>}

        {!pendingClarification && pendingActions.length > 1 && (
          <div className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}>
            <BulkConfirmationCard actions={pendingActions} onConfirmSelected={handleBulkConfirm} onCancel={() => setPendingActions([])} />
          </div>
        )}

        {!pendingClarification && pendingActions.length <= 1 && pendingActions.map((pa, idx) => (
          <div key={'pa-' + idx} className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}>
            {pa.action.type === 'add_recurring_event' ? (
              <RecurringEventPopup
                action={pa.action}
                onConfirm={(checkedEvents) => {
                  checkedEvents.forEach(ev => executeAction({ type:'add_event', title:ev.title, date:ev.date, event_type:ev.event_type, subject:ev.subject }));
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

        {pendingContent.map((pc, idx) => <div key={'pc-' + idx} className="sos-msg sos-msg-ai" style={{ padding: '6px 16px' }}><StudyContentRouter content={pc} onSave={() => handleSaveContent(idx)} onDismiss={() => handleDismissContent(idx)} onApplyPlan={(steps) => handleApplyPlan(idx, steps)} onStartPlanTask={(step) => handleStartPlanTask(step)} onExportGoogleDocs={(planData) => handleExportPlanToGoogleDocs(idx, planData)} googleConnected={isGoogleConnected()} /></div>)}
        {isLoading && <TypingDotsComponent />}
        {chatError && <div style={{ padding: '8px 16px' }}><div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)', fontSize: '0.84rem', color: 'var(--danger)', maxWidth: '80%' }}>{chatError}</div></div>}
        <div ref={messagesEndRef} style={{ height: 1 }} />
      </div>

      <div className="sos-input-area">
        <TutorActions
          messages={messages}
          quickChips={quickChips}
          viewingSavedChatId={viewingSavedChatId}
          saveChat={saveChat}
          resumeSavedChat={resumeSavedChat}
          exitSavedChatView={exitSavedChatView}
          setShowChatSidebar={setShowChatSidebar}
          pendingPhoto={pendingPhoto}
          setPendingPhoto={setPendingPhoto}
          isRecording={isRecording}
          recordingTime={recordingTime}
          waveformRef={waveformRef}
          cancelRecording={cancelRecording}
          stopRecording={stopRecording}
          isTranscribing={isTranscribing}
          handleSubmit={handleSubmit}
          photoInputRef={photoInputRef}
          handlePhotoSelect={handlePhotoSelect}
          workspaceModeLabel={workspaceModeLabel}
          isLoading={isLoading}
          inputRef={inputRef}
          input={input}
          setInput={setInput}
          welcomeIdx={welcomeIdx}
          handlePhotoClick={() => photoInputRef.current?.click()}
          startRecording={startRecording}
          pendingPhotoAttached={!!pendingPhoto}
          footerHints={footerHints}
        />
      </div>
    </div>
  );
}
