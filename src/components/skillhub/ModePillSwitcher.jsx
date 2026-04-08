import React from 'react';
import { TUTOR_MODES } from '../../lib/tutorModeConfig.js';

/**
 * ModePillSwitcher — three-pill selector at the bottom of the Skill Hub sidebar.
 *
 * Props:
 *   activeMode — current mode id
 *   onSwitch   — (modeId) => void
 *   disabled   — disable while AI is loading
 */
export default function ModePillSwitcher({ activeMode, onSwitch, disabled }) {
  const modes = Object.values(TUTOR_MODES);

  return (
    <div className="sh-mode-switcher">
      <div className="sh-mode-label">Tutor mode</div>
      <div className="sh-mode-pills">
        {modes.map(m => (
          <button
            key={m.id}
            className={'sh-mode-pill' + (activeMode === m.id ? ' active' : '')}
            style={{
              '--pill-accent':      m.accentColor,
              '--pill-accent-dim':  m.accentDim,
              '--pill-accent-glow': m.accentGlow,
            }}
            disabled={disabled}
            onClick={() => {
              if (activeMode !== m.id) onSwitch(m.id);
            }}
            title={m.label}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
