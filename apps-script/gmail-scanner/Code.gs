/**
 * SOS Gmail Scanner — Google Apps Script
 *
 * Scans Gmail for recent important emails, extracts summaries,
 * calendar tasks, and note material, then logs results to a
 * Google Sheet for review and import into the SOS app.
 *
 * Uses only GmailApp (gmail.readonly) and SpreadsheetApp (spreadsheets)
 * to keep OAuth scopes narrow and avoid Restricted verification status.
 */

/* ─── Configuration ─────────────────────────────────────────── */

var CONFIG = {
  // Gmail search queries — combined with deduplication.
  // "is:important" uses Gmail's own priority-inbox classifier.
  SEARCH_QUERIES: [
    'is:important newer_than:3d',
    'is:starred newer_than:7d',
    'category:updates newer_than:2d',
    'subject:(action required) newer_than:7d',
    'subject:(deadline OR due OR exam OR assignment) newer_than:7d'
  ],
  MAX_THREADS: 30,
  SPREADSHEET_NAME: 'SOS Gmail Digest',

  // Keywords that signal calendar / task-relevant content
  CALENDAR_KEYWORDS: [
    'deadline', 'due', 'due date', 'exam', 'test', 'quiz',
    'assignment', 'meeting', 'appointment', 'schedule',
    'class', 'lecture', 'submit', 'submission', 'presentation',
    'project', 'homework', 'lab', 'office hours', 'review session',
    'study group', 'reminder', 'rsvp', 'attend', 'register',
    'midterm', 'final', 'paper', 'essay', 'report'
  ],

  // Patterns for date / time extraction
  DATE_PATTERN: /\b(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[,\s]+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:[,\s]+\d{4})?\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:today|tomorrow|tonight|this\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)|next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi,

  TIME_PATTERN: /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\b|\b\d{1,2}:\d{2}\b/gi
};

/* ═══════════════════════════════════════════════════════════════
   ENTRY POINTS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Main function — scan Gmail and log results to a Google Sheet.
 * Run manually or via a time-driven trigger.
 */
function scanGmail() {
  var threads = fetchImportantThreads_();
  var results = [];

  for (var i = 0; i < threads.length; i++) {
    var thread  = threads[i];
    var msgs    = thread.getMessages();
    var latest  = msgs[msgs.length - 1];
    var body    = latest.getPlainBody();
    var subject = latest.getSubject();
    var from    = latest.getFrom();
    var date    = latest.getDate();

    var parsed = parseMessage_(subject, body);

    results.push({
      date:           date,
      from:           from,
      subject:        subject,
      summary:        parsed.summary,
      calendarItems:  parsed.calendarItems,
      noteMaterial:   parsed.noteMaterial,
      importance:     rateImportance_(subject, body, thread),
      messageId:      latest.getId()
    });
  }

  // Highest importance first
  results.sort(function (a, b) { return b.importance - a.importance; });

  logToSheet_(results);

  Logger.log('Scanned ' + threads.length + ' threads, logged ' + results.length + ' results.');
  return results;
}

/**
 * Install a daily time-driven trigger for scanGmail.
 * Run this once manually from the Apps Script editor.
 */
function installDailyTrigger() {
  // Remove any existing scanGmail triggers to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scanGmail') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('scanGmail')
    .timeBased()
    .everyDays(1)
    .atHour(7)   // Runs around 7 AM in your script timezone
    .create();

  Logger.log('Daily trigger installed — scanGmail will run at ~7 AM daily.');
}

/**
 * Remove all scanGmail triggers.
 */
function removeDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scanGmail') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log('Daily trigger removed.');
}

/* ═══════════════════════════════════════════════════════════════
   GMAIL FETCHING
   ═══════════════════════════════════════════════════════════════ */

/**
 * Run every search query, deduplicate threads by ID, and return
 * up to MAX_THREADS unique threads.
 */
