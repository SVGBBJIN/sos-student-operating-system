// Pure text helpers used to build context/prompt strings within a token budget.
// No React/app state — safe to unit-test and reuse.

export function estimateInputTokens(text = '') {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

export function truncateWithEllipsis(text = '', maxChars = 300) {
  if (!text || text.length <= maxChars) return text || '';
  return text.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
}

export function capLines(lines = [], maxChars = 1000, summaryLabel = 'items') {
  const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  const kept = [];
  let used = 0;
  for (let i = 0; i < safeLines.length; i++) {
    const line = String(safeLines[i]).trim();
    if (!line) continue;
    const lineLen = line.length + 1;
    if (used + lineLen > maxChars) break;
    kept.push(line);
    used += lineLen;
  }
  const omitted = Math.max(0, safeLines.length - kept.length);
  if (omitted > 0) kept.push('… +' + omitted + ' more ' + summaryLabel + ' omitted for context budget');
  return kept.join('\n');
}

// Returns { text, shown, total } for trim-aware callers
export function capLinesInfo(lines = [], maxChars = 1000, summaryLabel = 'items') {
  const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  const text = capLines(safeLines, maxChars, summaryLabel);
  const total = safeLines.length;
  // count kept lines = total lines minus the '… +N more' line if present
  const omitted = Math.max(0, safeLines.filter(l => String(l).trim()).length - text.split('\n').filter(l => !l.startsWith('…')).length);
  const shown = total - omitted;
  return { text, shown, total, trimmed: omitted > 0 };
}

export function dedupeRepeatedLines(blockText = '') {
  const seen = new Set();
  return (blockText || '')
    .split('\n')
    .filter(line => {
      const key = line.trim().toLowerCase();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}
