import React, { useMemo } from 'react';
import NudgeCard from './NudgeCard.jsx';
import { getModeConfig } from '../../lib/tutorModeConfig.js';

/**
 * SkillHubHome — dashboard tab.
 * Sections: nudge cards, weekly activity, skills tracker, streak, topics, lessons in progress, recent sessions.
 */
export default function SkillHubHome({
  triggers, sessions, lessons,
  onNudgeGo, onNudgeDismiss, onOpenLesson, onOpenChat,
}) {
  const allSessions  = sessions || [];
  const allLessons   = lessons  || [];
  const activeLessons = allLessons.filter(l => l.status !== 'complete').slice(0, 4);
  const recentSessions = allSessions.slice(0, 8);

  // ── Weekly activity (last 7 days) ──────────────────────────────────────────
  const weeklyActivity = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const count = allSessions.filter(s =>
        s.created_at && s.created_at.slice(0, 10) === ds
      ).length;
      days.push({ date: ds, count, label: d.toLocaleDateString('en-US', { weekday: 'short' }) });
    }
    return days;
  }, [allSessions]);

  // ── Streak: consecutive days with sessions (most recent first) ─────────────
  const streak = useMemo(() => {
    if (allSessions.length === 0) return 0;
    let count = 0;
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const hasSession = allSessions.some(s => s.created_at?.slice(0, 10) === ds);
      if (hasSession) {
        count++;
      } else if (i > 0) {
        break; // gap found — streak ends
      }
    }
    return count;
  }, [allSessions]);

  // ── Skills tracker: accuracy per subject ───────────────────────────────────
  const skillsBySubject = useMemo(() => {
    const map = {};
    for (const s of allSessions) {
      const key = s.subject || s.mode || 'general';
      if (!map[key]) map[key] = { correct: 0, incorrect: 0, sessions: 0, mode: s.mode };
      map[key].correct   += s.score_correct   || 0;
      map[key].incorrect += s.score_incorrect || 0;
      map[key].sessions  += 1;
    }
    return Object.entries(map)
      .map(([subject, data]) => ({
        subject,
        ...data,
        total:    data.correct + data.incorrect,
        accuracy: data.correct + data.incorrect > 0
          ? Math.round((data.correct / (data.correct + data.incorrect)) * 100)
          : null,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 6);
  }, [allSessions]);

  // ── Topics practiced (from struggled_topics) ───────────────────────────────
  const topicChips = useMemo(() => {
    const counts = {};
    for (const s of allSessions) {
      for (const t of (s.struggled_topics || [])) {
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([topic, count]) => ({ topic, count }));
  }, [allSessions]);

  const totalSessions = allSessions.length;
  const totalCorrect  = allSessions.reduce((s, r) => s + (r.score_correct || 0), 0);
  const totalAnswered = allSessions.reduce((s, r) => s + (r.score_correct || 0) + (r.score_incorrect || 0), 0);

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

        {/* ── Stats bar ─────────────────────────────────────────────── */}
        {totalSessions > 0 && (
          <div className="sh-stats-bar">
            <div className="sh-stat-chip">
              <div className="sh-stat-value">{totalSessions}</div>
              <div className="sh-stat-label">Sessions</div>
            </div>
            <div className="sh-stat-chip">
              <div className="sh-stat-value">
                {totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) + '%' : '—'}
              </div>
              <div className="sh-stat-label">Accuracy</div>
            </div>
            <div className="sh-stat-chip">
              <div className="sh-stat-value" style={{ color: streak >= 3 ? 'var(--sh-accent)' : undefined }}>
                {streak > 0 ? `${streak}🔥` : '0'}
              </div>
              <div className="sh-stat-label">Day streak</div>
            </div>
            <div className="sh-stat-chip">
              <div className="sh-stat-value">{allLessons.filter(l => l.status === 'complete').length}</div>
              <div className="sh-stat-label">Lessons done</div>
            </div>
          </div>
        )}

        {/* ── Weekly activity ────────────────────────────────────────── */}
        {totalSessions > 0 && (
          <div>
            <div className="sh-section-title">This week</div>
            <div className="sh-week-grid">
              {weeklyActivity.map(day => (
                <div key={day.date} className="sh-week-day">
                  <div
                    className={'sh-week-dot' + (day.count > 0 ? ' active' : '')}
                    style={day.count > 0 ? { opacity: Math.min(0.4 + day.count * 0.3, 1) } : undefined}
                    title={`${day.label}: ${day.count} session${day.count !== 1 ? 's' : ''}`}
                  />
                  <div className="sh-week-label">{day.label[0]}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Skills by subject ─────────────────────────────────────── */}
        {skillsBySubject.length > 0 && (
          <div>
            <div className="sh-section-title">Skills tracker</div>
            <div className="sh-skills-list">
              {skillsBySubject.map(({ subject, accuracy, sessions: sc, mode }) => {
                const cfg = getModeConfig(mode);
                return (
                  <div key={subject} className="sh-skill-row">
                    <span className="sh-skill-icon">{cfg.icon}</span>
                    <div className="sh-skill-info">
                      <div className="sh-skill-label">{subject}</div>
                      <div className="sh-skill-bar-wrap">
                        <div
                          className="sh-skill-bar"
                          style={{
                            width: accuracy !== null ? accuracy + '%' : '0%',
                            background: accuracy !== null && accuracy >= 70
                              ? 'var(--sh-correct)'
                              : accuracy !== null && accuracy >= 40
                                ? 'var(--sh-accent)'
                                : 'var(--sh-wrong)',
                          }}
                        />
                      </div>
                    </div>
                    <div className="sh-skill-pct">
                      {accuracy !== null ? accuracy + '%' : '—'}
                    </div>
                    <div className="sh-skill-count">{sc} sess.</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Topics practiced ─────────────────────────────────────── */}
        {topicChips.length > 0 && (
          <div>
            <div className="sh-section-title">Topics practiced</div>
            <div className="sh-topic-chips">
              {topicChips.map(({ topic, count }) => (
                <span key={topic} className="sh-topic-chip" title={`Reviewed ${count}×`}>
                  {topic}
                  <span className="sh-topic-chip-count">{count}</span>
                </span>
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
        {recentSessions.length > 0 && (
          <div>
            <div className="sh-section-title">Recent sessions</div>
            <div className="sh-sessions-list">
              {recentSessions.map((s, i) => {
                const cfg = getModeConfig(s.mode);
                const duration = s.started_at && s.ended_at
                  ? Math.round((new Date(s.ended_at) - new Date(s.started_at)) / 60000)
                  : null;
                const timeAgo = s.created_at ? formatTimeAgo(new Date(s.created_at)) : '';
                const total = (s.score_correct ?? 0) + (s.score_incorrect ?? 0);
                return (
                  <div key={s.id || i} className="sh-session-row">
                    <span className="sh-session-mode-icon">{cfg.icon}</span>
                    <div className="sh-session-info">
                      <div className="sh-session-info-title">
                        {cfg.label}{s.subject ? ` · ${s.subject}` : ''}
                      </div>
                      <div className="sh-session-info-meta">
                        {duration !== null && duration > 0 ? `${duration} min` : ''}
                        {timeAgo ? ` · ${timeAgo}` : ''}
                      </div>
                    </div>
                    {total > 0 && (
                      <div className="sh-session-score-badge">
                        <span className="correct">{s.score_correct ?? 0}</span>
                        <span>/</span>
                        <span>{total}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────────────────── */}
        {totalSessions === 0 && activeLessons.length === 0 && !triggers?.length && (
          <div className="sh-empty-state">
            <div className="sh-empty-state-icon">🎓</div>
            <div>Welcome to Skill Hub.</div>
            <div style={{ marginTop: 6 }}>
              <button className="sh-btn sh-btn-primary" onClick={onOpenChat}>
                Start a session →
              </button>
            </div>
          </div>
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
