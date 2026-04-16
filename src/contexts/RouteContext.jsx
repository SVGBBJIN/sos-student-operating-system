import { createContext, useContext, useCallback, useMemo } from 'react';

/**
 * RouteContext
 *
 * Centralises every routing-related state value and the navigation helpers
 * that modify them. Components import `useRoute()` instead of receiving a
 * dozen individual props, eliminating prop drilling and keeping routing logic
 * in one place.
 *
 * Usage:
 *   const { activePanel, goToChat, goToTutor } = useRoute();
 */

const RouteContext = createContext(null);

export function RouteProvider({ value, children }) {
  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>;
}

export function useRoute() {
  const ctx = useContext(RouteContext);
  if (!ctx) throw new Error('useRoute must be used inside <RouteProvider>');
  return ctx;
}

/**
 * buildRouteValue — called inside App to assemble the context object from
 * existing state variables so we don't have to migrate everything at once.
 *
 * @param {object} state  - snapshot of all routing-related state
 * @param {object} setters - setters and action fns from App
 */
export function buildRouteValue(state, setters) {
  const {
    activePanel, layoutMode, skillHubTab, skillHubMode,
    sidebarCollapsed, sidebarCompanionPanel, companionCollapsed,
    autoCollapseSidebarCompanion, showPeek, showNotes, tutorMode,
    user,
  } = state;

  const {
    setActivePanel, setLayoutMode, setSkillHubTab, setSkillHubMode,
    setSidebarCollapsed, setSidebarCompanionPanel, setCompanionCollapsed,
    setShowPeek, setShowNotes, toggleTutorMode, sfx,
    openCompanionPanel, switchSkillHubMode,
  } = setters;

  // ── Derived booleans ─────────────────────────────────────────────
  const routeState = {
    isInTutor: activePanel === 'tutor',
    isInSettings: activePanel === 'settings',
    isInChat: activePanel === 'chat',
    showSidebarCompanion:
      layoutMode === 'sidebar' && activePanel === 'chat' && sidebarCompanionPanel !== 'none',
    isLofiLayout: layoutMode === 'lofi',
    isSidebarLayout: layoutMode === 'sidebar',
    isTopbarLayout: layoutMode === 'topbar',
  };

  // ── Named navigation handlers (stable references via the caller's useCallback) ──
  const goToChat = useCallback(() => {
    sfx?.nav?.();
    setActivePanel('chat');
  }, [setActivePanel, sfx]);

  const goToTutor = useCallback(() => {
    sfx?.nav?.();
    setActivePanel('tutor');
    setSkillHubTab('home');
    toggleTutorMode?.(true);
  }, [setActivePanel, setSkillHubTab, toggleTutorMode, sfx]);

  const goToSettings = useCallback(() => {
    sfx?.nav?.();
    setActivePanel('settings');
  }, [setActivePanel, sfx]);

  const goBackFromTutor = useCallback(() => {
    sfx?.nav?.();
    toggleTutorMode?.(false);
    setActivePanel('chat');
    setSkillHubTab('home');
  }, [setActivePanel, setSkillHubTab, toggleTutorMode, sfx]);

  const openSchedulePanel = useCallback(() => {
    sfx?.nav?.();
    openCompanionPanel?.('schedule');
  }, [openCompanionPanel, sfx]);

  const openNotesPanel = useCallback(() => {
    sfx?.nav?.();
    openCompanionPanel?.('notes');
  }, [openCompanionPanel, sfx]);

  const toggleSchedulePeek = useCallback(() => {
    setShowPeek(prev => !prev);
    setShowNotes(false);
  }, [setShowPeek, setShowNotes]);

  const toggleNotesPeek = useCallback(() => {
    setShowNotes(prev => !prev);
    setShowPeek(false);
  }, [setShowNotes, setShowPeek]);

  return {
    // Raw state
    activePanel, layoutMode, skillHubTab, skillHubMode,
    sidebarCollapsed, sidebarCompanionPanel, companionCollapsed,
    autoCollapseSidebarCompanion, showPeek, showNotes, tutorMode,
    user,
    // Derived
    ...routeState,
    // Named actions
    goToChat,
    goToTutor,
    goToSettings,
    goBackFromTutor,
    openSchedulePanel,
    openNotesPanel,
    toggleSchedulePeek,
    toggleNotesPeek,
    // Pass-through setters needed by deep components
    setLayoutMode,
    setSidebarCollapsed,
    setSidebarCompanionPanel,
    setCompanionCollapsed,
    setSkillHubTab,
    switchSkillHubMode,
  };
}
