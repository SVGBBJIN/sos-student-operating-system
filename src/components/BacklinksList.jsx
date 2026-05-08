// BacklinksList — renders a simple list of inbound links to an entity.
// Always visible on note + event detail surfaces (no toggle). When there are
// no backlinks, renders a tiny dim placeholder so the section is discoverable.

import React from 'react';
import { findBacklinks } from '../lib/wikilinkSearch.js';

const TYPE_GLYPH = { note: '⊡', event: '📅', task: '✓' };

export default function BacklinksList({ entityType, entityId, entityLinks, notes, events, tasks, onOpen }) {
  const links = findBacklinks(entityType, entityId, { entityLinks, notes, events, tasks });
  return (
    <div className="backlinks" style={{ marginTop: 12, padding: '10px 12px', borderTop: '1px dashed var(--border, rgba(255,255,255,0.08))' }}>
      <div style={{
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
        color: 'var(--text-dim, rgba(255,255,255,0.45))', marginBottom: 6, fontWeight: 600,
      }}>
        Backlinks ({links.length})
      </div>
      {links.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim, rgba(255,255,255,0.45))', fontStyle: 'italic' }}>
          Nothing references this yet. Type <code>[[</code> in another note or event to link here.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {links.map(link => (
            <li key={`${link.type}-${link.id}`}>
              <button
                type="button"
                onClick={() => onOpen?.(link)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '5px 8px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                  color: 'var(--text, #e0e4f0)', cursor: onOpen ? 'pointer' : 'default',
                  textAlign: 'left', fontSize: 13,
                }}
              >
                <span style={{ width: 16, opacity: 0.7 }}>{TYPE_GLYPH[link.type] || '•'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.title}</span>
                {link.origin && link.origin !== 'manual' && (
                  <span style={{ fontSize: 10, opacity: 0.5 }}>{link.origin}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
