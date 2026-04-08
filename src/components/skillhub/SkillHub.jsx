import React, { useState, useEffect, useCallback } from 'react';
import { sb } from '../../lib/supabase.js';
import { getModeConfig } from '../../lib/tutorModeConfig.js';
import { evaluateTriggers, recordSkillHubVisit } from '../../lib/skillHubUtils.js';
import SkillHubHome     from './SkillHubHome.jsx';
import SkillHubChat     from './SkillHubChat.jsx';
import SkillHubLessons  from './SkillHubLessons.jsx';
import SkillHubSchedule from './SkillHubSchedule.jsx';

/**
 * SkillHub — the Skill Hub content area (no sidebar — navigation lives in App.jsx main sidebar).
 *
 * Props (state lifted to App.jsx so the sidebar can control navigation):
 *   activeTab      — 'home' | 'chat' | 'lessons' | 'schedule'
 *   setActiveTab   — (tab) => void
 *   activeMode     — 'cause-effect' | 'interpretation' | 'study'
 *   onModeSwitch   — (mode) => void
 *   onAutoSwitchMode — (mode) => void  (from chat auto-detection)
 *   lessons        — lesson array (lifted to App.jsx for sidebar companion)
 *   onLessonsChange — (lessons) => void
 *
 *   tasks        — all tasks from main app
 *   events       — all events from main app
 *   notes        — all notes from main app
 *   user         — auth user object
 *   onBack       — () => void — exit Skill Hub back to main chat
 *   setToastMsg  — (msg) => void — fires main app toast
 */
export default function SkillHub({
  activeTab, setActiveTab,
  activeMode, onModeSwitch, onAutoSwitchMode,
  lessons, onLessonsChange,
  tasks, events, notes, user, onBack, setToastMsg,
}) {
  const [linkedTask,   setLinkedTask]   = useState(null);
  const [triggers,     setTriggers]     = useState([]);
  const [dismissals,   setDismissals]   = useState([]);
  const [sessions,     setSessions]     = useState([]);

  const modeConfig = getModeConfig(activeMode);

  // ── On mount: record visit, load data ──────────────────────────────────────
  useEffect(() => {
    recordSkillHubVisit();
    if (user) {
      loadDismissals();
      loadSessions();
      loadLessons();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Evaluate triggers when tasks/dismissals change ─────────────────────────
  useEffect(() => {
    const t = evaluateTriggers(tasks || [], dismissals);
    setTriggers(t);
  }, [tasks, dismissals]);

  // ── Data loaders ───────────────────────────────────────────────────────────
  async function loadDismissals() {
    const { data } = await sb
      .from('trigger_dismissals')
      .select('*')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString());
    if (data) setDismissals(data);
  }

  async function loadSessions() {
    const { data } = await sb
      .from('skill_hub_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setSessions(data);
  }

  async function loadLessons() {
    const { data } = await sb
      .from('lessons')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) onLessonsChange?.(data);
  }

  // ── Trigger actions ────────────────────────────────────────────────────────
  function handleNudgeGo(trigger) {
    if (trigger.suggestedMode) onModeSwitch?.(trigger.suggestedMode);
    setLinkedTask(trigger.task);
    setActiveTab('chat');
  }

  async function handleNudgeDismiss(trigger) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const dismissal = { task_id: trigger.task.id, expires_at: expiresAt };
    if (user) {
      await sb.from('trigger_dismissals').insert({ ...dismissal, user_id: user.id });
    }
    setDismissals(prev => [...prev, { ...dismissal, id: 'local-' + Date.now() }]);
  }

  // ── Session save ───────────────────────────────────────────────────────────
  async function handleSessionSave(record) {
    if (!user) return;
    const { data } = await sb
      .from('skill_hub_sessions')
      .insert({ ...record, user_id: user.id })
      .select()
      .single();
    if (data) setSessions(prev => [data, ...prev]);
  }

  // ── Open task in chat (from Schedule tab) ──────────────────────────────────
  function handleOpenInChat(task, suggestedMode) {
    if (suggestedMode) onModeSwitch?.(suggestedMode);
    setLinkedTask(task);
    setActiveTab('chat');
  }

  // ── Render active tab ──────────────────────────────────────────────────────
  function renderTab() {
    switch (activeTab) {
      case 'home':
        return (
          <SkillHubHome
            triggers={triggers}
            sessions={sessions}
            lessons={lessons || []}
            onNudgeGo={handleNudgeGo}
            onNudgeDismiss={handleNudgeDismiss}
            onOpenLesson={() => setActiveTab('lessons')}
            onOpenChat={() => setActiveTab('chat')}
          />
        );
      case 'chat':
        return (
          <SkillHubChat
            activeMode={activeMode}
            linkedTask={linkedTask}
            tasks={tasks}
            notes={notes}
            user={user}
            onSessionSave={handleSessionSave}
            onAutoSwitchMode={onAutoSwitchMode}
          />
        );
      case 'lessons':
        return (
          <SkillHubLessons
            lessons={lessons || []}
            activeMode={activeMode}
            user={user}
            onLessonUpdate={onLessonsChange}
          />
        );
      case 'schedule':
        return (
          <SkillHubSchedule
            tasks={tasks}
            onOpenInChat={handleOpenInChat}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div
      className="skill-hub"
      data-mode={activeMode}
      style={{ '--sh-accent': modeConfig.accentColor }}
    >
      <main className="sh-main">
        {renderTab()}
      </main>
    </div>
  );
}
