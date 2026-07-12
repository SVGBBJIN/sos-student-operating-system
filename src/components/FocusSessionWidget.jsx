import React from 'react';
import { StudioIcon } from './StudioIcons';

const FOCUS_MODES = [
  { id: 'sprint',   label: 'Sprint',   sub: 'timed · one task', icon: 'zap' },
  { id: 'marathon', label: 'Marathon', sub: 'goal · loops tasks', icon: 'target' },
];

export default function FocusSessionWidget({ onLaunch }) {
  return (
    <div className="focus-row">
      {FOCUS_MODES.map(m => (
        <button
          key={m.id}
          className="focus-card"
          onClick={() => onLaunch?.(m.id)}
          title={`Start a ${m.label}`}
        >
          <span className="focus-card-ic"><StudioIcon name={m.icon} size={14} /></span>
          <span className="focus-card-body">
            <span className="focus-card-label">{m.label}</span>
            <span className="focus-card-time">{m.sub}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
