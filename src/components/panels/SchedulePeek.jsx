import { useState, useMemo } from 'react';
import Icon from '../../lib/icons';
import { fmt, fmtFull, fmtTime, toDateStr, today, daysUntil } from '../../lib/dateUtils';
import { catColor, weatherEmoji, getPriority } from '../../lib/uiUtils';

export default function SchedulePeek({ tasks, blocks, events, weatherData, onClose, embedded = false, recentlyCompleted = new Set() }) {
  const todayKey = today(); const todayDow = new Date().getDay();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [calView, setCalView] = useState('month');
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());

  const timeline = useMemo(() => {
    const result = {};
    (blocks.recurring || []).forEach(rb => {
      if (rb.days.includes(todayDow)) {
        const [sh,sm]=rb.start.split(':').map(Number); const [eh,em]=rb.end.split(':').map(Number);
        let ch=sh,cm=sm;
        while(ch<eh||(ch===eh&&cm<em)){const key=String(ch).padStart(2,'0')+':'+String(cm).padStart(2,'0');result[key]={name:rb.name,category:rb.category};cm+=30;if(cm>=60){ch++;cm=0;}}
      }
    });
    const ov = blocks.dates?.[todayKey]||{};
    Object.entries(ov).forEach(([k,v])=>{if(v===null)delete result[k];else result[k]=v;});
    return result;
  },[blocks,todayKey,todayDow]);

  const condensed = useMemo(()=>{
    const sorted=Object.entries(timeline).sort(([a],[b])=>a.localeCompare(b));const bl=[];let cur=null;
    sorted.forEach(([time,data])=>{if(cur&&cur.name===data.name&&cur.category===data.category){cur.end=time;cur.slots++}else{if(cur)bl.push(cur);cur={start:time,end:time,name:data.name,category:data.category,slots:1}}});
    if(cur)bl.push(cur);
    return bl.map(b=>{const[eh,em]=b.end.split(':').map(Number);let nm=em+30,nh=eh;if(nm>=60){nh++;nm=0}return{...b,endDisplay:String(nh).padStart(2,'0')+':'+String(nm).padStart(2,'0')}});
  },[timeline]);

  const overduePeekTasks=useMemo(()=>tasks.filter(t=>t.status!=='done'&&daysUntil(t.dueDate)<0).sort((a,b)=>daysUntil(a.dueDate)-daysUntil(b.dueDate)),[tasks]);
  const activeTasks=useMemo(()=>{
    const completing = tasks.filter(t => recentlyCompleted.has(t.id));
    const active = tasks.filter(t=>t.status!=='done'&&daysUntil(t.dueDate)>=0).sort((a,b)=>getPriority(a)-getPriority(b)).slice(0,5);
    const completing2 = completing.filter(t => !active.some(a => a.id === t.id));
    return [...completing2, ...active];
  },[tasks, recentlyCompleted]);
  const upcomingEvents=useMemo(()=>events.filter(ev=>{const d=daysUntil(ev.date);return d>=0&&d<=7}).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4),[events]);
  const currentHour=new Date().getHours();
  const greeting=currentHour<12?'Good morning':currentHour<17?'Good afternoon':'Good evening';

  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startDow = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const prevMonthLast = new Date(calYear, calMonth, 0).getDate();

    const cells = [];
    for (let i = startDow - 1; i >= 0; i--) {
      const d = prevMonthLast - i;
      const dt = new Date(calYear, calMonth - 1, d);
      cells.push({ date: dt, day: d, isCurrentMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(calYear, calMonth, d);
      cells.push({ date: dt, day: d, isCurrentMonth: true });
    }
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const dt = new Date(calYear, calMonth + 1, d);
        cells.push({ date: dt, day: d, isCurrentMonth: false });
      }
    }
    return cells;
  }, [calYear, calMonth]);

  const dateItemsMap = useMemo(() => {
    const map = {};
    function addItem(dateStr, item) {
      if (!map[dateStr]) map[dateStr] = [];
      if (item.cls === 'block' && map[dateStr].some(i => i.cls === 'block' && i.title === item.title)) return;
      map[dateStr].push(item);
    }
    tasks.forEach(t => {
      if (!t.dueDate) return;
      const cls = t.status === 'done' ? 'task' : (daysUntil(t.dueDate) < 0 ? 'overdue' : 'task');
      addItem(t.dueDate, { title: t.title, cls });
    });
    events.forEach(ev => {
      if (!ev.date) return;
      addItem(ev.date, { title: ev.title, cls: 'event' });
    });
    (blocks.recurring || []).forEach(rb => {
      calendarDays.forEach(cell => {
        if (rb.days.includes(cell.date.getDay())) {
          const ds = toDateStr(cell.date);
          addItem(ds, { title: rb.name, cls: 'block' });
        }
      });
    });
    Object.entries(blocks.dates || {}).forEach(([dateStr, slots]) => {
      const seen = new Set();
      Object.values(slots).forEach(slot => {
        if (slot && slot.name && !seen.has(slot.name)) { seen.add(slot.name); addItem(dateStr, { title: slot.name, cls: 'block' }); }
      });
    });
    return map;
  }, [tasks, events, blocks, calendarDays]);

  function prevMonth() { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }
  function nextMonth() { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }
  function goToday() { setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth()); }

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayHeaders = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const weekDays = useMemo(() => {
    const now = new Date();
    const sunday = new Date(now); sunday.setDate(now.getDate() - now.getDay()); sunday.setHours(0,0,0,0);
    return Array.from({length:7}, (_, i) => { const d = new Date(sunday); d.setDate(sunday.getDate() + i); return d; });
  }, []);

  const weekDayItems = useMemo(() => {
    return weekDays.map(day => {
      const ds = toDateStr(day);
      const dow = day.getDay();
      const dayBlocks = [];
      const seen = new Set();
      (blocks.recurring || []).forEach(rb => {
        if (rb.days.includes(dow) && !seen.has(rb.name)) { seen.add(rb.name); dayBlocks.push({ title: rb.name, cls: 'block' }); }
      });
      Object.entries(blocks.dates?.[ds] || {}).forEach(([, slot]) => {
        if (slot && slot.name && !seen.has(slot.name)) { seen.add(slot.name); dayBlocks.push({ title: slot.name, cls: 'block' }); }
      });
      const dayTasks = tasks.filter(t => t.dueDate === ds && t.status !== 'done').map(t => ({ title: t.title, cls: daysUntil(t.dueDate) < 0 ? 'overdue' : 'task' }));
      const dayEvents = events.filter(ev => ev.date === ds).map(ev => ({ title: ev.title, cls: 'event' }));
      return { date: day, ds, items: [...dayBlocks, ...dayTasks, ...dayEvents] };
    });
  }, [weekDays, blocks, tasks, events]);

  return (<>
    {!embedded && <div className="peek-overlay" onClick={onClose}/>}
    <div className={'peek-panel' + (embedded ? ' embedded' : '') + (isFullscreen && !embedded ? ' fullscreen' : '')}>
      {!isFullscreen && <div className="peek-handle"/>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div><div style={{fontSize:'1.1rem',fontWeight:700}}>{greeting}</div><div style={{fontSize:'0.82rem',color:'var(--text-dim)'}}>{fmtFull(new Date())}</div></div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          {weatherData?.current&&<div style={{display:'flex',alignItems:'center',gap:6,marginRight:4}}><span style={{display:'flex',color:'var(--teal)'}}>{weatherEmoji(weatherData.current.weathercode)}</span><span style={{fontWeight:700}}>{Math.round(weatherData.current.temperature_2m)}°F</span></div>}
          <button className="notes-fs-btn" onClick={() => setIsFullscreen(f => !f)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen calendar'}>
            {isFullscreen ? Icon.minimize(16) : Icon.maximize(16)}
          </button>
          {!embedded && <button className="g-modal-close" onClick={onClose}>{Icon.x(16)}</button>}
        </div>
      </div>

      {isFullscreen && (
        <div style={{marginBottom:16}}>
          <div style={{display:'flex',gap:6,marginBottom:12}}>
            {['month','week'].map(v => (
              <button key={v} onClick={()=>setCalView(v)}
                style={{padding:'5px 14px',borderRadius:8,border:'1px solid',fontSize:'0.8rem',fontWeight:600,cursor:'pointer',transition:'all .15s',
                  borderColor: calView===v ? 'var(--accent)' : 'var(--border)',
                  background: calView===v ? 'rgba(108,99,255,0.18)' : 'transparent',
                  color: calView===v ? 'var(--accent)' : 'var(--text-dim)'}}>
                {v.charAt(0).toUpperCase()+v.slice(1)}
              </button>
            ))}
          </div>

          {calView === 'month' && (<>
            <div className="cal-month-nav">
              <button className="cal-nav-btn" onClick={prevMonth}>{Icon.chevronLeft(16)}</button>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span className="cal-month-title">{monthNames[calMonth]} {calYear}</span>
                <button className="cal-nav-btn" onClick={goToday} style={{fontSize:'0.75rem',padding:'4px 10px'}}>Today</button>
              </div>
              <button className="cal-nav-btn" onClick={nextMonth}>{Icon.chevronRight(16)}</button>
            </div>
            <div className="cal-grid">
              {dayHeaders.map(d => (<div key={d} className="cal-day-header">{d}</div>))}
              {calendarDays.map((cell, i) => {
                const dateStr = toDateStr(cell.date);
                const isToday = dateStr === todayKey;
                const items = dateItemsMap[dateStr] || [];
                const maxShow = 2;
                return (
                  <div key={i} className={'cal-cell' + (cell.isCurrentMonth ? '' : ' other-month') + (isToday ? ' today' : '')}>
                    <div className="cal-cell-date" style={isToday ? {color:'var(--accent)'} : {}}>{cell.day}</div>
                    {items.slice(0, maxShow).map((item, j) => (
                      <div key={j} className={'cal-cell-event ' + item.cls} title={item.title}>{item.title}</div>
                    ))}
                    {items.length > maxShow && <div className="cal-cell-more">+{items.length - maxShow} more</div>}
                  </div>
                );
              })}
            </div>
          </>)}

          {calView === 'week' && (
            <div>
              <div style={{textAlign:'center',fontWeight:600,marginBottom:10,color:'var(--text-dim)',fontSize:'0.85rem'}}>
                Week of {weekDays[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} – {weekDays[6].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4}}>
                {weekDayItems.map(({date, ds, items}) => {
                  const isToday = ds === todayKey;
                  return (
                    <div key={ds} style={{background: isToday ? 'rgba(108,99,255,0.1)' : 'rgba(255,255,255,0.05)', border: isToday ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius:10, padding:'6px 4px', minHeight:90}}>
                      <div style={{textAlign:'center',marginBottom:4}}>
                        <div style={{fontSize:'0.7rem',color:'var(--text-dim)',textTransform:'uppercase',fontWeight:600}}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()]}</div>
                        <div style={{fontSize:'0.85rem',fontWeight:700,color: isToday ? 'var(--accent)' : 'var(--text)'}}>{date.getDate()}</div>
                      </div>
                      {items.length === 0 && <div style={{fontSize:'0.62rem',color:'var(--text-dim)',textAlign:'center',marginTop:4}}>free</div>}
                      {items.map((item, j) => (
                        <div key={j} className={'cal-cell-event ' + item.cls} title={item.title} style={{marginBottom:2}}>{item.title}</div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="peek-section">
        <div className="peek-section-title">Today's Schedule</div>
        {condensed.length===0?<div style={{fontSize:'0.85rem',color:'var(--text-dim)',padding:'8px 0'}}>Wide open! Your future self will thank you 🗓️</div>:
        condensed.map((block,i)=>(
          <div key={i} className="peek-timeline-slot"><div className="peek-timeline-time">{fmtTime(...block.start.split(':').map(Number))}</div>
          <div className="peek-timeline-block" style={{background:catColor(block.category)+'20',borderLeft:'3px solid '+catColor(block.category)}}>{block.name}<span style={{fontSize:'0.72rem',color:'var(--text-dim)',marginLeft:8}}>{block.slots*30}min</span></div></div>
        ))}
      </div>
      {overduePeekTasks.length>0&&<div className="peek-section">
        <div className="peek-section-title" style={{color:'var(--danger)',display:'flex',alignItems:'center',gap:4}}>{Icon.alertTriangle(14)} Overdue ({overduePeekTasks.length})</div>
        {overduePeekTasks.map(task=>(<div key={task.id} className="peek-task-item">
          <div className="peek-task-dot" style={{background:'var(--danger)'}}/>
          <div style={{flex:1}}>
            <div style={{fontWeight:600,color:'var(--danger)'}}>{task.title}</div>
            <div style={{fontSize:'0.75rem',color:'var(--text-dim)'}}>{task.subject&&task.subject+' · '}{Math.abs(daysUntil(task.dueDate))}d overdue{' · '+(task.estTime||30)+'min'}</div>
          </div>
          <div style={{color:'var(--danger)',display:'flex'}}>{task.status==='in_progress'?Icon.circleDot(14):Icon.circle(14)}</div>
        </div>))}
      </div>}
      {activeTasks.length>0&&<div className="peek-section"><div className="peek-section-title">Upcoming Tasks ({activeTasks.filter(t=>t.status!=='done').length})</div>
        {activeTasks.map(task=>{
          const completing = recentlyCompleted.has(task.id);
          const d=daysUntil(task.dueDate);
          const dotColor=completing?'var(--success)':d<=1?'var(--warning)':d<=3?'var(--accent)':'var(--text-dim)';
          return(<div key={task.id} className={'peek-task-item'+(completing?' task-completing':'')} style={completing?{background:'rgba(46,213,115,0.08)',borderRadius:10,padding:'4px 6px',transition:'all .3s'}:{}}><div className="peek-task-dot" style={{background:dotColor}}/><div style={{flex:1}}><div style={{fontWeight:500,color:completing?'var(--success)':undefined}}>{task.title}</div><div style={{fontSize:'0.75rem',color:'var(--text-dim)'}}>{task.subject&&task.subject+' · '}{completing?'Completed! 🎉':d===0?'Today':d===1?'Tomorrow':fmt(task.dueDate)}{!completing&&' · '+(task.estTime||30)+'min'}</div></div><div style={{color:completing?'var(--success)':dotColor,display:'flex'}}>{completing?Icon.checkCircle(14):task.status==='in_progress'?Icon.circleDot(14):Icon.circle(14)}</div></div>)
        })}
      </div>}
      {upcomingEvents.length>0&&<div className="peek-section"><div className="peek-section-title">Upcoming Events</div>
        {upcomingEvents.map(ev=>(<div key={ev.id} className="peek-task-item"><div className="peek-task-dot" style={{background:catColor(ev.type)}}/><div><div style={{fontWeight:500}}>{ev.title}</div><div style={{fontSize:'0.75rem',color:'var(--text-dim)'}}>{fmt(ev.date)}{ev.subject&&' · '+ev.subject}</div></div></div>))}
      </div>}
    </div>
  </>);
}
