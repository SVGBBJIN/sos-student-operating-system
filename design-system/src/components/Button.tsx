import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight of the button. @default 'primary' */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Button size. @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Icon rendered before the label. */
  icon?: React.ReactNode;
  /** Stretches the button to fill its container. */
  fullWidth?: boolean;
}

/**
 * Primary interactive control for the SOS design system.
 * Used for form submissions, action-card confirmations, and toolbar actions.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  fullWidth,
  className,
  children,
  ...rest
}: ButtonProps) {
  const cls = ['sos-ds-btn', `sos-ds-btn--${variant}`, `sos-ds-btn--${size}`, fullWidth ? 'sos-ds-btn--full' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {icon && <span className="sos-ds-btn-icon">{icon}</span>}
      {children}
    </button>
  );
}
