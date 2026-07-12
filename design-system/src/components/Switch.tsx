import React from 'react';

export interface SwitchProps {
  /** Current on/off state. */
  checked: boolean;
  /** Called when the user toggles the switch. */
  onChange: () => void;
  /** Accessible label — announced to screen readers, not rendered visibly. */
  label: string;
  disabled?: boolean;
}

/**
 * Apple-style toggle switch — used throughout Settings (auto-approve, notification prefs).
 */
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={'sos-ds-switch' + (checked ? ' sos-ds-switch--on' : '')}
    >
      <span className="sos-ds-switch-knob" />
    </button>
  );
}
