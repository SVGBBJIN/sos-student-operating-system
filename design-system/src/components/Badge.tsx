import React from 'react';
import type { SosCardAccent } from './Card';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Status color, matching the same per-type vocabulary as Card's accent. @default 'accent' */
  tone?: SosCardAccent;
}

/**
 * Small status/label pill — matches .notes-badge (subject/file-type tags in NotesPanel)
 * and ConfirmationCard's header badge.
 */
export function Badge({ tone = 'accent', className, children, ...rest }: BadgeProps) {
  const cls = ['sos-ds-badge', `sos-ds-badge--${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

/**
 * Clickable quick-pick chip — matches .sos-chip exactly (subject/event-type
 * suggestion rows). The real class has no "selected"/active visual state —
 * only default and :hover — so this component doesn't invent one either.
 */
export function Chip({ className, children, ...rest }: ChipProps) {
  const cls = ['sos-ds-chip', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
