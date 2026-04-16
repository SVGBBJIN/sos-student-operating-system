import Icon from '../../lib/icons';
import { fmt } from '../../lib/dateUtils';
import ContentCard from './ContentCard';

export default function GenericContentDisplay({ data, icon, label, onSave, onDismiss, accentColor }) {
  const ac = accentColor || 'var(--teal)';

  const formatted = (() => {
    try {
      switch (data.type) {
        case 'create_summary':
          return (data.bullets || []).map(b => ({ type: 'bullet', text: b }));
        case 'create_outline':
          return (data.sections || []).flatMap(s => [{ type: 'heading', text: s.heading }, ...(s.points || []).map(p => ({ type: 'point', text: p }))]);
        case 'create_study_plan':
          return (data.steps || []).map((s, i) => ({ type: 'step', num: i + 1, text: s.step, meta: (s.time_minutes || 20) + 'min' + (s.day ? ' · ' + s.day : '') }));
        case 'create_project_breakdown':
          return (data.phases || []).flatMap(p => [{ type: 'heading', text: p.phase + (p.deadline ? ' — due ' + fmt(p.deadline) : '') }, ...(p.tasks || []).map(t => ({ type: 'point', text: t }))]);
        default:
          return [{ type: 'bullet', text: '(content generated)' }];
      }
    } catch (_) { return [{ type: 'bullet', text: '(error displaying content)' }]; }
  })();

  return (
    <ContentCard icon={icon} title={data.title || label} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor={ac}>
      <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: '0.85rem', lineHeight: 1.6 }}>
        {formatted.map((item, i) => {
          if (item.type === 'heading') return <div key={i} style={{ fontWeight: 700, color: ac, marginTop: i > 0 ? 10 : 0, marginBottom: 4, fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 3, height: 14, borderRadius: 2, background: ac, flexShrink: 0 }} />{item.text}</div>;
          if (item.type === 'step') return <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}><span style={{ width: 22, height: 22, borderRadius: 6, background: `color-mix(in srgb, ${ac} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${ac} 20%, transparent)`, color: ac, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>{item.num}</span><div><div style={{ color: 'var(--text)', fontWeight: 500 }}>{item.text}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 1 }}>{item.meta}</div></div></div>;
          if (item.type === 'point') return <div key={i} style={{ padding: '3px 0 3px 14px', color: 'var(--text)', borderLeft: `2px solid color-mix(in srgb, ${ac} 25%, transparent)`, marginLeft: 2 }}>• {item.text}</div>;
          return <div key={i} style={{ padding: '4px 0', color: 'var(--text)', display: 'flex', alignItems: 'flex-start', gap: 8 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: ac, marginTop: 7, flexShrink: 0 }} />{item.text}</div>;
        })}
      </div>
    </ContentCard>
  );
}
