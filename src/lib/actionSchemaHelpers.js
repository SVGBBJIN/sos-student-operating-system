/* ═══════════════════════════════════════════════
   STRUCTURED CLARIFICATION (multi-field, direct-merge)
   ═══════════════════════════════════════════════ */

// Maps a missing field name to the input control we want to render for it.
// 'time' is special: it drives a two-thumb time-range slider that also writes endTime.
export const FIELD_INPUT_TYPES = {
  title: 'text', task_name: 'text', activity: 'text', new_title: 'text',
  date: 'date', due_date: 'date', due: 'date', start_date: 'date', end_date: 'date',
  time: 'time-range', start: 'time', end: 'time',
  subject: 'subject-picker',
  event_type: 'event-type-picker',
  category: 'category-picker',
};

export const SUBJECT_QUICK_PICKS = [
  'Mathematics', 'Calculus', 'Biology', 'Chemistry', 'Physics',
  'English', 'Literature', 'History', 'Spanish', 'Computer Science',
];

export const EVENT_TYPE_QUICK_PICKS = [
  { id: 'test', label: 'Test' },
  { id: 'exam', label: 'Exam' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'practice', label: 'Practice' },
  { id: 'game', label: 'Game' },
  { id: 'event', label: 'Other' },
];

export const FIELD_LABELS = {
  title: 'Title', task_name: 'Title', activity: 'Activity', new_title: 'New title',
  date: 'Date', due_date: 'Due date', due: 'Due date', start_date: 'Start date', end_date: 'End date',
  time: 'Time', start: 'Start time', end: 'End time',
  subject: 'Subject', event_type: 'Type', category: 'Category',
};

export const ACTION_SCHEMAS = {
  add_event: {
    required: ['title', 'date'],
    recommended: ['event_type'],
    optional: ['subject', 'time', 'end_time', 'description', 'location', 'priority'],
  },
  add_task: {
    required: ['title', 'due_date'],
    recommended: ['subject'],
    optional: ['est_time', 'priority', 'description'],
  },
  add_note: {
    required: ['title', 'subject', 'source'],
    recommended: [],
    optional: ['content'],
  },
  set_timer: {
    required: ['label'],
    recommended: ['duration_seconds'],
    optional: ['fire_at', 'preset'],
  },
};

export function readField(action, key) {
  if (action == null) return undefined;
  const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (action[key] !== undefined && action[key] !== null && String(action[key]).trim() !== '') return action[key];
  if (action[camel] !== undefined && action[camel] !== null && String(action[camel]).trim() !== '') return action[camel];
  if (key === 'title' && action.task_name) return action.task_name;
  if (key === 'due_date' && action.due) return action.due;
  return undefined;
}

export function validateActionSchema(action) {
  const schema = ACTION_SCHEMAS[action?.type];
  if (!schema) return { valid: true, missing_required: [], missing_recommended: [] };
  const missing = (keys) => keys.filter(k => readField(action, k) === undefined);
  const missing_required = missing(schema.required);
  const missing_recommended = missing(schema.recommended);
  return { valid: missing_required.length === 0, missing_required, missing_recommended };
}

export function defaultsForAction(actionType) {
  if (actionType === 'add_event') return { event_type: 'other', subject: '', time: null, end_time: null };
  if (actionType === 'add_task')  return { subject: '', est_time: 30, priority: 'medium' };
  return {};
}

export function valueForAssumption(field, clarification) {
  const sd = clarification?.suggested_defaults?.[field];
  if (sd !== undefined && sd !== null) return sd;
  const d = defaultsForAction(clarification?.context_action)[field];
  return d !== undefined ? d : null;
}

export function buildLocalClarification({ contextAction, knownFields = {}, missingFields = [], message, suggestedDefaults = {}, optionsByField = {} }) {
  const checklist = missingFields.map(f => ({
    field: f,
    status: 'pending',
    value: null,
    options: Array.isArray(optionsByField[f]) ? optionsByField[f].slice(0, 6) : null,
  }));
  return {
    question: message || `A few details for this ${contextAction.replace(/_/g, ' ')}.`,
    context_action: contextAction,
    known_fields: knownFields,
    missing_fields: missingFields,
    suggested_defaults: suggestedDefaults,
    checklist,
    multi_field: true,
  };
}
