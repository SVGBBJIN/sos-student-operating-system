import React from 'react';
import Icon from '../../lib/icons';
import { useEditModeContext } from './EditModeContext';
import { getEditableSurfaceMeta } from './editableSurfaceContract';

function isDevMode() {
  return typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);
}

/**
 * Editable modules should provide this contract:
 * - editableId: stable module id
 * - editableFields: list of editable field keys
 * - onPatch: patch handler receiving partial updates
 */
export default function EditableSurface({
  editableId,
  editableFields,
  onPatch,
  className,
  style,
  children,
}) {
  const { isEditMode, selectedEditableId, setSelectedEditableId } = useEditModeContext();

  const { hasContract, showAffordance, missingEditableId } = getEditableSurfaceMeta({
    isEditMode,
    editableId,
    editableFields,
    onPatch,
  });

  if (isEditMode && isDevMode() && missingEditableId) {
    console.warn('EditableSurface rendered in edit mode without required `editableId`.');
  }
  if (isEditMode && isDevMode() && !hasContract) {
    console.warn('Editable module contract requires `editableId`, `editableFields`, and `onPatch`.');
  }
  const isSelected = selectedEditableId === editableId;

  return (
    <div
      className={className}
      style={style}
      data-editable-id={editableId || undefined}
      data-editable-surface={hasContract ? 'registered' : 'missing-contract'}
      onClick={isEditMode && editableId ? () => setSelectedEditableId(editableId) : undefined}
    >
      {showAffordance && (
        <div className={'editable-surface-affordance' + (isSelected ? ' active' : '')} data-testid={`editable-affordance-${editableId}`}>
          <span style={{ display: 'inline-flex' }}>{Icon.edit(12)}</span>
          <span style={{ display: 'inline-flex' }}>{Icon.settings(12)}</span>
        </div>
      )}
      {children}
    </div>
  );
}
