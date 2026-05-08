// Wikilink parser/renderer for HTML content (notes + event descriptions).
// Walks text nodes only — never regexes raw HTML — so we don't double-wrap on
// re-render and don't match inside <a> tags or attribute values.
//
// Failure mode: wikilinks split across formatting boundaries (e.g. [[<b>X</b>]])
// won't match. Acceptable; rare.

const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g;

function lower(s) { return (s || '').toLowerCase().trim(); }

function getDoc(html) {
  // Wrap in a body so DOMParser preserves top-level text nodes.
  const parser = new DOMParser();
  return parser.parseFromString(`<!doctype html><body>${html || ''}</body>`, 'text/html');
}

function isInsideWikilink(node) {
  let n = node.parentElement;
  while (n) {
    if (n.classList && n.classList.contains('wikilink')) return true;
    n = n.parentElement;
  }
  return false;
}

// Returns [{ raw: '[[Name]]', name: 'Name' }, ...] from an HTML string.
// Names are de-duplicated by case-insensitive match.
export function extractWikilinks(html) {
  if (!html || typeof html !== 'string') return [];
  if (!html.includes('[[')) return [];
  const doc = getDoc(html);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
  const seen = new Set();
  const out = [];
  let node;
  while ((node = walker.nextNode())) {
    if (isInsideWikilink(node)) continue;
    const text = node.nodeValue || '';
    if (!text.includes('[[')) continue;
    let m;
    WIKILINK_RE.lastIndex = 0;
    while ((m = WIKILINK_RE.exec(text)) !== null) {
      const name = m[1].trim();
      if (!name) continue;
      const key = lower(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ raw: m[0], name });
    }
  }
  return out;
}

// Replaces [[Name]] occurrences in text nodes with anchor spans.
// resolveFn(name) → { type, id } | null. Unresolved links render with
// .wikilink.unresolved so users can see they typo'd a name.
export function renderWikilinks(html, resolveFn) {
  if (!html || typeof html !== 'string') return html || '';
  if (!html.includes('[[')) return html;
  const doc = getDoc(html);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    if (isInsideWikilink(node)) continue;
    if (!(node.nodeValue || '').includes('[[')) continue;
    targets.push(node);
  }
  for (const t of targets) {
    const text = t.nodeValue || '';
    WIKILINK_RE.lastIndex = 0;
    if (!WIKILINK_RE.test(text)) continue;
    WIKILINK_RE.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    let m;
    while ((m = WIKILINK_RE.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
      const name = m[1].trim();
      const resolved = resolveFn ? resolveFn(name) : null;
      const a = doc.createElement('a');
      a.className = 'wikilink' + (resolved ? '' : ' unresolved');
      a.setAttribute('data-link-name', name);
      if (resolved && resolved.type) a.setAttribute('data-target-type', resolved.type);
      if (resolved && resolved.id) a.setAttribute('data-target-id', resolved.id);
      a.href = '#';
      a.textContent = m[0];
      frag.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
    t.parentNode.replaceChild(frag, t);
  }
  return doc.body.innerHTML;
}

// Resolve a wikilink name to an entity. Case-insensitive exact match first;
// then tolerant fuzzy via the optional `normalizeFn` (default: lowercase trim).
// Search order: notes → events → tasks. First hit wins.
export function resolveLinkName(name, { notes = [], events = [], tasks = [] } = {}, normalizeFn) {
  if (!name) return null;
  const norm = normalizeFn || lower;
  const target = norm(name);
  if (!target) return null;

  for (const n of notes) {
    if (lower(n.name) === lower(name)) return { type: 'note', id: n.id, title: n.name };
  }
  for (const e of events) {
    if (lower(e.title) === lower(name)) return { type: 'event', id: e.id, title: e.title };
  }
  for (const t of tasks) {
    if (lower(t.title) === lower(name)) return { type: 'task', id: t.id, title: t.title };
  }

  // Fallback: tolerant fuzzy via caller-provided normalizer (handles "calc"→"calculus" etc).
  for (const n of notes) {
    if (norm(n.name) === target) return { type: 'note', id: n.id, title: n.name };
  }
  for (const e of events) {
    if (norm(e.title) === target) return { type: 'event', id: e.id, title: e.title };
  }
  for (const t of tasks) {
    if (norm(t.title) === target) return { type: 'task', id: t.id, title: t.title };
  }

  return null;
}

// Strip HTML tags and collapse whitespace for previews / similarity scoring.
export function stripHtml(html) {
  if (!html) return '';
  if (typeof window === 'undefined' || !window.DOMParser) {
    return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const doc = getDoc(html);
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

// Fuzzy match titles inside a free-text message. Returns [{type, id, title, matchedText}].
// Uses prefix length ≥ 4 chars to avoid noise. Skips wikilinked spans (those are
// handled by extractWikilinks).
export function findEntityMentions(message, { notes = [], events = [] } = {}, normalizeFn) {
  if (!message) return [];
  const norm = normalizeFn || lower;
  const haystack = norm(message);
  const seen = new Set();
  const out = [];
  const candidates = [
    ...notes.map(n => ({ type: 'note', id: n.id, title: n.name })),
    ...events.map(e => ({ type: 'event', id: e.id, title: e.title })),
  ];
  for (const c of candidates) {
    if (!c.title) continue;
    const t = norm(c.title);
    if (t.length < 4) continue;
    if (haystack.includes(t)) {
      const key = c.type + ':' + c.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...c, matchedText: c.title });
    }
  }
  return out;
}
