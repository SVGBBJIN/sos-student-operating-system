import React, { useState } from 'react';
import Icon from '../../lib/icons';

function ContentCard({ icon, title, subject, onSave, onDismiss, children, accentColor }) {
  const ac = accentColor || 'var(--teal)';
  return (
    <div className="content-card" style={{borderLeftColor:ac}}>
      <div className="content-card-header">
        <div className="content-card-hdr-icon" style={{background:`color-mix(in srgb, ${ac} 10%, transparent)`,borderColor:`color-mix(in srgb, ${ac} 20%, transparent)`,color:ac}}>{icon}</div>
        <div>
          <div className="content-card-title">{title}</div>
          {subject && <div className="content-card-subject">{subject}</div>}
        </div>
      </div>
      <div className="content-card-body">{children}</div>
      <div className="content-card-actions">
        <button className="content-card-save" style={{background:`linear-gradient(135deg, ${ac}, color-mix(in srgb, ${ac} 70%, #000))`,boxShadow:`0 2px 12px color-mix(in srgb, ${ac} 25%, transparent)`}} onClick={onSave}>{Icon.fileText(14)} Save to Notes</button>
        <button className="content-card-dismiss" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function FlashcardDisplay({ data, onSave, onDismiss }) {
  const cards = data.cards || [];
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (cards.length === 0) return <ContentCard icon={Icon.layers(16)} title={data.title||'Flashcards'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)"><div style={{color:'var(--text-dim)',fontSize:'0.85rem'}}>No cards generated.</div></ContentCard>;

  function goNext() { if (idx < cards.length - 1) { setFlipped(false); setTimeout(() => setIdx(i => i + 1), 100); } }
  function goPrev() { if (idx > 0) { setFlipped(false); setTimeout(() => setIdx(i => i - 1), 100); } }

  return (
    <ContentCard icon={Icon.layers(16)} title={data.title||'Flashcards'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)">
      <div className="fc-container" onClick={() => setFlipped(f => !f)}>
        <div className={'fc-inner' + (flipped ? ' flipped' : '')}>
          <div className="fc-front"><div>{cards[idx]?.q || 'No question'}</div></div>
          <div className="fc-back"><div>{cards[idx]?.a || 'No answer'}</div></div>
        </div>
      </div>
      <div className="fc-nav">
        <button className="fc-nav-btn" onClick={(e) => { e.stopPropagation(); goPrev(); }} disabled={idx === 0}>{Icon.chevronLeft(16)}</button>
        <span className="fc-counter">{idx + 1} / {cards.length}</span>
        <button className="fc-nav-btn" onClick={(e) => { e.stopPropagation(); goNext(); }} disabled={idx === cards.length - 1}>{Icon.chevronRight(16)}</button>
      </div>
      {flipped && (
        <div className="fc-chips">
          <button className="fc-chip chip-know" onClick={(e) => { e.stopPropagation(); goNext(); }}>✓ Got it</button>
          <button className="fc-chip chip-unsure" onClick={(e) => { e.stopPropagation(); goNext(); }}>~ Almost</button>
          <button className="fc-chip chip-nope" onClick={(e) => { e.stopPropagation(); goNext(); }}>✗ Nope</button>
        </div>
      )}
      <div className="fc-hint">tap card to flip</div>
    </ContentCard>
  );
}

function QuizDisplay({ data, onSave, onDismiss }) {
  const questions = data.questions || [];
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  if (questions.length === 0) return <ContentCard icon={Icon.fileText(16)} title={data.title||'Quiz'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--orange)"><div style={{color:'var(--text-dim)',fontSize:'0.85rem'}}>No questions generated.</div></ContentCard>;

  const q = questions[qIdx];
  function checkAnswer() {
    if (!selected || revealed) return;
    setRevealed(true);
    if (selected === q.answer) setScore(s => s + 1);
  }
  function nextQuestion() {
    if (qIdx < questions.length - 1) { setQIdx(i => i + 1); setSelected(null); setRevealed(false); }
    else setFinished(true);
  }

  return (
    <ContentCard icon={Icon.fileText(16)} title={data.title||'Quiz'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--orange)">
      {finished ? (
        <div className="quiz-score">
          <div style={{ marginBottom:8, color: score === questions.length ? 'var(--success)' : score >= questions.length * 0.7 ? 'var(--accent)' : 'var(--text-dim)', display:'flex', justifyContent:'center' }}>{score === questions.length ? Icon.trophy(32) : score >= questions.length * 0.7 ? Icon.thumbsUp(32) : Icon.bookOpen(32)}</div>
          <div>{score} / {questions.length} correct</div>
          <div style={{ fontSize:'0.82rem', color:'var(--text-dim)', fontWeight:400, marginTop:4 }}>{score === questions.length ? 'Perfect score!' : score >= questions.length * 0.7 ? 'Nice job!' : 'Keep studying, you got this!'}</div>
          <button className="quiz-btn" style={{ marginTop:12 }} onClick={() => { setQIdx(0); setSelected(null); setRevealed(false); setScore(0); setFinished(false); }}>Try Again</button>
        </div>
      ) : (
        <>
          <div className="quiz-progress">
            <span>{qIdx + 1}/{questions.length}</span>
            <div className="quiz-progress-bar"><div className="quiz-progress-fill" style={{ width: ((qIdx + 1) / questions.length * 100) + '%' }}/></div>
            <span style={{ color:'var(--success)', display:'flex', alignItems:'center', gap:2 }}>{score} {Icon.check(12)}</span>
          </div>
          <div className="quiz-question">{q?.q || 'No question'}</div>
          <div className="quiz-choices">
            {(q?.choices || []).map((choice, i) => {
              let cls = 'quiz-choice';
              if (revealed && choice === q.answer) cls += ' correct';
              else if (revealed && choice === selected && choice !== q.answer) cls += ' wrong';
              else if (!revealed && choice === selected) cls += ' selected';
              if (revealed && choice === q.answer && choice !== selected) cls += ' reveal-correct';
              return <button key={i} className={cls} onClick={() => { if (!revealed) setSelected(choice); }}>{choice}</button>;
            })}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {!revealed && <button className="quiz-btn" onClick={checkAnswer} disabled={!selected}>Check Answer</button>}
            {revealed && <button className="quiz-btn" style={{display:'flex',alignItems:'center',gap:4}} onClick={nextQuestion}>{qIdx < questions.length - 1 ? <>Next {Icon.arrowRight(14)}</> : 'See Score'}</button>}
          </div>
        </>
      )}
    </ContentCard>
  );
}

function GenericContentDisplay({ data, icon, label, onSave, onDismiss, accentColor, fmt }) {
  const ac = accentColor || 'var(--teal)';
  const formatted = (() => {
    try {
      switch (data.type) {
        case 'create_summary':
          return (data.bullets||[]).map(b => ({ type:'bullet', text:b }));
        case 'create_outline':
          return (data.sections||[]).flatMap(s => [{ type:'heading', text: s.heading }, ...(s.points||[]).map(p => ({ type:'point', text: p }))]);
        case 'create_study_plan':
          return (data.steps||[]).map((s,i) => ({ type:'step', num:i+1, text:s.step, meta:(s.time_minutes||20)+'min'+(s.day?' · '+s.day:'') }));
        case 'create_project_breakdown':
          return (data.phases||[]).flatMap(p => [{ type:'heading', text: p.phase + (p.deadline ? ' — due ' + fmt(p.deadline) : '') }, ...(p.tasks||[]).map(t => ({ type:'point', text: t }))]);
        default:
          return [{ type:'bullet', text:'(content generated)' }];
      }
    } catch(e) {
      return [{ type:'bullet', text:'(error displaying content)' }];
    }
  })();

  return (
    <ContentCard icon={icon} title={data.title||label} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor={ac}>
      <div style={{ maxHeight:220, overflowY:'auto', fontSize:'0.85rem', lineHeight:1.6 }}>
        {formatted.map((item, i) => {
          if (item.type==='heading') return <div key={i} style={{ fontWeight:700, color:ac, marginTop: i > 0 ? 10 : 0, marginBottom:4, fontSize:'0.86rem', display:'flex', alignItems:'center', gap:6 }}><span style={{width:3,height:14,borderRadius:2,background:ac,flexShrink:0}}/>{item.text}</div>;
          if (item.type==='step') return <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}><span style={{width:22,height:22,borderRadius:6,background:`color-mix(in srgb, ${ac} 10%, transparent)`,border:`1px solid color-mix(in srgb, ${ac} 20%, transparent)`,color:ac,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.72rem',fontWeight:700,flexShrink:0}}>{item.num}</span><div><div style={{color:'var(--text)',fontWeight:500}}>{item.text}</div><div style={{fontSize:'0.75rem',color:'var(--text-dim)',marginTop:1}}>{item.meta}</div></div></div>;
          if (item.type==='point') return <div key={i} style={{ padding:'3px 0 3px 14px', color:'var(--text)', borderLeft:`2px solid color-mix(in srgb, ${ac} 25%, transparent)`, marginLeft:2 }}>• {item.text}</div>;
          return <div key={i} style={{ padding:'4px 0', color:'var(--text)', display:'flex', alignItems:'flex-start', gap:8 }}><span style={{width:5,height:5,borderRadius:'50%',background:ac,marginTop:7,flexShrink:0}}/>{item.text}</div>;
        })}
      </div>
    </ContentCard>
  );
}

function StudyContentRouter({ content, onSave, onDismiss, onApplyPlan, onStartPlanTask, onExportGoogleDocs, googleConnected, PlanCard, fmt }) {
  switch (content.type) {
    case 'make_plan':
      return <PlanCard data={content} onApply={onApplyPlan} onSave={onSave} onDismiss={onDismiss} onStartTask={onStartPlanTask} onExportGoogleDocs={onExportGoogleDocs} googleConnected={googleConnected} />;
    case 'create_flashcards':
      return <FlashcardDisplay data={content} onSave={onSave} onDismiss={onDismiss} />;
    case 'create_quiz':
      return <QuizDisplay data={content} onSave={onSave} onDismiss={onDismiss} />;
    case 'create_outline':
      return <GenericContentDisplay data={content} icon={Icon.listTree(16)} label="Outline" onSave={onSave} onDismiss={onDismiss} accentColor="var(--blue)" fmt={fmt} />;
    case 'create_summary':
      return <GenericContentDisplay data={content} icon={Icon.clipboard(16)} label="Summary" onSave={onSave} onDismiss={onDismiss} accentColor="var(--teal)" fmt={fmt} />;
    case 'create_study_plan':
      return <GenericContentDisplay data={content} icon={Icon.calendar(16)} label="Study Plan" onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)" fmt={fmt} />;
    case 'create_project_breakdown':
      return <GenericContentDisplay data={content} icon={Icon.hammer(16)} label="Project Breakdown" onSave={onSave} onDismiss={onDismiss} accentColor="var(--orange)" fmt={fmt} />;
    default:
      return <GenericContentDisplay data={content} icon={Icon.zap(16)} label="Content" onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)" fmt={fmt} />;
  }
}

export { ContentCard, FlashcardDisplay, QuizDisplay, GenericContentDisplay, StudyContentRouter };
