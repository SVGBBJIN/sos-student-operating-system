// Generate per-component doc stubs for the SOS design system.
// Each file's frontmatter `category` sets the component's DS-pane group;
// the body becomes the component's .prompt.md (the design agent's usage
// reference). Discovery binds <Name>.md by name (cfg.docsDir), no docsMap
// needed. Run: node .design-sync/gen-docs.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = new URL('./docs/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// [Name, Category, one-line description, wrap hint]
const C = [
  ['BrandMark', 'Brand', 'The SOS wordmark — Fraunces-900 italic "SOS" with the coral middle O and a bordered retro brand mark. `fontSize` scales it.'],
  ['AuthScreen', 'Landing', 'Full-screen sign-in / sign-up surface: email + password, "continue with Google", and the SOS wordmark. Entry point before a student is authenticated.'],
  ['Onboarding', 'Landing', 'First-run onboarding flow that drafts a student\'s week in a few conversational taps — no forms.'],

  ['ConfirmationCard', 'Confirmations', 'The core AI confirmation card. Renders a proposed action (add_task, add_event, add_block, delete_*, convert_*, …) with editable fields and Approve / Edit / Dismiss. Colour + icon are keyed off `action.type`.'],
  ['BulkConfirmationCard', 'Confirmations', 'Batch confirmation: a checklist of proposed actions with select-all, per-item toggles, and "Approve N". Surfaced when the AI proposes several actions at once.'],
  ['ProposalCard', 'Confirmations', 'Lightweight yes/no card surfaced when the conversational model calls propose_action — "Want me to <summary>?" with Yes / Nah.'],
  ['ClarificationCard', 'Confirmations', 'Single-question clarification: the AI asks one question with selectable option chips (single- or multi-select) plus an optional "other" free-text.'],
  ['MultiFieldClarificationCard', 'Confirmations', 'Multi-question clarification: several fields answered at once, then reviewed before submit.'],

  ['PlanCard', 'Plans', 'A proposed study plan: an ordered list of steps (each with a title + estimated minutes, optionally a date/time) with Apply / Save / Export actions.'],
  ['IntentPlanCard', 'Plans', 'A goal-driven plan: recurring study blocks + milestone tasks + a review cadence, batch-applied on confirm. Detects conflicts against existing recurring blocks.'],
  ['PlanTemplateSelector', 'Plans', 'Picker of built-in plan templates (weekly study, exam prep, essay, project timeline, research paper) or "custom plan".'],

  ['ContentCard', 'Content', 'Generic wrapper for generated study content: an icon + title + subject header, a coloured accent bar, arbitrary body, and Save-to-Notes / Dismiss actions.'],
  ['FlashcardDisplay', 'Content', 'An interactive flashcard deck viewer — flip between question (`q`) and answer (`a`), step through the deck, save or dismiss.'],
  ['QuizDisplay', 'Content', 'An interactive multiple-choice quiz — one question at a time with choices, correct/wrong reveal, running score, and a final score screen.'],
  ['GenericContentDisplay', 'Content', 'Renders AI-generated outline / summary / breakdown content (bullets, sections, or phases) inside a ContentCard.'],
  ['StudyPackCard', 'Content', 'A bundled exam-prep pack: summary + key concepts + flashcards + quiz for a topic, generated as one artifact.'],
  ['ClueCard', 'Content', 'A Socratic coaching card — gives a clue / next step toward an answer without giving it away, with a deeper fallback if the student is stuck.'],
  ['WorkCheckCard', 'Content', 'A work-check / proofreading card — flags hedged or unsupported claims in the student\'s own writing lane-by-lane.'],

  ['StudioDashboard', 'Studio', 'The Studio dashboard shell — the mint-accented home surface: stat strip, welcome box, agenda, deadlines, courses, and review decks. Wrap in an element with class `studio`.'],
  ['StudioHomeView', 'Studio', 'The Studio centre column ("Let\'s set up your week") — the conversational home view with quick-action rails. Wrap in `studio`.'],
  ['StudioSidebar', 'Studio', 'The Studio left sidebar — brand, new-chat, saved-chat history, projects, focus session, and account. Wrap in `studio`.'],
  ['StudyTopBar', 'Studio', 'The Studio top bar — clock, sync status, nav toggles, theme switch, and account. Wrap in `studio`.'],
  ['Panel', 'Studio', 'A titled Studio panel container — header with icon + count + action, and a body slot. The building block of the dashboard grid. Wrap in `studio`.'],
  ['AskBar', 'Studio', 'The Studio "ask SOS" input bar. Wrap in `studio`.'],
  ['QuickActions', 'Studio', 'A row of Studio quick-action chips (add event, make a plan, quiz me, proofread). Wrap in `studio`.'],
  ['UpNext', 'Studio', 'The "up next" Studio card highlighting the next event with a start-focus action. Wrap in `studio`.'],
  ['AgendaList', 'Studio', 'A Studio agenda list — today\'s time-ordered events with location + done state. Wrap in `studio`.'],
  ['DueList', 'Studio', 'A Studio deadlines list — upcoming due items with subject + date. Wrap in `studio`.'],
  ['CourseGrid', 'Studio', 'A Studio course grid — per-course progress bars and next-up meta. Wrap in `studio`.'],
  ['ReviewDecks', 'Studio', 'A Studio review-decks strip — flashcard decks due for review. Wrap in `studio`.'],
  ['StatStrip', 'Studio', 'The Studio stat strip — today\'s progress, done count, events, focus. Wrap in `studio`.'],
  ['WelcomeBox', 'Studio', 'The Studio welcome box — greeting + conversational prompt + quick actions for a fresh session. Wrap in `studio`.'],
  ['AddCard', 'Studio', 'A dashed "add" affordance card (icon + title + subtitle). Wrap in `studio`.'],
  ['HomeScreen', 'Studio', 'The custom Home screen with the focus widget and a personal background.'],

  ['ScheduleWidget', 'Widgets', 'A floating "today\'s schedule" widget — time-ordered events and blocks, tone-coded, dockable.'],
  ['PomodoroTimer', 'Widgets', 'A Pomodoro / focus timer with preset tabs (pomodoro, short break, long break) and AI-set timer rings.'],
  ['DynamicIsland', 'Widgets', 'A compact status pill ("dynamic island") showing the clock and current session/status.'],
  ['FocusSessionWidget', 'Widgets', 'A focus-session launcher — Sprint (timed, one task) vs Marathon (goal, loops tasks) modes.'],
];

for (const [name, category, desc] of C) {
  writeFileSync(
    OUT + name + '.md',
    `---\ncategory: ${category}\n---\n\n# ${name}\n\n${desc}\n`,
  );
}
console.log(`wrote ${C.length} doc stubs → .design-sync/docs/`);
