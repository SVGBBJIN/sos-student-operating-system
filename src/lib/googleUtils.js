/* ─── Google API utilities ───────────────────────────────────────── */

/** Extracts plain text from a Google Docs API document object */
export function extractDocsText(doc) {
  const parts = [];
  function walkContent(content) {
    for (const block of (content || [])) {
      if (block.paragraph) {
        const line = (block.paragraph.elements || [])
          .map(el => el.textRun?.content || '')
          .join('');
        parts.push(line);
      } else if (block.table) {
        for (const row of (block.table.tableRows || [])) {
          for (const cell of (row.tableCells || [])) {
            walkContent(cell.content);
          }
        }
      }
    }
  }
  walkContent(doc.body?.content);
  return parts.join('').trim();
}

/** Accepts a full Google Docs URL or a bare doc ID; returns the ID or null */
export function parseDocId(input) {
  const urlMatch = input.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

/** Maps raw Google Calendar API items → app event shape */
export function mapGoogleCalItems(items) {
  return items.filter(e => e.summary).map(e => ({
    googleId: e.id,
    title: e.summary,
    date: e.start?.date || (e.start?.dateTime?.split('T')[0] ?? ''),
    startTime: e.start?.dateTime
      ? new Date(e.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : null,
    allDay: !!e.start?.date,
  }));
}
