import Icon from '../../lib/icons';

export default function ContentCard({ icon, title, subject, onSave, onDismiss, children, accentColor }) {
  const ac = accentColor || 'var(--teal)';
  return (
    <div className="content-card" style={{ borderLeftColor: ac }}>
      <div className="content-card-header">
        <div className="content-card-hdr-icon" style={{ background: `color-mix(in srgb, ${ac} 10%, transparent)`, borderColor: `color-mix(in srgb, ${ac} 20%, transparent)`, color: ac }}>
          {icon}
        </div>
        <div>
          <div className="content-card-title">{title}</div>
          {subject && <div className="content-card-subject">{subject}</div>}
        </div>
      </div>
      <div className="content-card-body">{children}</div>
      <div className="content-card-actions">
        <button
          className="content-card-save"
          style={{ background: `linear-gradient(135deg, ${ac}, color-mix(in srgb, ${ac} 70%, #000))`, boxShadow: `0 2px 12px color-mix(in srgb, ${ac} 25%, transparent)` }}
          onClick={onSave}
        >
          {Icon.fileText(14)} Save to Notes
        </button>
        <button className="content-card-dismiss" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
