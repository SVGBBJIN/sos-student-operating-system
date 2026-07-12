import React from 'react';
import { StudioIcon } from './StudioIcons';

const FOCUS_PRESETS = [
  { id: 'pomodoro',    label: 'Pomodoro',    duration: '25 min', preset: 'pomodoro',    icon: 'play' },
  { id: 'short_break', label: 'Short break', duration: '5 min',  preset: 'short_break', icon: 'pause' },
  { id: 'long_break',  label: 'Long break',  duration: '15 min', preset: 'long_break',  icon: 'pause' },
];

export default function FocusSessionWidget({ onStartSession }) {
  return (
    <div className="focus-row">
      {FOCUS_PRESETS.map(preset => (
        <button
          key={preset.id}
          className="focus-card"
          onClick={() => onStartSession?.(preset.preset, preset.label)}
          title={`Start ${preset.label}`}
        >
          <span className="focus-card-ic"><StudioIcon name={preset.icon} size={14} /></span>
          <span className="focus-card-body">
            <span className="focus-card-label">{preset.label}</span>
            <span className="focus-card-time">{preset.duration}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
