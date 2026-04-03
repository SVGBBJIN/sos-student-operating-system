const DEFAULT_ACTION_ORDER = ['edit', 'drag-handle', 'duplicate', 'delete', 'visibility'];

const EDIT_TOOLBAR_ACTIONS = {
  edit: { icon: 'edit', label: 'Edit' },
  'drag-handle': { icon: 'gripVertical', label: 'Drag' },
  duplicate: { icon: 'copy', label: 'Duplicate' },
  delete: { icon: 'trash', label: 'Delete' },
  visibility: {
    icon: (isVisible) => (isVisible ? 'eyeOff' : 'eye'),
    label: (isVisible) => (isVisible ? 'Hide' : 'Show')
  }
};

function resolveToolbarActionView(action, isVisible = false) {
  const config = EDIT_TOOLBAR_ACTIONS[action];
  if (!config) return null;
  return {
    action,
    icon: typeof config.icon === 'function' ? config.icon(isVisible) : config.icon,
    label: typeof config.label === 'function' ? config.label(isVisible) : config.label
  };
}

export { DEFAULT_ACTION_ORDER, EDIT_TOOLBAR_ACTIONS, resolveToolbarActionView };