function fetchImportantThreads_() {
  var seen    = {};
  var threads = [];

  for (var q = 0; q < CONFIG.SEARCH_QUERIES.length; q++) {
    try {
      var hits = GmailApp.search(CONFIG.SEARCH_QUERIES[q], 0, CONFIG.MAX_THREADS);
      for (var h = 0; h < hits.length; h++) {
        var id = hits[h].getId();
        if (!seen[id]) {
          seen[id] = true;
          threads.push(hits[h]);
        }
      }
    } catch (e) {
      Logger.log('Search failed: ' + CONFIG.SEARCH_QUERIES[q] + ' — ' + e.message);
    }
  }

  return threads.slice(0, CONFIG.MAX_THREADS);
}

/* ═══════════════════════════════════════════════════════════════
   MESSAGE PARSING
   ═══════════════════════════════════════════════════════════════ */

function parseMessage_(subject, body) {
  var cleaned = cleanBody_(body);
  return {
    summary:       extractSummary_(subject, cleaned),
    calendarItems: extractCalendarItems_(subject, cleaned),
    noteMaterial:  extractNoteMaterial_(subject, cleaned)
  };
}

/**
 * Strip signatures, reply chains, quoted text, and image refs.
 */
function cleanBody_(body) {
  return body
    .replace(/--\s*\r?\n[\s\S]*$/, '')           // Signature blocks
    .replace(/On\s.+wrote:\s*\r?\n[\s\S]*$/, '') // Reply chains
    .replace(/>+\s*.*/g, '')                       // Quoted lines
    .replace(/_{3,}|={3,}|-{3,}/g, '')             // Separator lines
    .replace(/\[image:[^\]]*\]/gi, '')             // Image placeholders
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ─── Summary ───────────────────────────────────────────────── */

/**
 * Extract the first few meaningful sentences as a summary.
 * Falls back to the subject line if the body is too short.
 */
function extractSummary_(subject, body) {
  var sentences = body
    .split(/(?<=[.!?])\s+/)
    .filter(function (s) {
      var t = s.trim();
      return t.length > 15 && t.length < 500 && !/^https?:\/\//i.test(t);
    });

  if (sentences.length === 0) return subject;

  var summary = sentences.slice(0, 3).join(' ').trim();
  return summary.length > 500 ? summary.substring(0, 497) + '...' : summary;
}

/* ─── Calendar Tasks ────────────────────────────────────────── */

/**
 * Find sentences that contain calendar-relevant keywords and
 * extract any dates / times mentioned nearby.
 */
function extractCalendarItems_(subject, body) {
  var items    = [];
  var combined = subject + '\n' + body;
  var lower    = combined.toLowerCase();

  // Which keywords appear?
  var matched = CONFIG.CALENDAR_KEYWORDS.filter(function (kw) {
    return lower.indexOf(kw) !== -1;
  });

  if (matched.length === 0) return items;

  // Reset global-flag regexes before use
  CONFIG.DATE_PATTERN.lastIndex = 0;
  CONFIG.TIME_PATTERN.lastIndex = 0;

  var dates = uniqueMatches_(combined, CONFIG.DATE_PATTERN);
  var times = uniqueMatches_(combined, CONFIG.TIME_PATTERN);

  // Sentences containing at least one matched keyword
  var sentences = combined.split(/[.!?\n]+/);
  var seen      = {};

  for (var i = 0; i < sentences.length; i++) {
    var trimmed      = sentences[i].trim();
    var sentenceLower = trimmed.toLowerCase();

    if (trimmed.length < 10 || trimmed.length > 300) continue;

    var hasKeyword = matched.some(function (kw) {
      return sentenceLower.indexOf(kw) !== -1;
    });

    if (hasKeyword && !seen[sentenceLower]) {
      seen[sentenceLower] = true;
      items.push({
        text:     trimmed,
        dates:    dates,
        times:    times,
        keywords: matched.filter(function (kw) {
          return sentenceLower.indexOf(kw) !== -1;
        })
      });
    }
  }

  return items;
}

