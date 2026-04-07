import React, { useState, useEffect, useCallback } from 'react';
import { sb } from '../../lib/supabase.js';
import { getModeConfig, DEFAULT_MODE } from '../../lib/tutorModeConfig.js';
import { evaluateTriggers, recordSkillHubVisit } from '../../lib/skillHubUtils.js';
import ModePillSwitcher from './ModePillSwitcher.jsx';
import SkillHubHome     from './SkillHubHome.jsx';
import SkillHubChat     from './SkillHubChat.jsx';
import SkillHubLessons  from './SkillHubLessons.jsx';
import SkillHubSchedule from './SkillHubSchedule.jsx';

const TABS = [
  { id: 'home',     label: 'Home',     icon: '🏠' },
  { id: 'chat',     label: 'Chat',     icon: '💬' },
  { id: 'lessons',  label: 'Lessons',  icon: '📖' },
  { id: 'schedule', label: 'Schedule', icon: '🗓' },
];

/**
 * SkillHub — the full Skill Hub UI shell.
 * Mounted in place of the old TutorMissionPage.
 *
 * Props:
 *   tasks        — all tasks from main app
 *   events       — all events from main app
 *   notes        — all notes from main app
 *   user         — auth user object
 *   onBack       — () => void — exit Skill Hub back to main chat
 *   setToastMsg  — (msg) => void — fires main app toast
 */
export default function SkillHub({ tasks, events, notes, user, onBack, setToastMsg }) {
  const [activeTab,    setActiveTab]    = useState('home');
  const [activeMode,   setActiveMode]   = useState(() =>
    localStorage.getItem('sos_skill_hub_mode') || DEFAULT_MODE
  );
  const [linkedTask,   setLinkedTask]   = useState(null);
  const [triggers,     setTriggers]     = useState([]);
  const [dismissals,   setDismissals]   = useState([]);
  const [sessions,     setSessions]     = useState([]);
  const [lessons,      setLessons]      = useState([]);
  const [modeLoading,  setModeLoading]  = useState(false);

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
      .limit(20);
    if (data) setSessions(data);
  }

  async function loadLessons() {
    const { data } = await sb
      .from('lessons')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setLessons(data);
  }

  // ── Mode switching ─────────────────────────────────────────────────────────
  const switchMode = useCallback((newMode) => {
    if (newMode === activeMode) return;
    setModeLoading(true);
    setActiveMode(newMode);
    localStorage.setItem('sos_skill_hub_mode', newMode);
    const cfg = getModeConfig(newMode);
    setToastMsg?.(`${cfg.icon} Switched to ${cfg.label} mode`);
    setTimeout(() => setModeLoading(false), 100);
  }, [activeMode, setToastMsg]);

  // ── Trigger actions ────────────────────────────────────────────────────────
  function handleNudgeGo(trigger) {
    if (trigger.suggestedMode) switchMode(trigger.suggestedMode);
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
    if (suggestedMode) switchMode(suggestedMode);
    setLinkedTask(task);
    setActiveTab('chat');
  }

  // ── Open lesson from Home preview ─────────────────────────────────────────
  function handleOpenLessonFromHome(lesson) {
    setActiveTab('lessons');
    // LessonPlayer opens from SkillHubLessons; we can't directly open it here,
    // but switching the tab lets the user click the card. A future enhancement
    // could pass an autoOpenLessonId prop.
  }

  // ── Render active tab ──────────────────────────────────────────────────────
  function renderTab() {
    switch (activeTab) {
      case 'home':
        return (
          <SkillHubHome
            triggers={triggers}
            sessions={sessions}
            lessons={lessons}
            onNudgeGo={handleNudgeGo}
            onNudgeDismiss={handleNudgeDismiss}
            onOpenLesson={handleOpenLessonFromHome}
            onOpenChat={() => setActiveTab('chat')}
          />
        );
      case 'chat':
        return (
          <SkillHubChat
            key={activeMode} // remount on mode change to clear messages
            activeMode={activeMode}
            linkedTask={linkedTask}
            tasks={tasks}
            notes={notes}
            user={user}
            onSessionSave={handleSessionSave}
          />
        );
      case 'lessons':
        return (
          <SkillHubLessons
            lessons={lessons}
            activeMode={activeMode}
            user={user}
            onLessonUpdate={setLessons}
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
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="sh-sidebar">
        <div className="sh-sidebar-header">
          <button className="sh-back-btn" onClick={onBack} title="Back to main chat">
            ← Back
          </button>
          <span className="sh-brand">Skill Hub</span>
        </div>

        <nav className="sh-nav">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={'sh-nav-btn' + (activeTab === tab.id ? ' active' : '')}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="sh-nav-icon">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.id === 'home' && triggers.length > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  minWidth: 18, height: 18,
                  borderRadius: 9,
                  background: 'var(--sh-accent)',
                  color: '#0a0c18',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 5px',
                }}>
                  {triggers.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <ModePillSwitcher
          activeMode={activeMode}
          onSwitch={switchMode}
          disabled={modeLoading}
        />
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="sh-main">
        {renderTab()}
      </main>
    </div>
  );
}
