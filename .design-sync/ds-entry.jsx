// SOS Design System — importable entry (synth bundle).
// Re-exports the real, shipped SOS UI components verbatim from src/.
// Nothing here is a reimplementation: every export is the actual component
// the app renders. See .design-sync/config.json (componentSrcMap) for the
// canonical name → source-file mapping.

// Preview provider: several Studio surfaces call react-router's useNavigate,
// which needs a Router in context. Re-export MemoryRouter so previews can be
// wrapped in it (cfg.provider) using the SAME react-router instance the
// components bundle against. Not a DS component (absent from componentSrcMap).
export { MemoryRouter as DSRouterProvider } from 'react-router-dom';

// ── Brand & landing ──────────────────────────────────────────────
export { default as BrandMark } from '../src/components/BrandMark.jsx';
export { default as AuthScreen } from '../src/components/AuthScreen.jsx';
export { default as Onboarding } from '../src/components/Onboarding.jsx';

// ── AI confirmation / action cards ───────────────────────────────
export { ConfirmationCard, BulkConfirmationCard } from '../src/components/ConfirmationCards.jsx';
export { default as ProposalCard } from '../src/components/ProposalCard.jsx';
export { ClarificationCard, MultiFieldClarificationCard } from '../src/components/ClarificationCard.jsx';
export { PlanCard, IntentPlanCard, PlanTemplateSelector } from '../src/components/PlanCards.jsx';

// ── Generated content cards (Studio output) ──────────────────────
export {
  ContentCard,
  FlashcardDisplay,
  QuizDisplay,
  GenericContentDisplay,
  StudyPackCard,
} from '../src/components/ContentDisplayCards.jsx';
export { ClueCard, WorkCheckCard } from '../src/components/CoachingCards.jsx';

// ── Dashboard / Studio surfaces ──────────────────────────────────
export { default as StudioDashboard } from '../src/components/StudioDashboard.jsx';
export { default as StudioHomeView } from '../src/components/StudioHomeView.jsx';
export { default as StudioSidebar } from '../src/components/StudioSidebar.jsx';
export { default as StudyTopBar } from '../src/components/StudyTopBar.jsx';
export {
  Panel,
  AskBar,
  QuickActions,
  UpNext,
  AgendaList,
  DueList,
  CourseGrid,
  ReviewDecks,
  StatStrip,
  WelcomeBox,
  AddCard,
} from '../src/components/StudioPanels.jsx';
export { default as HomeScreen } from '../src/components/HomeScreen.jsx';

// ── Widgets ──────────────────────────────────────────────────────
export { default as ScheduleWidget } from '../src/components/ScheduleWidget.jsx';
export { default as PomodoroTimer } from '../src/components/PomodoroTimer.jsx';
export { default as DynamicIsland } from '../src/components/DynamicIsland.jsx';
export { default as FocusSessionWidget } from '../src/components/FocusSessionWidget.jsx';
