import React from 'react';
import Icon from '../lib/icons';

const TYPE_LABEL = { note: 'Note', event: 'Event', task: 'Task' };
const TYPE_COLOR = { note: 'var(--teal)', event: 'var(--blue)', task: 'var(--accent)' };

function entityName(e) { return e?.title || e?.name || '(untitled)'; }

export default function LinkSuggestionCard({ suggestion, onApprove, onReject, onDismiss }) {
  if (!suggestion) return null;
  const { source, target, score } = suggestion;

  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(43,203,186,0.08), rgba(108,99,255,0.06))',
      border: '1px solid rgba(43,203,186,0.25)',
      maxWidth: '88%',
      boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
    }}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,fontSize:'0.72rem',color:'var(--text-dim)',textTransform:'uppercase',letterSpacing:'0.5px'}}>
        <span style={{display:'flex',color:'var(--teal)'}}>{Icon.link ? Icon.link(12) : '🔗'}</span>
        <span>Suggested link</span>
        {typeof score === 'number' && (
          <span style={{marginLeft:'auto',fontSize:'0.68rem',opacity:0.7}}>score {score}</span>
        )}
      </div>

      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:10,fontSize:'0.86rem'}}>
        <span style={{padding:'2px 8px',borderRadius:8,background:'var(--bg2)',color:TYPE_COLOR[source?.type]||'var(--accent)',fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase'}}>
          {TYPE_LABEL[source?.type]||'item'}
        </span>
        <span style={{fontWeight:600}}>{entityName(source)}</span>
        <span style={{opacity:0.5}}>↔</span>
        <span style={{padding:'2px 8px',borderRadius:8,background:'var(--bg2)',color:TYPE_COLOR[target?.type]||'var(--accent)',fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase'}}>
          {TYPE_LABEL[target?.type]||'item'}
        </span>
        <span style={{fontWeight:600}}>{entityName(target)}</span>
      </div>

      <div style={{fontSize:'0.78rem',color:'var(--text-dim)',marginBottom:10,lineHeight:1.4}}>
        These look related — link them so SOS can pull up context across both?
      </div>

      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button
          onClick={() => onDismiss && onDismiss(suggestion)}
          style={{padding:'6px 12px',borderRadius:10,border:'1px solid rgba(255,255,255,0.1)',background:'transparent',color:'var(--text-dim)',fontSize:'0.78rem',cursor:'pointer'}}
        >Not now</button>
        <button
          onClick={() => onReject && onReject(suggestion)}
          style={{padding:'6px 12px',borderRadius:10,border:'1px solid rgba(255,71,87,0.3)',background:'transparent',color:'var(--danger)',fontSize:'0.78rem',cursor:'pointer'}}
        >Reject</button>
        <button
          onClick={() => onApprove && onApprove(suggestion)}
          style={{padding:'6px 14px',borderRadius:10,border:'none',background:'linear-gradient(135deg,var(--teal),var(--accent))',color:'#fff',fontSize:'0.82rem',fontWeight:700,cursor:'pointer'}}
        >Link them</button>
      </div>
    </div>
  );
}
