import React from 'react';
import NudgeCard from './NudgeCard.jsx';
import { getModeConfig } from '../../lib/tutorModeConfig.js';

/**
 * SkillHubHome — dashboard tab.
 * Three sections: trigger nudges, recent sessions, lesson progress.
 *
 * Props:
 *   triggers      — array of trigger objects from evaluateTriggers()
 *   sessions      — array of skill_hub_sessions rows (most recent first)
 *   lessons       — array of lessons rows
 *   onNudgeGo     — (trigger) => void
 *   onNudgeDismiss — (trigger) => void
 *   onOpenLesson  — (lesson) => void
 *   onOpenChat    — () => void
 */
export default function SkillHubHome({
  triggers, sessions, lessons,
  onNudgeGo, onNudgeDismiss, onOpenLesson, onOpenChat,
}) {
  const activeLessons  = (lessons  || []).filter(l => l.status !== 'complete').slice(0, 4);
  const recentSessions = (sessions || []).slice(0, 5);

  return (
    <div className="sh-tab-panel">
      <div className="sh-home-grid">

        {/* ── Nudges ──────────────────────────────────────────────────── */}
        {triggers?.length > 0 && (
          <div>
            <div className="sh-section-title">Up next</div>
            <div className="sh-nudge-feed">
              {triggers.map((t, i) => (
                <NudgeCard
                  key={t.task?.id || i}
                  trigger={t}
                  onGo={() => onNudgeGo(t)}
                  onDismiss={() => onNudgeDismiss(t)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Lessons in progress ─────────────────────────────────────── */}
        {activeLessons.length > 0 && (
          <div>
            <div className="sh-section-title">Continue learning</div>
            <div className="sh-lessons-preview">
              {activeLessons.map(lesson => {
                const screens = lesson.screens || [];
                const done    = lesson.current_screen || 0;
                const total   = screens.length;
                const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
                const cfg     = getModeConfig(lesson.mode);
                return (
                  <div
                    key={lesson.id}
                    className="sh-lesson-preview-card"
                    onClick={() => onOpenLesson?.(lesson)}
                  >
                    <span className="sh-lesson-preview-icon">{cfg.icon}</span>
                    <div className="sh-lesson-preview-info">
                      <div className="sh-lesson-preview-title">{lesson.topic}</div>
                      <div className="sh-lesson-preview-meta">
                        {done}/{total} screens
                        {lesson.estimated_minutes ? ` · ~${lesson.estimated_minutes} min` : ''}
                      </div>
                      <div className="sh-progress-bar">
                        <div className="sh-progress-fill" style={{ width: pct + '%' }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Recent sessions ──────────────────────────────────────────── */}
        {recentSessions.length > 0 ? (
          <div>
            <div className="sh-section-title">Recent sessions</div>
            <div className="sh-sessions-list">
              {recentSessions.map((s, i) => {
                const cfg = getModeConfig(s.mode);
                const duration = s.started_at && s.ended_at
                  ? Math.round((new Date(s.ended_at) - new Date(s.started_at)) / 60000)
                  : null;
                const timeAgo = s.created_at ? formatTimeAgo(new Date(s.created_at)) : '';
                return (
                  <div key={s.id || i} className="sh-session-row">
                    <span className="sh-session-mode-icon">{cfg.icon}</span>
                    <div className="sh-session-info">
                      <div className="sh-session-info-title">
                        {cfg.label}{s.subject ? ` · ${s.subject}` : ''}
                      </div>
                      <div className="sh-session-info-meta">
                        {duration !== null ? `${duration} min` : ''}
                        {timeAgo ? ` · ${timeAgo}` : ''}
                      </div>
                    </div>
                    <div className="sh-session-score-badge">
                      <span className="correct">{s.score_correct ?? 0}</span>
                      <span>/</span>
                      <span>{(s.score_correct ?? 0) + (s.score_incorrect ?? 0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Empty state — no sessions yet */
          triggers?.length === 0 && activeLessons.length === 0 && (
            <div className="sh-empty-state">
              <div className="sh-empty-state-icon">🎓</div>
              <div>Welcome to Skill Hub.</div>
              <div style={{ marginTop: 6 }}>
                <button className="sh-btn sh-btn-primary" onClick={onOpenChat}>
                  Start a session →
                </button>
              </div>
            </div>
          )
        )}

      </div>
    </div>
  );
}

function formatTimeAgo(date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
