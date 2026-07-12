import React from 'react';

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Label rendered above the input. */
  label?: string;
  /** Small helper or error text rendered below the input. */
  hint?: string;
  /** Renders the hint in the danger color. */
  error?: boolean;
}

/**
 * Standard text input — used in auth forms, settings fields, and inline task/event editors.
 */
export function TextField({ label, hint, error, id, className, ...rest }: TextFieldProps) {
  const inputId = id ?? (label ? `sos-ds-field-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return (
    <div className={['sos-ds-field', className].filter(Boolean).join(' ')}>
      {label && (
        <label className="sos-ds-field-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input id={inputId} className="sos-ds-field-input" {...rest} />
      {hint && <div className={'sos-ds-field-hint' + (error ? ' sos-ds-field-hint--error' : '')}>{hint}</div>}
    </div>
  );
}
