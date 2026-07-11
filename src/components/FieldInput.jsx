import { FIELD_INPUT_TYPES, SUBJECT_QUICK_PICKS, EVENT_TYPE_QUICK_PICKS } from '../lib/actionSchemaHelpers';
import { today, toDateStr } from '../lib/dateUtils';

export function TimeRangeSlider({ start, end, onChange }) {
  const STEP = 15;          // 15-minute increments
  const MIN_MIN = 6 * 60;   // 6 AM
  const MAX_MIN = 23 * 60;  // 11 PM
  const toMins = (hhmm) => {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const toHHMM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const toLabel = (mins) => {
    const h = Math.floor(mins / 60), m = mins % 60;
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  };
  const startMin = toMins(start) ?? 17 * 60;
  const endMin = toMins(end) ?? Math.min(startMin + 60, MAX_MIN);
  const handleStart = (v) => {
    const newStart = Math.max(MIN_MIN, Math.min(Number(v), MAX_MIN - STEP));
    const newEnd = newStart >= endMin ? Math.min(newStart + STEP, MAX_MIN) : endMin;
    onChange(toHHMM(newStart), toHHMM(newEnd));
  };
  const handleEnd = (v) => {
    const newEnd = Math.max(MIN_MIN + STEP, Math.min(Number(v), MAX_MIN));
    const newStart = newEnd <= startMin ? Math.max(newEnd - STEP, MIN_MIN) : startMin;
    onChange(toHHMM(newStart), toHHMM(newEnd));
  };
  const totalMins = Math.max(0, endMin - startMin);
  const hours = Math.floor(totalMins / 60), mins = totalMins % 60;
  const durationLabel = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
  const startPct = ((startMin - MIN_MIN) / (MAX_MIN - MIN_MIN)) * 100;
  const endPct = ((endMin - MIN_MIN) / (MAX_MIN - MIN_MIN)) * 100;
  return (
    <div style={{padding:'4px 0 8px'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10, fontSize:'0.92rem'}}>
        <span style={{color:'var(--teal)', fontWeight:700}}>{toLabel(startMin)}</span>
        <span style={{fontSize:'0.74rem', color:'var(--text-dim)', fontWeight:600}}>{durationLabel}</span>
        <span style={{color:'var(--teal)', fontWeight:700}}>{toLabel(endMin)}</span>
      </div>
      <div style={{position:'relative', height:36}}>
        <div style={{position:'absolute', top:16, left:0, right:0, height:4, background:'rgba(255,255,255,0.08)', borderRadius:2}}/>
        <div style={{position:'absolute', top:16, height:4, borderRadius:2, background:'var(--teal)', left:`${startPct}%`, width:`${endPct - startPct}%`}}/>
        <input type="range" min={MIN_MIN} max={MAX_MIN} step={STEP} value={startMin}
          onChange={(e) => handleStart(e.target.value)}
          style={{position:'absolute', top:0, left:0, width:'100%', height:36, background:'transparent', appearance:'none', WebkitAppearance:'none', pointerEvents:'auto'}}
          className="sos-time-range-input"/>
        <input type="range" min={MIN_MIN} max={MAX_MIN} step={STEP} value={endMin}
          onChange={(e) => handleEnd(e.target.value)}
          style={{position:'absolute', top:0, left:0, width:'100%', height:36, background:'transparent', appearance:'none', WebkitAppearance:'none', pointerEvents:'auto'}}
          className="sos-time-range-input"/>
      </div>
    </div>
  );
}

export function FieldInput({ field, value, secondaryValue, onChange, options }) {
  const inputType = FIELD_INPUT_TYPES[field] || 'text';
  // AI-supplied options take precedence over the default control: render up to 6 chips.
  if (Array.isArray(options) && options.length > 0) {
    const visible = options.slice(0, 6);
    return (
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {visible.map(opt => {
          const selected = String(value || '').toLowerCase() === String(opt).toLowerCase();
          return (
            <button key={opt} onClick={() => onChange(opt)} style={{
              background: selected ? 'rgba(108,99,255,0.18)' : 'rgba(255,255,255,0.05)',
              border: selected ? '1px solid rgba(108,99,255,0.45)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600,
              color: selected ? 'var(--accent)' : 'var(--text)', cursor: 'pointer',
            }}>{opt}</button>
          );
        })}
      </div>
    );
  }
  if (inputType === 'date') {
    const todayStr = today();
    const tomorrow = new Date(todayStr + 'T12:00:00'); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = toDateStr(tomorrow);
    const inWeek = new Date(todayStr + 'T12:00:00'); inWeek.setDate(inWeek.getDate() + 7);
    const inWeekStr = toDateStr(inWeek);
    const quicks = [
      { label: 'Today', val: todayStr },
      { label: 'Tomorrow', val: tomorrowStr },
      { label: 'In a week', val: inWeekStr },
    ];
    return (
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
          {quicks.map(q => (
            <button key={q.val} onClick={() => onChange(q.val)} style={{
              background: value === q.val ? 'rgba(43,203,186,0.18)' : 'rgba(255,255,255,0.05)',
              border: value === q.val ? '1px solid rgba(43,203,186,0.45)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600,
              color: value === q.val ? 'var(--teal)' : 'var(--text)', cursor: 'pointer',
            }}>{q.label}</button>
          ))}
        </div>
        <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)}
          style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, color:'var(--text)', fontSize:'0.86rem', padding:'8px 10px', outline:'none', colorScheme:'dark'}}/>
      </div>
    );
  }
  if (inputType === 'time-range') {
    return <TimeRangeSlider start={value} end={secondaryValue} onChange={(s, e) => onChange(s, e)}/>;
  }
  if (inputType === 'subject-picker') {
    const isCustom = value && !SUBJECT_QUICK_PICKS.some(s => s.toLowerCase() === String(value).toLowerCase());
    return (
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
          {SUBJECT_QUICK_PICKS.map(s => {
            const selected = value && value.toLowerCase() === s.toLowerCase();
            return (
              <button key={s} onClick={() => onChange(s.toLowerCase())} style={{
                background: selected ? 'rgba(108,99,255,0.18)' : 'rgba(255,255,255,0.05)',
                border: selected ? '1px solid rgba(108,99,255,0.45)' : '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600,
                color: selected ? 'var(--accent)' : 'var(--text)', cursor: 'pointer',
              }}>{s}</button>
            );
          })}
        </div>
        <input type="text" value={isCustom ? value : ''} onChange={(e) => onChange(e.target.value)}
          placeholder="Or type a custom subject"
          style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, color:'var(--text)', fontSize:'0.86rem', padding:'8px 10px', outline:'none'}}/>
      </div>
    );
  }
  if (inputType === 'event-type-picker') {
    return (
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {EVENT_TYPE_QUICK_PICKS.map(t => {
          const selected = value === t.id;
          return (
            <button key={t.id} onClick={() => onChange(t.id)} style={{
              background: selected ? 'rgba(43,203,186,0.18)' : 'rgba(255,255,255,0.05)',
              border: selected ? '1px solid rgba(43,203,186,0.45)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600,
              color: selected ? 'var(--teal)' : 'var(--text)', cursor: 'pointer',
            }}>{t.label}</button>
          );
        })}
      </div>
    );
  }
  // Default: free-text input (title, task_name, activity)
  return (
    <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)}
      placeholder={field === 'task_name' || field === 'title' ? 'e.g. Physics problem set' : 'Type here…'}
      style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, color:'var(--text)', fontSize:'0.92rem', padding:'10px 12px', outline:'none', width:'100%'}}/>
  );
}
