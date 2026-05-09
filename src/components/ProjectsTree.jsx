// ProjectsTree — flat hierarchical tree of folders + notes.
//
// MVP scope (per the strategic plan): indent-based rendering, expand/collapse
// folders, click leaf to open in the existing notes editor. No drag-and-drop,
// no desktop icons, no breadcrumbs. The point is the unified file system —
// the desktop aesthetic comes later.
//
// Data shape: notes array with optional `parent_id` (uuid, nullable) and
// `is_folder` (boolean). Leaves render with the note glyph; folders render
// expandable with a chevron.

import React, { useMemo, useState } from 'react';

function buildTree(notes) {
  const byParent = new Map();
  for (const note of notes || []) {
    const key = note.parent_id || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(note);
  }
  // Folders first (alpha), then notes (most recent first).
  for (const list of byParent.values()) {
    list.sort((a, b) => {
      if (Boolean(a.is_folder) !== Boolean(b.is_folder)) return a.is_folder ? -1 : 1;
      if (a.is_folder) return (a.name || '').localeCompare(b.name || '');
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
  }
  return byParent;
}

function NodeRow({ node, depth, expanded, onToggle, onOpen, onCreateInside, selectedId }) {
  const isSelected = node.id === selectedId;
  const isFolder = !!node.is_folder;
  return (
    <div
      onClick={() => isFolder ? onToggle(node.id) : onOpen(node)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: `4px 8px 4px ${8 + depth * 14}px`,
        cursor: 'pointer',
        background: isSelected ? 'var(--muted, rgba(108,99,255,0.18))' : 'transparent',
        borderRadius: 4,
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface, rgba(255,255,255,0.04))'; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ width: 12, opacity: 0.55, fontSize: 10 }}>
        {isFolder ? (expanded ? '▾' : '▸') : ' '}
      </span>
      <span style={{ width: 14, opacity: 0.7, fontSize: 12 }}>
        {isFolder ? '📁' : '⊡'}
      </span>
      <span style={{ flex: 1, fontSize: 12, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {node.name || (isFolder ? 'Untitled folder' : 'Untitled note')}
      </span>
      {isFolder && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCreateInside(node.id); }}
          title="New note in this folder"
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-dim)',
            fontSize: 12, lineHeight: 1, padding: '0 4px', borderRadius: 4,
          }}
        >
          +
        </button>
      )}
    </div>
  );
}

function renderBranch(parentId, byParent, expanded, depth, props) {
  const list = byParent.get(parentId || null) || [];
  return list.flatMap(node => {
    const rows = [
      <NodeRow
        key={node.id}
        node={node}
        depth={depth}
        expanded={!!expanded[node.id]}
        onToggle={props.onToggle}
        onOpen={props.onOpen}
        onCreateInside={props.onCreateInside}
        selectedId={props.selectedId}
      />,
    ];
    if (node.is_folder && expanded[node.id]) {
      rows.push(...renderBranch(node.id, byParent, expanded, depth + 1, props));
    }
    return rows;
  });
}

export default function ProjectsTree({
  notes,
  selectedId,
  onOpenNote,
  onCreateNote,        // ({ parent_id }) => void
  onCreateFolder,      // ({ parent_id }) => void
  onImport,            // () => void
}) {
  const [expanded, setExpanded] = useState({});
  const byParent = useMemo(() => buildTree(notes || []), [notes]);

  function toggle(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function createInside(parentId) {
    onCreateNote?.({ parent_id: parentId });
    setExpanded(prev => ({ ...prev, [parentId]: true }));
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Folder header — also hosts the + and import affordances per the plan. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--sidebar)',
      }}>
        <span style={{ flex: 1, fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Projects
        </span>
        <button
          type="button"
          onClick={() => onCreateFolder?.({ parent_id: null })}
          title="New folder"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 11 }}
        >
          + Folder
        </button>
        <button
          type="button"
          onClick={() => onCreateNote?.({ parent_id: null })}
          title="New note at root"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 11 }}
        >
          + Note
        </button>
        {onImport && (
          <button
            type="button"
            onClick={onImport}
            title="Import a note from PDF or Google Docs"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 11 }}
          >
            Import
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {(byParent.get(null) || []).length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
            No notes yet. Tap <strong>+ Note</strong> or <strong>+ Folder</strong> to start.
          </div>
        )}
        {renderBranch(null, byParent, expanded, 0, {
          onToggle: toggle,
          onOpen: onOpenNote,
          onCreateInside: createInside,
          selectedId,
        })}
      </div>
    </div>
  );
}
