import { useState } from 'react';
import Icon from '../../lib/icons';

export default function DailyBriefCard({ brief, onAction }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  if (!brief) return null;
  const scheduleItems = (brief.schedule_items || []).filter(item => (item?.event_name || '').trim() || (item?.time || '').trim());
  const isScheduleBlank = scheduleItems.length === 0;
  const allClearMsg = 'all clear for now go have some fun';

  return (
    <div style={{
      background:'linear-gradient(135deg, rgba(26,26,46,0.98), rgba(15,15,26,0.95))',
      border:'1px solid rgba(108,99,255,0.2)',
      borderRadius:18,
      padding:0,
      maxWidth:480,
      width:'100%',
      maxHeight:'70vh',
      overflowY:'auto',
      overflowX:'hidden',
      boxShadow:'0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(108,99,255,0.08)',
    }}>
      <div style={{
        background:'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(43,203,186,0.1))',
        padding:'16px 20px',
        borderBottom:'1px solid rgba(108,99,255,0.1)',
        display:'flex',
        alignItems:'center',
        gap:10
      }}>
        <div style={{
          width:36, height:36, borderRadius:10,
          background:'linear-gradient(135deg, var(--accent), var(--teal))',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 12px rgba(108,99,255,0.3)'
        }}>
          {Icon.calendar(18)}
        </div>
        <div>
          <div style={{fontWeight:800, fontSize:'1rem', color:'var(--text)', letterSpacing:'-0.3px'}}>Daily Brief</div>
          <div style={{fontSize:'0.72rem', color:'var(--text-dim)', marginTop:1}}>
            {new Date().toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' })}
          </div>
        </div>
      </div>

      <div style={{
        padding:'14px 20px',
        background:'rgba(108,99,255,0.04)',
        borderBottom:'1px solid rgba(255,255,255,0.04)',
        fontSize:'0.88rem',
        color:'var(--text)',
        lineHeight:1.5,
        fontWeight:500
      }}>
        {isScheduleBlank ? allClearMsg : (brief.summary || allClearMsg)}
      </div>

      <div style={{padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
        <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8}}>Schedule</div>
        {isScheduleBlank ? (
          <div style={{fontSize:'0.84rem', color:'var(--text-dim)', lineHeight:1.5}}>{allClearMsg}</div>
        ) : scheduleItems.map((item, i) => (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:10,
              padding:'6px 0',
              borderBottom: i < scheduleItems.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none'
            }}>
              <span style={{
                fontSize:'0.78rem', fontWeight:700, color:'var(--teal)',
                minWidth:72, fontVariantNumeric:'tabular-nums'
              }}>{item.time || '—'}</span>
              <span style={{fontSize:'0.84rem', color:'var(--text)', flex:1}}>{item.event_name}</span>
              {item.related_doc_id && (
                <span style={{display:'flex', color:'var(--accent)', opacity:0.6}} title="Linked document">
                  {Icon.fileText(13)}
                </span>
              )}
            </div>
          ))}
      </div>

      {brief.plan_of_action && brief.plan_of_action.length > 0 && (
        <div style={{padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
          <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8}}>Plan of Action</div>
          {brief.plan_of_action.map((item, i) => (
            <div key={i} style={{
              display:'flex', alignItems:'flex-start', gap:8,
              padding:'5px 0', fontSize:'0.84rem', color:'var(--text)', lineHeight:1.5
            }}>
              <span style={{
                width:20, height:20, borderRadius:6, flexShrink:0, marginTop:1,
                background:'rgba(43,203,186,0.1)',
                border:'1px solid rgba(43,203,186,0.2)',
                color:'var(--teal)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:'0.7rem', fontWeight:700
              }}>{i + 1}</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      {brief.dropdown_options && brief.dropdown_options.length > 0 && (
        <div style={{padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)', position:'relative'}}>
          <button onClick={() => setDropdownOpen(!dropdownOpen)} style={{
            width:'100%',
            background:'rgba(108,99,255,0.08)',
            border:'1px solid rgba(108,99,255,0.2)',
            borderRadius:10,
            padding:'10px 14px',
            color:'var(--accent)',
            fontSize:'0.84rem',
            fontWeight:600,
            cursor:'pointer',
            display:'flex',
            alignItems:'center',
            justifyContent:'space-between',
            transition:'all .15s'
          }}>
            <span style={{display:'flex',alignItems:'center',gap:6}}>
              {Icon.zap(14)} Quick Actions
            </span>
            <span style={{
              display:'inline-flex',
              transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition:'transform .2s'
            }}>
              {Icon.arrowRight(12)}
            </span>
          </button>
          {dropdownOpen && (
            <div style={{
              marginTop:6,
              borderRadius:10,
              overflow:'hidden',
              border:'1px solid rgba(108,99,255,0.15)',
              background:'rgba(15,15,26,0.95)'
            }}>
              {brief.dropdown_options.map((opt, i) => (
                <button key={i} onClick={() => { setDropdownOpen(false); onAction(opt); }}
                  style={{
                    width:'100%',
                    background:'transparent',
                    border:'none',
                    borderBottom: i < brief.dropdown_options.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    padding:'10px 14px',
                    color:'var(--text)',
                    fontSize:'0.82rem',
                    cursor:'pointer',
                    textAlign:'left',
                    transition:'background .15s',
                    display:'flex',
                    alignItems:'center',
                    gap:8
                  }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(108,99,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <span style={{color:'var(--accent)',display:'flex'}}>{Icon.sparkles(13)}</span>
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {brief.encouragement && (
        <div style={{
          padding:'14px 20px',
          background:'linear-gradient(135deg, rgba(43,203,186,0.06), rgba(108,99,255,0.04))',
          fontSize:'0.84rem',
          color:'var(--teal)',
          fontWeight:600,
          fontStyle:'italic',
          textAlign:'center',
          lineHeight:1.5
        }}>
          {brief.encouragement}
        </div>
      )}
    </div>
  );
}
