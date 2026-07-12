import React from 'react';

export interface ProgressBarProps {
  /** Completion percentage, 0–100. Omit to render an indeterminate sweeping bar. */
  value?: number;
}

/**
 * Thin progress track. With no `value`, renders an indeterminate sweep used
 * while a long-running AI pipeline step (plan/studio generation) is in flight.
 */
export function ProgressBar({ value }: ProgressBarProps) {
  const indeterminate = value === undefined;
  return (
    <div className="sos-ds-progress-track" role="progressbar" aria-valuenow={indeterminate ? undefined : value}>
      {!indeterminate && (
        <div className="sos-ds-progress-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      )}
    </div>
  );
}
