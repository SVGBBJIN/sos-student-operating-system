export function getEditableSurfaceMeta({ isEditMode, editableId, editableFields, onPatch }) {
  const hasContract = Boolean(editableId) && Array.isArray(editableFields) && typeof onPatch === 'function';
  const showAffordance = Boolean(isEditMode && hasContract);

  return {
    hasContract,
    showAffordance,
    missingEditableId: Boolean(isEditMode && !editableId),
  };
}
