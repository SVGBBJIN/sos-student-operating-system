import { useState, useEffect } from 'react';
import Icon from '../../lib/icons';
import { fmt } from '../../lib/dateUtils';

export default function ConfirmationCard({ action, onConfirm, onCancel, isFallback }) {
  const [editing, setEditing] = useState(!!isFallback);
  const [editingField, setEditingField] = useState(null);
  const [editData, setEditData] = useState({});
  useEffect(() => { setEditData({ ...action }); }, [action]);

  const fieldTypes = { due: 'date', date: 'date', estimated_minutes: 'number', start: 'time', end: 'time' };

  function getCardInfo() {
    switch (action.type) {
      case 'add_task': return { icon: Icon.clipboard(16), label: 'New Task', badge: 'task', badgeColor: 'var(--accent)', borderColor: 'var(--accent)', bgTint: 'rgba(108,99,255,0.03)', fields: [{ key: 'title', label: 'Title', value: action.title, editable: true }, { key: 'subject', label: 'Class', value: action.subject || '—', editable: true }, { key: 'due', label: 'Due', value: action.due ? fmt(action.due) : 'No date', editable: true }, { key: 'estimated_minutes', label: 'Time', value: (action.estimated_minutes || 30) + ' min', editable: true }] };
      case 'add_event': return { icon: Icon.calendar(16), label: 'New Event', badge: 'event', badgeColor: 'var(--teal)', borderColor: 'var(--teal)', bgTint: 'rgba(43,203,186,0.03)', fields: [{ key: 'title', label: 'Event', value: action.title, editable: true }, { key: 'date', label: 'Date', value: action.date ? fmt(action.date) : 'No date', editable: true }, { key: 'event_type', label: 'Type', value: action.event_type || 'other', editable: true }, { key: 'subject', label: 'Class', value: action.subject || '—', editable: true }, ...(action.startTime ? [{ key: 'startTime', label: 'Start', value: action.startTime }] : []), ...(action.endTime ? [{ key: 'endTime', label: 'End', value: action.endTime }] : [])] };
      case 'add_block': return { icon: Icon.calendarClock(16), label: 'Schedule Block', badge: 'block', badgeColor: 'var(--blue)', borderColor: 'var(--blue)', bgTint: 'rgba(69,170,242,0.03)', fields: [{ key: 'activity', label: 'Activity', value: action.activity, editable: true }, { key: 'date', label: 'Date', value: action.date ? fmt(action.date) : 'Today', editable: true }, { key: 'time', label: 'Time', value: (action.start || '?') + ' — ' + (action.end || '?') }, { key: 'category', label: 'Type', value: action.category || 'school' }] };
      case 'complete_task': return { icon: Icon.checkCircle(16), label: 'Complete Task', badge: 'done', badgeColor: 'var(--success)', borderColor: 'var(--success)', fields: [{ key: 'task_id', label: 'Task', value: action.task_id }] };
      case 'break_task': return { icon: Icon.scissors(16), label: 'Break Into Parts', badge: 'split', badgeColor: 'var(--orange)', borderColor: 'var(--orange)', fields: [{ key: 'parent_title', label: 'Project', value: action.parent_title }, { key: 'subtasks', label: 'Parts', value: (action.subtasks || []).length + ' sub-tasks' }] };
      case 'delete_task': return { icon: Icon.trash(16), label: 'Delete Task', badge: 'remove', badgeColor: 'var(--danger)', borderColor: 'var(--danger)', fields: [{ key: 'title', label: 'Task', value: action.title || action.task_id || 'Unknown' }] };
      case 'delete_event': return { icon: Icon.trash(16), label: 'Delete Event', badge: 'remove', badgeColor: 'var(--danger)', borderColor: 'var(--danger)', fields: [{ key: 'title', label: 'Event', value: action.title || action.event_id || 'Unknown' }] };
      case 'update_event': return { icon: Icon.calendar(16), label: 'Update Event', badge: 'update', badgeColor: 'var(--blue)', borderColor: 'var(--blue)', fields: [{ key: 'title', label: 'Event', value: action.new_title || action.title || '(unchanged)', editable: true }, { key: 'date', label: 'Date', value: action.date ? fmt(action.date) : '(unchanged)', editable: true }, { key: 'event_type', label: 'Type', value: action.event_type || '(unchanged)' }] };
      case 'delete_block': return { icon: Icon.trash(16), label: 'Remove Block', badge: 'remove', badgeColor: 'var(--danger)', borderColor: 'var(--danger)', fields: [{ key: 'date', label: 'Date', value: action.date ? fmt(action.date) : '?' }, { key: 'time', label: 'Time', value: (action.start || '?') + ' — ' + (action.end || '?') }] };
      case 'convert_event_to_block': return { icon: Icon.calendarClock(16), label: 'Convert Event to Block', badge: 'convert', badgeColor: 'var(--blue)', borderColor: 'var(--blue)', bgTint: 'rgba(69,170,242,0.03)', fields: [{ key: 'title', label: 'Event', value: action.title || action.event_id || 'Unknown', editable: true }, { key: 'date', label: 'Date', value: action.date ? fmt(action.date) : '?', editable: true }, { key: 'time', label: 'Time', value: (action.start || '?') + ' — ' + (action.end || '?') }, { key: 'category', label: 'Category', value: action.category || 'school' }] };
      case 'convert_block_to_event': return { icon: Icon.calendar(16), label: 'Convert Block to Event', badge: 'convert', badgeColor: 'var(--teal)', borderColor: 'var(--teal)', bgTint: 'rgba(43,203,186,0.03)', fields: [{ key: 'title', label: 'Event', value: action.title || 'Event', editable: true }, { key: 'date', label: 'Date', value: action.date ? fmt(action.date) : '?', editable: true }, { key: 'time', label: 'Time', value: (action.start || '?') + ' — ' + (action.end || '(auto)') }, { key: 'event_type', label: 'Type', value: action.event_type || 'event' }, { key: 'subject', label: 'Class', value: action.subject || '—' }] };
      case 'clear_all': return { icon: Icon.alertTriangle(16), label: 'Clear Everything', badge: 'danger', badgeColor: 'var(--danger)', borderColor: 'var(--danger)', fields: [{ key: 'scope', label: 'Scope', value: 'Tasks, events, and schedule blocks will be removed.' }] };
      default: return { icon: Icon.zap(16), label: 'Action', badge: 'action', badgeColor: 'var(--accent)', borderColor: 'var(--accent)', fields: Object.entries(action).filter(([k]) => k !== 'type').map(([k, v]) => ({ key: k, label: k, value: String(v) })) };
    }
  }

  const info = getCardInfo();
  const isDanger = ['delete_task', 'delete_event', 'delete_block', 'clear_all'].includes(action.type);
  const isEditFlow = ['update_event', 'convert_event_to_block', 'convert_block_to_event', 'edit_note'].includes(action.type);
  const hasEdits = Object.keys(editData).some(k => k !== 'type' && editData[k] !== action[k]);

  return (
    <div className={'confirm-card sos-confirm-card' + (isEditFlow ? ' confirm-card-edit-flow' : '')} data-action={action.type} style={{ borderLeftColor: info.borderColor, background: info.bgTint ? `linear-gradient(160deg,${info.bgTint},rgba(15,15,30,0.92))` : '' }}>
      {isFallback && (
        <div style={{ fontSize: '0.75rem', color: 'var(--warning)', padding: '8px 16px', background: 'rgba(255,165,2,0.05)', borderBottom: '1px solid rgba(255,165,2,0.1)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {Icon.helpCircle(14)} I think you want to add this — check the details?
        </div>
      )}
      <div className="confirm-card-hdr">
        <div className="confirm-card-hdr-left">
          <div className="confirm-card-hdr-icon" style={{ background: `color-mix(in srgb, ${info.badgeColor} 10%, transparent)`, borderColor: `color-mix(in srgb, ${info.badgeColor} 20%, transparent)`, color: info.badgeColor }}>{info.icon}</div>
          <span className="confirm-card-hdr-title">{info.label}</span>
        </div>
        <span className="confirm-card-hdr-badge" style={{ background: `color-mix(in srgb, ${info.badgeColor} 10%, transparent)`, color: info.badgeColor, border: `1px solid color-mix(in srgb, ${info.badgeColor} 20%, transparent)`, fontSize: '0.68rem', padding: '3px 10px' }}>{info.badge}</span>
      </div>
      <div className="confirm-card-body">
        {!editing ? info.fields.map(f => (
          <div key={f.key} className="confirm-card-field"
            onClick={f.editable ? () => { setEditingField(f.key); setEditData(prev => ({ ...prev })); } : undefined}
            style={f.editable ? { cursor: 'pointer' } : {}}>
            <span className="confirm-card-label">{f.label}</span>
            {editingField === f.key ? (
              <input className="confirm-edit-input" type={fieldTypes[f.key] || 'text'}
                value={editData[f.key] ?? action[f.key] ?? ''} autoFocus
                min={f.key === 'estimated_minutes' ? '5' : undefined} step={f.key === 'estimated_minutes' ? '5' : undefined}
                onChange={e => setEditData(p => ({ ...p, [f.key]: fieldTypes[f.key] === 'number' ? Number(e.target.value) : e.target.value }))}
                onBlur={() => setEditingField(null)}
                onKeyDown={e => { if (e.key === 'Enter') setEditingField(null); }}
                style={{ flex: 1, maxWidth: 160 }} />
            ) : (
              <span className="confirm-card-value" style={f.editable ? { borderBottom: '1px dashed rgba(108,99,255,0.3)' } : {}}>
                {editData[f.key] && editData[f.key] !== action[f.key]
                  ? (fieldTypes[f.key] === 'date' ? fmt(editData[f.key]) : fieldTypes[f.key] === 'number' ? editData[f.key] + ' min' : editData[f.key])
                  : f.value}
                {f.editable && <span style={{ marginLeft: 4, opacity: 0.4, display: 'inline-flex' }}>{Icon.edit(10)}</span>}
              </span>
            )}
          </div>
        )) : (
          <div>
            {action.type === 'add_task' && <>
              <div className="confirm-edit-row"><span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: 52, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Title</span><input className="confirm-edit-input" value={editData.title || ''} onChange={e => setEditData(p => ({ ...p, title: e.target.value }))} /></div>
              <div className="confirm-edit-row"><span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: 52, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Due</span><input className="confirm-edit-input" type="date" value={editData.due || ''} onChange={e => setEditData(p => ({ ...p, due: e.target.value }))} /></div>
              <div className="confirm-edit-row"><span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: 52, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Mins</span><input className="confirm-edit-input" type="number" min="5" step="5" value={editData.estimated_minutes || 30} onChange={e => setEditData(p => ({ ...p, estimated_minutes: Number(e.target.value) }))} /></div>
              <div className="confirm-edit-row"><span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: 52, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Class</span><input className="confirm-edit-input" value={editData.subject || ''} onChange={e => setEditData(p => ({ ...p, subject: e.target.value }))} placeholder="e.g. Math" /></div>
            </>}
            {action.type === 'add_event' && <>
              <div className="confirm-edit-row"><span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: 52, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Title</span><input className="confirm-edit-input" value={editData.title || ''} onChange={e => setEditData(p => ({ ...p, title: e.target.value }))} /></div>
              <div className="confirm-edit-row"><span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: 52, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Date</span><input className="confirm-edit-input" type="date" value={editData.date || ''} onChange={e => setEditData(p => ({ ...p, date: e.target.value }))} /></div>
            </>}
            {action.type === 'add_block' && <>
              <div className="confirm-edit-row"><span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: 52, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>What</span><input className="confirm-edit-input" value={editData.activity || ''} onChange={e => setEditData(p => ({ ...p, activity: e.target.value }))} /></div>
              <div className="confirm-edit-row"><span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: 52, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Date</span><input className="confirm-edit-input" type="date" value={editData.date || ''} onChange={e => setEditData(p => ({ ...p, date: e.target.value }))} /></div>
              <div className="confirm-edit-row"><span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: 52, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Start</span><input className="confirm-edit-input" type="time" value={editData.start || ''} onChange={e => setEditData(p => ({ ...p, start: e.target.value }))} /></div>
              <div className="confirm-edit-row"><span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: 52, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>End</span><input className="confirm-edit-input" type="time" value={editData.end || ''} onChange={e => setEditData(p => ({ ...p, end: e.target.value }))} /></div>
            </>}
          </div>
        )}
      </div>
      <div className="confirm-card-actions">
        <button className="confirm-btn confirm-btn-yes" onClick={() => { (editing || hasEdits) ? onConfirm({ ...action, ...editData }) : onConfirm(action); }}>
          {(editing || hasEdits) ? Icon.check(14) : isDanger ? Icon.trash(14) : Icon.check(14)} {(editing || hasEdits) ? 'Save' : isDanger ? 'Confirm' : 'Approve'}
        </button>
        {!editing && action.type !== 'complete_task' && <button className="confirm-btn confirm-btn-edit" onClick={() => setEditing(true)}>{Icon.edit(14)} Edit</button>}
        <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>{Icon.x(14)} Dismiss</button>
      </div>
    </div>
  );
}
