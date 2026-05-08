// Search across notes, events, and tasks for wikilink autocomplete.
// Returns up to `limit` candidates sorted by relevance (prefix match wins,
// then substring match). Each candidate is `{ type, id, title, subtitle }`.

function lower(s) { return (s || '').toLowerCase().trim(); }

export function searchEntities(query, { notes = [], events = [], tasks = [], limit = 8 } = {}) {
  const q = lower(query);
  const candidates = [
    ...notes.map(n => ({ type: 'note', id: n.id, title: n.name || 'Untitled note', subtitle: 'note' })),
    ...events.map(e => ({ type: 'event', id: e.id, title: e.title || 'Untitled event', subtitle: e.date ? `event · ${e.date}` : 'event' })),
    ...tasks.map(t => ({ type: 'task', id: t.id, title: t.title || 'Untitled task', subtitle: t.dueDate ? `task · due ${t.dueDate}` : 'task' })),
  ];
  if (!q) return candidates.slice(0, limit);
  const scored = candidates
    .map(c => {
      const t = lower(c.title);
      let score = 0;
      if (t === q) score = 100;
      else if (t.startsWith(q)) score = 80;
      else if (t.includes(q)) score = 50;
      else {
        // word-prefix: any token in the title starting with the query
        const tokens = t.split(/\s+/);
        if (tokens.some(tok => tok.startsWith(q))) score = 40;
      }
      return { c, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.title.localeCompare(b.c.title))
    .slice(0, limit)
    .map(x => x.c);
  return scored;
}

// Backlink lookup over the entity_links graph. Returns an array of
// `{ type, id, title, origin }` rows that point AT (target_*) the entity.
export function findBacklinks(entityType, entityId, { entityLinks = [], notes = [], events = [], tasks = [] } = {}) {
  if (!entityType || !entityId) return [];
  const incoming = entityLinks.filter(l => l.target_type === entityType && l.target_id === entityId && l.origin !== 'rejected');
  const out = [];
  for (const link of incoming) {
    let title = '(missing)';
    if (link.source_type === 'note') {
      const n = notes.find(x => x.id === link.source_id);
      if (n) title = n.name || 'Untitled note';
    } else if (link.source_type === 'event') {
      const e = events.find(x => x.id === link.source_id);
      if (e) title = e.title || 'Untitled event';
    } else if (link.source_type === 'task') {
      const t = tasks.find(x => x.id === link.source_id);
      if (t) title = t.title || 'Untitled task';
    }
    out.push({ type: link.source_type, id: link.source_id, title, origin: link.origin });
  }
  return out;
}
