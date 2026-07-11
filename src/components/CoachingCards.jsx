import React, { useState } from 'react';
import Icon from '../lib/icons';

/* ═══════════════════════════════════════════════
   HINT & WORK-CHECK CARDS
   ═══════════════════════════════════════════════ */
export const CONTENT_TYPE_LABEL = { procedure: 'Procedure', fact: 'Fact', argument: 'Argument' };

// The forward clue: one nudge toward a checkable attempt. "Still stuck" never
// yields a second clue — it routes the student to put down an attempt and run
// the check. The deep fallback (a parallel problem) only appears when offered.
export function ClueCard({ data, onDismiss }) {
  const ac = 'var(--blue)';
  const [showStuck, setShowStuck] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const typeLabel = CONTENT_TYPE_LABEL[data.content_type] || 'Clue';
  return (
    <div className="content-card" style={{borderLeftColor:ac}}>
      <div className="content-card-header">
        <div className="content-card-hdr-icon" style={{background:`color-mix(in srgb, ${ac} 10%, transparent)`,borderColor:`color-mix(in srgb, ${ac} 20%, transparent)`,color:ac}}>{Icon.helpCircle(16)}</div>
        <div>
          <div className="content-card-title">Clue</div>
          <div className="content-card-subject">{typeLabel} · enough to attempt, not to solve</div>
        </div>
      </div>
      <div className="content-card-body">
        <div style={{fontSize:'0.9rem',lineHeight:1.5,color:'var(--text)'}}>{data.clue}</div>
        {!showStuck ? (
          <button onClick={() => setShowStuck(true)} style={{marginTop:12,background:'none',border:'none',color:ac,fontSize:'0.8rem',cursor:'pointer',padding:0,fontWeight:600}}>Still stuck?</button>
        ) : (
          <div style={{marginTop:12,padding:'10px 12px',borderRadius:8,background:'color-mix(in srgb, var(--blue) 8%, transparent)',fontSize:'0.84rem',lineHeight:1.45,color:'var(--text-dim)'}}>
            {data.next_if_stuck}
          </div>
        )}
        {data.deep_fallback?.parallel_problem && (
          !showFallback ? (
            <button onClick={() => setShowFallback(true)} style={{marginTop:8,display:'block',background:'none',border:'none',color:'var(--text-dim)',fontSize:'0.78rem',cursor:'pointer',padding:0}}>No attempt yet? Try a parallel problem →</button>
          ) : (
            <div style={{marginTop:8,padding:'10px 12px',borderRadius:8,border:'1px dashed var(--border)',fontSize:'0.84rem',lineHeight:1.45,color:'var(--text)'}}>
              <div style={{fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',color:'var(--text-dim)',marginBottom:6}}>Parallel problem</div>
              {data.deep_fallback.parallel_problem}
              <div style={{marginTop:6,fontStyle:'italic',color:'var(--text-dim)',fontSize:'0.76rem'}}>Re-derive this one — your original answer stays hidden.</div>
            </div>
          )
        )}
      </div>
      <div className="content-card-actions">
        <button className="content-card-dismiss" onClick={onDismiss}>Got it</button>
      </div>
    </div>
  );
}

// The backward check: strengths first, ≤3 gaps, a coverage number that is never
// a grade, and at the terminal proofread round it hands the work back for a
// directed self-read instead of giving a verdict.
export function WorkCheckCard({ data, onDismiss }) {
  const ac = 'var(--teal)';
  const cards = Array.isArray(data.cards) ? data.cards : [];
  const coverage = data.coverage || { addressed: 0, total: 0 };
  const terminal = data.proofread?.terminal;
  const typeLabel = CONTENT_TYPE_LABEL[data.content_type] || 'Work check';
  return (
    <div className="content-card" style={{borderLeftColor:ac}}>
      <div className="content-card-header">
        <div className="content-card-hdr-icon" style={{background:`color-mix(in srgb, ${ac} 10%, transparent)`,borderColor:`color-mix(in srgb, ${ac} 20%, transparent)`,color:ac}}>{Icon.checkCircle(16)}</div>
        <div>
          <div className="content-card-title">Work check</div>
          <div className="content-card-subject">{typeLabel}{data.proofread ? ` · round ${data.proofread.round} of ${data.proofread.max}` : ''}</div>
        </div>
      </div>
      <div className="content-card-body">
        {coverage.total > 0 && (
          <div style={{marginBottom:10,fontSize:'0.82rem',color:'var(--text-dim)'}}>
            <span style={{fontWeight:700,color:'var(--text)'}}>{coverage.addressed} of {coverage.total} addressed</span>
            <span style={{marginLeft:6,fontStyle:'italic'}}>— coverage, not a grade</span>
          </div>
        )}
        {data.needs_rubric_nudge && (
          <div style={{marginBottom:10,padding:'8px 10px',borderRadius:8,background:'color-mix(in srgb, var(--orange) 10%, transparent)',fontSize:'0.78rem',color:'var(--text-dim)'}}>
            Paste your rubric or the prompt and I'll check against your real criteria.
          </div>
        )}
        {data.error_class && (
          <div style={{marginBottom:10,fontSize:'0.82rem',color:'var(--text-dim)'}}>
            Likely class of issue: <span style={{color:'var(--text)'}}>{data.error_class}</span>
          </div>
        )}
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {cards.map((c, i) => {
            const isStrength = c.kind === 'strength';
            const isGrammar = c.lane === 'grammar';
            const color = isStrength ? 'var(--teal)' : isGrammar ? 'var(--text-dim)' : 'var(--orange)';
            const icon = isStrength ? Icon.checkCircle(14) : (c.hedged ? Icon.helpCircle(14) : Icon.alertTriangle(14));
            return (
              <div key={i} style={{display:'flex',gap:8,padding:'8px 10px',borderRadius:8,background:'var(--bg-soft, rgba(127,127,127,0.06))'}}>
                <span style={{color,flexShrink:0,marginTop:1}}>{icon}</span>
                <div style={{fontSize:'0.85rem',lineHeight:1.45,color:'var(--text)'}}>
                  {c.text}
                  {c.self_attest && <span style={{marginLeft:6,fontSize:'0.72rem',color:'var(--text-dim)',fontStyle:'italic'}}>· your teacher checks this</span>}
                  {isGrammar && <span style={{marginLeft:6,fontSize:'0.72rem',color:'var(--text-dim)'}}>· grammar</span>}
                </div>
              </div>
            );
          })}
        </div>
        {terminal && (
          <div style={{marginTop:12,padding:'10px 12px',borderRadius:8,border:`1px solid color-mix(in srgb, ${ac} 25%, transparent)`,fontSize:'0.84rem',lineHeight:1.45,color:'var(--text)'}}>
            {data.unwritten_note && <div style={{marginBottom:6,color:'var(--text-dim)'}}>{data.unwritten_note}</div>}
            That's the last check for now. Read it out loud — listen for any sentence you stumble on. It's yours from here.
          </div>
        )}
      </div>
      <div className="content-card-actions">
        <button className="content-card-dismiss" onClick={onDismiss}>Done</button>
      </div>
    </div>
  );
}
