import React from 'react';
import { StudioIcon } from './StudioIcons';

const FOCUS_PRESETS = [
  { id: 'pomodoro', label: 'Pomodoro', duration: '25 min', preset: 'pomodoro', icon: 'play' },
  { id: 'short_break', label: 'Short break', duration: '5 min', preset: 'short_break', icon: 'pause' },
  { id: 'long_break', label: 'Long break', duration: '15 min', preset: 'long_break', icon: 'pause' },
];

export default function FocusSessionWidget({ onStartSession }) {
  return (
    <div className="focus-widget">
      <div className="focus-widget-header">
        <h3>Start a focus session</h3>
      </div>
      <div className="focus-widget-buttons">
        {FOCUS_PRESETS.map(preset => (
          <button
            key={preset.id}
            className="focus-btn"
            onClick={() => onStartSession?.(preset.preset, preset.label)}
            title={`Start ${preset.label}`}
          >
            <span className="focus-btn-icon"><StudioIcon name={preset.icon} size={14} /></span>
            <span className="focus-btn-label">{preset.label}</span>
            <span className="focus-btn-time">{preset.duration}</span>
          </button>
        ))}
      </div>
      <style>{`
        .focus-widget {
          padding: 0;
        }
        .focus-widget-header {
          padding: 12px 16px 8px;
          border-bottom: 1px solid var(--border);
        }
        .focus-widget-header h3 {
          font-size: 13px;
          font-weight: 600;
          margin: 0;
          color: var(--text);
        }
        .focus-widget-buttons {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 12px;
        }
        .focus-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface);
          color: var(--text);
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          transition: all 150ms ease;
        }
        .focus-btn:hover {
          background: var(--surface-hover);
          border-color: var(--border-hover);
        }
        .focus-btn:active {
          transform: scale(0.98);
        }
        .focus-btn-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 20px;
          height: 20px;
          border-radius: 4px;
          background: var(--accent-dim);
          color: var(--accent);
        }
        .focus-btn-label {
          flex: 1;
          text-align: left;
        }
        .focus-btn-time {
          font-size: 12px;
          color: var(--text-dim);
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
