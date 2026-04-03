import React from 'react';
import Icon from '../../../lib/icons';
import { DEFAULT_ACTION_ORDER, resolveToolbarActionView } from './editToolbarConfig';

const ICON_SLOTS = {
  edit: () => Icon.edit(12),
  gripVertical: () => Icon.gripVertical(12),
  copy: () => Icon.copy(12),
  trash: () => Icon.trash(12),
  eye: () => Icon.eye(12),
  eyeOff: () => Icon.eyeOff(12)
};

function EditToolbar({
  enabledActions = [],
  onAction,
  className = '',
  activeAction,
  ariaLabel = 'Edit toolbar'
}) {
  const toolbarActions = DEFAULT_ACTION_ORDER.filter((action) => enabledActions.includes(action));

  if (!toolbarActions.length) return null;

  return (
    <div className={`edit-toolbar ${className}`.trim()} role="toolbar" aria-label={ariaLabel}>
      {toolbarActions.map((action) => {
        const isActive = activeAction === action || (action === 'visibility' && !!activeAction?.visibility);
        const resolved = resolveToolbarActionView(action, Boolean(activeAction?.visibility));
        const label = resolved?.label;
        const iconRenderer = ICON_SLOTS[resolved?.icon];
        const icon = iconRenderer ? iconRenderer() : null;

        return (
          <button
            key={action}
            type="button"
            className={`notes-toolbar-btn edit-toolbar-btn${isActive ? ' active' : ''}`}
            onClick={(event) => onAction?.(action, event)}
            title={label}
            aria-label={label}
            data-action={action}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}

export default EditToolbar;
