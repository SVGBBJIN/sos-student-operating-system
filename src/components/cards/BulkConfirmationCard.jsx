import { useState, useEffect } from 'react';
import Icon from '../../lib/icons';
import { fmt } from '../../lib/dateUtils';

export default function BulkConfirmationCard({ actions, onConfirmSelected, onCancel }) {
  const [checked, setChecked] = useState(actions.map(() => true));
  const [selectAll, setSelectAll] = useState(true);

  useEffect(() => { setChecked(actions.map(() => true)); setSelectAll(true); }, [actions.length]);

  function toggleItem(idx) { setChecked(prev => { const n = [...prev]; n[idx] = !n[idx]; return n; }); }
  function toggleAll() { const v = !selectAll; setSelectAll(v); setChecked(actions.map(() => v)); }

  function getActionLabel(a) {
    const labels = { add_task: 'Task', add_event: 'Event', add_block: 'Block', delete_task: 'Delete Task', delete_event: 'Delete Event', update_event: 'Update', break_task: 'Split', delete_block: 'Remove Block', convert_event_to_block: 'Convert Event → Block', convert_block_to_event: 'Convert Block → Event', add_recurring_event: 'Recurring', clear_all: 'Clear Everything' };
    return (labels[a.type] || 'Action') + ': ' + (a.title || a.activity || a.parent_title || 'Untitled');
  }

  function getBadgeColor(a) {
    if (a.type?.startsWith('delete')) return 'var(--danger)';
    if (a.type === 'add_event' || a.type === 'add_recurring_event') return 'var(--teal)';
    if (a.type === 'add_block') return 'var(--blue)';
    return 'var(--accent)';
  }

  const selectedCount = checked.filter(Boolean).length;

  return (
    <div className="confirm-card" style={{ maxWidth: 420, borderLeftColor: 'var(--accent)' }}>
      <div className="confirm-card-hdr">
        <div className="confirm-card-hdr-left">
          <div className="confirm-card-hdr-icon" style={{ background: 'rgba(108,99,255,0.1)', borderColor: 'rgba(108,99,255,0.2)', color: 'var(--accent)' }}>{Icon.layers(16)}</div>
          <span className="confirm-card-hdr-title">Bulk Add</span>
        </div>
        <span className="confirm-card-hdr-badge" style={{ background: 'rgba(108,99,255,0.1)', color: 'var(--accent)', border: '1px solid rgba(108,99,255,0.2)' }}>{actions.length} items</span>
      </div>
      <div className="confirm-card-body" style={{ maxHeight: 250, overflowY: 'auto' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <input type="checkbox" checked={selectAll} onChange={toggleAll} /> Select All ({actions.length})
        </label>
        {actions.map((pa, idx) => (
          <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', fontSize: '0.82rem', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
            <input type="checkbox" checked={checked[idx]} onChange={() => toggleItem(idx)} />
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: getBadgeColor(pa.action), flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              {getActionLabel(pa.action)}
              {pa.action.date && <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginLeft: 6 }}>{fmt(pa.action.date)}</span>}
              {pa.action.due && <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginLeft: 6 }}>due {fmt(pa.action.due)}</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="confirm-card-actions">
        <button className="confirm-btn confirm-btn-yes" onClick={() => onConfirmSelected(checked)} disabled={selectedCount === 0}>
          {Icon.check(14)} Approve {selectedCount}
        </button>
        <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>{Icon.x(14)} Dismiss All</button>
      </div>
    </div>
  );
}