/* ─── Note Material ─────────────────────────────────────────── */

/**
 * Extract structured content worth saving to notes:
 * lists, URLs, key-value details, and attachment mentions.
 */
function extractNoteMaterial_(subject, body) {
  var notes = [];
  var lines = body.split('\n')
    .map(function (l) { return l.trim(); })
    .filter(Boolean);

  // Bulleted / numbered lists
  var listItems = lines.filter(function (line) {
    return /^[\-\*\u2022\u2023\u2043]\s+/.test(line) || /^\d+[.\)]\s+/.test(line);
  });
  if (listItems.length > 0) {
    notes.push({
      type: 'list',
      content: listItems.map(function (l) {
        return l.replace(/^[\-\*\u2022\u2023\u2043\d.)\s]+/, '').trim();
      })
    });
  }

  // URLs (skip unsubscribe / tracking junk)
  var urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  var urls = body.match(urlPattern) || [];
  var uniqueUrls = dedupe_(urls).filter(function (u) {
    return !/unsubscribe|tracking|click\.|list-manage/i.test(u);
  });
  if (uniqueUrls.length > 0) {
    notes.push({ type: 'links', content: uniqueUrls });
  }

  // Key-value pairs (e.g. "Room: 301", "Location: Library")
  var kvPairs = lines.filter(function (line) {
    return /^[A-Za-z][A-Za-z\s]{1,25}:\s+.+/.test(line);
  });
  if (kvPairs.length > 0) {
    notes.push({ type: 'details', content: kvPairs });
  }

  // Attachment mentions
  var attachRE = /(?:attached|attachment|enclosed|see attached|find attached)[^.!?\n]*/gi;
  var attachMentions = body.match(attachRE);
  if (attachMentions) {
    notes.push({
      type: 'attachments',
      content: attachMentions.map(function (a) { return a.trim(); })
    });
  }

  return notes;
}

/* ═══════════════════════════════════════════════════════════════
   IMPORTANCE RATING
   ═══════════════════════════════════════════════════════════════ */

/**
 * Score 0-10 reflecting how important / actionable an email is
 * for a student. Higher = more important.
 */
function rateImportance_(subject, body, thread) {
  var score = 0;
  var lower = (subject + ' ' + body).toLowerCase();

  // Starred threads
  if (thread.hasStarredMessages()) score += 3;

  // Gmail "Important" label
  if (thread.isImportant()) score += 2;

  // Urgency language
  var urgentWords = [
    'urgent', 'asap', 'immediately', 'action required',
    'important', 'deadline', 'overdue', 'final notice',
    'last chance', 'time-sensitive'
  ];
  for (var u = 0; u < urgentWords.length; u++) {
    if (lower.indexOf(urgentWords[u]) !== -1) { score += 2; break; }
  }

  // Academic keywords
  var academicWords = [
    'exam', 'midterm', 'final', 'grade', 'gpa',
    'assignment', 'submit', 'due'
  ];
  for (var a = 0; a < academicWords.length; a++) {
    if (lower.indexOf(academicWords[a]) !== -1) { score += 1; break; }
  }

  // Contains dates (likely actionable)
  if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b/i.test(lower) ||
      /\b\d{1,2}\/\d{1,2}\b/.test(lower)) {
    score += 1;
  }

  // Recency bonus
  var ageHours = (Date.now() - thread.getLastMessageDate().getTime()) / 3600000;
  if (ageHours < 6)       score += 2;
  else if (ageHours < 24) score += 1;

  return score;
}

/* ═══════════════════════════════════════════════════════════════
   GOOGLE SHEET LOGGING
   ═══════════════════════════════════════════════════════════════ */

/**
 * Write results to three sheets: Summaries, Calendar Tasks, Notes.
 * The spreadsheet ID is stored in Script Properties so we reuse
 * the same file across runs (no Drive scope needed).
 */
