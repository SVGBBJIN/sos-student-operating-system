import React, { useState, useEffect } from 'react';

/* ═══════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════ */
export function Toast({message,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,2400);return()=>clearTimeout(t)},[]);
  return(<div style={{position:'fixed',top:20,left:'50%',transform:'translateX(-50%)',zIndex:9999,padding:'10px 20px',borderRadius:14,background:'linear-gradient(135deg,var(--success),#1db954)',color:'#fff',fontWeight:600,fontSize:'0.88rem',boxShadow:'0 4px 24px rgba(46,213,115,0.4),0 0 40px rgba(46,213,115,0.1)',animation:'toastIn .3s cubic-bezier(0.16,1,0.3,1), toastOut .3s ease 2.1s forwards',backdropFilter:'blur(8px)'}}>{message}</div>);
}

// Persistent confirmation card for single-signal LMS pending closes.
// Shows for up to 5 min; server auto-promotes after that window anyway.
export function LmsPendingToast({ taskTitle, lmsName, onConfirm, onReject }) {
  const WINDOW_S = 300; // 5 min — matches the cron window
  const [secsLeft, setSecsLeft] = useState(WINDOW_S);
  useEffect(() => {
    const t = setInterval(() => setSecsLeft(s => {
      if (s <= 1) { clearInterval(t); onConfirm(); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;
  const countdown = `${mins}:${String(secs).padStart(2, '0')}`;
  return (
    <div style={{
      position:'fixed', top:20, left:'50%', transform:'translateX(-50%)',
      zIndex:9999, padding:'14px 18px', borderRadius:16,
      background:'var(--bg-secondary,#1e1e2e)', color:'var(--text,#e2e8f0)',
      boxShadow:'0 8px 32px rgba(0,0,0,0.4)', display:'flex', flexDirection:'column',
      gap:10, minWidth:280, maxWidth:360, animation:'toastIn .3s cubic-bezier(0.16,1,0.3,1)',
      border:'1px solid var(--border,rgba(255,255,255,0.08))',
    }}>
      <div style={{fontSize:'0.8rem', opacity:0.6, fontWeight:500}}>
        {lmsName} detected a submission
      </div>
      <div style={{fontWeight:600, fontSize:'0.9rem', lineHeight:1.35}}>
        Did you submit <span style={{color:'var(--accent,#7c6af7)'}}>{taskTitle}</span>?
      </div>
      <div style={{display:'flex', gap:8, marginTop:2}}>
        <button onClick={onConfirm} style={{
          flex:1, padding:'8px 0', borderRadius:10, border:'none', cursor:'pointer',
          background:'var(--success,#2ed573)', color:'#fff', fontWeight:700, fontSize:'0.85rem',
        }}>Yes, mark done</button>
        <button onClick={onReject} style={{
          flex:1, padding:'8px 0', borderRadius:10, cursor:'pointer', fontWeight:600,
          background:'transparent', border:'1px solid var(--border,rgba(255,255,255,0.15))',
          color:'var(--text-secondary,#94a3b8)', fontSize:'0.85rem',
        }}>Not yet</button>
      </div>
      <div style={{fontSize:'0.72rem', opacity:0.4, textAlign:'center'}}>
        Auto-confirming in {countdown}
      </div>
    </div>
  );
}

export function AppleSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={'apple-toggle' + (checked ? ' on' : '')}
    >
      <span className="apple-toggle-knob" />
    </button>
  );
}
