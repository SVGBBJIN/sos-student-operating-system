import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Status color of the badge. @default 'neutral' */
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

/**
 * Small status/label pill — used for subject tags, priority markers, and LMS badges.
 */
export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  const cls = ['sos-ds-badge', `sos-ds-badge--${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Marks the chip as the currently selected option. */
  selected?: boolean;
}

/**
 * Clickable quick-pick chip — used for subject pickers, event-type pickers, and suggestion rows.
 */
export function Chip({ selected, className, children, ...rest }: ChipProps) {
  const cls = ['sos-ds-chip', selected ? 'sos-ds-chip--selected' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
