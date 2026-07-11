import Icon from '../lib/icons';
import { PlanCard, detectPlanConflicts, IntentPlanCard } from './PlanCards';
import { FlashcardDisplay, QuizDisplay, GenericContentDisplay, StudyPackCard } from './ContentDisplayCards';
import { ClueCard, WorkCheckCard } from './CoachingCards';

export default function ContentTypeRouter({ content, onSave, onDismiss, onApplyPlan, onApplyIntentPlan, onApplyIntentPlanSkipConflicts, onStartPlanTask, onExportGoogleDocs, googleConnected, existingRecurring }) {
  switch (content.type) {
    case 'make_plan':
      return <PlanCard data={content} onApply={onApplyPlan} onSave={onSave} onDismiss={onDismiss} onStartTask={onStartPlanTask} onExportGoogleDocs={onExportGoogleDocs} googleConnected={googleConnected} />;
    case 'create_flashcards':
      return <FlashcardDisplay data={content} onSave={onSave} onDismiss={onDismiss} />;
    case 'create_quiz':
      return <QuizDisplay data={content} onSave={onSave} onDismiss={onDismiss} />;
    case 'create_outline':
      return <GenericContentDisplay data={content} icon={Icon.listTree(16)} label="Outline" onSave={onSave} onDismiss={onDismiss} accentColor="var(--blue)" />;
    case 'create_summary':
      return <GenericContentDisplay data={content} icon={Icon.clipboard(16)} label="Summary" onSave={onSave} onDismiss={onDismiss} accentColor="var(--teal)" />;
    // create_study_plan removed — study plans now use the agentic planning pipeline (make_plan)
    case 'create_project_breakdown':
      return <GenericContentDisplay data={content} icon={Icon.hammer(16)} label="Project Breakdown" onSave={onSave} onDismiss={onDismiss} accentColor="var(--orange)" />;
    case 'make_intent_plan': {
      const conflicts = detectPlanConflicts(content.recurring_blocks || [], existingRecurring || []);
      return <IntentPlanCard data={content} onApply={onApplyIntentPlan} onApplyWithoutConflicts={onApplyIntentPlanSkipConflicts} onDismiss={onDismiss} conflicts={conflicts} />;
    }
    case 'make_study_pack':
      return <StudyPackCard data={content} onDismiss={onDismiss} />;
    case 'make_clue':
      return <ClueCard data={content} onDismiss={onDismiss} />;
    case 'make_work_check':
      return <WorkCheckCard data={content} onDismiss={onDismiss} />;
    default:
      return <GenericContentDisplay data={content} icon={Icon.zap(16)} label="Content" onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)" />;
  }
}
