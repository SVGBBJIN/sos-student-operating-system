import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accent color of the card's left border and header icon. @default 'teal' */
  accent?: 'teal' | 'amber' | 'violet' | 'danger';
}

/**
 * Elevated surface used for AI content cards, proposal cards, and confirmation cards.
 * Compose with CardHeader / CardBody / CardActions.
 */
export function Card({ accent = 'teal', className, children, ...rest }: CardProps) {
  const cls = ['sos-ds-card', `sos-ds-card--${accent}`, className].filter(Boolean).join(' ');
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}

export interface CardHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Icon rendered in the header's leading badge. */
  icon?: React.ReactNode;
  /** Header title text. */
  title: React.ReactNode;
  /** Small text under the title, e.g. subject or timestamp. */
  subtitle?: React.ReactNode;
}

/** Header row for a Card — icon, title, optional subtitle. */
export function CardHeader({ icon, title, subtitle, className, ...rest }: CardHeaderProps) {
  return (
    <div className={['sos-ds-card-header', className].filter(Boolean).join(' ')} {...rest}>
      <div className="sos-ds-card-header-left">
        {icon && <span className="sos-ds-card-header-icon">{icon}</span>}
        <div>
          <div className="sos-ds-card-title">{title}</div>
          {subtitle && <div className="sos-ds-card-subtitle">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

/** Padded content region of a Card. */
export function CardBody({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['sos-ds-card-body', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}

/** Footer action row of a Card — houses Buttons for save/dismiss/confirm. */
export function CardActions({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['sos-ds-card-actions', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}
