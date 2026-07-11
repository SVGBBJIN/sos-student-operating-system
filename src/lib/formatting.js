import DOMPurify from 'dompurify';

export const CONTENT_GEN_REGEX = /flashcards?|outline|summar|quiz\s+me|make\s+(?:me\s+)?(?:a\s+)?quiz|create\s+(?:a\s+)?quiz|practice\s*questions?|project\s*breakdown|review\s*sheet|cheat\s*sheet/i;

/* ─── Typing Dots (loading indicator) ─── */
export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatAssistantMessage(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  const withBreaks = escapeHtml(raw)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
  return DOMPurify.sanitize(withBreaks);
}

export function getLoadingMessage(msgContent, photo, isPlanRequest) {
  const m = (msgContent || '').toLowerCase();
  if (photo)           return "scanning your work…";
  if (isPlanRequest)   return "building your study plan…";
  if (CONTENT_GEN_REGEX.test(msgContent || '')) {
    if (/flashcard/.test(m))              return "crafting flashcards…";
    if (/quiz/.test(m))                   return "writing your quiz…";
    if (/outline/.test(m))                return "building an outline…";
    if (/summary|summarize/.test(m))      return "summarizing that…";
    return "creating your study material…";
  }
  if (/\b(delete|remove|cancel|clear)\b/.test(m))           return "clearing that out…";
  if (/\b(update|move|reschedule|change)\b/.test(m))         return "updating your schedule…";
  if (/\b(exam|test|deadline)\b/.test(m))                    return "logging your exam…";
  if (/\b(homework|assignment|project)\b/.test(m))           return "adding your homework…";
  if (/\b(event|appointment|meeting|practice|game|tournament|dentist|doctor|club|lab)\b/.test(m)) return "building your calendar…";
  if (/\b(schedule|block|time\s*slot)\b/.test(m))            return "blocking your time…";
  if (/\btask\b/.test(m))                                    return "adding that task…";
  return "thinkisizing…";
}
