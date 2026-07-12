import React, { useEffect } from 'react';

export interface ToastProps {
  /** Message shown in the toast. */
  message: React.ReactNode;
  /** Called after the toast's display window elapses. */
  onDone: () => void;
  /** Milliseconds the toast stays visible before onDone fires. @default 2400 */
  durationMs?: number;
}

/**
 * Transient success confirmation, e.g. "Task added" — auto-dismisses after `durationMs`.
 */
export function Toast({ message, onDone, durationMs = 2400 }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onDone]);
  return <div className="sos-ds-toast">{message}</div>;
}

export interface ConfirmToastProps {
  /** Message asking the user to confirm. */
  message: React.ReactNode;
  /** Label for the confirming action. @default 'Confirm' */
  confirmLabel?: string;
  /** Label for the rejecting action. @default 'Not yet' */
  rejectLabel?: string;
  onConfirm: () => void;
  onReject: () => void;
  /** Small caption line above the message, e.g. a source label. */
  eyebrow?: React.ReactNode;
}

/**
 * Persistent confirmation toast with explicit accept/reject actions — used for
 * LMS-detected submissions and other evidence-based prompts that need a human decision.
 */
export function ConfirmToast({
  message,
  confirmLabel = 'Confirm',
  rejectLabel = 'Not yet',
  onConfirm,
  onReject,
  eyebrow,
}: ConfirmToastProps) {
  return (
    <div className="sos-ds-confirm-toast">
      {eyebrow && <div className="sos-ds-confirm-toast-eyebrow">{eyebrow}</div>}
      <div className="sos-ds-confirm-toast-message">{message}</div>
      <div className="sos-ds-confirm-toast-actions">
        <button type="button" className="sos-ds-confirm-toast-confirm" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="sos-ds-confirm-toast-reject" onClick={onReject}>
          {rejectLabel}
        </button>
      </div>
    </div>
  );
}
