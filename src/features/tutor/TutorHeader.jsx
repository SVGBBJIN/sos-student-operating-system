import React from 'react';
import Icon from '../../lib/icons';

export default function TutorHeader({ user, syncStatus, showTutorIndicatorTopbar, showPerfIndicatorTopbar, TutorIndicator, PerfPill, tutorMode, setLayoutMode, setShowPeek, setShowNotes, setShowChatSidebar, setActivePanel }) {
  return (
    <div className="sos-header">
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <button onClick={()=>setLayoutMode('sidebar')} className="topbar-sidebar-btn" title="Sidebar mode" aria-label="Sidebar mode">{Icon.panel(16)}</button>
        <div className="sos-sidebar-brand" style={{width:34,height:34}}><img className="sos-brand-logo" src="/brain-logo.svg" alt="SOS" style={{width:30,height:30}}/></div>
        {user && <div style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:4}}><span className={'sync-dot '+(syncStatus==='saving'?'sync-saving':syncStatus==='error'?'sync-error':'sync-saved')}/>{syncStatus==='saving'?'Saving...':syncStatus==='error'?'Sync error':'Synced'}</div>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        {showTutorIndicatorTopbar && <TutorIndicator active={tutorMode} />}
        {showPerfIndicatorTopbar && <PerfPill />}
        <button onClick={()=>setShowPeek(p=>!p)} className="g-hdr-btn">{Icon.clipboard(14)} Peek</button>
        <button onClick={()=>setShowNotes(true)} className="g-hdr-btn">{Icon.fileText(14)} Notes</button>
        <button onClick={()=>setShowChatSidebar(true)} className="g-hdr-btn">{Icon.messageCircle(14)} History</button>
        <button onClick={()=>setActivePanel('settings')} className="g-hdr-btn">{Icon.edit(14)} Settings</button>
      </div>
    </div>
  );
}
