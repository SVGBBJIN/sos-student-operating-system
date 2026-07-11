import Icon from '../lib/icons';

export const ThinkingIndicator=({message="thinkisizing…"})=>(
  <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
    <div style={{background:'linear-gradient(135deg,rgba(26,26,46,0.95),rgba(15,15,26,0.95))',border:'1px solid rgba(108,99,255,0.12)',borderRadius:16,borderBottomLeftRadius:4,padding:'10px 18px',display:'inline-flex',flexDirection:'column',gap:8,minWidth:200,backdropFilter:'blur(8px)',animation:'borderGlow 2s ease-in-out infinite'}}>
      <span style={{fontSize:13,fontStyle:'italic',background:'linear-gradient(135deg, var(--accent), var(--teal))',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',animation:'textPulse 1.6s ease-in-out infinite'}}>{message}</span>
      <div className="sos-slider-track" style={{height:3,width:'100%'}}/>
    </div>
  </div>
);

const PIPELINE_STEP_LABELS = ['Analyzing', 'Drafting', 'Reviewing', 'Finalizing'];
export function PipelineProgressIndicator({ progress }) {
  if (!progress) return null;
  const { step, totalSteps, label } = progress;
  return (
    <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
      <div style={{background:'linear-gradient(135deg,rgba(26,26,46,0.97),rgba(15,15,26,0.97))',border:'1px solid rgba(108,99,255,0.2)',borderRadius:16,borderBottomLeftRadius:4,padding:'12px 18px',minWidth:260,backdropFilter:'blur(8px)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
          <span style={{fontSize:12,fontStyle:'italic',background:'linear-gradient(135deg, var(--accent), var(--teal))',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',animation:'textPulse 1.6s ease-in-out infinite'}}>{label}</span>
          <span style={{fontSize:11,color:'var(--text-dim)',marginLeft:'auto'}}>{step}/{totalSteps}</span>
        </div>
        {/* Continuous slider — sweeps the whole time so the panel never looks
           frozen during the ~15s gaps between discrete progress events. */}
        <div className="sos-slider-track" style={{height:4,marginBottom:10}}/>
        <div style={{display:'flex',gap:4}}>
          {Array.from({length:totalSteps},(_,i)=>(
            <div key={i} style={{flex:1,height:3,borderRadius:2,background:i<step?'var(--accent)':'rgba(108,99,255,0.15)',transition:'background 0.4s ease'}}/>
          ))}
        </div>
        <div style={{display:'flex',gap:6,marginTop:10}}>
          {PIPELINE_STEP_LABELS.slice(0,totalSteps).map((lbl,i)=>(
            <span key={i} style={{flex:1,textAlign:'center',fontSize:9,color:i+1===step?'var(--accent)':i+1<step?'var(--teal)':'var(--text-dim)',fontWeight:i+1===step?700:400,textTransform:'uppercase',letterSpacing:'0.04em',transition:'color 0.3s ease'}}>{lbl}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const AutoApproveIndicator = ({ status }) => {
  if (!status) return null;
  const done = status.state === 'done';
  return (
    <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
      <div className={'auto-approve-indicator' + (done ? ' done' : '')}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
          <span>{done ? 'Applied' : 'Applying'} {status.count} change{status.count === 1 ? '' : 's'}{status.label ? ` · ${status.label}` : ''}</span>
          <span style={{display:'inline-flex',alignItems:'center'}}>{done ? Icon.checkCircle(14) : Icon.circleDot(14)}</span>
        </div>
        <div className="auto-approve-track">
          <div className="auto-approve-fill" />
        </div>
      </div>
    </div>
  );
};
