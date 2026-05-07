// Heuristic auto-link suggestion engine.
// Runs client-side (no LLM call in v1) on note/event/task save and proposes
// a single highest-scoring candidate link for user approval.
//
// Scoring (additive):
//   +40  same subject (events/tasks have it; for notes derived from title + first words).
//   +30  one entity's title appears verbatim in the other's content/description.
//   +20  per shared content keyword (top-N TF after stopword strip), capped at +60.
//   −∞   if a link already exists between the pair (in either direction).
//   −∞   if the user rejected this pair within the last 30 days.
//
// Thresholds (no LLM available client-side):
//   ≥80  surface as a suggestion card.
//   <80  drop.

import { stripHtml } from './wikilinks.js';

const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','to','in','on','at','for','with','by','from','as',
  'is','are','was','were','be','been','being','have','has','had','do','does','did','will',
  'would','could','should','may','might','can','this','that','these','those','it','its',
  'i','you','he','she','they','we','my','your','his','her','their','our','me','him','them',
  'us','if','then','than','so','not','no','yes','too','very','just','also','any','all',
  'some','more','most','other','out','up','down','about','into','over','under','again',
  'further','once','here','there','when','where','why','how','what','who','which','whom',
]);

const REJECTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function lower(s) { return (s || '').toLowerCase().trim(); }

function tokens(text) {
  if (!text) return [];
  return lower(text)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

function topKeywords(text, n = 10) {
  const counts = new Map();
  for (const t of tokens(text)) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

function entityText(entity) {
  if (!entity) return '';
  if (entity.type === 'note') return stripHtml(entity.content || '');
  if (entity.type === 'event') return entity.description || '';
  if (entity.type === 'task') return entity.title || '';
  return '';
}

function entityTitle(entity) {
  if (!entity) return '';
  return entity.type === 'note' ? (entity.name || '') : (entity.title || '');
}

function entitySubject(entity, deriveSubject) {
  if (!entity) return '';
  if (entity.subject) return lower(entity.subject);
  if (entity.type === 'note' && deriveSubject) {
    try { return lower(deriveSubject(entityTitle(entity)) || ''); } catch (_) { return ''; }
  }
  return '';
}

function pairKey(a, b) {
  // Order-independent key: sort by type then id so (A→B) and (B→A) collide.
  const ka = a.type + ':' + a.id;
  const kb = b.type + ':' + b.id;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function hasExistingLink(a, b, links) {
  if (!Array.isArray(links)) return false;
  return links.some(l =>
    (l.source_type === a.type && l.source_id === a.id && l.target_type === b.type && l.target_id === b.id) ||
    (l.source_type === b.type && l.source_id === b.id && l.target_type === a.type && l.target_id === a.id)
  );
}

function isRecentlyRejected(a, b, links, now = Date.now()) {
  if (!Array.isArray(links)) return false;
  const cutoff = now - REJECTION_TTL_MS;
  return links.some(l => {
    if (l.origin !== 'rejected') return false;
    const same = (l.source_type === a.type && l.source_id === a.id && l.target_type === b.type && l.target_id === b.id) ||
                 (l.source_type === b.type && l.source_id === b.id && l.target_type === a.type && l.target_id === a.id);
    if (!same) return false;
    const ts = l.created_at ? new Date(l.created_at).getTime() : 0;
    return ts >= cutoff;
  });
}

// Score a candidate pair. Returns 0 if not a candidate (existing link or recent rejection).
export function scorePair(a, b, { links = [], deriveSubject } = {}) {
  if (!a || !b) return 0;
  if (a.type === b.type && a.id === b.id) return 0;
  if (hasExistingLink(a, b, links)) return 0;
  if (isRecentlyRejected(a, b, links)) return 0;

  let score = 0;

  const subjA = entitySubject(a, deriveSubject);
  const subjB = entitySubject(b, deriveSubject);
  if (subjA && subjB && subjA === subjB) score += 40;

  const titleA = lower(entityTitle(a));
  const titleB = lower(entityTitle(b));
  const textA = lower(entityText(a));
  const textB = lower(entityText(b));
  if (titleA && textB && textB.includes(titleA)) score += 30;
  if (titleB && textA && textA.includes(titleB)) score += 30;

  const kwA = new Set(topKeywords(`${entityTitle(a)} ${entityText(a)}`, 10));
  const kwB = new Set(topKeywords(`${entityTitle(b)} ${entityText(b)}`, 10));
  let shared = 0;
  for (const k of kwA) if (kwB.has(k)) shared++;
  score += Math.min(shared, 3) * 20;

  return score;
}

// Given one entity that just changed, find the best candidate to suggest linking with.
// Returns { source, target, score } or null. Threshold defaults to 80.
export function bestSuggestion(changedEntity, allEntities, opts = {}) {
  const { threshold = 80, links = [], deriveSubject } = opts;
  if (!changedEntity || !Array.isArray(allEntities)) return null;
  let best = null;
  const seen = new Set();
  for (const other of allEntities) {
    if (!other) continue;
    if (other.type === changedEntity.type && other.id === changedEntity.id) continue;
    const key = pairKey(changedEntity, other);
    if (seen.has(key)) continue;
    seen.add(key);
    const s = scorePair(changedEntity, other, { links, deriveSubject });
    if (s >= threshold && (!best || s > best.score)) {
      best = { source: changedEntity, target: other, score: s };
    }
  }
  return best;
}

// Helper: flatten the app's three entity arrays into a uniform [{type,id,...}] list.
export function flattenEntities({ notes = [], events = [], tasks = [] } = {}) {
  return [
    ...notes.map(n => ({ type: 'note', id: n.id, name: n.name, content: n.content || '' })),
    ...events.map(e => ({ type: 'event', id: e.id, title: e.title, description: e.description || '', subject: e.subject || '' })),
    ...tasks.map(t => ({ type: 'task', id: t.id, title: t.title, subject: t.subject || '' })),
  ];
}
