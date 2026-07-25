import Icon from '../lib/icons';

/* ═══════════════════════════════════════════════
   CONTENT DISPLAY COMPONENTS
   ═══════════════════════════════════════════════ */
export function ContentCard({ icon, title, subject, onSave, onDismiss, children, accentColor, saveLabel }) {
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
        <button className="content-card-save" style={{background:`linear-gradient(135deg, ${ac}, color-mix(in srgb, ${ac} 70%, #000))`,boxShadow:`0 2px 12px color-mix(in srgb, ${ac} 25%, transparent)`}} onClick={onSave}>{Icon.fileText(14)} {saveLabel || 'Save to Notes'}</button>
        <button className="content-card-dismiss" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

// Fallback renderer for any content type ContentTypeRouter has no dedicated
// card for. The structured studio types (flashcards / quiz / outline / summary /
// study pack) were cut from the AI pipeline, so this now only ever sees
// unrecognized shapes — it renders the title and a neutral placeholder body
// rather than dumping raw JSON at the student.
export function GenericContentDisplay({ data, icon, label, onSave, onDismiss, accentColor }) {
  const ac = accentColor || 'var(--teal)';
  return (
    <ContentCard icon={icon} title={data.title||label} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor={ac}>
      <div style={{ maxHeight:220, overflowY:'auto', fontSize:'0.85rem', lineHeight:1.6 }}>
        <div style={{ padding:'4px 0', color:'var(--text)', display:'flex', alignItems:'flex-start', gap:8 }}>
          <span style={{width:5,height:5,borderRadius:'50%',background:ac,marginTop:7,flexShrink:0}}/>
          (content generated)
        </div>
      </div>
    </ContentCard>
  );
}
