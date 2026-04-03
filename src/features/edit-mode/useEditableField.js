import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Field-level bindings for editable modules using the contract:
 * editableId, editableFields, onPatch.
 */
export function useEditableField({ editableId, editableFields, onPatch, sourceData }) {
  const [editingField, setEditingField] = useState(null);
  const [draft, setDraft] = useState(sourceData || {});

  useEffect(() => {
    setDraft(sourceData || {});
  }, [sourceData]);

  const editableSet = useMemo(() => new Set(editableFields || []), [editableFields]);

  const isEditable = useCallback((fieldKey) => editableSet.has(fieldKey), [editableSet]);

  const startEditing = useCallback((fieldKey) => {
    if (isEditable(fieldKey)) {
      setEditingField(fieldKey);
    }
  }, [isEditable]);

  const patchField = useCallback((fieldKey, value) => {
    setDraft((prev) => {
      const next = { ...prev, [fieldKey]: value };
      if (typeof onPatch === 'function') {
        onPatch({ [fieldKey]: value }, next, editableId);
      }
      return next;
    });
  }, [editableId, onPatch]);

  const stopEditing = useCallback(() => {
    setEditingField(null);
  }, []);

  return {
    draft,
    editingField,
    isEditable,
    startEditing,
    patchField,
    stopEditing,
  };
}
