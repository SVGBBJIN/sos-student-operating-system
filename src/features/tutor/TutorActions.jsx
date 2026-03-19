import React from 'react';
import Icon from '../../lib/icons';

export default function TutorActions({ messages, quickChips, viewingSavedChatId, saveChat, resumeSavedChat, exitSavedChatView, setShowChatSidebar, pendingPhoto, setPendingPhoto, isRecording, recordingTime, waveformRef, cancelRecording, stopRecording, isTranscribing, handleSubmit, photoInputRef, handlePhotoSelect, workspaceModeLabel, isLoading, inputRef, input, setInput, welcomeIdx, handlePhotoClick, startRecording, pendingPhotoAttached, footerHints }) {
  return (
    <>
      {messages.length>0&&(
        <div style={{display:'flex',gap:8,marginBottom:8,overflowX:'auto',paddingBottom:2}}>
          {quickChips.map((chip,i)=>(<button key={i} className="sos-chip" onClick={()=>chip.action?chip.action():chip.onSend(chip.msg)}>{chip.label}</button>))}
          {!viewingSavedChatId && <button className="sos-chip" onClick={saveChat} style={{background:'rgba(46,213,115,0.08)',borderColor:'rgba(46,213,115,0.2)',color:'var(--success)'}}>Save chat</button>}
          {viewingSavedChatId && <button className="sos-chip" onClick={() => resumeSavedChat(viewingSavedChatId)} style={{background:'rgba(46,213,115,0.08)',borderColor:'rgba(46,213,115,0.2)',color:'var(--success)'}}>Resume chat</button>}
          {viewingSavedChatId && <button className="sos-chip" onClick={exitSavedChatView} style={{background:'rgba(108,99,255,0.08)',borderColor:'rgba(108,99,255,0.2)',color:'var(--accent)'}}>Back</button>}
          <button className="sos-chip" onClick={()=>setShowChatSidebar(true)} style={{background:'rgba(108,99,255,0.06)',borderColor:'rgba(108,99,255,0.15)',color:'var(--accent)'}}>History</button>
        </div>
      )}
      {pendingPhoto&&(
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,padding:'6px 10px',background:'var(--bg)',borderRadius:12,border:'1px solid var(--border)',animation:'fadeIn .2s ease'}}>
          <img src={pendingPhoto.preview} alt="attached" style={{width:48,height:48,borderRadius:8,objectFit:'cover'}}/>
          <span style={{fontSize:'0.82rem',color:'var(--text-dim)',flex:1}}>Photo attached</span>
          <button onClick={()=>setPendingPhoto(null)} style={{background:'transparent',border:'none',color:'var(--danger)',cursor:'pointer',padding:'4px 8px',display:'flex'}}>{Icon.x(16)}</button>
        </div>
      )}
      {isRecording ? (
        <div className="voice-bar">
          <div className="voice-bar-indicator"><div className="voice-bar-dot"/><div className="voice-bar-timer">{Math.floor(recordingTime/60)}:{String(recordingTime%60).padStart(2,'0')}</div></div>
          <div className="voice-bar-waveform" ref={waveformRef}>{Array.from({length:40},(_,i)=><div key={i} className="voice-bar-bar" style={{height:'3px'}}/>)}</div>
          <button className="voice-bar-cancel" onClick={cancelRecording} title="Cancel">{Icon.trash(16)}</button>
          <button className="voice-bar-send" onClick={stopRecording} title="Send voice">{Icon.send(18)}</button>
        </div>
      ) : isTranscribing ? (
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,padding:'14px 16px',background:'linear-gradient(135deg,rgba(26,26,46,0.97),rgba(15,15,26,0.97))',border:'1px solid rgba(108,99,255,0.15)',borderRadius:28}}><div style={{width:18,height:18,border:'2px solid var(--accent)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .6s linear infinite'}}/><span style={{fontSize:'0.85rem',color:'var(--text-dim)'}}>Transcribing...</span></div>
      ) : (
        <form onSubmit={handleSubmit} style={{display:'flex',gap:8,alignItems:'center'}}>
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={handlePhotoSelect}/>
          {workspaceModeLabel && <span style={{padding:'4px 9px',borderRadius:999,fontSize:'0.72rem',fontWeight:600,color:'var(--accent)',background:'rgba(108,99,255,0.1)',border:'1px solid rgba(108,99,255,0.24)',whiteSpace:'nowrap'}}>{workspaceModeLabel}</span>}
          <button type="button" onClick={handlePhotoClick} disabled={isLoading} style={{width:40,height:40,borderRadius:'50%',background:'transparent',border:'1px solid '+(pendingPhotoAttached?'var(--accent)':'var(--border)'),color:pendingPhotoAttached?'var(--accent)':'var(--text-dim)',cursor:isLoading?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .2s',opacity:isLoading?0.5:1}}>{Icon.camera(18)}</button>
          <button type="button" onClick={startRecording} disabled={isLoading||!!viewingSavedChatId} style={{width:40,height:40,borderRadius:'50%',background:'transparent',border:'1px solid var(--border)',color:'var(--text-dim)',cursor:(isLoading||viewingSavedChatId)?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .2s',opacity:(isLoading||viewingSavedChatId)?0.5:1}}>{Icon.mic(18)}</button>
          <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} placeholder={viewingSavedChatId?"viewing saved chat — click 'Resume' to continue":pendingPhoto?"add a message or just send the photo...":messages.length===0?["What's on your plate today?","What do you need help with?","Tell me about your classes...","What's coming up this week?","Anything on your mind?"][welcomeIdx]:"type anything..."} disabled={isLoading||!!viewingSavedChatId} style={{flex:1,background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:24,padding:'12px 20px',fontSize:'0.92rem',outline:'none',opacity:(isLoading||viewingSavedChatId)?0.5:1,transition:'all .25s cubic-bezier(0.16,1,0.3,1)'}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSubmit()}}}/>
          <button type="submit" disabled={isLoading||!!viewingSavedChatId||(!input.trim()&&!pendingPhoto)} style={{width:44,height:44,borderRadius:'50%',background:(isLoading||!!viewingSavedChatId||(!input.trim()&&!pendingPhoto))?'var(--border)':'linear-gradient(135deg,var(--accent),#5a54d4)',color:'#fff',border:'none',cursor:(isLoading||!!viewingSavedChatId||(!input.trim()&&!pendingPhoto))?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all .2s',flexShrink:0,boxShadow:(isLoading||!!viewingSavedChatId||(!input.trim()&&!pendingPhoto))?'none':'0 2px 12px rgba(108,99,255,0.3)'}}>{Icon.send(18)}</button>
        </form>
      )}
      <div style={{display:'flex',justifyContent:'center',gap:16,marginTop:8,fontSize:'0.68rem',color:'var(--text-dim)',flexWrap:'wrap'}}>{footerHints.map((hint) => hint.href ? <a key={hint.label} href={hint.href} style={{color:'var(--text-dim)',textDecoration:'none',opacity:0.6,transition:'opacity .15s'}} onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0.6}>{hint.label}</a> : <span key={hint.label}>{hint.label}</span>)}</div>
    </>
  );
}
