import React, { useEffect, useMemo, useState } from 'react';

function sortByOrder(modules) {
  return modules
    .map((module, index) => ({ module, index }))
    .sort((a, b) => {
      const ao = a.module.order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.module.order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.index - b.index;
    })
    .map(({ module }) => module);
}

function mergeStoredOrder(modules, storedIds) {
  const byId = new Map(modules.map((module) => [module.editableId, module]));
  const ordered = [];

  (storedIds || []).forEach((id) => {
    if (byId.has(id)) ordered.push(byId.get(id));
  });

  modules.forEach((module) => {
    if (!ordered.some((item) => item.editableId === module.editableId)) {
      ordered.push(module);
    }
  });

  return ordered;
}

function moveByOffset(items, id, offset) {
  const index = items.findIndex((item) => item.editableId === id);
  if (index === -1) return items;
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= items.length) return items;

  const clone = [...items];
  const [picked] = clone.splice(index, 1);
  clone.splice(nextIndex, 0, picked);
  return clone;
}

export default function EditableSortableContainer({
  modules,
  isEditMode,
  storageKey = 'sos_home_layout_order',
  renderModule,
}) {
  const normalizedModules = useMemo(() => {
    const sorted = sortByOrder(modules || []);

    sorted.forEach((module, index) => {
      if (!module?.editableId) {
        throw new Error(`Editable module at index ${index} is missing required editableId`);
      }
    });

    return sorted;
  }, [modules]);

  const [orderedIds, setOrderedIds] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [draggingId, setDraggingId] = useState(null);

  const orderedModules = useMemo(() => {
    return mergeStoredOrder(normalizedModules, orderedIds);
  }, [normalizedModules, orderedIds]);

  useEffect(() => {
    const ids = orderedModules.map((module) => module.editableId);
    setOrderedIds((prev) => {
      if (JSON.stringify(prev) === JSON.stringify(ids)) return prev;
      return ids;
    });
  }, [orderedModules]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(orderedIds));
    } catch {
      // Ignore write failures (private mode/quota exceeded).
    }
  }, [orderedIds, storageKey]);

  const reorder = (nextModules) => {
    setOrderedIds(nextModules.map((module) => module.editableId));
  };

  return (
    <>
      {orderedModules.map((module, index) => {
        const isFirst = index === 0;
        const isLast = index === orderedModules.length - 1;

        return (
          <div
            key={module.editableId}
            className={'editable-sortable-module' + (draggingId === module.editableId ? ' dragging' : '')}
            draggable={isEditMode}
            onDragStart={(event) => {
              if (!isEditMode) return;
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', module.editableId);
              setDraggingId(module.editableId);
            }}
            onDragOver={(event) => {
              if (!isEditMode) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => {
              if (!isEditMode) return;
              event.preventDefault();
              const sourceId = event.dataTransfer.getData('text/plain') || draggingId;
              if (!sourceId || sourceId === module.editableId) return;
              const sourceIndex = orderedModules.findIndex((item) => item.editableId === sourceId);
              const targetIndex = orderedModules.findIndex((item) => item.editableId === module.editableId);
              if (sourceIndex === -1 || targetIndex === -1) return;
              const clone = [...orderedModules];
              const [picked] = clone.splice(sourceIndex, 1);
              clone.splice(targetIndex, 0, picked);
              reorder(clone);
            }}
            onDragEnd={() => setDraggingId(null)}
          >
            {isEditMode && (
              <div className="editable-sortable-handle" aria-hidden="true">
                <span className="editable-sortable-grip">⋮⋮</span>
                <div className="editable-sortable-actions">
                  <button
                    type="button"
                    className="editable-sortable-action-btn"
                    onClick={() => reorder(moveByOffset(orderedModules, module.editableId, -1))}
                    disabled={isFirst}
                    aria-label={`Move ${module.label || module.editableId} up`}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="editable-sortable-action-btn"
                    onClick={() => reorder(moveByOffset(orderedModules, module.editableId, 1))}
                    disabled={isLast}
                    aria-label={`Move ${module.label || module.editableId} down`}
                    title="Move down"
                  >
                    ↓
                  </button>
                </div>
              </div>
            )}

            {renderModule(module, index)}
          </div>
        );
      })}
    </>
  );
}
