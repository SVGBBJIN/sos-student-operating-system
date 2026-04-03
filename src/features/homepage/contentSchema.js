export const DEFAULT_HOMEPAGE_CONTENT = {
  programs: [
    {
      title: 'Teach me from my notes',
      description: 'Ask SOS to explain your saved notes and quiz you one step at a time.',
      ctaPrimary: 'Start tutor workflow',
      ctaSecondary: 'Use notes in chat',
      prompt: 'Teach me the most important ideas from my notes and quiz me one question at a time.',
      icon: 'sparkles',
    },
    {
      title: 'Build a study sprint',
      description: 'Get a focused 45-minute sprint plan based on your highest-priority work.',
      ctaPrimary: 'Create sprint',
      ctaSecondary: 'Open schedule',
      prompt: 'Plan a focused 45-minute study sprint for my highest-priority work.',
      icon: 'calendarClock',
    },
    {
      title: 'Make flashcards fast',
      description: 'Generate flashcards from what you need to review right now.',
      ctaPrimary: 'Generate flashcards',
      ctaSecondary: 'Open notes',
      prompt: 'Make me flashcards for the topic I need to study.',
      icon: 'layers',
    },
  ],
  values: [
    {
      title: 'Notes-aware tutoring',
      description: 'Tutor mode can cite your own notes and docs instead of generic examples.',
      ctaPrimary: 'Open notes',
      ctaSecondary: 'Import notes',
      icon: 'fileText',
      action: 'openNotes',
    },
    {
      title: 'Schedule-aware coaching',
      description: 'Study plans stay realistic by considering your due dates and events.',
      ctaPrimary: 'Open schedule',
      ctaSecondary: 'Plan this week',
      icon: 'calendarClock',
      action: 'openSchedule',
    },
    {
      title: 'One-click study actions',
      description: 'Move from chat into quizzes, flashcards, and plans without context switching.',
      ctaPrimary: 'Start guided help',
      ctaSecondary: 'Tune settings',
      icon: 'sparkles',
      action: 'startPrompt',
      prompt: 'Help me study step by step using tutor mode.',
    },
  ],
  contactFaq: [
    {
      title: 'Need support?',
      description: 'Use Settings if you want to tune tutor behavior, themes, and workspace controls.',
      ctaPrimary: 'Open settings',
      ctaSecondary: 'Back to chat',
      icon: 'settings',
      action: 'openSettings',
    },
    {
      title: 'FAQ: How do I get better answers?',
      description: 'Add notes, keep tasks current, then ask for a step-by-step plan tied to deadlines.',
      ctaPrimary: 'Open notes',
      ctaSecondary: 'Open schedule',
      icon: 'helpCircle',
      action: 'faqWorkflow',
    },
  ],
};

function normalizeArray(items, defaults) {
  const src = Array.isArray(items) ? items : [];
  return defaults.map((fallback, idx) => {
    const existing = src[idx] || {};
    const merged = { ...fallback, ...(typeof existing === 'object' ? existing : {}) };
    return Object.fromEntries(Object.entries(merged).map(([key, value]) => {
      if (value === null || value === undefined || value === '') return [key, fallback[key]];
      return [key, value];
    }));
  });
}

export function normalizeHomepageContent(content) {
  const input = content && typeof content === 'object' ? content : {};
  return {
    programs: normalizeArray(input.programs, DEFAULT_HOMEPAGE_CONTENT.programs),
    values: normalizeArray(input.values, DEFAULT_HOMEPAGE_CONTENT.values),
    contactFaq: normalizeArray(input.contactFaq, DEFAULT_HOMEPAGE_CONTENT.contactFaq),
  };
}

export function iconForHomepageContent(Icon, iconName, size = 16) {
  const iconFactory = Icon?.[iconName];
  if (typeof iconFactory === 'function') return iconFactory(size);
  return Icon.sparkles(size);
}
