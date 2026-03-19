export function getWorkspaceContext({ layoutMode, activePanel, sidebarCompanionPanel, companionCollapsed, overridePanel = null }) {
  const effectivePanel = overridePanel || sidebarCompanionPanel;
  if (layoutMode === 'sidebar' && activePanel === 'chat' && !companionCollapsed) {
    if (effectivePanel === 'schedule') return 'schedule';
    if (effectivePanel === 'notes') return 'notes';
  }
  return activePanel === 'chat' ? 'chat' : 'none';
}

export function getWorkspaceModeLabel(workspaceContext) {
  if (workspaceContext === 'schedule') return 'Schedule mode';
  if (workspaceContext === 'notes') return 'Notes mode';
  return null;
}

export function detectCompanionIntent(text) {
  const msg = (text || '').toLowerCase();
  if (!msg) return null;
  if (/\b(notes?|document|docs?|pdf|reference|summarize my notes|in my notes)\b/.test(msg)) return 'notes';
  if (/\b(calendar|schedule|planner|plan my day|today's plan|timetable|due date)\b/.test(msg)) return 'schedule';
  return null;
}
