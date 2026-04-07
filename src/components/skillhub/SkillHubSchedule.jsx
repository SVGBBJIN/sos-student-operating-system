import React from 'react';
import { filterScheduleTasks, groupByTimeBucket, formatDue, getSubjectIcon } from '../../lib/skillHubUtils.js';
import { detectModeFromText } from '../../lib/tutorModeConfig.js';

/**
 * SkillHubSchedule — read-only filtered task timeline.
 * Clicking a task loads it in Chat with auto-mode selection.
 *
 * Props:
 *   tasks         — all tasks from main app
 *   onOpenInChat  — (task, suggestedMode) => void
 */
export default function SkillHubSchedule({ tasks, onOpenInChat }) {
  const filtered = filterScheduleTasks(tasks || []);
  const buckets  = groupByTimeBucket(filtered);

  if (buckets.length === 0) {
    return (
      <div className="sh-tab-panel">
        <div className="sh-schedule-wrap">
          <div className="sh-empty-state">
            <div className="sh-empty-state-icon">🗓</div>
            <div>No upcoming study tasks.</div>
            <div style={{ marginTop: 6, fontSize: '0.8rem' }}>
              Tasks tagged test, quiz, homework, or essay due within 14 days will appear here.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sh-tab-panel">
      <div className="sh-schedule-wrap">
        {buckets.map(([label, items]) => (
          <div key={label} className="sh-timeline-bucket">
            <div className="sh-timeline-label">{label}</div>
            {items.map(task => {
              const icon  = getSubjectIcon((task.title || '') + ' ' + (task.subject || ''));
              const due   = formatDue(task.dueDate);
              const mode  = detectModeFromText((task.title || '') + ' ' + (task.subject || ''));
              return (
                <div
                  key={task.id}
                  className={'sh-timeline-item' + (task.overdue ? ' overdue' : '')}
                  onClick={() => onOpenInChat(task, mode)}
                  title="Click to study this in Chat"
                >
                  <span className="sh-timeline-item-icon">{icon}</span>
                  <div className="sh-timeline-item-info">
                    <div className="sh-timeline-item-title">{task.title}</div>
                    {task.subject && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--sh-text-muted)', marginTop: 1 }}>
                        {task.subject}
                      </div>
                    )}
                    <div className="sh-timeline-item-due">{due}</div>
                  </div>
                  <span className="sh-timeline-item-arrow">→</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
