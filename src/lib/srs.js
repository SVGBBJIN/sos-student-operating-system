// SM-2 spaced-repetition helpers for the flashcard surface.
// Pure + localStorage-backed; no React/app state. Schedule is keyed per card
// and persisted under 'sos-fc-schedule'.

export function srsCardKey(title, q) {
  return ('fc:' + (title || '') + ':' + (q || '')).slice(0, 120);
}

function srsLoad() {
  try { return JSON.parse(localStorage.getItem('sos-fc-schedule') || '{}'); } catch (_) { return {}; }
}

function srsSave(schedule) {
  try { localStorage.setItem('sos-fc-schedule', JSON.stringify(schedule)); } catch (_) { /* ignore quota/serialization errors */ }
}

export function srsDaysUntil(isoDate) {
  if (!isoDate) return null;
  const diff = new Date(isoDate) - new Date(new Date().toDateString());
  return Math.round(diff / 86400000);
}

export function srsRate(cardKey, rating) {
  // rating: 'know' | 'unsure' | 'nope'
  const schedule = srsLoad();
  const prev = schedule[cardKey] || { interval: 1, easiness: 2.5 };
  let { interval, easiness } = prev;
  if (rating === 'know') {
    easiness = Math.min(3.0, easiness + 0.1);
    interval = Math.max(7, Math.round(interval * easiness));
  } else if (rating === 'unsure') {
    easiness = Math.max(1.3, easiness - 0.15);
    interval = 1;
  } else {
    easiness = Math.max(1.3, easiness - 0.2);
    interval = 0;
  }
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);
  schedule[cardKey] = { interval, easiness, nextReview: nextReview.toISOString().slice(0, 10) };
  srsSave(schedule);
  return interval;
}
