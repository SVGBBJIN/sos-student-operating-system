import React from 'react';
import { getSubjectIcon } from '../../lib/skillHubUtils.js';

/**
 * NudgeCard — smart trigger nudge card.
 * Used both in the main app sidebar and the Skill Hub Home tab.
 *
 * Props:
 *   trigger  — { task, triggerType, message, suggestedMode, daysUntilDue }
 *   compact  — if true, renders inline (for sidebar); else full card layout
 *   onGo     — () => void — routes to Skill Hub with task pre-loaded
 *   onDismiss — () => void — dismiss for 24 hours
 */
export default function NudgeCard({ trigger, compact = false, onGo, onDismiss }) {
  if (!trigger) return null;
  const { task, message } = trigger;
  const icon = getSubjectIcon((task.title || '') + ' ' + (task.subject || ''));

  if (compact) {
    return (
      <div className="app-nudge-card">
        <div className="app-nudge-msg">
          <strong>{icon}</strong> {message}
        </div>
        <div className="app-nudge-actions">
          <button className="app-nudge-go" onClick={onGo}>✓ Let's go</button>
          <button className="app-nudge-dismiss" onClick={onDismiss}>✗</button>
        </div>
      </div>
    );
  }

  return (
    <div className="sh-nudge-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span className="sh-nudge-icon">{icon}</span>
        <span className="sh-nudge-msg">{message}</span>
      </div>
      <div className="sh-nudge-actions">
        <button className="sh-nudge-go" onClick={onGo}>✓ Let's go</button>
        <button className="sh-nudge-dismiss" onClick={onDismiss}>✗ Later</button>
      </div>
    </div>
  );
}
