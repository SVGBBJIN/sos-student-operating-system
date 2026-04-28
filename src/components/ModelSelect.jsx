import React, { useState, useEffect } from 'react';

const MODEL_DEEP = 'openai/gpt-oss-120b';
const MODEL_FAST = 'openai/gpt-oss-20b';
const MODEL_KEY = 'sos_preferred_model';

export default function ModelSelect({ value, onChange, className }) {
  const [internal, setInternal] = useState(() => {
    try { return localStorage.getItem(MODEL_KEY) || MODEL_DEEP; } catch (_) { return MODEL_DEEP; }
  });
  const current = value ?? internal;

  useEffect(() => {
    if (value !== undefined && value !== internal) setInternal(value);
  }, [value]);

  const handle = (e) => {
    const next = e.target.value;
    setInternal(next);
    try { localStorage.setItem(MODEL_KEY, next); } catch (_) {}
    onChange?.(next);
  };

  return (
    <select
      value={current}
      onChange={handle}
      className={className}
      title="Select AI model — Deep is more accurate, Fast is quicker"
      style={{
        fontSize: '11px',
        padding: '2px 6px',
        borderRadius: '4px',
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.2)',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      <option value={MODEL_DEEP}>Deep (120B)</option>
      <option value={MODEL_FAST}>Fast (20B)</option>
    </select>
  );
}
