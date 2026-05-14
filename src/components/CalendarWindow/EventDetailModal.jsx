import React, { useEffect } from 'react';

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) { return iso; }
}

function fmtTimeRange(start, end) {
  if (!start) return 'All day';
  const fmt = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    if (Number.isNaN(h)) return hhmm;
    const suf = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m || 0).padStart(2, '0')} ${suf}`;
  };
  return end ? `${fmt(start)} — ${fmt(end)}` : fmt(start);
}

function isPastEvent(ev) {
  if (!ev?.date) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const evDate = new Date(ev.date + 'T00:00:00');
  return evDate < today;
}

export default function EventDetailModal({ event, onClose, onEdit, onDelete }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!event) return null;

  const start = event.start_time || event.time;
  const end = event.end_time;
  const past = isPastEvent(event);
  const accent = event.color || 'var(--primary)';

  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.55)',
        display:'flex', alignItems:'center', justifyContent:'center',
        zIndex: 9999, animation: 'sos-modal-fade 0.18s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Event details"
        style={{
          background:'rgba(22,22,36,0.98)', border:'1px solid rgba(255,255,255,0.08)',
          borderRadius:18, width:'min(440px, 92vw)',
          boxShadow:'0 16px 48px rgba(0,0,0,0.55)', overflow:'hidden',
          animation:'sos-modal-pop 0.22s cubic-bezier(0.34, 1.4, 0.64, 1)',
        }}
      >
        <div style={{height:5, background: accent}}/>
        <div style={{padding:'18px 22px 8px', display:'flex', alignItems:'flex-start', gap:12}}>
          <div style={{flex:1}}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
              {event.event_type && (
                <span style={{
                  fontSize:'0.65rem', textTransform:'uppercase', letterSpacing:'0.6px',
                  color:'var(--text-dim)', background:'rgba(255,255,255,0.05)',
                  padding:'2px 8px', borderRadius:10, fontWeight:700,
                }}>{event.event_type}</span>
              )}
              {past && (
                <span style={{
                  fontSize:'0.65rem', textTransform:'uppercase', letterSpacing:'0.6px',
                  color:'rgba(255,255,255,0.5)', background:'rgba(255,255,255,0.04)',
                  padding:'2px 8px', borderRadius:10, fontWeight:700,
                }}>Past</span>
              )}
            </div>
            <div style={{fontSize:'1.2rem', fontWeight:700, color:'var(--text)', lineHeight:1.25, letterSpacing:'-0.3px'}}>
              {event.title || 'Untitled event'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)',
            padding:'2px 8px', fontSize:'1.2rem', lineHeight:1,
          }}>×</button>
        </div>

        <div style={{padding:'4px 22px 14px', display:'flex', flexDirection:'column', gap:10}}>
          <Row icon="📅" label={fmtDate(event.date)}/>
          <Row icon="🕒" label={fmtTimeRange(start, end)}/>
          {event.subject && <Row icon="📚" label={event.subject}/>}
          {event.location && <Row icon="📍" label={event.location}/>}
          {event.description && (
            <div style={{
              marginTop:4, padding:'10px 12px', background:'rgba(255,255,255,0.03)',
              border:'1px solid rgba(255,255,255,0.06)', borderRadius:10,
              fontSize:'0.86rem', lineHeight:1.45, color:'var(--text)',
              whiteSpace:'pre-wrap',
            }}>{event.description}</div>
          )}
        </div>

        <div style={{
          display:'flex', gap:8, padding:'10px 16px 14px',
          borderTop:'1px solid rgba(255,255,255,0.06)',
        }}>
          {onDelete && (
            <button onClick={() => { onDelete(event); }} style={{
              background:'transparent', border:'1px solid rgba(255,90,90,0.25)',
              borderRadius:8, padding:'8px 14px', color:'#ff7a7a', fontSize:'0.84rem',
              fontWeight:600, cursor:'pointer',
            }}>Delete</button>
          )}
          <div style={{flex:1}}/>
          <button onClick={onClose} style={{
            background:'transparent', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'8px 14px', color:'var(--text-dim)', fontSize:'0.84rem',
            fontWeight:600, cursor:'pointer',
          }}>Close</button>
          {onEdit && (
            <button onClick={() => onEdit(event)} style={{
              background:'var(--accent, var(--primary))',
              border:'1px solid var(--accent, var(--primary))',
              borderRadius:8, padding:'8px 18px', color:'#fff', fontSize:'0.86rem',
              fontWeight:700, cursor:'pointer',
            }}>Edit</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label }) {
  return (
    <div style={{display:'flex', alignItems:'center', gap:10, fontSize:'0.9rem', color:'var(--text)'}}>
      <span style={{opacity:0.65, fontSize:'0.95rem', flexShrink:0, width:18, textAlign:'center'}}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}
