/*
 * Onboarding draft builder — pure, no I/O.
 *
 * Q1 (commitment count) × Q2 (commitment duration) → committed time per day →
 * the size of each day's free window → how the draft fills it.
 *
 * The output is a conservative weekly skeleton: school + the student's stated
 * after-school commitments are written as real, committed time; the focus /
 * break / lighter blocks are speculative drafts the student calibrates day by
 * day. Blocks are subject-agnostic on purpose — nothing is known yet about the
 * kid's actual classes, so we never invent named subjects.
 */

// dow numbers match JS Date.getDay(): 0 = Sunday … 6 = Saturday. This is the
// format recurring_blocks.days is stored in.
export const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-first for display
const DOW_LABEL = {
  0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday',
  4: 'Thursday', 5: 'Friday', 6: 'Saturday',
};
const DOW_SHORT = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

// Q2 ranges → a 30-min-aligned representative length so blocks land on clean
// grid lines.
export const DURATION_OPTIONS = [
  { id: 'short', label: 'Under an hour', minutes: 60 },
  { id: 'medium', label: '1–2 hours', minutes: 90 },
  { id: 'long', label: '2–3 hours', minutes: 150 },
  { id: 'xlong', label: '3+ hours', minutes: 180 },
];

export const COUNT_OPTIONS = [0, 1, 2, 3, 4, 5];

// Spread commitments across the week with breathing room rather than clustering
// them Mon–Tue. Take the first `count` of these.
const COMMITMENT_SPREAD = [1, 3, 5, 2, 4]; // Mon, Wed, Fri, Tue, Thu

const SCHOOL_START = 8 * 60; // 08:00
const SCHOOL_END = 15 * 60; // 15:00
const AFTERSCHOOL = 15 * 60 + 30; // 15:30 — free window opens
const DAY_END = 21 * 60; // 21:00 — evening cap
const FOCUS_LEN = 60;
const BREAK_LEN = 30;
const LIGHTER_LEN = 60;
const BUFFER = 30; // decompression gap after a commitment

function hhmm(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

let _seq = 0;
function rid() {
  _seq += 1;
  return 'onb_' + Date.now().toString(36) + '_' + _seq;
}

export function makeBlock(name, kind, category, startMin, endMin) {
  return {
    id: rid(),
    name,
    kind, // 'school' | 'commitment' | 'focus' | 'break' | 'lighter'
    category,
    start: hhmm(startMin),
    end: hhmm(endMin),
    committed: kind === 'school' || kind === 'commitment',
  };
}

/*
 * Build the full seven-day draft. Returns Monday-first day columns, each with an
 * ordered list of blocks. Kept deliberately conservative so most columns are
 * approvable on the first pass — correction should be the exception.
 */
export function buildOnboardingDraft({ commitmentCount = 0, commitmentMinutes = 90 } = {}) {
  const count = Math.max(0, Math.min(5, commitmentCount | 0));
  const commitmentDays = new Set(COMMITMENT_SPREAD.slice(0, count));

  return DOW_ORDER.map((dow) => {
    const isWeekday = dow >= 1 && dow <= 5;
    const isWeekend = !isWeekday;
    const hasCommitment = commitmentDays.has(dow);
    const blocks = [];

    if (isWeekday) {
      // School — real committed time.
      blocks.push(makeBlock('School', 'school', 'school', SCHOOL_START, SCHOOL_END));

      let cursor = AFTERSCHOOL;
      if (hasCommitment) {
        const end = Math.min(cursor + commitmentMinutes, DAY_END);
        blocks.push(makeBlock('Commitment', 'commitment', 'other', cursor, end));
        cursor = end + BUFFER;
      }

      // Fill the remaining free window conservatively. Busy days get a single
      // focus block; lighter days get a touch more.
      const fills = hasCommitment
        ? [['Focus block', 'focus', FOCUS_LEN], ['Break', 'break', BREAK_LEN]]
        : [['Focus block', 'focus', FOCUS_LEN], ['Break', 'break', BREAK_LEN], ['Lighter block', 'lighter', LIGHTER_LEN]];

      for (const [name, kind, len] of fills) {
        if (cursor + len > DAY_END) break;
        blocks.push(makeBlock(name, kind, 'free time', cursor, cursor + len));
        cursor += len;
      }
    } else if (dow === 0) {
      // Sunday — a single light reset/prep block. Saturday stays free.
      blocks.push(makeBlock('Lighter block', 'lighter', 'free time', 11 * 60, 12 * 60));
    }

    return {
      dow,
      key: DOW_SHORT[dow],
      label: DOW_LABEL[dow],
      isWeekend,
      hasCommitment,
      blocks,
    };
  });
}

/*
 * Flatten the calibrated day columns into recurring_blocks rows. Identical
 * blocks (same name/time/kind) appearing on multiple days collapse into one row
 * with a multi-day `days` array — the way recurring blocks are meant to be
 * stored. Committed blocks ship confirmed / high-confidence; drafted study
 * blocks ship tentative / low-confidence.
 */
export function draftToRecurringRows(days) {
  const bySig = new Map();
  for (const day of days) {
    for (const b of (day.blocks || [])) {
      const sig = [b.name, b.start, b.end, b.category, b.kind].join('|');
      if (!bySig.has(sig)) {
        bySig.set(sig, {
          name: b.name,
          category: b.category,
          start: b.start,
          end: b.end,
          kind: b.kind,
          committed: b.committed,
          days: [],
        });
      }
      const row = bySig.get(sig);
      if (!row.days.includes(day.dow)) row.days.push(day.dow);
    }
  }
  return Array.from(bySig.values()).map((r) => ({
    name: r.name,
    category: r.category,
    start: r.start,
    end: r.end,
    days: r.days.sort((a, b) => a - b),
    // Reuse the existing confidence/commitment gate (20260523 / 20260529).
    confidence: r.committed ? 0.95 : 0.4,
    commitment: r.committed ? 'confirmed' : 'tentative',
  }));
}