function logToSheet_(results) {
  var ss = getOrCreateSpreadsheet_();

  writeSummarySheet_(ss, results);
  writeCalendarSheet_(ss, results);
  writeNotesSheet_(ss, results);

  // Clean up the default "Sheet1" if it exists and is empty
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) { /* ignore */ }
  }

  Logger.log('Results written → ' + ss.getUrl());
}

function getOrCreateSpreadsheet_() {
  var props   = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SOS_DIGEST_SHEET_ID');

  if (sheetId) {
    try {
      return SpreadsheetApp.openById(sheetId);
    } catch (e) {
      Logger.log('Stored sheet not accessible, creating a new one.');
    }
  }

  var ss = SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
  props.setProperty('SOS_DIGEST_SHEET_ID', ss.getId());
  Logger.log('Created spreadsheet: ' + ss.getUrl());
  return ss;
}

/* ─── Summaries sheet ───────────────────────────────────────── */

function writeSummarySheet_(ss, results) {
  var sheet = getOrCreateSheet_(ss, 'Summaries');
  sheet.clear();

  var header = ['Score', 'Date', 'From', 'Subject', 'Summary'];
  sheet.appendRow(header);
  styleHeader_(sheet, header.length, '#4a44b3');

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    sheet.appendRow([
      r.importance,
      formatDate_(r.date),
      r.from,
      r.subject,
      r.summary
    ]);
  }

  sheet.autoResizeColumns(1, header.length);
  sheet.setFrozenRows(1);
}

/* ─── Calendar Tasks sheet ──────────────────────────────────── */

function writeCalendarSheet_(ss, results) {
  var sheet = getOrCreateSheet_(ss, 'Calendar Tasks');
  sheet.clear();

  var header = ['From', 'Subject', 'Task / Event', 'Dates Found', 'Times Found', 'Keywords'];
  sheet.appendRow(header);
  styleHeader_(sheet, header.length, '#2ed573');

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    for (var j = 0; j < r.calendarItems.length; j++) {
      var item = r.calendarItems[j];
      sheet.appendRow([
        r.from,
        r.subject,
        item.text,
        (item.dates || []).join(', '),
        (item.times || []).join(', '),
        (item.keywords || []).join(', ')
      ]);
    }
  }

  sheet.autoResizeColumns(1, header.length);
  sheet.setFrozenRows(1);
}

/* ─── Notes sheet ───────────────────────────────────────────── */

function writeNotesSheet_(ss, results) {
  var sheet = getOrCreateSheet_(ss, 'Notes');
  sheet.clear();

  var header = ['Subject', 'Type', 'Content'];
  sheet.appendRow(header);
  styleHeader_(sheet, header.length, '#6C63FF');

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    for (var j = 0; j < r.noteMaterial.length; j++) {
      var note = r.noteMaterial[j];
      sheet.appendRow([
        r.subject,
        note.type,
        (note.content || []).join('\n')
      ]);
    }
  }

  sheet.autoResizeColumns(1, header.length);
  sheet.setFrozenRows(1);
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function styleHeader_(sheet, cols, bgColor) {
  sheet.getRange(1, 1, 1, cols)
    .setFontWeight('bold')
    .setBackground(bgColor)
    .setFontColor('#ffffff');
}

function formatDate_(d) {
  if (!d) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

/**
 * Return unique matches from a global regex (resets lastIndex).
 */
function uniqueMatches_(text, regex) {
  regex.lastIndex = 0;
  var matches = text.match(regex) || [];
  var seen = {};
  return matches.filter(function (m) {
    var key = m.trim().toLowerCase();
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).map(function (m) { return m.trim(); });
}

/**
 * Simple array deduplication.
 */
function dedupe_(arr) {
  var seen = {};
  return arr.filter(function (item) {
    if (seen[item]) return false;
    seen[item] = true;
    return true;
  });
}
