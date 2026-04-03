import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import * as pdfjsLib from 'pdfjs-dist';
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY, EDGE_FN_URL, CHAT_MAX_MESSAGES } from './lib/supabase';
import Icon from './lib/icons';
import { trackEvent } from './lib/analytics';
import ErrorBoundary from './components/ErrorBoundary';
import PresenceDetector from './components/PresenceDetector';
import IdleLockScreen from './components/IdleLockScreen';
import SfxToggle from './components/SfxToggle';
import * as sfx from './lib/sfx';
import { getPerfTier, setPerfOverride } from './lib/perfAdjuster';
import StudyTopBar from './components/StudyTopBar';
import StudyBottomBar from './components/StudyBottomBar';
import LofiLeftPanel from './components/LofiLeftPanel';
import LofiRightPanel from './components/LofiRightPanel';
import EditableSortableContainer from './features/edit-mode/dnd/EditableSortableContainer';

// Configure pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();


/* ─── Date helpers ─── */
function fmt(d) { return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric' }); }
function fmtFull(d) { return new Date(d).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }); }
function toDateStr(d) {
  const dt = new Date(d);
  return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
}
function today() { return toDateStr(new Date()); }
function daysUntil(dateStr) {
  const now = new Date(); now.setHours(0,0,0,0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - now) / 86400000);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function fmtTime(h, m) {
  const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return hr + ':' + String(m).padStart(2,'0') + ' ' + ampm;
}

/* ─── Collapse a {HH:MM: {name}} slot map into "Name HH:MM-HH:MM" strings ─── */
function summarizeBlockSlots(slotMap) {
  const entries = Object.entries(slotMap).filter(([,v]) => v).sort(([a],[b]) => a.localeCompare(b));
  if (!entries.length) return [];
  const ranges = [];
  let curName = null, startKey = null, prevKey = null;
  const advance = key => { const [h,m] = key.split(':').map(Number); return String(m===30?h+1:h).padStart(2,'0')+':'+(m===30?'00':'30'); };
  for (const [key, val] of entries) {
    const name = val?.name || String(val);
    if (name !== curName) {
      if (curName !== null) ranges.push(curName + ' ' + startKey + '-' + advance(prevKey));
      curName = name; startKey = key;
    }
    prevKey = key;
  }
  if (curName !== null) ranges.push(curName + ' ' + startKey + '-' + advance(prevKey));
  return ranges;
}

/* ─── Map raw Google Calendar API items → app event shape ─── */
function mapGoogleCalItems(items) {
  return items.filter(e => e.summary).map(e => ({
    googleId: e.id,
    title: e.summary,
    date: e.start?.date || (e.start?.dateTime?.split('T')[0] ?? ''),
    startTime: e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : null,
    allDay: !!e.start?.date,
  }));
}

/* ─── Nudge Engine ─── */
function getNudge(task) {
  if (task.status === 'done') return { emoji:'done', text:'Done! Nice work.' };
  const d = daysUntil(task.dueDate);
  if (d < 0) return { emoji:'overdue', text:'Overdue by ' + Math.abs(d) + ' day' + (Math.abs(d)>1?'s':'') };
  if (d === 0) return { emoji:'today', text:'Due today' };
  if (d === 1) return { emoji:'tomorrow', text:'Due tomorrow' };
  if (d <= 3) return { emoji:'soon', text:d + ' days left' };
  if (d <= 7) return { emoji:'week', text:d + ' days left' };
  return { emoji:'chill', text:d + ' days left' };
}

function getPriority(task) {
  if (task.status === 'done') return 999;
  const d = daysUntil(task.dueDate);
  let score = d;
  if (task.status === 'not_started') score -= 2;
  if (task.status === 'in_progress') score -= 1;
  return score;
}

/* ─── Category Colors ─── */
const CAT_COLORS = {
  school:'var(--accent)', swim:'var(--teal)', debate:'var(--orange)',
  'free time':'var(--green)', sleep:'var(--blue)', other:'var(--pink)',
  homework:'var(--accent)', test:'var(--danger)', practice:'var(--teal)',
  event:'var(--orange)'
};
function catColor(cat) { return CAT_COLORS[cat?.toLowerCase()] || 'var(--accent)'; }

/* ─── Weather Icons ─── */
function weatherEmoji(code) {
  if (code <= 1) return Icon.sun(18); if (code <= 3) return Icon.cloud(18);
  if (code <= 48) return Icon.cloudFog(18); if (code <= 67) return Icon.cloudRain(18);
  if (code <= 77) return Icon.cloudSnow(18); if (code <= 82) return Icon.cloudDrizzle(18);
  return Icon.cloudLightning(18);
}

function weatherThemeKey(code) {
  if (code === null || code === undefined) return 'clear';
  if (code <= 1) return 'clear';
  if (code <= 48) return 'cloudy';
  if (code <= 67) return 'rainy';
  if (code <= 77) return 'snowy';
  if (code <= 82) return 'rainy';
  return 'stormy';
}

// CHAT_MAX_MESSAGES imported from ./lib/supabase
const GUEST_DEMO_LIMIT = 10;

/* ─── Photo utilities ─── */
function resizeImage(file, maxDim = 1024, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          // If still too large (>500KB base64), reduce quality
          if (dataUrl.length > 500000) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.5);
          }
          const base64 = dataUrl.split(',')[1];
          resolve({ base64, preview: dataUrl, mimeType: 'image/jpeg' });
        } catch (err) { reject(err); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhotoToStorage(base64, userId) {
  try {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: 'image/jpeg' });
    const path = userId + '/' + Date.now() + '-' + uid() + '.jpg';
    const { data, error } = await sb.storage.from('chat-photos').upload(path, blob, { contentType: 'image/jpeg' });
    if (error) { console.error('Photo upload error:', error); return null; }
    const { data: urlData } = sb.storage.from('chat-photos').getPublicUrl(path);
    return urlData?.publicUrl || null;
  } catch (e) {
    console.error('Photo upload failed:', e);
    return null;
  }
}

/* ═══════════════════════════════════════════════
   SUPABASE DATA LAYER
   Reads from / writes to Supabase. Falls back to
   localStorage if offline or not logged in.
   ═══════════════════════════════════════════════ */

/* Convert DB row → app shape */
function dbTaskToApp(row) {
  return {
    id: row.id, title: row.title, subject: row.subject || '',
    dueDate: row.due_date, estTime: row.est_time || 30,
    status: row.status || 'not_started', focusMinutes: row.focus_minutes || 0,
    completedAt: row.completed_at, createdAt: row.created_at
  };
}
function appTaskToDb(t, userId) {
  return {
    id: t.id, user_id: userId, title: t.title, subject: t.subject || '',
    due_date: t.dueDate, est_time: t.estTime || 30,
    status: t.status || 'not_started', focus_minutes: t.focusMinutes || 0,
    completed_at: t.completedAt || null, created_at: t.createdAt || new Date().toISOString()
  };
}
function dbEventToApp(row) {
  return {
    id: row.id, title: row.title, type: row.event_type || 'other',
    subject: row.subject || '', date: row.event_date,
    recurring: row.recurring || 'none', createdAt: row.created_at,
    googleId: row.google_id || null,
    source: row.source || 'manual'
  };
}
function appEventToDb(e, userId) {
  return {
    id: e.id, user_id: userId, title: e.title, event_type: e.type || 'other',
    subject: e.subject || '', event_date: e.date,
    recurring: e.recurring || 'none', created_at: e.createdAt || new Date().toISOString(),
    google_id: e.googleId || null,
    source: e.source || 'manual'
  };
}
function dbNoteToApp(row) {
  return { id: row.id, name: row.name, content: row.content || '', updatedAt: row.updated_at };
}
function appNoteToDb(n, userId) {
  return { id: n.id, user_id: userId, name: n.name, content: n.content || '', updated_at: n.updatedAt || new Date().toISOString() };
}

/* Full load from Supabase */
async function loadAllFromSupabase(userId) {
  try {
    const [tasksRes, eventsRes, notesRes, chatRes, recurringRes, dateBlocksRes, profileRes] = await Promise.all([
      sb.from('tasks').select('*').eq('user_id', userId),
      sb.from('events').select('*').eq('user_id', userId),
      sb.from('notes').select('*').eq('user_id', userId),
      sb.from('chat_messages').select('*').eq('user_id', userId).order('created_at', { ascending: true }).limit(CHAT_MAX_MESSAGES),
      sb.from('recurring_blocks').select('*').eq('user_id', userId),
      sb.from('date_blocks').select('*').eq('user_id', userId),
      sb.from('profiles').select('*').eq('id', userId).single()
    ]);

    const tasks = (tasksRes.data || []).map(dbTaskToApp);
    const events = (eventsRes.data || []).map(dbEventToApp);
    const notes = (notesRes.data || []).map(dbNoteToApp);
    const messages = (chatRes.data || []).map(m => ({ role: m.role, content: m.content, timestamp: new Date(m.created_at).getTime(), photoUrl: m.photo_url || null, fromDB: true }));

    // Reconstruct blocks object from recurring_blocks + date_blocks
    const recurring = (recurringRes.data || []).map(rb => ({
      id: rb.id, name: rb.name, category: rb.category,
      start: rb.start_time?.slice(0,5) || '00:00',
      end: rb.end_time?.slice(0,5) || '01:00',
      days: rb.days || []
    }));
    const dates = {};
    (dateBlocksRes.data || []).forEach(db => {
      if (!dates[db.block_date]) dates[db.block_date] = {};
      dates[db.block_date][db.time_slot] = db.name === null ? null : { name: db.name, category: db.category || 'school' };
    });
    const blocks = { recurring, dates };

    const weatherCoords = profileRes.data
      ? { lat: profileRes.data.weather_lat || 42.33, lon: profileRes.data.weather_lon || -71.21 }
      : { lat: 42.33, lon: -71.21 };

    return { tasks, events, notes, messages, blocks, weatherCoords };
  } catch (e) {
    console.error('Failed to load from Supabase:', e);
    return null;
  }
}

/* ── Name resolver: translates fuzzy AI names → real objects with IDs ── */
// Common abbreviations teens use → expanded form
const SUBJECT_ALIASES = {
  calc:'calculus', math:'mathematics', bio:'biology', chem:'chemistry',
  phys:'physics', eng:'english', hist:'history', sci:'science', span:'spanish',
  econ:'economics', psych:'psychology', gov:'government', geo:'geography',
  pe:'physical education', gym:'physical education', lit:'literature',
  cs:'computer science', comp:'computer science', la:'language arts'
};

const SUBJECT_ALIAS_PATTERNS = Object.entries(SUBJECT_ALIASES).map(
  ([short, long]) => ({ regex: new RegExp('\\b' + short + '\\b', 'g'), replacement: long })
);
function normalize(str) {
  if (!str) return '';
  let s = str.toLowerCase().trim();
  // expand known abbreviations
  for (const { regex, replacement } of SUBJECT_ALIAS_PATTERNS) {
    regex.lastIndex = 0;
    s = s.replace(regex, replacement);
  }
  return s;
}

// Score how well two strings match (higher = better, 0 = no match)
function matchScore(query, target) {
  const q = normalize(query);
  const t = normalize(target);
  if (!q || !t) return 0;
  if (q === t) return 100;               // exact match
  if (t.includes(q)) return 80;          // target contains query ("Math Test" contains "math")
  if (q.includes(t)) return 70;          // query contains target ("cancel the math test" contains "math test")
  // word overlap — how many query words appear in target
  const qWords = q.split(/\s+/);
  const tWords = t.split(/\s+/);
  const overlap = qWords.filter(w => tWords.some(tw => tw.includes(w) || w.includes(tw))).length;
  if (overlap > 0) return 30 + (overlap / qWords.length) * 40;
  return 0;
}

// Find the best-matching event from the array. Returns the event object or null.
function resolveEvent(nameOrId, eventsList) {
  if (!nameOrId || !eventsList?.length) return null;
  // 1. Try exact ID match first
  const byId = eventsList.find(ev => ev.id === nameOrId);
  if (byId) return byId;
  // 2. Score every event by name similarity, pick the best
  let best = null, bestScore = 0;
  for (const ev of eventsList) {
    const s = matchScore(nameOrId, ev.title);
    if (s > bestScore) { bestScore = s; best = ev; }
  }
  return bestScore >= 30 ? best : null;
}

// Find the best-matching task from the array. Returns the task object or null.
function resolveTask(nameOrId, tasksList) {
  if (!nameOrId || !tasksList?.length) return null;
  const byId = tasksList.find(t => t.id === nameOrId);
  if (byId) return byId;
  let best = null, bestScore = 0;
  for (const t of tasksList) {
    const s = matchScore(nameOrId, t.title);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return bestScore >= 30 ? best : null;
}

function addThirtyMinutes(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  d.setMinutes(d.getMinutes() + 30);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function resolveBlockRange(action, blocksState) {
  const date = action?.date;
  if (!date) return null;
  const daySlots = blocksState?.dates?.[date] || {};
  const sortedSlots = Object.keys(daySlots).sort((a, b) => a.localeCompare(b));
  if (sortedSlots.length === 0) return null;

  let start = action?.start;
  if (!start && action?.activity) {
    let bestSlot = null;
    let bestScore = 0;
    for (const key of sortedSlots) {
      const score = matchScore(action.activity, daySlots[key]?.name || '');
      if (score > bestScore) {
        bestScore = score;
        bestSlot = key;
      }
    }
    if (bestScore >= 30) start = bestSlot;
  }
  if (!start || !daySlots[start]) return null;

  const slotData = daySlots[start];
  const end = action?.end || (() => {
    let cursor = start;
    while (true) {
      const next = addThirtyMinutes(cursor);
      const nextData = daySlots[next];
      if (!nextData || nextData.name !== slotData.name || nextData.category !== slotData.category) return next;
      cursor = next;
    }
  })();

  return { date, start, end, name: slotData.name, category: slotData.category || 'school' };
}

/* ── Individual save helpers (fire-and-forget) ── */
async function dbUpsertTask(task, userId) {
  const { error } = await sb.from('tasks').upsert(appTaskToDb(task, userId), { onConflict: 'id' });
  if (error) console.error('Task upsert error:', error);
}
async function dbDeleteTask(taskId, userId) {
  const { error } = await sb.from('tasks').delete().eq('id', taskId).eq('user_id', userId);
  if (error) console.error('Task delete error:', error);
}
async function dbUpsertEvent(event, userId) {
  const { error } = await sb.from('events').upsert(appEventToDb(event, userId), { onConflict: 'id' });
  if (error) console.error('Event upsert error:', error);
}
async function dbDeleteEvent(eventId, userId) {
  const { error } = await sb.from('events').delete().eq('id', eventId).eq('user_id', userId);
  if (error) console.error('Event delete error:', error);
}
async function dbUpsertNote(note, userId) {
  const { error } = await sb.from('notes').upsert(appNoteToDb(note, userId), { onConflict: 'id' });
  if (error) console.error('Note upsert error:', error);
}
async function dbInsertChatMsg(role, content, userId, photoUrl = null) {
  const row = { user_id: userId, role, content };
  if (photoUrl) row.photo_url = photoUrl;
  const { error } = await sb.from('chat_messages').insert(row);
  if (error) console.error('Chat insert error:', error);
}
async function dbClearChat(userId) {
  const { error } = await sb.from('chat_messages').delete().eq('user_id', userId);
  if (error) console.error('Chat clear error:', error);
}
async function pushEventToGoogle(event, token) {
  try {
    const endD = new Date(event.date + 'T00:00:00'); endD.setDate(endD.getDate() + 1);
    const endDate = endD.toISOString().split('T')[0];
    const body = { summary: event.title, start: { date: event.date }, end: { date: endDate } };
    if (event.googleId) {
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events/' + event.googleId, {
        method: 'PATCH', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) { const errBody = await res.text().catch(() => ''); console.error('Google event update failed:', res.status, errBody); return event.googleId; }
      const data = await res.json(); return data.id;
    } else {
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) { const errBody = await res.text().catch(() => ''); console.error('Google event create failed:', res.status, errBody); return null; }
      const data = await res.json(); return data.id;
    }
  } catch (e) { console.error('pushEventToGoogle error:', e); return event.googleId || null; }
}
async function deleteEventFromGoogle(googleId, token) {
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events/' + googleId, {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok && res.status !== 404 && res.status !== 410) { const errBody = await res.text().catch(() => ''); console.error('Google event delete failed:', res.status, errBody); }
  } catch (e) { console.error('deleteEventFromGoogle error:', e); }
}
async function dbUpsertDateBlock(date, timeSlot, data, userId) {
  const row = {
    user_id: userId, block_date: date, time_slot: timeSlot,
    name: data ? data.name : null, category: data ? (data.category || 'school') : 'school'
  };
  const { error } = await sb.from('date_blocks').upsert(row, { onConflict: 'user_id,block_date,time_slot' });
  if (error) console.error('Date block upsert error:', error);
}

/* ── Migrate localStorage → Supabase (first login) ── */
async function migrateLocalStorage(userId) {
  const migrated = localStorage.getItem('sos_migrated_' + userId);
  if (migrated) return false;

  try {
    // Tasks
    const localTasks = JSON.parse(localStorage.getItem('cc_tasks') || '[]');
    if (localTasks.length > 0) {
      const rows = localTasks.map(t => appTaskToDb(t, userId));
      await sb.from('tasks').upsert(rows, { onConflict: 'id' });
    }

    // Events
    const localEvents = JSON.parse(localStorage.getItem('cc_events') || '[]');
    if (localEvents.length > 0) {
      const rows = localEvents.map(e => appEventToDb(e, userId));
      await sb.from('events').upsert(rows, { onConflict: 'id' });
    }

    // Notes
    const localNotes = JSON.parse(localStorage.getItem('cc_notes') || '[]');
    if (localNotes.length > 0) {
      const rows = localNotes.map(n => appNoteToDb(n, userId));
      await sb.from('notes').upsert(rows, { onConflict: 'id' });
    }

    // Chat messages
    const localChat = JSON.parse(localStorage.getItem('cc_chat') || '[]');
    if (localChat.length > 0) {
      const rows = localChat.map(m => ({ user_id: userId, role: m.role, content: m.content }));
      await sb.from('chat_messages').insert(rows);
    }

    // Blocks (recurring + date overrides)
    const localBlocks = JSON.parse(localStorage.getItem('cc_blocks') || '{"recurring":[],"dates":{}}');
    if (localBlocks.recurring?.length > 0) {
      const rows = localBlocks.recurring.map(rb => ({
        user_id: userId, name: rb.name, category: rb.category || 'school',
        start_time: rb.start || '00:00', end_time: rb.end || '01:00', days: rb.days || []
      }));
      await sb.from('recurring_blocks').insert(rows);
    }
    if (localBlocks.dates && Object.keys(localBlocks.dates).length > 0) {
      const rows = [];
      Object.entries(localBlocks.dates).forEach(([date, slots]) => {
        Object.entries(slots).forEach(([slot, data]) => {
          rows.push({
            user_id: userId, block_date: date, time_slot: slot,
            name: data ? data.name : null, category: data ? (data.category || 'school') : 'school'
          });
        });
      });
      if (rows.length > 0) await sb.from('date_blocks').upsert(rows, { onConflict: 'user_id,block_date,time_slot' });
    }

    // Weather coords
    const localCoords = JSON.parse(localStorage.getItem('cc_weather_coords') || 'null');
    if (localCoords) {
      await sb.from('profiles').update({ weather_lat: localCoords.lat, weather_lon: localCoords.lon }).eq('id', userId);
    }

    localStorage.setItem('sos_migrated_' + userId, 'true');
    console.log('Migration complete');
    return true;
  } catch (e) {
    console.error('Migration error:', e);
    return false;
  }
}

/* ═══════════════════════════════════════════════
   SOS SYSTEM PROMPT BUILDER
   ═══════════════════════════════════════════════ */
const SYSTEM_PROMPT_VERSION = 'sos-policy-v2';
const SYSTEM_PROMPT_CHAR_BUDGET = 7000;
const CONTEXT_SECTION_BUDGETS = {
  tasks: 1800,
  events: 800,
  week: 1000,
  notes: 2000,
  schedule: 600,
};

function estimateInputTokens(text = '') {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

function truncateWithEllipsis(text = '', maxChars = 300) {
  if (!text || text.length <= maxChars) return text || '';
  return text.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
}

function capLines(lines = [], maxChars = 1000, summaryLabel = 'items') {
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
function capLinesInfo(lines = [], maxChars = 1000, summaryLabel = 'items') {
  const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  const text = capLines(safeLines, maxChars, summaryLabel);
  const total = safeLines.length;
  // count kept lines = total lines minus the '… +N more' line if present
  const omitted = Math.max(0, safeLines.filter(l => String(l).trim()).length - text.split('\n').filter(l => !l.startsWith('…')).length);
  const shown = total - omitted;
  return { text, shown, total, trimmed: omitted > 0 };
}

function dedupeRepeatedLines(blockText = '') {
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

function buildSystemPrompt(tasks, blocks, events, notes, tier = 2, options = {}) {
  const tutorMode = !!options.tutorMode;
  const workspaceContext = options.workspaceContext || 'chat';
  const todayStr = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  const todayKey = today();
  const currentHour = new Date().getHours();

  const todayBlocks = {};
  const todayDow = new Date().getDay();
  (blocks.recurring || []).forEach(rb => {
    if (rb.days.includes(todayDow)) {
      const [sh, sm] = rb.start.split(':').map(Number);
      const [eh, em] = rb.end.split(':').map(Number);
      let ch = sh, cm = sm;
      while (ch < eh || (ch === eh && cm < em)) {
        const key = String(ch).padStart(2,'0') + ':' + String(cm).padStart(2,'0');
        todayBlocks[key] = { name: rb.name, category: rb.category };
        cm += 30; if (cm >= 60) { ch++; cm = 0; }
      }
    }
  });
  const dateOverrides = blocks.dates?.[todayKey] || {};
  Object.entries(dateOverrides).forEach(([k, v]) => {
    if (v === null) delete todayBlocks[k]; else todayBlocks[k] = v;
  });

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const weekSummary = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - d.getDay() + i);
    const ds = toDateStr(d); const dow = d.getDay();
    // Build merged block map (recurring base + date-specific overrides) for this day
    const daySlots = {};
    (blocks.recurring || []).forEach(rb => {
      if (rb.days.includes(dow)) {
        const [sh,sm] = rb.start.split(':').map(Number);
        const [eh,em] = rb.end.split(':').map(Number);
        let ch=sh, cm=sm;
        while (ch<eh||(ch===eh&&cm<em)) {
          daySlots[String(ch).padStart(2,'0')+':'+String(cm).padStart(2,'0')] = { name: rb.name };
          cm+=30; if(cm>=60){ch++;cm=0;}
        }
      }
    });
    Object.entries(blocks.dates?.[ds] || {}).forEach(([k,v]) => {
      if (v===null) delete daySlots[k]; else daySlots[k] = v;
    });
    const activities = summarizeBlockSlots(daySlots);
    tasks.filter(t => t.dueDate === ds && t.status !== 'done').forEach(t => activities.push('DUE: ' + t.title));
    events.filter(e => e.date === ds).forEach(e => activities.push('EVENT: ' + e.title));
    if (activities.length > 0) weekSummary.push(dayNames[dow] + ' ' + fmt(ds) + ': ' + activities.join(', '));
  }

  const activeTasks = tasks.filter(t => t.status !== 'done').sort((a,b) => getPriority(a) - getPriority(b));
  const overdueTasks = activeTasks.filter(t => daysUntil(t.dueDate) < 0);
  const upcomingEvents = events.filter(ev => { const d = daysUntil(ev.date); return d >= 0 && d <= 14; }).map(ev => ev.title + ' (' + ev.type + ') on ' + fmt(ev.date));
  const now = new Date(); const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
  const doneThisWeek = tasks.filter(t => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= weekStart).length;
  const dailyLoad = {}; activeTasks.forEach(t => { dailyLoad[t.dueDate] = (dailyLoad[t.dueDate] || 0) + (t.estTime || 30); });
  const overloadedDays = Object.entries(dailyLoad).filter(([d, mins]) => mins > 120).map(([d, mins]) => fmt(d) + ' (' + mins + ' min)');
  const taskLines = activeTasks.map(t =>
    '- ' + truncateWithEllipsis(t.title, 90) + (t.subject ? ' [' + t.subject + ']' : '') +
    ' | due ' + fmt(t.dueDate) + ' (' + daysUntil(t.dueDate) + 'd)' +
    ' | ' + t.estTime + 'min | ' + t.status.replace('_',' ') + ' | id:' + t.id
  );

  const noteNames = notes.map(n => n.name).join(', ') || 'none';
  const noteLines = [];
  if (notes.length > 0) {
    const sortOrder = { pdf: 0, google_docs: 1 };
    const sorted = notes.slice().sort((a, b) => (sortOrder[a.source] ?? 2) - (sortOrder[b.source] ?? 2));
    sorted.forEach(n => {
      const src = n.source === 'pdf' ? 'PDF' : n.source === 'google_docs' ? 'Google Doc' : 'study material';
      const preview = truncateWithEllipsis((n.content || '').replace(/\s+/g, ' ').trim(), 500);
      noteLines.push('- ' + n.name + ' (' + src + '): ' + preview);
    });
  }

  const taskCapInfo = capLinesInfo(taskLines, CONTEXT_SECTION_BUDGETS.tasks, 'tasks');

  const dynamicSections = [
    'DYNAMIC CONTEXT:',
    'TODAY: ' + todayStr + ' (' + (currentHour >= 12 ? 'afternoon' : 'morning') + ')',
    '',
    'TODAY\'S SCHEDULE:',
    capLines(summarizeBlockSlots(todayBlocks), CONTEXT_SECTION_BUDGETS.schedule, 'schedule blocks') || '(nothing scheduled)',
    '',
    'ACTIVE TASKS (budgeted):',
    taskCapInfo.text || '(none)',
    (overdueTasks.length > 0 ? ('OVERDUE: ' + overdueTasks.map(t => truncateWithEllipsis(t.title, 80) + ' (' + Math.abs(daysUntil(t.dueDate)) + 'd late)').join(', ')) : ''),
    '',
    'THIS WEEK (budgeted):',
    capLines(weekSummary, CONTEXT_SECTION_BUDGETS.week, 'weekly entries') || '(no scheduled activities)',
    '',
    'UPCOMING EVENTS (budgeted):',
    capLines(upcomingEvents, CONTEXT_SECTION_BUDGETS.events, 'events') || 'none',
    (overloadedDays.length > 0 ? 'OVERLOADED DAYS: ' + overloadedDays.join(', ') : ''),
    'COMPLETED THIS WEEK: ' + doneThisWeek + ' tasks',
    '',
    'NOTES INDEX: ' + noteNames,
    'NOTES PREVIEWS (budgeted):',
    capLines(noteLines, CONTEXT_SECTION_BUDGETS.notes, 'note previews') || '(none)',
    '',
    'MODE FLAGS:',
    '- tutor_mode: ' + (tutorMode ? 'ON' : 'OFF'),
    '- workspace_context: ' + workspaceContext,
  ].filter(Boolean).join('\n');

  const contextBlock = truncateWithEllipsis(dedupeRepeatedLines(dynamicSections), SYSTEM_PROMPT_CHAR_BUDGET);

  const stablePolicyTier1 = `STABLE POLICY (${SYSTEM_PROMPT_VERSION})
You are SOS, a supportive study sidekick. Keep replies casual, brief (2-3 sentences), and never condescending.
Never invent tasks/events/deadlines that are not present in dynamic context.
If schedule/tasks are clear, say so directly and upbeat.
If student asks about note content, reference only available notes and ask focused follow-ups when details are missing.`;

  if (tier === 1) {
    const allClear = activeTasks.length === 0 && overdueTasks.length === 0 && upcomingEvents.length === 0;
    const scheduleStr = summarizeBlockSlots(todayBlocks).join(', ') || 'nothing scheduled';
    const dynamicTier1 = `DYNAMIC CONTEXT:
TODAY: ${todayStr}
TODAY'S SCHEDULE: ${scheduleStr}
COMPLETED THIS WEEK: ${doneThisWeek} task${doneThisWeek !== 1 ? 's' : ''}
${allClear ? 'STATUS: All clear — no overdue tasks, no upcoming events, nothing on the list.' : `ACTIVE TASKS: ${activeTasks.length} pending${overdueTasks.length > 0 ? ' (' + overdueTasks.length + ' overdue)' : ''}. UPCOMING EVENTS: ${upcomingEvents.length > 0 ? upcomingEvents.join(', ') : 'none'}.`}
NOTES: ${noteNames}`;
    const prompt = stablePolicyTier1 + '\n\n' + truncateWithEllipsis(dynamicTier1, 1800);
    return { prompt, promptVersion: SYSTEM_PROMPT_VERSION, contextChars: dynamicTier1.length, estimatedInputTokens: estimateInputTokens(prompt) };
  }

  const stablePolicyTier2 = `STABLE POLICY (${SYSTEM_PROMPT_VERSION})
You are SOS — a chill, concise study companion.
Voice: supportive friend, 2-4 sentence default, no condescension, no hallucinated schedule data.
Planning guardrails: protect sleep (no work past 10pm), suggest decomposition for large tasks, rebalance overloaded days, and handle overdue tasks without guilt.
Tools: if user gives explicit actionable details, call the matching tool; if ANY key field (title/date/time/subject) is missing or unnamed — including vague requests like "add a task" or "create an event" with no specifics — call ask_clarification FIRST. The title must be a specific name the student actually said; generic labels like "New task", "Task title", or "Event" are treated as missing and are never acceptable.
Corrections: "actually / wait / I meant / oops" should update the latest related item.
Notes/docs: use them as references when relevant; cite note names naturally.
Workspace: prioritize workspace_context when useful (notes vs schedule vs chat).
Image input: describe what is visible first, then extract assignments/dates when legible.
Content generation requests (flashcards/quizzes/plans/outlines/summaries/project breakdowns) must return canonical tool actions only (typed payloads in actions[]).
Date resolution: when resolving weekday references (e.g. "due Monday", "due Friday"), if today IS that weekday use today's date. Never resolve a weekday to a past date — always use the current or next upcoming occurrence.`;

  const prompt = dedupeRepeatedLines(stablePolicyTier2 + '\n\n' + contextBlock);
  return {
    prompt,
    // stablePrompt/dynamicContext are sent separately so the backend can put the static
    // policy in an immutable system message (Groq caches it + tool definitions across requests).
    stablePrompt: stablePolicyTier2,
    dynamicContext: contextBlock,
    promptVersion: SYSTEM_PROMPT_VERSION,
    contextChars: contextBlock.length,
    estimatedInputTokens: estimateInputTokens(prompt),
    trimInfo: taskCapInfo.trimmed
      ? { shown: taskCapInfo.shown, total: taskCapInfo.total }
      : null,
  };
}

/* ─── Google Docs text extractor (shared by import modal + daily brief) ─── */
function extractDocsText(doc) {
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

/* ─── Google Doc ID parser (shared by import modal + daily brief context) ─── */
// Accepts a full Google Docs URL or a bare doc ID; returns the ID or null.
function parseDocId(input) {
  const urlMatch = input.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

/* ─── Multi-model message classifier ─── */
const CONTENT_TYPES = ['create_flashcards','create_outline','create_summary','create_study_plan','create_quiz','create_project_breakdown','make_plan'];
const CONTENT_GEN_REGEX = /flashcards?|outline|summar|study\s*plan|study\s*guide|quiz\s+me|make\s+(?:me\s+)?(?:a\s+)?quiz|create\s+(?:a\s+)?quiz|practice\s*questions?|project\s*breakdown|review\s*sheet|cheat\s*sheet/i;
const TUTOR_STUDY_REGEX = /flashcards?|quiz\s+me|make\s+(?:me\s+)?(?:a\s+)?quiz|create\s+(?:a\s+)?quiz|practice\s*questions?/i;

function isStringArray(value, min = 0) {
  return Array.isArray(value) && value.length >= min && value.every(v => typeof v === 'string' && v.trim().length > 0);
}

function isValidContentAction(action) {
  if (!action || typeof action !== 'object' || !CONTENT_TYPES.includes(action.type)) return false;
  switch (action.type) {
    case 'create_flashcards':
      return Array.isArray(action.cards) && action.cards.length > 0 && action.cards.every(c => typeof c?.q === 'string' && typeof c?.a === 'string');
    case 'create_quiz':
      return Array.isArray(action.questions) && action.questions.length > 0 && action.questions.every(q => typeof q?.q === 'string' && isStringArray(q?.choices, 2) && typeof q?.answer === 'string');
    case 'create_outline':
      return Array.isArray(action.sections) && action.sections.length > 0 && action.sections.every(s => typeof s?.heading === 'string' && isStringArray(s?.points, 1));
    case 'create_summary':
      return isStringArray(action.bullets, 1);
    case 'create_study_plan':
      return Array.isArray(action.steps) && action.steps.length > 0 && action.steps.every(s => typeof s?.step === 'string');
    case 'create_project_breakdown':
      return Array.isArray(action.phases) && action.phases.length > 0 && action.phases.every(p => typeof p?.phase === 'string' && isStringArray(p?.tasks, 1));
    case 'make_plan':
      return typeof action.title === 'string' && Array.isArray(action.steps) && action.steps.length > 0 && action.steps.every(s => typeof s?.title === 'string');
    default:
      return false;
  }
}

/* Regex-based classifier (kept as fast fallback) */
function classifyMessageRegex(text) {
  if (CONTENT_GEN_REGEX.test(text)) {
    return { provider:'groq', model:'llama-3.1-8b-instant', tier:2, isContentGen:true, maxTokens:4096 };
  }
  if (/\b(notes?|reference|look\s*up|search\s+(my\s+)?notes|find\s+in|from\s+(my|the)\s+(pdf|doc|notes?)|what\s+(does|did)\s+(my|the)\s+(pdf|doc|notes?)|in\s+my\s+(pdf|doc|notes?))\b/i.test(text)) {
    return { provider:'groq', model:'llama-3.1-8b-instant', tier:2, isContentGen:false, maxTokens:2048 };
  }
  const actionSignals = /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tmrw|tmw|2morrow|tomorrow|tonight|today|this\s+week|next\s+week|\d{1,2}(am|pm|:\d\d))\b|\b(test|exam|quiz|hw|homework|essay|project|lab|report|presentation|practice|game|match|meet|tournament|scrimmage|tryout|rehearsal|class|lesson|club|appointment|deadline|due|midterm|final|paper|assignment|worksheet)\b|\b(add|schedule|remind|mark|cancel|remove|delete|clear|scratch|drop|ditch|wipe|axe|nix|scrap|erase|purge|yeet|bin|toss|dump|trash|strike|pull|cut|move|reschedule|push\s*back|postpone|bump|finish|done|completed|finished|turned\s+in|submitted|started|working\s+on|nevermind|never\s*mind|forget)\b|\b(no\s+longer|not\s+happening|called\s+off|scratch\s+that|off\s+the\s+books|take\s+off|cross\s+out)\b|\b(calc|math|bio|chem|phys|eng|hist|sci|span|french|econ|psych|gov|geo|ap\s+\w+|pe|gym)\b|\b(swim|debate|band|choir|track|soccer|basketball|baseball|football|tennis|volleyball|lacrosse|dance|drama|robotics|chess|music|tutoring)\b/i;
  if (actionSignals.test(text)) {
    return { provider:'groq', model:'llama-3.1-8b-instant', tier:2, isContentGen:false, maxTokens:1024 };
  }
  // All messages use GPT-OSS so one model handles chat + actions + content.
  return { provider:'groq', model:'llama-3.1-8b-instant', tier:2, isContentGen:false, maxTokens:1024 };
}

/* LLM-based classifier using openai/gpt-oss-20b (with regex fallback) */
async function classifyMessage(text) {
  try {
    const session = await sb.auth.getSession();
    const token = session?.data?.session?.access_token;
    const classifyPrompt = `You are a message classifier for a student planner app. Classify the user message into exactly one category and return ONLY a JSON object.

Categories:
- CONTENT_GEN: Requests to create study materials — flashcards, outlines, summaries, study plans, quizzes, project breakdowns, review sheets, cheat sheets
- NOTES_REF: Questions about the student's own notes, reference docs, PDFs, or looking things up in saved documents
- ACTION: Any scheduling, task, event, block, calendar, or organizational request. Includes mentions of dates, times, school subjects, activities, verbs like add/delete/schedule/cancel/move, and slang equivalents
- CHAT: General conversation, greetings, questions, or anything with no scheduling or content generation intent

Return ONLY: {"category":"CONTENT_GEN"} or {"category":"NOTES_REF"} or {"category":"ACTION"} or {"category":"CHAT"}`;

    const response = await fetch(EDGE_FN_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||SUPABASE_ANON_KEY)},
      body:JSON.stringify({
        systemPrompt:classifyPrompt,
        messages:[{role:'user',content:text}],
        maxTokens:32,
        model:'llama-3.1-8b-instant',
        provider:'groq',
        isContentGen:false
      })
    });
    if (!response.ok) throw new Error('Classification request failed');
    const data = await response.json();
    const raw = (data?.content || '').trim();
    const jsonStr = raw.replace(/^```json?\s*/i,'').replace(/\s*```$/,'');
    const result = JSON.parse(jsonStr);
    switch (result.category) {
      case 'CONTENT_GEN': return { provider:'groq', model:'llama-3.1-8b-instant', tier:2, isContentGen:true, maxTokens:4096 };
      case 'NOTES_REF':   return { provider:'groq', model:'llama-3.1-8b-instant', tier:2, isContentGen:false, maxTokens:2048 };
      case 'ACTION':      return { provider:'groq', model:'llama-3.1-8b-instant', tier:2, isContentGen:false, maxTokens:1024 };
      // CHAT and all other categories also use GPT-OSS so every capability stays available
      default:            return { provider:'groq', model:'llama-3.1-8b-instant', tier:2, isContentGen:false, maxTokens:1024 };
    }
  } catch (e) {
    console.warn('LLM classification failed, using regex fallback:', e);
    return classifyMessageRegex(text);
  }
}

/* ─── Fail-safe: extract action from user message if AI missed ─── */
function inferActionFromMessage(text) {
  const dayMap = {
    'mon':'Monday','tue':'Tuesday','wed':'Wednesday','thu':'Thursday',
    'fri':'Friday','sat':'Saturday','sun':'Sunday',
    'monday':'Monday','tuesday':'Tuesday','wednesday':'Wednesday',
    'thursday':'Thursday','friday':'Friday','saturday':'Saturday','sunday':'Sunday',
    'tmrw':'tomorrow','tmw':'tomorrow','2morrow':'tomorrow','tomorrow':'tomorrow',
    'today':'today','2day':'today'
  };

  let inferredDate = null;
  // Check for "next week" first
  if (/next\s+week/i.test(text)) {
    const d = new Date(); d.setDate(d.getDate() + 7);
    inferredDate = toDateStr(d);
  } else {
    for (const [abbr, full] of Object.entries(dayMap)) {
      if (new RegExp('\\b' + abbr + '\\b', 'i').test(text)) {
        if (full === 'today') {
          inferredDate = today();
        } else if (full === 'tomorrow') {
          const d = new Date(); d.setDate(d.getDate() + 1);
          inferredDate = toDateStr(d);
        } else {
          const dayIndex = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(full);
          const d = new Date(); const current = d.getDay();
          let diff = dayIndex - current;
          if (diff <= 0) diff += 7;
          d.setDate(d.getDate() + diff);
          inferredDate = toDateStr(d);
        }
        break;
      }
    }
  }

  // Classify as event vs task
  const eventWords = /\b(test|exam|quiz|game|match|practice|rehearsal|tryout|meet|tournament|scrimmage|recital|lesson|appointment|meeting|class)\b/i;
  const taskWords = /\b(hw|homework|essay|project|paper|assignment|lab|report|presentation|reading|worksheet|finish|complete|do|write|study)\b/i;

  // ── Check for remove/delete intent FIRST (before add logic) ──
  const removeSignals = /\b(cancel|remove|delete|clear|scratch|drop|ditch|wipe|axe|nix|scrap|erase|purge|yeet|bin|toss|dump|trash|strike|cut|forget|nevermind|never\s*mind)\b/i;
  const removePhrases = /\b(no\s+longer|not\s+happening|called\s+off|scratch\s+that|off\s+the\s+books|take\s+off|cross\s+out|get\s+rid\s+of)\b/i;
  const clearAllSignals = /\b(clear|delete|remove|wipe|reset|nuke)\b[\s\S]{0,24}\b(all|everything)\b|\b(start\s+over|clean\s+slate|wipe\s+it\s+all|clear\s+everything)\b/i;

  if (clearAllSignals.test(text)) {
    return { type:'clear_all' };
  }

  if (removeSignals.test(text) || removePhrases.test(text)) {
    let removeTitle = text.trim()
      .replace(/\b(cancel|remove|delete|clear|scratch|drop|ditch|wipe|axe|nix|scrap|erase|purge|yeet|bin|toss|dump|trash|strike|cut|forget|nevermind|never\s*mind|no\s+longer|not\s+happening|called\s+off|scratch\s+that|off\s+the\s+books|take\s+off|cross\s+out|get\s+rid\s+of|got|it's|isn't|is)\b/gi, ' ')
      .replace(/\b(my|the|a|an|that|this|about|it|from|off|of)\b/gi, ' ')
      .replace(/\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tmrw|tmw|2morrow|tomorrow|today|2day|next\s+week)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    if (removeTitle) removeTitle = removeTitle.charAt(0).toUpperCase() + removeTitle.slice(1);
    if (removeTitle && removeTitle.length >= 2) {
      if (taskWords.test(text)) {
        return { type:'delete_task', title:removeTitle.substring(0,60) };
      }
      return { type:'delete_event', title:removeTitle.substring(0,60) };
    }
  }

  // Try to build a title — strip scheduling noise
  let title = text.trim()
    .replace(/\b(add|create|schedule|put|mark|set\s*up|log|i\s+have|i('ve|\s+got)|got|gotta|need\s*to|have\s*to|hafta|remind\s+me\s+to|remind\s+me\s+about|on|at|by|due|this|next|my|a|an|the|for|to)\b/gi, ' ')
    .replace(/\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tmrw|tmw|2morrow|tomorrow|today|2day|next\s+week)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
  if (!title || title.length < 2) title = 'Untitled';

  // Detect subject abbreviations
  const subjectMap = {
    'calc':'Calculus','math':'Math','bio':'Biology','chem':'Chemistry',
    'phys':'Physics','eng':'English','hist':'History','sci':'Science',
    'span':'Spanish','french':'French','econ':'Economics','psych':'Psychology',
    'gov':'Government','geo':'Geography'
  };
  let subject = '';
  for (const [abbr, full] of Object.entries(subjectMap)) {
    if (new RegExp('\\b' + abbr + '\\b', 'i').test(text)) { subject = full; break; }
  }

  if (eventWords.test(text)) {
    return {
      type:'add_event', title:title.substring(0,60), date:inferredDate||today(),
      event_type:/test|exam|quiz/i.test(text)?'test':/practice|rehearsal|tryout|game|match|meet|tournament|scrimmage/i.test(text)?'practice':'event',
      subject
    };
  }

  if (taskWords.test(text) || /\bdue\b/i.test(text)) {
    return { type:'add_task', title:title.substring(0,60), subject, due:inferredDate||today(), estimated_minutes:30 };
  }

  // If we found a date but can't tell event vs task, default to event
  if (inferredDate) {
    return { type:'add_event', title:title.substring(0,60), date:inferredDate, event_type:'other', subject };
  }

  return null;
}

/* ═══════════════════════════════════════════════
   AUTH SCREEN
   ═══════════════════════════════════════════════ */
function AuthModal({ onAuth, onClose, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);

  useEffect(() => {
    if (rateLimitSeconds <= 0) return;
    const t = setInterval(() => setRateLimitSeconds(s => s <= 1 ? 0 : s - 1), 1000);
    return () => clearInterval(t);
  }, [rateLimitSeconds]);

  function fmtCountdown(s) {
    const m = Math.floor(s / 60);
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  }

  function friendlyAuthError(msg) {
    if (!msg) return 'Something went wrong — please try again.';
    const lower = msg.toLowerCase();
    if ((lower.includes('invalid') && lower.includes('email')) || lower.includes('email address') || lower.includes('not authorized')) {
      return "That email address wasn't accepted. Please try a different address or use Google sign-in.";
    }
    if (lower.includes('rate limit') || lower.includes('security purposes') || lower.includes('too many')) {
      const match = msg.match(/(\d+)\s*second/i);
      const secs = match ? parseInt(match[1], 10) : 300;
      setRateLimitSeconds(secs);
      const mins = Math.ceil(secs / 60);
      return `Too many sign-up attempts — please wait ${mins} minute${mins !== 1 ? 's' : ''} before trying again.`;
    }
    if (lower.includes('already registered') || lower.includes('already in use') || lower.includes('user already')) {
      return 'An account with that email already exists — try signing in instead.';
    }
    if (lower.includes('password') && lower.includes('short')) {
      return 'Password must be at least 6 characters.';
    }
    return msg;
  }

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);
    try {
      const { error: err } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
      if (err) throw err;
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { data, error: err } = await sb.auth.signUp({
          email, password,
          options: { data: { display_name: displayName || 'Student' } }
        });
        if (err) throw err;
        if (data.user) {
          if (data.session) {
            onAuth(data.user);
          } else {
            setError(null);
            setMode('check-email');
          }
        } else {
          // Supabase silently rejects the email (e.g. domain blocklist) without an error object
          setError("We couldn't create an account with that email — please try a different address or use Google sign-in.");
        }
      } else {
        const { data, error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) throw err;
        if (data.user) onAuth(data.user);
      }
    } catch (err) {
      setError(friendlyAuthError(err.message));
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'check-email') {
    return (
      <div className="g-overlay" onClick={onClose}>
        <div className="g-modal" onClick={e=>e.stopPropagation()} style={{textAlign:'center'}}>
          <div style={{marginBottom:8,color:'var(--accent)',display:'flex',justifyContent:'center'}}>{Icon.mail(32)}</div>
          <div style={{fontSize:'1.1rem',fontWeight:700,marginBottom:8}}>Check your email</div>
          <div style={{fontSize:'0.88rem',color:'var(--text-dim)',marginBottom:20,lineHeight:1.5}}>
            We sent a confirmation link to <strong style={{color:'var(--text)'}}>{email}</strong>. Click it, then come back and log in.
          </div>
          <button className="auth-btn auth-btn-primary" onClick={()=>setMode('login')}>
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="g-overlay" onClick={onClose}>
      <div className="g-modal" onClick={e=>e.stopPropagation()} style={{padding:'28px 24px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div>
            <div style={{fontSize:'1.1rem',fontWeight:700}}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</div>
            <div style={{fontSize:'0.8rem',color:'var(--text-dim)',marginTop:2}}>Sign in to save your data across devices</div>
          </div>
          <button className="g-modal-close" onClick={onClose}>{Icon.x(16)}</button>
        </div>

        {error && (
          <div className="auth-error">
            {error}
            {rateLimitSeconds > 0 && (
              <span style={{display:'block',marginTop:4,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>
                Try again in {fmtCountdown(rateLimitSeconds)}
              </span>
            )}
          </div>
        )}

        <button type="button" onClick={handleGoogleSignIn} disabled={loading}
          style={{width:'100%',padding:'12px',borderRadius:10,border:'1px solid var(--border)',background:'var(--bg2)',color:'var(--text)',cursor:loading?'not-allowed':'pointer',fontWeight:600,fontSize:'0.92rem',display:'flex',alignItems:'center',justifyContent:'center',gap:10,transition:'all .15s',marginBottom:12,opacity:loading?0.6:1}}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continue with Google
        </button>

        <div className="auth-divider">or use email</div>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <input className="auth-input" type="text" placeholder="Your name" value={displayName} onChange={e=>setDisplayName(e.target.value)} autoComplete="name"/>
          )}
          <input className="auth-input" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/>
          <input className="auth-input" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} autoComplete={mode==='login'?'current-password':'new-password'}/>

          <button className="auth-btn auth-btn-primary" type="submit" disabled={loading || rateLimitSeconds > 0}>
            {loading ? 'Loading...' : rateLimitSeconds > 0 ? `Wait ${fmtCountdown(rateLimitSeconds)}` : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <button type="button" style={{width:'100%',background:'transparent',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:'0.84rem',padding:'8px 0',marginTop:4}}
          onClick={()=>{setMode(mode==='login'?'signup':'login');setError(null);}}>
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   CONFIRMATION CARD
   ═══════════════════════════════════════════════ */
function ConfirmationCard({ action, onConfirm, onCancel, isFallback, editableId, editableFields, onPatch }) {
  const [editing, setEditing] = useState(!!isFallback);
  const { draft: editData, editingField, isEditable, startEditing, patchField, stopEditing } = useEditableField({
    editableId,
    editableFields,
    onPatch,
    sourceData: action,
  });

  // P1.3: field type map for inline editing
  const fieldTypes = { due:'date', date:'date', estimated_minutes:'number', start:'time', end:'time' };

  function getCardInfo() {
    switch (action.type) {
      case 'add_task': return { icon:Icon.clipboard(16), label:'New Task', badge:'task', badgeColor:'var(--accent)', borderColor:'var(--accent)', bgTint:'rgba(108,99,255,0.03)', fields: [
        { key:'title', label:'Title', value:action.title, editable:true }, { key:'subject', label:'Class', value:action.subject||'—', editable:true },
        { key:'due', label:'Due', value:action.due?fmt(action.due):'No date', editable:true }, { key:'estimated_minutes', label:'Time', value:(action.estimated_minutes||30)+' min', editable:true }
      ]};
      case 'add_event': return { icon:Icon.calendar(16), label:'New Event', badge:'event', badgeColor:'var(--teal)', borderColor:'var(--teal)', bgTint:'rgba(43,203,186,0.03)', fields: [
        { key:'title', label:'Event', value:action.title, editable:true }, { key:'date', label:'Date', value:action.date?fmt(action.date):'No date', editable:true },
        { key:'event_type', label:'Type', value:action.event_type||'other', editable:true }, { key:'subject', label:'Class', value:action.subject||'—', editable:true },
        ...(action.startTime ? [{ key:'startTime', label:'Start', value:action.startTime }] : []),
        ...(action.endTime ? [{ key:'endTime', label:'End', value:action.endTime }] : [])
      ]};
      case 'add_block': return { icon:Icon.calendarClock(16), label:'Schedule Block', badge:'block', badgeColor:'var(--blue)', borderColor:'var(--blue)', bgTint:'rgba(69,170,242,0.03)', fields: [
        { key:'activity', label:'Activity', value:action.activity, editable:true }, { key:'date', label:'Date', value:action.date?fmt(action.date):'Today', editable:true },
        { key:'time', label:'Time', value:(action.start||'?')+' — '+(action.end||'?') }, { key:'category', label:'Type', value:action.category||'school' }
      ]};
      case 'complete_task': return { icon:Icon.checkCircle(16), label:'Complete Task', badge:'done', badgeColor:'var(--success)', borderColor:'var(--success)', fields: [{ key:'task_id', label:'Task', value:action.task_id }] };
      case 'break_task': return { icon:Icon.scissors(16), label:'Break Into Parts', badge:'split', badgeColor:'var(--orange)', borderColor:'var(--orange)', fields: [
        { key:'parent_title', label:'Project', value:action.parent_title }, { key:'subtasks', label:'Parts', value:(action.subtasks||[]).length+' sub-tasks' }
      ]};
      case 'delete_task': return { icon:Icon.trash(16), label:'Delete Task', badge:'remove', badgeColor:'var(--danger)', borderColor:'var(--danger)', fields: [
        { key:'title', label:'Task', value:action.title||action.task_id||'Unknown' }
      ]};
      case 'delete_event': return { icon:Icon.trash(16), label:'Delete Event', badge:'remove', badgeColor:'var(--danger)', borderColor:'var(--danger)', fields: [
        { key:'title', label:'Event', value:action.title||action.event_id||'Unknown' }
      ]};
      case 'update_event': return { icon:Icon.calendar(16), label:'Update Event', badge:'update', badgeColor:'var(--blue)', borderColor:'var(--blue)', fields: [
        { key:'title', label:'Event', value:action.new_title||action.title||'(unchanged)', editable:true }, { key:'date', label:'Date', value:action.date?fmt(action.date):'(unchanged)', editable:true },
        { key:'event_type', label:'Type', value:action.event_type||'(unchanged)' }
      ]};
      case 'delete_block': return { icon:Icon.trash(16), label:'Remove Block', badge:'remove', badgeColor:'var(--danger)', borderColor:'var(--danger)', fields: [
        { key:'date', label:'Date', value:action.date?fmt(action.date):'?' }, { key:'time', label:'Time', value:(action.start||'?')+' — '+(action.end||'?') }
      ]};
      case 'convert_event_to_block': return { icon:Icon.calendarClock(16), label:'Convert Event to Block', badge:'convert', badgeColor:'var(--blue)', borderColor:'var(--blue)', bgTint:'rgba(69,170,242,0.03)', fields: [
        { key:'title', label:'Event', value:action.title||action.event_id||'Unknown', editable:true },
        { key:'date', label:'Date', value:action.date?fmt(action.date):'?', editable:true },
        { key:'time', label:'Time', value:(action.start||'?')+' — '+(action.end||'?') },
        { key:'category', label:'Category', value:action.category||'school' }
      ]};
      case 'convert_block_to_event': return { icon:Icon.calendar(16), label:'Convert Block to Event', badge:'convert', badgeColor:'var(--teal)', borderColor:'var(--teal)', bgTint:'rgba(43,203,186,0.03)', fields: [
        { key:'title', label:'Event', value:action.title||'Event', editable:true },
        { key:'date', label:'Date', value:action.date?fmt(action.date):'?', editable:true },
        { key:'time', label:'Time', value:(action.start||'?')+' — '+(action.end||'(auto)') },
        { key:'event_type', label:'Type', value:action.event_type||'event' },
        { key:'subject', label:'Class', value:action.subject||'—' }
      ]};
      case 'clear_all': return { icon:Icon.alertTriangle(16), label:'Clear Everything', badge:'danger', badgeColor:'var(--danger)', borderColor:'var(--danger)', fields: [
        { key:'scope', label:'Scope', value:'Tasks, events, and schedule blocks will be removed.' }
      ]};
      default: return { icon:Icon.zap(16), label:'Action', badge:'action', badgeColor:'var(--accent)', borderColor:'var(--accent)', fields: Object.entries(action).filter(([k])=>k!=='type').map(([k,v])=>({key:k,label:k,value:String(v)})) };
    }
  }
  const info = getCardInfo();
  const isDanger = ['delete_task','delete_event','delete_block','clear_all'].includes(action.type);
  const hasEdits = Object.keys(editData).some(k => k !== 'type' && editData[k] !== action[k]);

  return (
    <EditableSurface
      className="confirm-card"
      style={{borderLeftColor:info.borderColor,background:info.bgTint?`linear-gradient(160deg,${info.bgTint},rgba(15,15,30,0.92))`:''}}
      editableId={editableId}
      editableFields={editableFields}
      onPatch={onPatch}
    >
      {isFallback && (
        <div style={{fontSize:'0.75rem',color:'var(--warning)',padding:'8px 16px',background:'rgba(255,165,2,0.05)',borderBottom:'1px solid rgba(255,165,2,0.1)',display:'flex',alignItems:'center',gap:6}}>
          {Icon.helpCircle(14)} I think you want to add this — check the details?
        </div>
      )}
      <div className="confirm-card-hdr">
        <div className="confirm-card-hdr-left">
          <div className="confirm-card-hdr-icon" style={{background:`color-mix(in srgb, ${info.badgeColor} 10%, transparent)`,borderColor:`color-mix(in srgb, ${info.badgeColor} 20%, transparent)`,color:info.badgeColor}}>{info.icon}</div>
          <span className="confirm-card-hdr-title">{info.label}</span>
        </div>
        <span className="confirm-card-hdr-badge" style={{background:`color-mix(in srgb, ${info.badgeColor} 10%, transparent)`,color:info.badgeColor,border:`1px solid color-mix(in srgb, ${info.badgeColor} 20%, transparent)`,fontSize:'0.68rem',padding:'3px 10px'}}>{info.badge}</span>
      </div>
      <div className="confirm-card-body">
      {!editing ? info.fields.map(f => (
        <div key={f.key} className="confirm-card-field"
          onClick={f.editable && isEditable(f.key) ? () => startEditing(f.key) : undefined}
          style={f.editable && isEditable(f.key) ? {cursor:'pointer'} : {}}>
          <span className="confirm-card-label">{f.label}</span>
          {editingField === f.key ? (
            <input className="confirm-edit-input" type={fieldTypes[f.key]||'text'}
              value={editData[f.key]??action[f.key]??''} autoFocus
              min={f.key==='estimated_minutes'?'5':undefined} step={f.key==='estimated_minutes'?'5':undefined}
              onChange={e=>patchField(f.key, fieldTypes[f.key]==='number'?Number(e.target.value):e.target.value)}
              onBlur={stopEditing}
              onKeyDown={e=>{if(e.key==='Enter')stopEditing();}}
              style={{flex:1,maxWidth:160}}/>
          ) : (
            <span className="confirm-card-value" style={f.editable && isEditable(f.key)?{borderBottom:'1px dashed rgba(108,99,255,0.3)'}:{}}>
              {editData[f.key] && editData[f.key] !== action[f.key]
                ? (fieldTypes[f.key]==='date'?fmt(editData[f.key]):fieldTypes[f.key]==='number'?editData[f.key]+' min':editData[f.key])
                : f.value}
              {f.editable && isEditable(f.key) && <span style={{marginLeft:4,opacity:0.4,display:'inline-flex'}}>{Icon.edit(10)}</span>}
            </span>
          )}
        </div>
      )) : (
        <div>
          {(action.type === 'add_task') && <>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Title</span><input className="confirm-edit-input" value={editData.title||''} onChange={e=>patchField('title',e.target.value)}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Due</span><input className="confirm-edit-input" type="date" value={editData.due||''} onChange={e=>patchField('due',e.target.value)}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Mins</span><input className="confirm-edit-input" type="number" min="5" step="5" value={editData.estimated_minutes||30} onChange={e=>patchField('estimated_minutes',Number(e.target.value))}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Class</span><input className="confirm-edit-input" value={editData.subject||''} onChange={e=>patchField('subject',e.target.value)} placeholder="e.g. Math"/></div>
          </>}
          {(action.type === 'add_event') && <>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Title</span><input className="confirm-edit-input" value={editData.title||''} onChange={e=>patchField('title',e.target.value)}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Date</span><input className="confirm-edit-input" type="date" value={editData.date||''} onChange={e=>patchField('date',e.target.value)}/></div>
          </>}
          {(action.type === 'add_block') && <>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>What</span><input className="confirm-edit-input" value={editData.activity||''} onChange={e=>patchField('activity',e.target.value)}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Date</span><input className="confirm-edit-input" type="date" value={editData.date||''} onChange={e=>patchField('date',e.target.value)}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Start</span><input className="confirm-edit-input" type="time" value={editData.start||''} onChange={e=>patchField('start',e.target.value)}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>End</span><input className="confirm-edit-input" type="time" value={editData.end||''} onChange={e=>patchField('end',e.target.value)}/></div>
          </>}
        </div>
      )}
      </div>
      <div className="confirm-card-actions">
        <button className="confirm-btn confirm-btn-yes" onClick={() => { (editing || hasEdits) ? onConfirm({...action,...editData}) : onConfirm(action); }}>
          {(editing || hasEdits) ? Icon.check(14) : isDanger ? Icon.trash(14) : Icon.check(14)} {(editing || hasEdits) ? 'Save' : isDanger ? 'Confirm' : 'Approve'}
        </button>
        {!editing && action.type !== 'complete_task' && <button className="confirm-btn confirm-btn-edit" onClick={() => setEditing(true)}>{Icon.edit(14)} Edit</button>}
        <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>{Icon.x(14)} Dismiss</button>
      </div>
    </EditableSurface>
  );
}

/* ═══════════════════════════════════════════════
   BULK CONFIRMATION CARD
   ═══════════════════════════════════════════════ */
function BulkConfirmationCard({ actions, onConfirmSelected, onCancel }) {
  const [checked, setChecked] = useState(actions.map(() => true));
  const [selectAll, setSelectAll] = useState(true);

  useEffect(() => { setChecked(actions.map(() => true)); setSelectAll(true); }, [actions.length]);

  function toggleItem(idx) { setChecked(prev => { const n=[...prev]; n[idx]=!n[idx]; return n; }); }
  function toggleAll() { const v=!selectAll; setSelectAll(v); setChecked(actions.map(()=>v)); }

  function getActionLabel(a) {
    const labels = { add_task:'Task', add_event:'Event', add_block:'Block', delete_task:'Delete Task', delete_event:'Delete Event', update_event:'Update', break_task:'Split', delete_block:'Remove Block', convert_event_to_block:'Convert Event → Block', convert_block_to_event:'Convert Block → Event', add_recurring_event:'Recurring', clear_all:'Clear Everything' };
    return (labels[a.type]||'Action')+': '+(a.title||a.activity||a.parent_title||'Untitled');
  }
  function getBadgeColor(a) {
    if (a.type?.startsWith('delete')) return 'var(--danger)';
    if (a.type==='add_event'||a.type==='add_recurring_event') return 'var(--teal)';
    if (a.type==='add_block') return 'var(--blue)';
    return 'var(--accent)';
  }

  const selectedCount = checked.filter(Boolean).length;

  return (
    <div className="confirm-card" style={{maxWidth:420,borderLeftColor:'var(--accent)'}}>
      <div className="confirm-card-hdr">
        <div className="confirm-card-hdr-left">
          <div className="confirm-card-hdr-icon" style={{background:'rgba(108,99,255,0.1)',borderColor:'rgba(108,99,255,0.2)',color:'var(--accent)'}}>{Icon.layers(16)}</div>
          <span className="confirm-card-hdr-title">Bulk Add</span>
        </div>
        <span className="confirm-card-hdr-badge" style={{background:'rgba(108,99,255,0.1)',color:'var(--accent)',border:'1px solid rgba(108,99,255,0.2)'}}>{actions.length} items</span>
      </div>
      <div className="confirm-card-body" style={{maxHeight:250,overflowY:'auto'}}>
        <label style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',cursor:'pointer',fontWeight:600,fontSize:'0.82rem',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
          <input type="checkbox" checked={selectAll} onChange={toggleAll}/> Select All ({actions.length})
        </label>
        {actions.map((pa,idx)=>(
          <label key={idx} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',cursor:'pointer',fontSize:'0.82rem',borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
            <input type="checkbox" checked={checked[idx]} onChange={()=>toggleItem(idx)}/>
            <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:getBadgeColor(pa.action),flexShrink:0}}/>
            <span style={{flex:1}}>
              {getActionLabel(pa.action)}
              {pa.action.date&&<span style={{color:'var(--text-dim)',fontSize:'0.75rem',marginLeft:6}}>{fmt(pa.action.date)}</span>}
              {pa.action.due&&<span style={{color:'var(--text-dim)',fontSize:'0.75rem',marginLeft:6}}>due {fmt(pa.action.due)}</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="confirm-card-actions">
        <button className="confirm-btn confirm-btn-yes" onClick={()=>onConfirmSelected(checked)} disabled={selectedCount===0}>
          {Icon.check(14)} Approve {selectedCount}
        </button>
        <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>{Icon.x(14)} Dismiss All</button>
      </div>
    </div>
  );
}

function ClarificationCard({ clarification, onSubmit, onSkip, savedAnswers, onAnswersChange }) {
  // Support both single clarification and array of clarifications
  const clarifications = Array.isArray(clarification) ? clarification : [clarification];
  const questionCount = clarifications.length;

  // Which question is currently displayed
  const [currentQIdx, setCurrentQIdx] = useState(0);

  // Per-question state: selected options and free-form text
  // Initialize from savedAnswers if available (preserves state across panel navigation)
  const [answers, setAnswers] = useState(() =>
    savedAnswers && savedAnswers.length === clarifications.length
      ? savedAnswers
      : clarifications.map(() => ({ selected: [], otherText: '' }))
  );

  // Stable string key based on question content — immune to object re-references.
  // Only changes when the AI sends genuinely different questions.
  const clarificationKey = clarifications.map(c => c.question).join('|||');

  useEffect(() => {
    if (!savedAnswers || savedAnswers.length !== clarifications.length) {
      setAnswers(clarifications.map(() => ({ selected: [], otherText: '' })));
    }
    setCurrentQIdx(0);
  }, [clarificationKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function normalizeOption(option, idx) {
    if (typeof option === 'string') return { id: 'opt_' + idx, label: option };
    return {
      id: option?.id || 'opt_' + idx,
      label: option?.label || option?.text || option?.value || ('Option ' + (idx + 1)),
      description: option?.description || '',
      allowOther: !!option?.allowOther,
      metadata: option?.metadata,
    };
  }

  function updateAnswer(qIdx, updater) {
    setAnswers(prev => {
      const next = [...prev];
      next[qIdx] = updater(next[qIdx]);
      if (onAnswersChange) onAnswersChange(next);
      return next;
    });
  }

  function toggleOption(qIdx, optId, multiSelect) {
    updateAnswer(qIdx, cur => {
      if (!multiSelect) return { ...cur, selected: [optId] };
      return {
        ...cur,
        selected: cur.selected.includes(optId)
          ? cur.selected.filter(v => v !== optId)
          : [...cur.selected, optId],
      };
    });
  }

  function setOtherText(qIdx, text) {
    updateAnswer(qIdx, cur => ({ ...cur, otherText: text }));
  }

  function buildPayloads(answersArr) {
    return clarifications.map((c, i) => {
      const opts = Array.isArray(c?.options) ? c.options.map(normalizeOption) : [];
      return {
        selected: answersArr[i].selected,
        options: opts,
        otherText: answersArr[i].otherText,
        question: c?.question || '',
      };
    });
  }

  function handleSubmit() {
    onSubmit(buildPayloads(answers));
  }

  function advance(updatedAnswers) {
    const ans = updatedAnswers || answers;
    if (currentQIdx < questionCount - 1) {
      setCurrentQIdx(i => i + 1);
    } else {
      onSubmit(buildPayloads(ans));
    }
  }

  function handleOptionClick(optId, multiSelect) {
    let nextAnswers;
    setAnswers(prev => {
      const next = [...prev];
      const cur = { ...next[currentQIdx] };
      if (!multiSelect) {
        cur.selected = [optId];
      } else {
        cur.selected = cur.selected.includes(optId)
          ? cur.selected.filter(v => v !== optId)
          : [...cur.selected, optId];
      }
      next[currentQIdx] = cur;
      nextAnswers = next;
      if (onAnswersChange) onAnswersChange(next);
      return next;
    });
    // Auto-advance for single-select after brief highlight
    if (!multiSelect) {
      setTimeout(() => advance(nextAnswers), 160);
    }
  }

  function handleSkipQuestion() {
    if (currentQIdx < questionCount - 1) {
      setCurrentQIdx(i => i + 1);
    } else {
      // Last question — submit with whatever we have (skipped = empty)
      onSubmit(buildPayloads(answers));
    }
  }

  function handleClose() {
    if (onSkip) onSkip();
    else onSubmit(buildPayloads(answers));
  }

  const c = clarifications[currentQIdx] || {};
  const options = Array.isArray(c?.options) ? c.options : [];
  const multiSelect = !!c?.multiSelect || !!c?.multi_select;
  const normalizedOptions = options.map(normalizeOption).filter(
    opt => !/^(other|something else|other\.\.\.|\.\.\.)$/i.test(opt.label.trim())
  );
  const answer = answers[currentQIdx] || { selected: [], otherText: '' };
  const currentAnswered = answer.selected.length > 0 || !!answer.otherText.trim();

  return (
    <div style={{
      background:'rgba(22,22,36,0.98)',
      border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:18,
      padding:0,
      maxWidth:440,
      width:'100%',
      boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
      overflow:'hidden',
    }}>
      {/* Header: question title + nav + close */}
      <div style={{
        padding:'20px 20px 16px',
        display:'flex',
        alignItems:'flex-start',
        gap:12,
      }}>
        {/* Question text */}
        <div style={{
          flex:1,
          fontSize:'1.05rem',
          fontWeight:700,
          color:'var(--text)',
          lineHeight:1.4,
          letterSpacing:'-0.2px',
        }}>
          {c?.question || 'Can you clarify?'}
        </div>
        {/* Nav + close */}
        <div style={{display:'flex', alignItems:'center', gap:4, flexShrink:0, marginTop:2}}>
          {questionCount > 1 && (
            <>
              <button
                onClick={() => setCurrentQIdx(i => Math.max(0, i - 1))}
                disabled={currentQIdx === 0}
                style={{
                  background:'none', border:'none', cursor: currentQIdx === 0 ? 'default' : 'pointer',
                  color: currentQIdx === 0 ? 'rgba(255,255,255,0.2)' : 'var(--text-dim)',
                  padding:'2px 4px', fontSize:'1rem', lineHeight:1,
                }}
              >‹</button>
              <span style={{fontSize:'0.78rem', color:'var(--text-dim)', whiteSpace:'nowrap', padding:'0 2px'}}>
                {currentQIdx + 1} of {questionCount}
              </span>
              <button
                onClick={() => advance()}
                disabled={currentQIdx === questionCount - 1 && !currentAnswered}
                style={{
                  background:'none', border:'none',
                  cursor:(currentQIdx === questionCount - 1 && !currentAnswered) ? 'default' : 'pointer',
                  color:(currentQIdx === questionCount - 1 && !currentAnswered) ? 'rgba(255,255,255,0.2)' : 'var(--text-dim)',
                  padding:'2px 4px', fontSize:'1rem', lineHeight:1,
                }}
              >›</button>
            </>
          )}
          <button
            onClick={handleClose}
            style={{
              background:'none', border:'none', cursor:'pointer',
              color:'var(--text-dim)', padding:'2px 6px', fontSize:'1.1rem', lineHeight:1,
              marginLeft:4,
            }}
          >×</button>
        </div>
      </div>

      {/* Options */}
      {normalizedOptions.length > 0 && (
        <div style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          {normalizedOptions.map((opt, i) => {
            const isSelected = answer.selected.includes(opt.id);
            return (
              <div
                key={opt.id}
                onClick={() => handleOptionClick(opt.id, multiSelect)}
                style={{
                  display:'flex', alignItems:'center', gap:14,
                  padding:'14px 20px',
                  borderBottom:'1px solid rgba(255,255,255,0.05)',
                  cursor:'pointer',
                  background: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                  transition:'background .12s',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background='rgba(255,255,255,0.03)'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background='transparent'; }}
              >
                {/* Number badge */}
                <div style={{
                  width:32, height:32, borderRadius:8, flexShrink:0,
                  background: isSelected ? 'rgba(43,203,186,0.2)' : 'rgba(255,255,255,0.07)',
                  border: isSelected ? '1px solid rgba(43,203,186,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:'0.82rem', fontWeight:700,
                  color: isSelected ? 'var(--teal)' : 'var(--text-dim)',
                  transition:'all .12s',
                }}>
                  {i + 1}
                </div>
                {/* Label */}
                <div style={{flex:1}}>
                  <div style={{fontSize:'0.88rem', color:'var(--text)', fontWeight:500, lineHeight:1.4}}>{opt.label}</div>
                  {opt.description && (
                    <div style={{fontSize:'0.74rem', color:'var(--text-dim)', marginTop:2, lineHeight:1.4}}>{opt.description}</div>
                  )}
                </div>
                {/* Chevron when selected */}
                {isSelected && (
                  <div style={{color:'var(--teal)', fontSize:'1rem', flexShrink:0}}>›</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: text input + Skip */}
      <div style={{
        display:'flex', alignItems:'center', gap:10,
        padding:'10px 16px 12px',
        borderTop: normalizedOptions.length > 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Pencil icon */}
        <div style={{color:'var(--text-dim)', flexShrink:0, opacity:0.6, display:'flex', alignItems:'center'}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </div>
        <input
          type="text"
          value={answer.otherText}
          onChange={(e) => setOtherText(currentQIdx, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && currentAnswered) advance(); }}
          placeholder={c?.otherPlaceholder || 'Something else…'}
          style={{
            flex:1,
            background:'transparent',
            border:'none',
            color:'var(--text-dim)',
            fontSize:'0.84rem',
            outline:'none',
            padding:'4px 0',
          }}
        />
        {/* Skip button */}
        <button
          onClick={handleSkipQuestion}
          style={{
            background:'rgba(255,255,255,0.07)',
            border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:8,
            padding:'6px 14px',
            color:'var(--text-dim)',
            fontSize:'0.82rem',
            fontWeight:600,
            cursor:'pointer',
            flexShrink:0,
            transition:'all .12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background='rgba(255,255,255,0.12)'; e.currentTarget.style.color='var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.07)'; e.currentTarget.style.color='var(--text-dim)'; }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   RECURRING EVENT POPUP
   ═══════════════════════════════════════════════ */
function RecurringEventPopup({ action, onConfirm, onCancel }) {
  const [generatedEvents, setGeneratedEvents] = useState([]);
  const [selAll, setSelAll] = useState(true);

  useEffect(() => {
    const dayNameToIndex = { Sunday:0,Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6 };
    const dayIndices = (action.days||[]).map(d=>dayNameToIndex[d]).filter(d=>d!==undefined);
    const start = new Date(action.start_date || today());
    const endDefault = new Date(); endDefault.setMonth(endDefault.getMonth()+3);
    const end = new Date(action.end_date || toDateStr(endDefault));
    const generated = [];
    const cursor = new Date(start);
    while (cursor <= end && generated.length < 100) {
      if (dayIndices.includes(cursor.getDay())) {
        const ds = toDateStr(cursor);
        generated.push({ id:Math.random().toString(36).slice(2), title:action.title||'Event', date:ds, event_type:action.event_type||'event', subject:action.subject||'', checked:true });
      }
      cursor.setDate(cursor.getDate()+1);
    }
    setGeneratedEvents(generated);
  }, [action]);

  function toggleEv(idx) { setGeneratedEvents(prev=>prev.map((ev,i)=>i===idx?{...ev,checked:!ev.checked}:ev)); }
  function toggleAllEv() { const v=!selAll; setSelAll(v); setGeneratedEvents(prev=>prev.map(ev=>({...ev,checked:v}))); }
  const checkedCount = generatedEvents.filter(e=>e.checked).length;

  return (
    <div className="confirm-card" style={{maxWidth:420,borderLeftColor:'var(--teal)'}}>
      <div className="confirm-card-hdr">
        <div className="confirm-card-hdr-left">
          <div className="confirm-card-hdr-icon" style={{background:'rgba(43,203,186,0.1)',borderColor:'rgba(43,203,186,0.2)',color:'var(--teal)'}}>{Icon.calendar(16)}</div>
          <span className="confirm-card-hdr-title">Recurring: {action.title}</span>
        </div>
        <span className="confirm-card-hdr-badge" style={{background:'rgba(43,203,186,0.1)',color:'var(--teal)',border:'1px solid rgba(43,203,186,0.2)'}}>{checkedCount} events</span>
      </div>
      <div className="confirm-card-body" style={{maxHeight:200,overflowY:'auto'}}>
        <label style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',cursor:'pointer',fontWeight:600,fontSize:'0.82rem',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
          <input type="checkbox" checked={selAll} onChange={toggleAllEv}/> Select All ({generatedEvents.length})
        </label>
        {generatedEvents.map((ev,idx)=>(
          <label key={ev.id} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',cursor:'pointer',fontSize:'0.82rem'}}>
            <input type="checkbox" checked={ev.checked} onChange={()=>toggleEv(idx)}/>
            <span>{ev.title} — {fmt(ev.date)} ({new Date(ev.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'})})</span>
          </label>
        ))}
      </div>
      <div className="confirm-card-actions">
        <button className="confirm-btn confirm-btn-yes" onClick={()=>onConfirm(generatedEvents.filter(e=>e.checked))} disabled={checkedCount===0}>
          {Icon.check(14)} Add {checkedCount} Events
        </button>
        <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>{Icon.x(14)} Cancel</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   CONTENT DISPLAY COMPONENTS
   ═══════════════════════════════════════════════ */
function ContentCard({ icon, title, subject, onSave, onDismiss, children, accentColor }) {
  const ac = accentColor || 'var(--teal)';
  return (
    <div className="content-card" style={{borderLeftColor:ac}}>
      <div className="content-card-header">
        <div className="content-card-hdr-icon" style={{background:`color-mix(in srgb, ${ac} 10%, transparent)`,borderColor:`color-mix(in srgb, ${ac} 20%, transparent)`,color:ac}}>{icon}</div>
        <div>
          <div className="content-card-title">{title}</div>
          {subject && <div className="content-card-subject">{subject}</div>}
        </div>
      </div>
      <div className="content-card-body">{children}</div>
      <div className="content-card-actions">
        <button className="content-card-save" style={{background:`linear-gradient(135deg, ${ac}, color-mix(in srgb, ${ac} 70%, #000))`,boxShadow:`0 2px 12px color-mix(in srgb, ${ac} 25%, transparent)`}} onClick={onSave}>{Icon.fileText(14)} Save to Notes</button>
        <button className="content-card-dismiss" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function PerfPill() {
  const [tier, setTier] = useState(() => getPerfTier());
  useEffect(() => {
    function onTier(e) { setTier(e.detail.tier); }
    window.addEventListener('sos:perf-tier', onTier);
    return () => window.removeEventListener('sos:perf-tier', onTier);
  }, []);
  const labels = { full: 'Full', mid: 'Mid', low: 'Lite' };
  const cycle = () => {
    const tiers = ['full', 'mid', 'low'];
    const next = tiers[(tiers.indexOf(tier) + 1) % 3];
    setPerfOverride(next);
    setTier(next);
  };
  const pillClass = 'perf-pill' + (tier === 'full' ? ' tier-full' : tier === 'mid' ? ' tier-mid' : '');
  return (
    <button className={pillClass} onClick={cycle} title={`Performance: ${labels[tier]}. Click to cycle.`}>
      {tier === 'full' ? '✦' : tier === 'mid' ? '⚡' : '⚡'} {labels[tier]}
    </button>
  );
}

function TutorIndicator({ active }) {
  return (
    <div className={'tutor-indicator' + (active ? ' active' : '')} title={active ? 'Tutor mode is ON' : 'Tutor mode is OFF'}>
      ✦ Tutor {active ? 'ON' : 'OFF'}
    </div>
  );
}

function TutorMissionPage({ tutorMode, tasks, events, notes, onBack, onToggleTutorMode, onPrompt, onOpenNotes, onOpenSchedule, onOpenSettings }) {
  const activeTasks = tasks.filter(t => t.status !== 'done');
  const overdueTasks = activeTasks.filter(t => daysUntil(t.dueDate) < 0);
  const dueSoon = activeTasks.filter(t => { const d = daysUntil(t.dueDate); return d >= 0 && d <= 3; });
  const upcomingEvents = events.filter(e => { const d = daysUntil(e.date); return d >= 0 && d <= 7; });
  const hasNotes = notes.length > 0;
  const primaryFocus = overdueTasks[0] || dueSoon[0] || activeTasks[0] || null;
  const prompts = [
    { label: 'Teach me from my notes', msg: hasNotes ? `Teach me the most important ideas from my notes and quiz me one question at a time.` : 'Help me study a topic step by step and quiz me one question at a time.' },
    { label: 'Build a study sprint', msg: 'Plan a focused 45-minute study sprint for my highest-priority work.' },
    { label: 'Explain this simply', msg: 'Explain this like I am learning it for the first time, then check my understanding with one question.' },
    { label: 'Make flashcards', msg: hasNotes ? 'Make flashcards from my notes for the topic I need most right now.' : 'Make me flashcards for the topic I need to study.' },
  ];
  const integrations = [
    { title: 'Notes-aware tutoring', description: hasNotes ? `Pulls from ${notes.length} saved note${notes.length === 1 ? '' : 's'} so explanations can cite your actual material.` : 'Import notes or PDFs and tutor mode will teach from them instead of starting from scratch.', action: onOpenNotes, cta: hasNotes ? 'Open notes' : 'Add notes', icon: Icon.fileText(16) },
    { title: 'Schedule-aware coaching', description: primaryFocus ? `Your next likely focus is ${primaryFocus.title}${primaryFocus.subject ? ` in ${primaryFocus.subject}` : ''}. Tutor mode can turn that into a plan without losing track of due dates.` : 'Tutor mode can turn explanations into realistic study blocks that fit around your calendar.', action: onOpenSchedule, cta: 'Open schedule', icon: Icon.calendarClock(16) },
    { title: 'One-click study actions', description: 'Jump from tutoring into flashcards, quizzes, plans, and task support without leaving the workspace.', action: onPrompt, cta: 'Start guided help', icon: Icon.sparkles(16), prompt: 'Help me study step by step using tutor mode.' },
  ];

  return (
    <div className="tutor-page">
      <section className="tutor-hero">
        <div className="tutor-hero-copy">
          <div className="tutor-eyebrow">Dedicated tutor workspace</div>
          <h1>Make tutor mode feel like its own page.</h1>
          <p>Tutor mode now has a home base for guided explanations, note-aware studying, and schedule-aware next steps. Turn it on when you want SOS to teach, coach, and keep you moving.</p>
          <div className="tutor-hero-actions">
            <button className="tutor-primary-btn" onClick={() => onToggleTutorMode(!tutorMode)}>{tutorMode ? 'Tutor mode on' : 'Turn tutor mode on'}</button>
            <button className="tutor-secondary-btn" onClick={() => onPrompt(prompts[0].msg)}>Try a guided session</button>
            <button className="tutor-secondary-btn" onClick={onBack}>Back to chat</button>
          </div>
        </div>
        <div className="tutor-hero-card">
          <div className="tutor-hero-card-top">
            <TutorIndicator active={tutorMode} />
            <span>{hasNotes ? 'Notes connected' : 'Bring in notes for better tutoring'}</span>
          </div>
          <div className="tutor-focus-label">Current mission</div>
          <div className="tutor-focus-title">{primaryFocus ? primaryFocus.title : 'Get clear on what to study next'}</div>
          <div className="tutor-focus-meta">
            {primaryFocus
              ? `${primaryFocus.subject || 'General study'} • due ${fmt(primaryFocus.dueDate)}`
              : `${upcomingEvents.length} event${upcomingEvents.length === 1 ? '' : 's'} this week • ${notes.length} note${notes.length === 1 ? '' : 's'} ready`}
          </div>
          <div className="tutor-hero-checklist">
            <div>{tutorMode ? '✓ Guided teaching voice is active' : '• Guided teaching voice is waiting for you to turn it on'}</div>
            <div>{hasNotes ? '✓ Can cite your notes while explaining' : '• Add notes to unlock note-grounded explanations'}</div>
            <div>✓ Can turn help into plans, blocks, flashcards, and quizzes</div>
          </div>
        </div>
      </section>

      <section className="tutor-stats">
        <div className="tutor-stat-card"><span>Active tasks</span><strong>{activeTasks.length}</strong><small>{overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : 'Nothing overdue right now'}</small></div>
        <div className="tutor-stat-card"><span>Due soon</span><strong>{dueSoon.length}</strong><small>Tasks due in the next 3 days</small></div>
        <div className="tutor-stat-card"><span>Study sources</span><strong>{notes.length}</strong><small>{hasNotes ? 'Notes + docs available for reference' : 'Import PDFs or docs to ground answers'}</small></div>
        <div className="tutor-stat-card"><span>This week</span><strong>{upcomingEvents.length}</strong><small>Upcoming events tutor mode can plan around</small></div>
      </section>

      <section className="tutor-section">
        <div className="tutor-section-head">
          <div>
            <div className="tutor-section-eyebrow">Start here</div>
            <h2>Quick tutor workflows</h2>
          </div>
          <button className="tutor-text-btn" onClick={() => onPrompt('Help me study step by step using tutor mode and my current workload.')}>Open in chat</button>
        </div>
        <div className="tutor-prompt-grid">
          {prompts.map(prompt => (
            <button key={prompt.label} className="tutor-prompt-card" onClick={() => onPrompt(prompt.msg)}>
              <div className="tutor-prompt-icon">{Icon.sparkles(15)}</div>
              <div>
                <div className="tutor-prompt-title">{prompt.label}</div>
                <div className="tutor-prompt-copy">{prompt.msg}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="tutor-section">
        <div className="tutor-section-head">
          <div>
            <div className="tutor-section-eyebrow">Integration upgrades</div>
            <h2>Tutor mode is connected to the rest of SOS</h2>
          </div>
          <button className="tutor-text-btn" onClick={onOpenSettings}>Tune settings</button>
        </div>
        <div className="tutor-integration-grid">
          {integrations.map(item => (
            <div key={item.title} className="tutor-integration-card">
              <div className="tutor-integration-icon">{item.icon}</div>
              <div className="tutor-integration-title">{item.title}</div>
              <p>{item.description}</p>
              <button className="tutor-secondary-btn" onClick={() => item.prompt ? item.action(item.prompt) : item.action()}>{item.cta}</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FlashcardDisplay({ data, onSave, onDismiss }) {
  const cards = data.cards || [];
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (cards.length === 0) return <ContentCard icon={Icon.layers(16)} title={data.title||'Flashcards'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)"><div style={{color:'var(--text-dim)',fontSize:'0.85rem'}}>No cards generated.</div></ContentCard>;

  function goNext() { if (idx < cards.length - 1) { setFlipped(false); setTimeout(() => setIdx(i => i + 1), 100); } }
  function goPrev() { if (idx > 0) { setFlipped(false); setTimeout(() => setIdx(i => i - 1), 100); } }

  return (
    <ContentCard icon={Icon.layers(16)} title={data.title||'Flashcards'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)">
      <div className="fc-container" onClick={() => setFlipped(f => !f)}>
        <div className={'fc-inner' + (flipped ? ' flipped' : '')}>
          <div className="fc-front">
            <div>{cards[idx]?.q || 'No question'}</div>
          </div>
          <div className="fc-back">
            <div>{cards[idx]?.a || 'No answer'}</div>
          </div>
        </div>
      </div>
      <div className="fc-nav">
        <button className="fc-nav-btn" onClick={(e) => { e.stopPropagation(); goPrev(); }} disabled={idx === 0}>{Icon.chevronLeft(16)}</button>
        <span className="fc-counter">{idx + 1} / {cards.length}</span>
        <button className="fc-nav-btn" onClick={(e) => { e.stopPropagation(); goNext(); }} disabled={idx === cards.length - 1}>{Icon.chevronRight(16)}</button>
      </div>
      {flipped && (
        <div className="fc-chips">
          <button className="fc-chip chip-know" onClick={(e) => { e.stopPropagation(); goNext(); }}>✓ Got it</button>
          <button className="fc-chip chip-unsure" onClick={(e) => { e.stopPropagation(); goNext(); }}>~ Almost</button>
          <button className="fc-chip chip-nope" onClick={(e) => { e.stopPropagation(); goNext(); }}>✗ Nope</button>
        </div>
      )}
      <div className="fc-hint">tap card to flip</div>
    </ContentCard>
  );
}

function QuizDisplay({ data, onSave, onDismiss }) {
  const questions = data.questions || [];
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  if (questions.length === 0) return <ContentCard icon={Icon.fileText(16)} title={data.title||'Quiz'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--orange)"><div style={{color:'var(--text-dim)',fontSize:'0.85rem'}}>No questions generated.</div></ContentCard>;

  const q = questions[qIdx];
  const isCorrect = selected === q?.answer;

  function checkAnswer() {
    if (!selected || revealed) return;
    setRevealed(true);
    if (selected === q.answer) setScore(s => s + 1);
  }
  function nextQuestion() {
    if (qIdx < questions.length - 1) { setQIdx(i => i + 1); setSelected(null); setRevealed(false); }
    else setFinished(true);
  }

  return (
    <ContentCard icon={Icon.fileText(16)} title={data.title||'Quiz'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--orange)">
      {finished ? (
        <div className="quiz-score">
          <div style={{ marginBottom:8, color: score === questions.length ? 'var(--success)' : score >= questions.length * 0.7 ? 'var(--accent)' : 'var(--text-dim)', display:'flex', justifyContent:'center' }}>{score === questions.length ? Icon.trophy(32) : score >= questions.length * 0.7 ? Icon.thumbsUp(32) : Icon.bookOpen(32)}</div>
          <div>{score} / {questions.length} correct</div>
          <div style={{ fontSize:'0.82rem', color:'var(--text-dim)', fontWeight:400, marginTop:4 }}>
            {score === questions.length ? 'Perfect score!' : score >= questions.length * 0.7 ? 'Nice job!' : 'Keep studying, you got this!'}
          </div>
          <button className="quiz-btn" style={{ marginTop:12 }} onClick={() => { setQIdx(0); setSelected(null); setRevealed(false); setScore(0); setFinished(false); }}>Try Again</button>
        </div>
      ) : (
        <>
          <div className="quiz-progress">
            <span>{qIdx + 1}/{questions.length}</span>
            <div className="quiz-progress-bar"><div className="quiz-progress-fill" style={{ width: ((qIdx + 1) / questions.length * 100) + '%' }}/></div>
            <span style={{ color:'var(--success)', display:'flex', alignItems:'center', gap:2 }}>{score} {Icon.check(12)}</span>
          </div>
          <div className="quiz-question">{q?.q || 'No question'}</div>
          <div className="quiz-choices">
            {(q?.choices || []).map((choice, i) => {
              let cls = 'quiz-choice';
              if (revealed && choice === q.answer) cls += ' correct';
              else if (revealed && choice === selected && choice !== q.answer) cls += ' wrong';
              else if (!revealed && choice === selected) cls += ' selected';
              if (revealed && choice === q.answer && choice !== selected) cls += ' reveal-correct';
              return (
                <button key={i} className={cls} onClick={() => { if (!revealed) setSelected(choice); }}>
                  {choice}
                </button>
              );
            })}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {!revealed && <button className="quiz-btn" onClick={checkAnswer} disabled={!selected}>Check Answer</button>}
            {revealed && <button className="quiz-btn" style={{display:'flex',alignItems:'center',gap:4}} onClick={nextQuestion}>{qIdx < questions.length - 1 ? <>Next {Icon.arrowRight(14)}</> : 'See Score'}</button>}
          </div>
        </>
      )}
    </ContentCard>
  );
}

function GenericContentDisplay({ data, icon, label, onSave, onDismiss, accentColor }) {
  const ac = accentColor || 'var(--teal)';
  const formatted = (() => {
    try {
      switch (data.type) {
        case 'create_summary':
          return (data.bullets||[]).map(b => ({ type:'bullet', text:b }));
        case 'create_outline':
          return (data.sections||[]).flatMap(s => [{ type:'heading', text: s.heading }, ...(s.points||[]).map(p => ({ type:'point', text: p }))]);
        case 'create_study_plan':
          return (data.steps||[]).map((s,i) => ({ type:'step', num:i+1, text:s.step, meta:(s.time_minutes||20)+'min'+(s.day?' · '+s.day:'') }));
        case 'create_project_breakdown':
          return (data.phases||[]).flatMap(p => [{ type:'heading', text: p.phase + (p.deadline ? ' — due ' + fmt(p.deadline) : '') }, ...(p.tasks||[]).map(t => ({ type:'point', text: t }))]);
        default: return [{ type:'bullet', text:'(content generated)' }];
      }
    } catch(e) { return [{ type:'bullet', text:'(error displaying content)' }]; }
  })();

  return (
    <ContentCard icon={icon} title={data.title||label} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor={ac}>
      <div style={{ maxHeight:220, overflowY:'auto', fontSize:'0.85rem', lineHeight:1.6 }}>
        {formatted.map((item, i) => {
          if (item.type==='heading') return <div key={i} style={{ fontWeight:700, color:ac, marginTop: i > 0 ? 10 : 0, marginBottom:4, fontSize:'0.86rem', display:'flex', alignItems:'center', gap:6 }}><span style={{width:3,height:14,borderRadius:2,background:ac,flexShrink:0}}/>{item.text}</div>;
          if (item.type==='step') return <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}><span style={{width:22,height:22,borderRadius:6,background:`color-mix(in srgb, ${ac} 10%, transparent)`,border:`1px solid color-mix(in srgb, ${ac} 20%, transparent)`,color:ac,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.72rem',fontWeight:700,flexShrink:0}}>{item.num}</span><div><div style={{color:'var(--text)',fontWeight:500}}>{item.text}</div><div style={{fontSize:'0.75rem',color:'var(--text-dim)',marginTop:1}}>{item.meta}</div></div></div>;
          if (item.type==='point') return <div key={i} style={{ padding:'3px 0 3px 14px', color:'var(--text)', borderLeft:`2px solid color-mix(in srgb, ${ac} 25%, transparent)`, marginLeft:2 }}>• {item.text}</div>;
          return <div key={i} style={{ padding:'4px 0', color:'var(--text)', display:'flex', alignItems:'flex-start', gap:8 }}><span style={{width:5,height:5,borderRadius:'50%',background:ac,marginTop:7,flexShrink:0}}/>{item.text}</div>;
        })}
      </div>
    </ContentCard>
  );
}

/* ─── Plan Templates ─── */
const PLAN_TEMPLATES = [
  {
    id: 'weekly_study', name: 'Weekly Study Plan', iconFn: Icon.calendar,
    description: 'Plan your study sessions for the week',
    skeleton: {
      summary: 'A structured weekly study plan to stay on top of your coursework.',
      steps: [
        { title: 'Review notes from last week', estimated_minutes: 30 },
        { title: 'Read new chapter material', estimated_minutes: 45 },
        { title: 'Practice problems / exercises', estimated_minutes: 40 },
        { title: 'Study group / peer review', estimated_minutes: 30 },
        { title: 'Self-quiz / flashcard review', estimated_minutes: 20 },
      ]
    }
  },
  {
    id: 'exam_prep', name: 'Exam Prep Plan', iconFn: Icon.target,
    description: '3-5 day countdown to exam day',
    skeleton: {
      summary: 'A focused exam preparation plan to maximize your study time.',
      steps: [
        { title: 'Gather all study materials and past notes', estimated_minutes: 20 },
        { title: 'Review key concepts and make a cheat sheet', estimated_minutes: 45 },
        { title: 'Practice with past exams / sample questions', estimated_minutes: 60 },
        { title: 'Focus on weak areas identified from practice', estimated_minutes: 45 },
        { title: 'Final review and light practice', estimated_minutes: 30 },
      ]
    }
  },
  {
    id: 'essay_plan', name: 'Essay Writing Plan', iconFn: Icon.fileText,
    description: 'Research, outline, draft, revise',
    skeleton: {
      summary: 'Step-by-step plan to write a polished essay.',
      steps: [
        { title: 'Research and gather sources', estimated_minutes: 45 },
        { title: 'Create outline with thesis and key points', estimated_minutes: 25 },
        { title: 'Write first draft', estimated_minutes: 60 },
        { title: 'Revise and strengthen arguments', estimated_minutes: 40 },
        { title: 'Proofread and final edits', estimated_minutes: 20 },
      ]
    }
  },
  {
    id: 'project_timeline', name: 'Project Timeline', iconFn: Icon.hammer,
    description: 'Break a big project into phases',
    skeleton: {
      summary: 'A phased timeline to complete your project on schedule.',
      steps: [
        { title: 'Define project scope and requirements', estimated_minutes: 30 },
        { title: 'Research and plan approach', estimated_minutes: 45 },
        { title: 'Build / create core deliverables', estimated_minutes: 90 },
        { title: 'Test, review, and iterate', estimated_minutes: 45 },
        { title: 'Polish and submit final version', estimated_minutes: 30 },
      ]
    }
  },
  {
    id: 'research_paper', name: 'Research Paper Plan', iconFn: Icon.search,
    description: 'Literature review through final draft',
    skeleton: {
      summary: 'A structured approach to writing a thorough research paper.',
      steps: [
        { title: 'Choose topic and narrow focus', estimated_minutes: 20 },
        { title: 'Literature review — find and read sources', estimated_minutes: 60 },
        { title: 'Create annotated bibliography', estimated_minutes: 40 },
        { title: 'Write introduction and methodology', estimated_minutes: 45 },
        { title: 'Write body sections and analysis', estimated_minutes: 90 },
        { title: 'Write conclusion and format citations', estimated_minutes: 30 },
      ]
    }
  },
];

function PlanTemplateSelector({ onSelectTemplate, onCustomPlan, onDismiss }) {
  return (
    <div style={{
      background:'linear-gradient(135deg, rgba(26,26,46,0.98), rgba(15,15,26,0.95))',
      border:'1px solid rgba(108,99,255,0.2)',
      borderRadius:18,
      padding:0,
      maxWidth:480,
      width:'100%',
      boxShadow:'0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(108,99,255,0.08)',
    }}>
      {/* Header */}
      <div style={{
        background:'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(43,203,186,0.1))',
        padding:'16px 20px',
        borderBottom:'1px solid rgba(108,99,255,0.1)',
        display:'flex',
        alignItems:'center',
        gap:10
      }}>
        <div style={{
          width:36, height:36, borderRadius:10,
          background:'linear-gradient(135deg, var(--accent), var(--teal))',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 12px rgba(108,99,255,0.3)'
        }}>
          {Icon.listTree(18)}
        </div>
        <div style={{flex:1}}>
          <div style={{fontWeight:800, fontSize:'1rem', color:'var(--text)', letterSpacing:'-0.3px'}}>Choose a Plan Template</div>
          <div style={{fontSize:'0.72rem', color:'var(--text-dim)', marginTop:1}}>Pick a starting point or create your own</div>
        </div>
        <button onClick={onDismiss} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',padding:4,display:'flex'}}>{Icon.x(14)}</button>
      </div>

      {/* Templates */}
      <div style={{padding:'12px 16px'}}>
        {PLAN_TEMPLATES.map(tmpl => (
          <div key={tmpl.id}
            onClick={() => onSelectTemplate(tmpl)}
            style={{
              display:'flex', alignItems:'center', gap:12,
              padding:'12px 14px',
              marginBottom:6,
              borderRadius:12,
              cursor:'pointer',
              border:'1px solid rgba(255,255,255,0.06)',
              background:'rgba(255,255,255,0.02)',
              transition:'all .15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(108,99,255,0.08)'; e.currentTarget.style.borderColor='rgba(108,99,255,0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.06)'; }}>
            <div style={{
              width:32, height:32, borderRadius:8,
              background:'rgba(108,99,255,0.1)',
              border:'1px solid rgba(108,99,255,0.2)',
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'var(--accent)', flexShrink:0
            }}>
              {tmpl.iconFn(16)}
            </div>
            <div>
              <div style={{fontSize:'0.86rem', fontWeight:600, color:'var(--text)'}}>{tmpl.name}</div>
              <div style={{fontSize:'0.74rem', color:'var(--text-dim)', marginTop:1}}>{tmpl.description}</div>
            </div>
          </div>
        ))}

        {/* Custom Plan option */}
        <div
          onClick={onCustomPlan}
          style={{
            display:'flex', alignItems:'center', gap:12,
            padding:'12px 14px',
            borderRadius:12,
            cursor:'pointer',
            border:'1px solid rgba(43,203,186,0.15)',
            background:'rgba(43,203,186,0.04)',
            transition:'all .15s'
          }}
          onMouseEnter={e => { e.currentTarget.style.background='rgba(43,203,186,0.1)'; e.currentTarget.style.borderColor='rgba(43,203,186,0.3)'; }}
          onMouseLeave={e => { e.currentTarget.style.background='rgba(43,203,186,0.04)'; e.currentTarget.style.borderColor='rgba(43,203,186,0.15)'; }}>
          <div style={{
            width:32, height:32, borderRadius:8,
            background:'rgba(43,203,186,0.1)',
            border:'1px solid rgba(43,203,186,0.2)',
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'var(--teal)', flexShrink:0
          }}>
            {Icon.sparkles(16)}
          </div>
          <div>
            <div style={{fontSize:'0.86rem', fontWeight:600, color:'var(--teal)'}}>Custom Plan</div>
            <div style={{fontSize:'0.74rem', color:'var(--text-dim)', marginTop:1}}>AI generates a unique plan from your description</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanCard({ data, onApply, onSave, onDismiss, onStartTask, onExportGoogleDocs, googleConnected }) {
  const [checked, setChecked] = useState(() => (data.steps||[]).map(() => true));
  const [mode, setMode] = useState('breakdown');
  const [activeIdx, setActiveIdx] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [docSyncing, setDocSyncing] = useState(false);
  const steps = data.steps || [];
  const toggle = i => setChecked(prev => prev.map((v,j) => j===i ? !v : v));
  const checkedCount = checked.filter(Boolean).length;

  function startTask(i) {
    if (!steps[i]) return;
    setActiveIdx(i);
    if (!checked[i]) toggle(i);
    onStartTask?.(steps[i], i);
  }

  function startNextTask() {
    const nextIdx = steps.findIndex((_, i) => checked[i] && i !== activeIdx);
    if (nextIdx >= 0) startTask(nextIdx);
  }

  async function handleExportDocs() {
    if (!onExportGoogleDocs) return;
    setDocSyncing(true);
    try { await onExportGoogleDocs(data); } finally { setDocSyncing(false); }
  }

  const hasDocId = !!data.googleDocId;

  return (
    <div style={{
      background:'linear-gradient(135deg, rgba(26,26,46,0.98), rgba(15,15,26,0.95))',
      border:'1px solid rgba(108,99,255,0.2)',
      borderRadius:18,
      padding:0,
      maxWidth:480,
      width:'100%',
      maxHeight:'70vh',
      overflowY:'auto',
      overflowX:'hidden',
      boxShadow:'0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(108,99,255,0.08)',
    }}>
      {/* Header */}
      <div style={{
        background:'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(43,203,186,0.1))',
        padding:'16px 20px',
        borderBottom:'1px solid rgba(108,99,255,0.1)',
        display:'flex',
        alignItems:'center',
        gap:10
      }}>
        <div style={{
          width:36, height:36, borderRadius:10,
          background:'linear-gradient(135deg, var(--accent), var(--teal))',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 12px rgba(108,99,255,0.3)'
        }}>
          {Icon.listTree(18)}
        </div>
        <div style={{flex:1}}>
          <div style={{fontWeight:800, fontSize:'1rem', color:'var(--text)', letterSpacing:'-0.3px'}}>{data.title||'Plan'}</div>
          {data.templateName && (
            <div style={{fontSize:'0.68rem', color:'var(--accent)', marginTop:1, fontWeight:600}}>
              {data.templateName}
            </div>
          )}
        </div>
        <span style={{fontSize:'0.7rem',fontWeight:700,padding:'3px 10px',borderRadius:8,background:'rgba(43,203,186,0.1)',color:'var(--teal)',letterSpacing:'0.5px'}}>{checkedCount}/{steps.length}</span>
        <button onClick={onDismiss} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',padding:4,display:'flex'}}>{Icon.x(14)}</button>
      </div>

      {/* Summary */}
      {data.summary && (
        <div style={{
          padding:'12px 20px',
          background:'rgba(108,99,255,0.04)',
          borderBottom:'1px solid rgba(255,255,255,0.04)',
          fontSize:'0.86rem',
          color:'var(--text)',
          lineHeight:1.5,
          fontWeight:500
        }}>
          {data.summary}
        </div>
      )}

      {/* Mode Toggle */}
      <div style={{padding:'10px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)', display:'flex', gap:6}}>
        <button onClick={() => setMode('breakdown')} style={{
          flex:1, padding:'6px 12px', borderRadius:8, border:'none', fontSize:'0.78rem', fontWeight:700, cursor:'pointer',
          background: mode === 'breakdown' ? 'rgba(108,99,255,0.15)' : 'rgba(255,255,255,0.04)',
          color: mode === 'breakdown' ? 'var(--accent)' : 'var(--text-dim)',
          transition:'all .15s'
        }}>Breakdown</button>
        <button onClick={() => setMode('start')} style={{
          flex:1, padding:'6px 12px', borderRadius:8, border:'none', fontSize:'0.78rem', fontWeight:700, cursor:'pointer',
          background: mode === 'start' ? 'rgba(43,203,186,0.15)' : 'rgba(255,255,255,0.04)',
          color: mode === 'start' ? 'var(--teal)' : 'var(--text-dim)',
          transition:'all .15s'
        }}>Start task</button>
      </div>

      {/* Steps */}
      <div style={{padding:'8px 20px'}}>
        <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8}}>Steps</div>
        {steps.map((step,i) => {
          const isActive = activeIdx === i;
          const isChecked = checked[i];
          return (
            <div key={i}
              onClick={() => mode === 'start' ? startTask(i) : toggle(i)}
              style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'8px 0',
                borderBottom: i < steps.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                cursor:'pointer',
                opacity: isChecked ? 1 : 0.5,
              }}>
              <span style={{
                width:24, height:24, borderRadius:7, flexShrink:0,
                background: isActive ? 'rgba(43,203,186,0.15)' : isChecked ? 'rgba(108,99,255,0.1)' : 'rgba(255,255,255,0.04)',
                border: isActive ? '1.5px solid var(--teal)' : isChecked ? '1.5px solid rgba(108,99,255,0.3)' : '1.5px solid rgba(255,255,255,0.1)',
                color: isActive ? 'var(--teal)' : 'var(--accent)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:'0.72rem', fontWeight:700,
                transition:'all .15s'
              }}>{isActive ? Icon.arrowRight(11) : isChecked ? (i + 1) : Icon.x(10)}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:'0.84rem', color:'var(--text)', fontWeight: isActive ? 600 : 400, textDecoration: isChecked ? 'none' : 'line-through'}}>{step.title}</div>
                <div style={{display:'flex', gap:8, marginTop:2}}>
                  {step.date && <span style={{fontSize:'0.72rem', color:'var(--teal)', fontWeight:600}}>{Icon.calendar(10)} {fmt(step.date)}</span>}
                  {step.time && <span style={{fontSize:'0.72rem', color:'var(--text-dim)'}}>{Icon.clock(10)} {step.time}</span>}
                  {step.estimated_minutes && <span style={{fontSize:'0.72rem', color:'var(--text-dim)'}}>{step.estimated_minutes}min</span>}
                </div>
              </div>
              {mode === 'start' && (
                <span style={{
                  fontSize:'0.72rem', fontWeight:700, padding:'3px 10px', borderRadius:6,
                  background: isActive ? 'rgba(43,203,186,0.15)' : 'rgba(108,99,255,0.08)',
                  color: isActive ? 'var(--teal)' : 'var(--accent)',
                }}>{isActive ? 'In progress' : 'Start'}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick Actions Dropdown */}
      <div style={{padding:'10px 20px', borderTop:'1px solid rgba(255,255,255,0.04)', position:'relative'}}>
        <button onClick={() => setActionsOpen(!actionsOpen)} style={{
          width:'100%',
          background:'rgba(108,99,255,0.08)',
          border:'1px solid rgba(108,99,255,0.2)',
          borderRadius:10,
          padding:'10px 14px',
          color:'var(--accent)',
          fontSize:'0.84rem',
          fontWeight:600,
          cursor:'pointer',
          display:'flex',
          alignItems:'center',
          justifyContent:'space-between',
          transition:'all .15s'
        }}>
          <span style={{display:'flex',alignItems:'center',gap:6}}>
            {Icon.zap(14)} Actions
          </span>
          <span style={{
            display:'inline-flex',
            transform: actionsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition:'transform .2s'
          }}>
            {Icon.arrowRight(12)}
          </span>
        </button>
        {actionsOpen && (
          <div style={{
            marginTop:6,
            borderRadius:10,
            overflow:'hidden',
            border:'1px solid rgba(108,99,255,0.15)',
            background:'rgba(15,15,26,0.95)'
          }}>
            {mode === 'breakdown' ? (
              <button onClick={() => { setActionsOpen(false); onApply(steps.filter((_,i) => checked[i])); }} style={{
                width:'100%', background:'transparent', border:'none',
                borderBottom:'1px solid rgba(255,255,255,0.04)',
                padding:'10px 14px', color:'var(--text)', fontSize:'0.82rem', cursor:'pointer', textAlign:'left',
                display:'flex', alignItems:'center', gap:8, transition:'background .15s'
              }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(108,99,255,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <span style={{color:'var(--teal)',display:'flex'}}>{Icon.check(13)}</span>
                Add {checkedCount} as tasks
              </button>
            ) : (
              <button onClick={() => { setActionsOpen(false); startNextTask(); }} style={{
                width:'100%', background:'transparent', border:'none',
                borderBottom:'1px solid rgba(255,255,255,0.04)',
                padding:'10px 14px', color:'var(--text)', fontSize:'0.82rem', cursor:'pointer', textAlign:'left',
                display:'flex', alignItems:'center', gap:8, transition:'background .15s'
              }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(108,99,255,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <span style={{color:'var(--teal)',display:'flex'}}>{Icon.arrowRight(13)}</span>
                Start next task
              </button>
            )}
            <button onClick={() => { setActionsOpen(false); onSave(); }} style={{
              width:'100%', background:'transparent', border:'none',
              borderBottom:'1px solid rgba(255,255,255,0.04)',
              padding:'10px 14px', color:'var(--text)', fontSize:'0.82rem', cursor:'pointer', textAlign:'left',
              display:'flex', alignItems:'center', gap:8, transition:'background .15s'
            }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(108,99,255,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              <span style={{color:'var(--accent)',display:'flex'}}>{Icon.fileText(13)}</span>
              Save to notes
            </button>
            <button onClick={() => { setActionsOpen(false); handleExportDocs(); }} disabled={docSyncing} style={{
              width:'100%', background:'transparent', border:'none',
              padding:'10px 14px', color: googleConnected ? 'var(--text)' : 'var(--text-dim)', fontSize:'0.82rem',
              cursor: docSyncing ? 'wait' : 'pointer', textAlign:'left',
              display:'flex', alignItems:'center', gap:8, transition:'background .15s',
              opacity: docSyncing ? 0.5 : 1
            }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(108,99,255,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              <span style={{color:'var(--accent)',display:'flex'}}>{Icon.externalLink(13)}</span>
              {docSyncing ? 'Syncing...' : hasDocId ? 'Sync to Google Docs' : 'Export to Google Docs'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ContentTypeRouter({ content, onSave, onDismiss, onApplyPlan, onStartPlanTask, onExportGoogleDocs, googleConnected }) {
  switch (content.type) {
    case 'make_plan':
      return <PlanCard data={content} onApply={onApplyPlan} onSave={onSave} onDismiss={onDismiss} onStartTask={onStartPlanTask} onExportGoogleDocs={onExportGoogleDocs} googleConnected={googleConnected} />;
    case 'create_flashcards':
      return <FlashcardDisplay data={content} onSave={onSave} onDismiss={onDismiss} />;
    case 'create_quiz':
      return <QuizDisplay data={content} onSave={onSave} onDismiss={onDismiss} />;
    case 'create_outline':
      return <GenericContentDisplay data={content} icon={Icon.listTree(16)} label="Outline" onSave={onSave} onDismiss={onDismiss} accentColor="var(--blue)" />;
    case 'create_summary':
      return <GenericContentDisplay data={content} icon={Icon.clipboard(16)} label="Summary" onSave={onSave} onDismiss={onDismiss} accentColor="var(--teal)" />;
    case 'create_study_plan':
      return <GenericContentDisplay data={content} icon={Icon.calendar(16)} label="Study Plan" onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)" />;
    case 'create_project_breakdown':
      return <GenericContentDisplay data={content} icon={Icon.hammer(16)} label="Project Breakdown" onSave={onSave} onDismiss={onDismiss} accentColor="var(--orange)" />;
    default:
      return <GenericContentDisplay data={content} icon={Icon.zap(16)} label="Content" onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)" />;
  }
}

/* ═══════════════════════════════════════════════
   DAILY BRIEF CARD
   ═══════════════════════════════════════════════ */
function DailyBriefCard({ brief, onAction }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  if (!brief) return null;
  const scheduleItems = (brief.schedule_items || []).filter(item => (item?.event_name || '').trim() || (item?.time || '').trim());
  const isScheduleBlank = scheduleItems.length === 0;
  const allClearMsg = 'all clear for now go have some fun';

  return (
    <div style={{
      background:'linear-gradient(135deg, rgba(26,26,46,0.98), rgba(15,15,26,0.95))',
      border:'1px solid rgba(108,99,255,0.2)',
      borderRadius:18,
      padding:0,
      maxWidth:480,
      width:'100%',
      maxHeight:'70vh',
      overflowY:'auto',
      overflowX:'hidden',
      boxShadow:'0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(108,99,255,0.08)',
    }}>
      {/* Header */}
      <div style={{
        background:'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(43,203,186,0.1))',
        padding:'16px 20px',
        borderBottom:'1px solid rgba(108,99,255,0.1)',
        display:'flex',
        alignItems:'center',
        gap:10
      }}>
        <div style={{
          width:36, height:36, borderRadius:10,
          background:'linear-gradient(135deg, var(--accent), var(--teal))',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 12px rgba(108,99,255,0.3)'
        }}>
          {Icon.calendar(18)}
        </div>
        <div>
          <div style={{fontWeight:800, fontSize:'1rem', color:'var(--text)', letterSpacing:'-0.3px'}}>Daily Brief</div>
          <div style={{fontSize:'0.72rem', color:'var(--text-dim)', marginTop:1}}>
            {new Date().toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' })}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div style={{
        padding:'14px 20px',
        background:'rgba(108,99,255,0.04)',
        borderBottom:'1px solid rgba(255,255,255,0.04)',
        fontSize:'0.88rem',
        color:'var(--text)',
        lineHeight:1.5,
        fontWeight:500
      }}>
        {isScheduleBlank ? allClearMsg : (brief.summary || allClearMsg)}
      </div>

      {/* Schedule Items */}
      <div style={{padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
        <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8}}>Schedule</div>
        {isScheduleBlank ? (
          <div style={{fontSize:'0.84rem', color:'var(--text-dim)', lineHeight:1.5}}>{allClearMsg}</div>
        ) : scheduleItems.map((item, i) => (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:10,
              padding:'6px 0',
              borderBottom: i < scheduleItems.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none'
            }}>
              <span style={{
                fontSize:'0.78rem', fontWeight:700, color:'var(--teal)',
                minWidth:72, fontVariantNumeric:'tabular-nums'
              }}>{item.time || '—'}</span>
              <span style={{fontSize:'0.84rem', color:'var(--text)', flex:1}}>{item.event_name}</span>
              {item.related_doc_id && (
                <span style={{display:'flex', color:'var(--accent)', opacity:0.6}} title="Linked document">
                  {Icon.fileText(13)}
                </span>
              )}
            </div>
          ))}
      </div>

      {/* Plan of Action */}
      {brief.plan_of_action && brief.plan_of_action.length > 0 && (
        <div style={{padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
          <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8}}>Plan of Action</div>
          {brief.plan_of_action.map((item, i) => (
            <div key={i} style={{
              display:'flex', alignItems:'flex-start', gap:8,
              padding:'5px 0', fontSize:'0.84rem', color:'var(--text)', lineHeight:1.5
            }}>
              <span style={{
                width:20, height:20, borderRadius:6, flexShrink:0, marginTop:1,
                background:'rgba(43,203,186,0.1)',
                border:'1px solid rgba(43,203,186,0.2)',
                color:'var(--teal)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:'0.7rem', fontWeight:700
              }}>{i + 1}</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions Dropdown */}
      {brief.dropdown_options && brief.dropdown_options.length > 0 && (
        <div style={{padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)', position:'relative'}}>
          <button onClick={() => setDropdownOpen(!dropdownOpen)} style={{
            width:'100%',
            background:'rgba(108,99,255,0.08)',
            border:'1px solid rgba(108,99,255,0.2)',
            borderRadius:10,
            padding:'10px 14px',
            color:'var(--accent)',
            fontSize:'0.84rem',
            fontWeight:600,
            cursor:'pointer',
            display:'flex',
            alignItems:'center',
            justifyContent:'space-between',
            transition:'all .15s'
          }}>
            <span style={{display:'flex',alignItems:'center',gap:6}}>
              {Icon.zap(14)} Quick Actions
            </span>
            <span style={{
              display:'inline-flex',
              transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition:'transform .2s'
            }}>
              {Icon.arrowRight(12)}
            </span>
          </button>
          {dropdownOpen && (
            <div style={{
              marginTop:6,
              borderRadius:10,
              overflow:'hidden',
              border:'1px solid rgba(108,99,255,0.15)',
              background:'rgba(15,15,26,0.95)'
            }}>
              {brief.dropdown_options.map((opt, i) => (
                <button key={i} onClick={() => { setDropdownOpen(false); onAction(opt); }}
                  style={{
                    width:'100%',
                    background:'transparent',
                    border:'none',
                    borderBottom: i < brief.dropdown_options.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    padding:'10px 14px',
                    color:'var(--text)',
                    fontSize:'0.82rem',
                    cursor:'pointer',
                    textAlign:'left',
                    transition:'background .15s',
                    display:'flex',
                    alignItems:'center',
                    gap:8
                  }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(108,99,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <span style={{color:'var(--accent)',display:'flex'}}>{Icon.sparkles(13)}</span>
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Encouragement Footer */}
      {brief.encouragement && (
        <div style={{
          padding:'14px 20px',
          background:'linear-gradient(135deg, rgba(43,203,186,0.06), rgba(108,99,255,0.04))',
          fontSize:'0.84rem',
          color:'var(--teal)',
          fontWeight:600,
          fontStyle:'italic',
          textAlign:'center',
          lineHeight:1.5
        }}>
          {brief.encouragement}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   GOOGLE IMPORT MODAL
   ═══════════════════════════════════════════════ */
function GoogleImportModal({ googleToken, googleUser, onClose, onImportEvents, onImportDoc, onImportPdf, onDisconnect, onConnect,
  calSyncEnabled, calSyncStatus, calSyncLastAt, calSyncCount, calSyncError, onToggleCalSync, onSyncNow }) {
  const [tab, setTab] = useState('calendar');
  // Calendar tab state
  const [calEvents, setCalEvents] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [calLoading, setCalLoading] = useState(false);
  const [calFetched, setCalFetched] = useState(false);
  // Docs tab state — direct URL/ID input
  const [docInput, setDocInput] = useState('');
  const [docLoading, setDocLoading] = useState(false);
  // PDF tab state — local file upload only
  const [pdfLoading, setPdfLoading] = useState(false);
  const fileInputRef = useRef(null);
  // Audio/Video tab state
  const [audioLoading, setAudioLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const audioInputRef = useRef(null);
  const videoInputRef = useRef(null);
  // Shared error
  const [err, setErr] = useState(null);

  // ── Helpers ──
  const isConnected = !!googleToken;
  function authHeader() { return { 'Authorization': 'Bearer ' + googleToken }; }

  // Converts an ISO timestamp to a friendly "X min ago" string
  function timeAgo(iso) {
    if (!iso) return null;
    const diffMs = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diffMs / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hr ago';
    return Math.floor(h / 24) + 'd ago';
  }

  // ── Calendar ──
  async function fetchCalEvents() {
    setCalLoading(true); setErr(null);
    try {
      const now = new Date();
      const max = new Date(now.getTime() + 14 * 86400000);
      const params = new URLSearchParams({
        timeMin: now.toISOString(), timeMax: max.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '50'
      });
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + params, { headers: authHeader() });
      if (!res.ok) { if (res.status === 401) throw new Error('Google session expired — click Reconnect.'); throw new Error('Calendar fetch failed: ' + res.status); }
      const data = await res.json();
      const evs = mapGoogleCalItems(data.items || []);
      setCalEvents(evs);
      setSelected(new Set(evs.map((_,i) => i)));
      setCalFetched(true);
    } catch(e) { setErr(e.message); }
    finally { setCalLoading(false); }
  }

  function toggleEv(i) {
    setSelected(prev => { const n=new Set(prev); n.has(i)?n.delete(i):n.add(i); return n; });
  }

  // ── Docs ── (uses Google Docs API with direct document access)
  async function importDoc() {
    const docId = parseDocId(docInput);
    if (!docId) { setErr('Please enter a valid Google Doc URL or ID.'); return; }
    setDocLoading(true); setErr(null);
    try {
      const res = await fetch('https://docs.googleapis.com/v1/documents/' + docId, { headers: authHeader() });
      if (!res.ok) {
        if (res.status === 401) throw new Error('Google session expired — click Reconnect.');
        if (res.status === 403) throw new Error('Access denied. Try disconnecting and reconnecting Google to refresh permissions.');
        if (res.status === 404) throw new Error('Doc not found. Make sure you have access and the URL/ID is correct.');
        throw new Error('Failed to fetch doc: ' + res.status);
      }
      const doc = await res.json();
      const text = extractDocsText(doc);
      if (!text) throw new Error('Document appears to be empty.');
      const title = doc.title || 'Imported Doc';
      onImportDoc(title, text);
      setDocInput('');
    } catch(e) { setErr(e.message); }
    finally { setDocLoading(false); }
  }

  // ── PDF ──
  async function importPdf(source) {
    setPdfLoading(true); setErr(null);
    try {
      const lib = pdfjsLib;
      if (!lib) throw new Error('PDF library is still loading — wait a moment and try again.');
      let loadingTask;
      let filename = source.name ? source.name.replace(/\.pdf$/i, '') : 'Imported PDF';
      const buf = await source.arrayBuffer();
      loadingTask = lib.getDocument({ data: buf });
      const pdf = await loadingTask.promise;
      let full = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        full += tc.items.map(item => item.str).join(' ') + '\n\n';
      }
      const trimmed = full.trim();
      if (!trimmed) throw new Error('No readable text found in this PDF. Scanned/image-only PDFs cannot be parsed.');
      // Truncate very large docs with a note
      const maxChars = 50000;
      const content = trimmed.length > maxChars ? trimmed.slice(0, maxChars) + '\n\n[Truncated — PDF had more content than the notes limit]' : trimmed;
      onImportPdf(filename, content);
    } catch(e) { setErr(e.message); }
    finally { setPdfLoading(false); }
  }

  // Audio/Video transcription via Whisper
  async function transcribeFile(file, setLoading) {
    if (file.size > 25 * 1024 * 1024) { setErr('File too large — max 25MB for transcription.'); return; }
    setLoading(true); setErr(null);
    try {
      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const audioBase64 = btoa(binary);
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY) },
        body: JSON.stringify({ mode: 'voice', audioBase64, audioMimeType: file.type || 'audio/webm' })
      });
      if (!res.ok) throw new Error('Transcription failed: ' + res.status);
      const data = await res.json();
      const transcript = (data.text || '').trim();
      if (!transcript) throw new Error('No speech detected in this file.');
      const filename = file.name.replace(/\.[^.]+$/, '') || 'Transcription';
      onImportPdf(filename, transcript);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function importAudio(file) { await transcribeFile(file, setAudioLoading); }

  async function importVideo(file) {
    if (file.size > 25 * 1024 * 1024) { setErr('File too large — max 25MB for transcription.'); return; }
    setVideoLoading(true); setErr(null);
    try {
      // Try direct transcription first — Whisper handles video formats
      await transcribeFile(file, setVideoLoading);
    } catch(e) { setErr(e.message); setVideoLoading(false); }
  }

  const isLoading = calLoading || docLoading || pdfLoading || audioLoading || videoLoading;

  return (
    <>
      <div className="g-overlay" onClick={onClose}/>
      <div className="g-modal" onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div className="g-modal-hdr">
          <div className="g-modal-title"><span style={{display:'flex',color:'var(--accent)'}}>{Icon.link(18)}</span> Import</div>
          <button className="g-modal-close" onClick={onClose} disabled={isLoading}>{Icon.x(16)}</button>
        </div>

        {/* Connected account info */}
        {googleUser ? (
          <div className="g-connected">
            <span style={{color:'var(--success)',display:'flex',alignItems:'center',gap:4}}>{Icon.check(12)} {googleUser.email}</span>
            <button onClick={onDisconnect} style={{background:'transparent',border:'none',color:'var(--danger)',cursor:'pointer',fontSize:'0.78rem',fontWeight:600,padding:'0 4px'}}>Disconnect</button>
          </div>
        ) : (
          <div className="g-connected" style={{background:'rgba(108,99,255,0.08)',borderColor:'rgba(108,99,255,0.2)'}}>
            <span style={{color:'var(--text-dim)',display:'flex',alignItems:'center',gap:6}}>{Icon.link(12)} Connect Google to import Calendar events or Docs.</span>
            <button onClick={onConnect} style={{background:'transparent',border:'1px solid rgba(108,99,255,0.3)',color:'var(--accent)',cursor:'pointer',fontSize:'0.76rem',fontWeight:600,padding:'4px 8px',borderRadius:8}}>Connect</button>
          </div>
        )}

        {/* Error */}
        {err && <div className="g-err" style={{display:'flex',alignItems:'center',gap:6}}>{Icon.alertTriangle(14)} {err}</div>}

        {/* Tabs */}
        <div className="g-tabs">
          {['calendar','docs','pdf','audio','video'].map(t=>(
            <button key={t} className={'g-tab'+(tab===t?' active':'')} onClick={()=>{setTab(t);setErr(null);}}>
              {t==='calendar'?<><span style={{display:'inline-flex'}}>{Icon.calendar(14)}</span> Calendar</>
              :t==='docs'?<><span style={{display:'inline-flex'}}>{Icon.fileText(14)}</span> Docs</>
              :t==='pdf'?<><span style={{display:'inline-flex'}}>{Icon.listTree(14)}</span> PDF</>
              :t==='audio'?<><span style={{display:'inline-flex'}}>{Icon.headphones(14)}</span> Audio</>
              :<><span style={{display:'inline-flex'}}>{Icon.video(14)}</span> Video</>}
            </button>
          ))}
        </div>

        {/* ── Calendar Tab ── */}
        {tab==='calendar' && (
          <div className="g-section">
            {!isConnected ? (
              <div className="g-note" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span>Connect Google to import and sync calendar events.</span>
                <button className="g-hdr-btn" onClick={onConnect}>Connect</button>
              </div>
            ) : (
            <>

            {/* ── Auto-sync toggle card ── */}
            <div className={'cal-sync-card' + (calSyncEnabled ? ' on' : '') + (calSyncStatus==='error' ? ' error' : '')}>
              <div className="cal-sync-toggle">
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'flex',color:'var(--accent)'}}>{calSyncStatus==='syncing'?Icon.circle(18):calSyncEnabled?Icon.checkCircle(18):Icon.calendar(18)}</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:'0.88rem'}}>Auto-sync Calendar</div>
                    <div style={{fontSize:'0.72rem',color:'var(--text-dim)',marginTop:1}}>
                      {calSyncEnabled ? 'Syncing next 2 weeks every 30 min' : 'Enable to sync automatically in the background'}
                    </div>
                  </div>
                </div>
                <button className={'cal-sync-pill ' + (calSyncEnabled ? 'on' : 'off')} onClick={onToggleCalSync}>
                  {calSyncEnabled ? '● ON' : '○ OFF'}
                </button>
              </div>

              {/* Status row — only shown when enabled */}
              {calSyncEnabled && (
                <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid rgba(255,255,255,0.06)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                  <div style={{fontSize:'0.78rem'}}>
                    {calSyncStatus==='syncing' && <span style={{color:'var(--text-dim)',display:'flex',alignItems:'center',gap:4}}>{Icon.circle(12)} Syncing now…</span>}
                    {calSyncStatus==='done' && (
                      <span style={{color:'var(--success)'}}>
                        {Icon.check(12)} Last synced {timeAgo(calSyncLastAt)}
                        {calSyncCount > 0 && <span style={{color:'var(--text-dim)',marginLeft:6}}>({calSyncCount} new event{calSyncCount!==1?'s':''})</span>}
                        {calSyncCount === 0 && <span style={{color:'var(--text-dim)',marginLeft:6}}>(no new events)</span>}
                      </span>
                    )}
                    {calSyncStatus==='error' && <span style={{color:'var(--danger)',display:'flex',alignItems:'center',gap:4}}>{Icon.alertTriangle(12)} {calSyncError}</span>}
                    {calSyncStatus==='idle' && calSyncLastAt && <span style={{color:'var(--text-dim)'}}>Last synced {timeAgo(calSyncLastAt)}</span>}
                    {calSyncStatus==='idle' && !calSyncLastAt && <span style={{color:'var(--text-dim)'}}>Starting first sync…</span>}
                  </div>
                  <button onClick={onSyncNow} disabled={calSyncStatus==='syncing'}
                    style={{background:'transparent',border:'1px solid '+(calSyncStatus==='syncing'?'var(--border)':'rgba(46,213,115,0.4)'),color:calSyncStatus==='syncing'?'var(--text-dim)':'var(--success)',borderRadius:8,padding:'4px 10px',cursor:calSyncStatus==='syncing'?'not-allowed':'pointer',fontSize:'0.75rem',fontWeight:600,transition:'all .15s',flexShrink:0}}>
                    {calSyncStatus==='syncing'?'Syncing…':'Sync now'}
                  </button>
                </div>
              )}
            </div>

            {/* ── Manual mode (shown only when auto-sync is OFF) ── */}
            {!calSyncEnabled && (
              <>
                {!calFetched ? (
                  <>
                    <p className="g-note">Or manually fetch events and choose which ones to import.</p>
                    <button className="g-btn" onClick={fetchCalEvents} disabled={calLoading}>
                      <span style={{display:'flex'}}>{calLoading?Icon.circle(16):Icon.calendar(16)}</span>
                      {calLoading ? 'Fetching events…' : 'Fetch next 2 weeks of events'}
                    </button>
                  </>
                ) : (
                  <>
                    {calEvents.length === 0 ? (
                      <div className="g-status">No events found in the next 2 weeks.</div>
                    ) : (
                      <>
                        <div style={{fontSize:'0.78rem',color:'var(--text-dim)',marginBottom:10}}>
                          {calEvents.length} events — tap to select/deselect.
                          <button onClick={()=>setSelected(s=>s.size===calEvents.length?new Set():new Set(calEvents.map((_,i)=>i)))}
                            style={{marginLeft:8,background:'transparent',border:'none',color:'var(--accent)',cursor:'pointer',fontSize:'0.78rem',fontWeight:600}}>
                            {selected.size===calEvents.length?'Deselect all':'Select all'}
                          </button>
                        </div>
                        {calEvents.map((ev,i)=>(
                          <div key={i} className="g-event-row" onClick={()=>toggleEv(i)}>
                            <div className={'g-check'+(selected.has(i)?' on':'')}>
                              {selected.has(i)&&<span style={{color:'#fff',display:'flex'}}>{Icon.check(12)}</span>}
                            </div>
                            <div style={{flex:1}}>
                              <div className="g-event-title">{ev.title}</div>
                              <div className="g-event-sub">{fmt(ev.date)}{ev.startTime?' · '+ev.startTime:' · All day'}</div>
                            </div>
                          </div>
                        ))}
                        <div className="g-action-row">
                          <button className="confirm-btn confirm-btn-yes" style={{flex:1}}
                            onClick={()=>onImportEvents(calEvents.filter((_,i)=>selected.has(i)))}
                            disabled={selected.size===0}>
                            Import {selected.size} event{selected.size!==1?'s':''}
                          </button>
                          <button className="confirm-btn confirm-btn-cancel" onClick={()=>{setCalFetched(false);setCalEvents([]);}}>
                            Re-fetch
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            </>
            )}
          </div>
        )}

        {/* ── Docs Tab ── */}
        {tab==='docs' && (
          <div className="g-section">
            {!isConnected ? (
              <div className="g-note" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span>Connect Google to import Docs.</span>
                <button className="g-hdr-btn" onClick={onConnect}>Connect</button>
              </div>
            ) : (
            <>
            <p className="g-note">Paste a Google Doc URL or ID below. Text only; formatting won't carry over.</p>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <input type="text" value={docInput} onChange={e=>{setDocInput(e.target.value);setErr(null);}}
                placeholder="https://docs.google.com/document/d/... or Doc ID"
                style={{flex:1,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 14px',color:'var(--text)',fontSize:'0.85rem',outline:'none',transition:'border-color .2s'}}
                onFocus={e=>e.target.style.borderColor='var(--accent)'}
                onBlur={e=>e.target.style.borderColor='var(--border)'}/>
              {docInput && <button onClick={()=>{setDocInput('');setErr(null);}}
                style={{background:'transparent',border:'none',color:'var(--text-dim)',cursor:'pointer',padding:'2px 6px',display:'flex'}}>{Icon.x(14)}</button>}
            </div>
            <button className="confirm-btn confirm-btn-yes" style={{width:'100%',marginTop:8}}
              onClick={importDoc} disabled={docLoading||!docInput.trim()}>
              {docLoading?'Importing…':'Import to Notes'}
            </button>
            </>
            )}
          </div>
        )}

        {/* ── PDF Tab ── */}
        {tab==='pdf' && (
          <div className="g-section">
            <button className="g-btn" onClick={()=>fileInputRef.current?.click()} disabled={pdfLoading}>
              <span style={{display:'flex'}}>{Icon.fileText(16)}</span> {pdfLoading?'Reading PDF…':'Upload PDF from your computer'}
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf" style={{display:'none'}}
              onChange={e=>{if(e.target.files?.[0]){importPdf(e.target.files[0]);e.target.value='';}}}/>

            <p className="g-note" style={{marginTop:8,display:'flex',alignItems:'flex-start',gap:6}}><span style={{display:'flex',flexShrink:0,color:'var(--warning)',marginTop:1}}>{Icon.alertTriangle(14)}</span> Scanned/photo PDFs won't work — only PDFs with real digital text can be read.</p>
          </div>
        )}

        {/* ── Audio Tab ── */}
        {tab==='audio' && (
          <div className="g-section">
            <button className="g-btn" onClick={()=>audioInputRef.current?.click()} disabled={audioLoading}>
              <span style={{display:'flex'}}>{Icon.headphones(16)}</span> {audioLoading?'Transcribing audio…':'Upload audio file to transcribe'}
            </button>
            <input ref={audioInputRef} type="file" accept=".mp3,.wav,.m4a,.ogg,.webm,.aac,.flac" style={{display:'none'}}
              onChange={e=>{if(e.target.files?.[0]){importAudio(e.target.files[0]);e.target.value='';}}}/>
            <p className="g-note" style={{marginTop:8}}>Supported: MP3, WAV, M4A, OGG, WebM, AAC, FLAC. Max 25MB. Audio will be transcribed to text and saved as a note.</p>
          </div>
        )}

        {/* ── Video Tab ── */}
        {tab==='video' && (
          <div className="g-section">
            <button className="g-btn" onClick={()=>videoInputRef.current?.click()} disabled={videoLoading}>
              <span style={{display:'flex'}}>{Icon.video(16)}</span> {videoLoading?'Transcribing video…':'Upload video file to transcribe'}
            </button>
            <input ref={videoInputRef} type="file" accept=".mp4,.webm,.mov,.avi,.mkv" style={{display:'none'}}
              onChange={e=>{if(e.target.files?.[0]){importVideo(e.target.files[0]);e.target.value='';}}}/>
            <p className="g-note" style={{marginTop:8}}>Supported: MP4, WebM, MOV, AVI, MKV. Max 25MB. Audio from the video will be transcribed to text and saved as a note.</p>
          </div>
        )}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════
   SCHEDULE PEEK PANEL (with fullscreen calendar)
   ═══════════════════════════════════════════════ */
function SchedulePeek({ tasks, blocks, events, weatherData, onClose, embedded = false, recentlyCompleted = new Set() }) {
  const todayKey = today(); const todayDow = new Date().getDay();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [calView, setCalView] = useState('month');
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());

  const timeline = useMemo(() => {
    const result = {};
    (blocks.recurring || []).forEach(rb => {
      if (rb.days.includes(todayDow)) {
        const [sh,sm]=rb.start.split(':').map(Number); const [eh,em]=rb.end.split(':').map(Number);
        let ch=sh,cm=sm;
        while(ch<eh||(ch===eh&&cm<em)){const key=String(ch).padStart(2,'0')+':'+String(cm).padStart(2,'0');result[key]={name:rb.name,category:rb.category};cm+=30;if(cm>=60){ch++;cm=0;}}
      }
    });
    const ov = blocks.dates?.[todayKey]||{};
    Object.entries(ov).forEach(([k,v])=>{if(v===null)delete result[k];else result[k]=v;});
    return result;
  },[blocks,todayKey,todayDow]);

  const condensed = useMemo(()=>{
    const sorted=Object.entries(timeline).sort(([a],[b])=>a.localeCompare(b));const bl=[];let cur=null;
    sorted.forEach(([time,data])=>{if(cur&&cur.name===data.name&&cur.category===data.category){cur.end=time;cur.slots++}else{if(cur)bl.push(cur);cur={start:time,end:time,name:data.name,category:data.category,slots:1}}});
    if(cur)bl.push(cur);
    return bl.map(b=>{const[eh,em]=b.end.split(':').map(Number);let nm=em+30,nh=eh;if(nm>=60){nh++;nm=0}return{...b,endDisplay:String(nh).padStart(2,'0')+':'+String(nm).padStart(2,'0')}});
  },[timeline]);

  const overduePeekTasks=useMemo(()=>tasks.filter(t=>t.status!=='done'&&daysUntil(t.dueDate)<0).sort((a,b)=>daysUntil(a.dueDate)-daysUntil(b.dueDate)),[tasks]);
  const activeTasks=useMemo(()=>{
    const completing = tasks.filter(t => recentlyCompleted.has(t.id));
    const active = tasks.filter(t=>t.status!=='done'&&daysUntil(t.dueDate)>=0).sort((a,b)=>getPriority(a)-getPriority(b)).slice(0,5);
    // prepend any completing tasks not already in list
    const completing2 = completing.filter(t => !active.some(a => a.id === t.id));
    return [...completing2, ...active];
  },[tasks, recentlyCompleted]);
  const upcomingEvents=useMemo(()=>events.filter(ev=>{const d=daysUntil(ev.date);return d>=0&&d<=7}).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4),[events]);
  const currentHour=new Date().getHours();
  const greeting=currentHour<12?'Good morning':currentHour<17?'Good afternoon':'Good evening';

  // ── Month calendar grid ──
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startDow = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const prevMonthLast = new Date(calYear, calMonth, 0).getDate();

    const cells = [];
    // Previous month trailing days
    for (let i = startDow - 1; i >= 0; i--) {
      const d = prevMonthLast - i;
      const dt = new Date(calYear, calMonth - 1, d);
      cells.push({ date: dt, day: d, isCurrentMonth: false });
    }
    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(calYear, calMonth, d);
      cells.push({ date: dt, day: d, isCurrentMonth: true });
    }
    // Next month leading days
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const dt = new Date(calYear, calMonth + 1, d);
        cells.push({ date: dt, day: d, isCurrentMonth: false });
      }
    }
    return cells;
  }, [calYear, calMonth]);

  // Build a map of date → items for the calendar
  const dateItemsMap = useMemo(() => {
    const map = {};
    function addItem(dateStr, item) {
      if (!map[dateStr]) map[dateStr] = [];
      if (item.cls === 'block' && map[dateStr].some(i => i.cls === 'block' && i.title === item.title)) return;
      map[dateStr].push(item);
    }
    tasks.forEach(t => {
      if (!t.dueDate) return;
      const cls = t.status === 'done' ? 'task' : (daysUntil(t.dueDate) < 0 ? 'overdue' : 'task');
      addItem(t.dueDate, { title: t.title, cls });
    });
    events.forEach(ev => {
      if (!ev.date) return;
      addItem(ev.date, { title: ev.title, cls: 'event' });
    });
    (blocks.recurring || []).forEach(rb => {
      calendarDays.forEach(cell => {
        if (rb.days.includes(cell.date.getDay())) {
          const ds = toDateStr(cell.date);
          addItem(ds, { title: rb.name, cls: 'block' });
        }
      });
    });
    Object.entries(blocks.dates || {}).forEach(([dateStr, slots]) => {
      const seen = new Set();
      Object.values(slots).forEach(slot => {
        if (slot && slot.name && !seen.has(slot.name)) { seen.add(slot.name); addItem(dateStr, { title: slot.name, cls: 'block' }); }
      });
    });
    return map;
  }, [tasks, events, blocks, calendarDays]);

  function prevMonth() { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }
  function nextMonth() { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }
  function goToday() { setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth()); }

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayHeaders = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // ── Weekly view data ──
  const weekDays = useMemo(() => {
    const now = new Date();
    const sunday = new Date(now); sunday.setDate(now.getDate() - now.getDay()); sunday.setHours(0,0,0,0);
    return Array.from({length:7}, (_, i) => { const d = new Date(sunday); d.setDate(sunday.getDate() + i); return d; });
  }, []);

  const weekDayItems = useMemo(() => {
    return weekDays.map(day => {
      const ds = toDateStr(day);
      const dow = day.getDay();
      const dayBlocks = [];
      const seen = new Set();
      (blocks.recurring || []).forEach(rb => {
        if (rb.days.includes(dow) && !seen.has(rb.name)) { seen.add(rb.name); dayBlocks.push({ title: rb.name, cls: 'block' }); }
      });
      Object.entries(blocks.dates?.[ds] || {}).forEach(([, slot]) => {
        if (slot && slot.name && !seen.has(slot.name)) { seen.add(slot.name); dayBlocks.push({ title: slot.name, cls: 'block' }); }
      });
      const dayTasks = tasks.filter(t => t.dueDate === ds && t.status !== 'done').map(t => ({ title: t.title, cls: daysUntil(t.dueDate) < 0 ? 'overdue' : 'task' }));
      const dayEvents = events.filter(ev => ev.date === ds).map(ev => ({ title: ev.title, cls: 'event' }));
      return { date: day, ds, items: [...dayBlocks, ...dayTasks, ...dayEvents] };
    });
  }, [weekDays, blocks, tasks, events]);

  return (<>
    {!embedded && <div className="peek-overlay" onClick={onClose}/>}
    <div className={'peek-panel' + (embedded ? ' embedded' : '') + (isFullscreen && !embedded ? ' fullscreen' : '')}>
      {!isFullscreen && <div className="peek-handle"/>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div><div style={{fontSize:'1.1rem',fontWeight:700}}>{greeting}</div><div style={{fontSize:'0.82rem',color:'var(--text-dim)'}}>{fmtFull(new Date())}</div></div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          {weatherData?.current&&<div style={{display:'flex',alignItems:'center',gap:6,marginRight:4}}><span style={{display:'flex',color:'var(--teal)'}}>{weatherEmoji(weatherData.current.weathercode)}</span><span style={{fontWeight:700}}>{Math.round(weatherData.current.temperature_2m)}°F</span></div>}
          <button className="notes-fs-btn" onClick={() => setIsFullscreen(f => !f)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen calendar'}>
            {isFullscreen ? Icon.minimize(16) : Icon.maximize(16)}
          </button>
          {!embedded && <button className="g-modal-close" onClick={onClose}>{Icon.x(16)}</button>}
        </div>
      </div>

      {/* ── Fullscreen: View Tabs + Calendar ── */}
      {isFullscreen && (
        <div style={{marginBottom:16}}>
          {/* View toggle tabs */}
          <div style={{display:'flex',gap:6,marginBottom:12}}>
            {['month','week'].map(v => (
              <button key={v} onClick={()=>setCalView(v)}
                style={{padding:'5px 14px',borderRadius:8,border:'1px solid',fontSize:'0.8rem',fontWeight:600,cursor:'pointer',transition:'all .15s',
                  borderColor: calView===v ? 'var(--accent)' : 'var(--border)',
                  background: calView===v ? 'rgba(108,99,255,0.18)' : 'transparent',
                  color: calView===v ? 'var(--accent)' : 'var(--text-dim)'}}>
                {v.charAt(0).toUpperCase()+v.slice(1)}
              </button>
            ))}
          </div>

          {calView === 'month' && (<>
            <div className="cal-month-nav">
              <button className="cal-nav-btn" onClick={prevMonth}>{Icon.chevronLeft(16)}</button>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span className="cal-month-title">{monthNames[calMonth]} {calYear}</span>
                <button className="cal-nav-btn" onClick={goToday} style={{fontSize:'0.75rem',padding:'4px 10px'}}>Today</button>
              </div>
              <button className="cal-nav-btn" onClick={nextMonth}>{Icon.chevronRight(16)}</button>
            </div>
            <div className="cal-grid">
              {dayHeaders.map(d => (<div key={d} className="cal-day-header">{d}</div>))}
              {calendarDays.map((cell, i) => {
                const dateStr = toDateStr(cell.date);
                const isToday = dateStr === todayKey;
                const items = dateItemsMap[dateStr] || [];
                const maxShow = 2;
                return (
                  <div key={i} className={'cal-cell' + (cell.isCurrentMonth ? '' : ' other-month') + (isToday ? ' today' : '')}>
                    <div className="cal-cell-date" style={isToday ? {color:'var(--accent)'} : {}}>{cell.day}</div>
                    {items.slice(0, maxShow).map((item, j) => (
                      <div key={j} className={'cal-cell-event ' + item.cls} title={item.title}>{item.title}</div>
                    ))}
                    {items.length > maxShow && <div className="cal-cell-more">+{items.length - maxShow} more</div>}
                  </div>
                );
              })}
            </div>
          </>)}

          {calView === 'week' && (
            <div>
              <div style={{textAlign:'center',fontWeight:600,marginBottom:10,color:'var(--text-dim)',fontSize:'0.85rem'}}>
                Week of {weekDays[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} – {weekDays[6].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4}}>
                {weekDayItems.map(({date, ds, items}) => {
                  const isToday = ds === todayKey;
                  return (
                    <div key={ds} style={{background: isToday ? 'rgba(108,99,255,0.1)' : 'rgba(255,255,255,0.05)', border: isToday ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius:10, padding:'6px 4px', minHeight:90}}>
                      <div style={{textAlign:'center',marginBottom:4}}>
                        <div style={{fontSize:'0.7rem',color:'var(--text-dim)',textTransform:'uppercase',fontWeight:600}}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()]}</div>
                        <div style={{fontSize:'0.85rem',fontWeight:700,color: isToday ? 'var(--accent)' : 'var(--text)'}}>{date.getDate()}</div>
                      </div>
                      {items.length === 0 && <div style={{fontSize:'0.62rem',color:'var(--text-dim)',textAlign:'center',marginTop:4}}>free</div>}
                      {items.map((item, j) => (
                        <div key={j} className={'cal-cell-event ' + item.cls} title={item.title} style={{marginBottom:2}}>{item.title}</div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Regular peek content ── */}
      <div className="peek-section">
        <div className="peek-section-title">Today's Schedule</div>
        {condensed.length===0?<div style={{fontSize:'0.85rem',color:'var(--text-dim)',padding:'8px 0'}}>Wide open! Your future self will thank you 🗓️</div>:
        condensed.map((block,i)=>(
          <div key={i} className="peek-timeline-slot"><div className="peek-timeline-time">{fmtTime(...block.start.split(':').map(Number))}</div>
          <div className="peek-timeline-block" style={{background:catColor(block.category)+'20',borderLeft:'3px solid '+catColor(block.category)}}>{block.name}<span style={{fontSize:'0.72rem',color:'var(--text-dim)',marginLeft:8}}>{block.slots*30}min</span></div></div>
        ))}
      </div>
      {overduePeekTasks.length>0&&<div className="peek-section">
        <div className="peek-section-title" style={{color:'var(--danger)',display:'flex',alignItems:'center',gap:4}}>{Icon.alertTriangle(14)} Overdue ({overduePeekTasks.length})</div>
        {overduePeekTasks.map(task=>(<div key={task.id} className="peek-task-item">
          <div className="peek-task-dot" style={{background:'var(--danger)'}}/>
          <div style={{flex:1}}>
            <div style={{fontWeight:600,color:'var(--danger)'}}>{task.title}</div>
            <div style={{fontSize:'0.75rem',color:'var(--text-dim)'}}>{task.subject&&task.subject+' · '}{Math.abs(daysUntil(task.dueDate))}d overdue{' · '+(task.estTime||30)+'min'}</div>
          </div>
          <div style={{color:'var(--danger)',display:'flex'}}>{task.status==='in_progress'?Icon.circleDot(14):Icon.circle(14)}</div>
        </div>))}
      </div>}
      {activeTasks.length>0&&<div className="peek-section"><div className="peek-section-title">Upcoming Tasks ({activeTasks.filter(t=>t.status!=='done').length})</div>
        {activeTasks.map(task=>{
          const completing = recentlyCompleted.has(task.id);
          const d=daysUntil(task.dueDate);
          const dotColor=completing?'var(--success)':d<=1?'var(--warning)':d<=3?'var(--accent)':'var(--text-dim)';
          return(<div key={task.id} className={'peek-task-item'+(completing?' task-completing':'')} style={completing?{background:'rgba(46,213,115,0.08)',borderRadius:10,padding:'4px 6px',transition:'all .3s'}:{}}><div className="peek-task-dot" style={{background:dotColor}}/><div style={{flex:1}}><div style={{fontWeight:500,color:completing?'var(--success)':undefined}}>{task.title}</div><div style={{fontSize:'0.75rem',color:'var(--text-dim)'}}>{task.subject&&task.subject+' · '}{completing?'Completed! 🎉':d===0?'Today':d===1?'Tomorrow':fmt(task.dueDate)}{!completing&&' · '+(task.estTime||30)+'min'}</div></div><div style={{color:completing?'var(--success)':dotColor,display:'flex'}}>{completing?Icon.checkCircle(14):task.status==='in_progress'?Icon.circleDot(14):Icon.circle(14)}</div></div>)
        })}
      </div>}
      {upcomingEvents.length>0&&<div className="peek-section"><div className="peek-section-title">Upcoming Events</div>
        {upcomingEvents.map(ev=>(<div key={ev.id} className="peek-task-item"><div className="peek-task-dot" style={{background:catColor(ev.type)}}/><div><div style={{fontWeight:500}}>{ev.title}</div><div style={{fontSize:'0.75rem',color:'var(--text-dim)'}}>{fmt(ev.date)}{ev.subject&&' · '+ev.subject}</div></div></div>))}
      </div>}
    </div>
  </>);
}

/* ═══════════════════════════════════════════════
   NOTES PANEL (reference system + editing + fullscreen)
   ═══════════════════════════════════════════════ */
function NotesPanel({ notes, onClose, onDeleteNote, onUpdateNote, onCreateNote, embedded = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newNoteName, setNewNoteName] = useState('');
  const editorRef = useRef(null);

  // ── Search / reference system ──
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const queryWords = normalize(searchQuery).split(/\s+/).filter(w => w.length > 0);
    if (queryWords.length === 0) return notes;

    const scored = notes.map(note => {
      const normName = normalize(note.name);
      const normContent = normalize(note.content || '');
      let score = 0;
      let firstMatchIndex = -1;
      queryWords.forEach(qw => {
        if (normName.includes(qw)) score += 40;
        const idx = normContent.indexOf(qw);
        if (idx >= 0) {
          score += 30;
          if (firstMatchIndex < 0) firstMatchIndex = idx;
        }
      });
      return { note, score, firstMatchIndex };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

    return scored.map(s => ({ ...s.note, _firstMatch: s.firstMatchIndex }));
  }, [notes, searchQuery]);

  function getSnippet(content, firstMatch) {
    if (firstMatch < 0 || !content) return content?.slice(0, 150) || '';
    const start = Math.max(0, firstMatch - 80);
    const end = Math.min(content.length, firstMatch + 120);
    let snippet = content.slice(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < content.length) snippet += '…';
    return snippet;
  }

  function highlightText(text) {
    if (!searchQuery.trim() || !text) return text;
    const queryWords = normalize(searchQuery).split(/\s+/).filter(w => w.length > 1);
    if (queryWords.length === 0) return text;
    const pattern = queryWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const splitRegex = new RegExp('(' + pattern + ')', 'gi');
    const testRegex = new RegExp(pattern, 'i');
    const parts = text.split(splitRegex);
    return parts.map((part, i) => testRegex.test(part)
      ? React.createElement('span', { key: i, className: 'notes-match' }, part)
      : part
    );
  }

  function getSourceBadge(note) {
    const src = note.source || '';
    if (src === 'pdf') return React.createElement('span', { className: 'notes-badge notes-badge-pdf' }, 'PDF');
    if (src === 'google_docs') return React.createElement('span', { className: 'notes-badge notes-badge-docs' }, 'Docs');
    if (src === 'manual') return React.createElement('span', { className: 'notes-badge', style:{background:'rgba(43,203,186,0.12)',color:'var(--teal)'} }, 'Manual');
    return React.createElement('span', { className: 'notes-badge notes-badge-ai' }, 'AI');
  }

  // ── Formatting toolbar actions ──
  function execFormat(cmd, value) {
    document.execCommand(cmd, false, value || null);
    editorRef.current?.focus();
  }

  // ── Start editing a note ──
  function startEdit(note, e) {
    e.stopPropagation();
    setEditingId(note.id);
    setEditingName(note.name);
    setExpandedId(note.id);
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = note.content || '';
        editorRef.current.focus();
      }
    }, 50);
  }

  // ── Save edited note ──
  function saveEdit() {
    if (!editingName.trim()) return;
    const content = editorRef.current?.innerHTML || '';
    onUpdateNote({ id: editingId, name: editingName.trim(), content, updatedAt: new Date().toISOString() });
    setEditingId(null);
    setEditingName('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName('');
  }

  // ── Create new note ──
  function startNewNote() {
    setIsCreatingNew(true);
    setNewNoteName('');
    setExpandedId(null);
    setEditingId(null);
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
        editorRef.current.focus();
      }
    }, 50);
  }

  function saveNewNote() {
    const title = newNoteName.trim() || 'Untitled Note';
    const content = editorRef.current?.innerHTML || '';
    onCreateNote({ name: title, content, source: 'manual' });
    setIsCreatingNew(false);
    setNewNoteName('');
  }

  function cancelNewNote() {
    setIsCreatingNew(false);
    setNewNoteName('');
  }

  function duplicateNote(note, e) {
    e.stopPropagation();
    onCreateNote({
      name: `${note.name} (Copy)`,
      content: note.content || '',
      source: note.source || 'manual'
    });
  }

  function handleNoteToolbarAction(action, note, isExpanded, e) {
    e.stopPropagation();
    switch (action) {
      case 'edit':
        startEdit(note, e);
        break;
      case 'duplicate':
        duplicateNote(note, e);
        break;
      case 'delete':
        onDeleteNote(note.id);
        break;
      case 'visibility':
        setExpandedId(isExpanded ? null : note.id);
        break;
      default:
        break;
    }
  }

  const FormatToolbar = useCallback(() => (
    <div className="notes-toolbar">
      <button className="notes-toolbar-btn" onClick={() => execFormat('bold')} title="Bold"><b>B</b></button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('italic')} title="Italic"><i>I</i></button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('underline')} title="Underline"><u>U</u></button>
      <div className="notes-toolbar-sep"/>
      <button className="notes-toolbar-btn" onClick={() => execFormat('fontSize', '2')} title="Small text" style={{fontSize:'0.68rem'}}>A</button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('fontSize', '4')} title="Medium text" style={{fontSize:'0.82rem'}}>A</button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('fontSize', '6')} title="Large text" style={{fontSize:'1rem'}}>A</button>
      <div className="notes-toolbar-sep"/>
      <button className="notes-toolbar-btn" onClick={() => execFormat('indent')} title="Indent">{Icon.arrowRight(14)}</button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('outdent')} title="Outdent">{Icon.arrowLeft(14)}</button>
      <div className="notes-toolbar-sep"/>
      <button className="notes-toolbar-btn" onClick={() => execFormat('insertUnorderedList')} title="Bullet list">•</button>
      <button className="notes-toolbar-btn" onClick={() => execFormat('insertOrderedList')} title="Numbered list">1.</button>
    </div>
  ), []);

  return (
    <>
      {!embedded && <div className="peek-overlay" onClick={onClose}/>}
      <div className={'notes-panel' + (embedded ? ' embedded' : '') + (isFullscreen && !embedded ? ' fullscreen' : '')}>
        {!isFullscreen && <div className="peek-handle"/>}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{display:'flex',color:'var(--accent)'}}>{Icon.fileText(18)}</span>
            <span style={{fontWeight:700,fontSize:'1.05rem'}}>Notes</span>
            {notes.length > 0 && <span style={{fontSize:'0.75rem',color:'var(--text-dim)',background:'var(--bg2)',padding:'2px 8px',borderRadius:10,fontWeight:600}}>{notes.length}</span>}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <button className="notes-new-btn" onClick={startNewNote} style={{display:'flex',alignItems:'center',gap:4}}>{Icon.plus(14)} New Note</button>
            <button className="notes-fs-btn" onClick={() => setIsFullscreen(f => !f)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? Icon.minimize(16) : Icon.maximize(16)}
            </button>
            {!embedded && <button className="g-modal-close" onClick={onClose}>{Icon.x(16)}</button>}
          </div>
        </div>

        {/* ── New note creation form ── */}
        {isCreatingNew && (
          <div style={{marginBottom:16,animation:'fadeIn .2s ease'}}>
            <input className="notes-title-input" value={newNoteName} onChange={e => setNewNoteName(e.target.value)}
              placeholder="Note title..." autoFocus/>
            <FormatToolbar/>
            <div ref={editorRef} className="notes-editor" contentEditable data-placeholder="Start writing your note..."
              onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); execFormat('indent'); }}}/>
            <div className="notes-edit-actions">
              <button className="notes-cancel-btn" onClick={cancelNewNote}>Cancel</button>
              <button className="notes-save-btn" onClick={saveNewNote}>Save Note</button>
            </div>
          </div>
        )}

        {/* ── Search bar ── */}
        {notes.length > 0 && !isCreatingNew && !editingId && (
          <div className="notes-search-wrap">
            <span className="notes-search-icon" style={{display:'flex'}}>{Icon.search(14)}</span>
            <input className="notes-search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search notes for keywords..." autoFocus/>
          </div>
        )}

        {/* ── Empty states ── */}
        {filteredNotes.length === 0 && !searchQuery.trim() && !isCreatingNew && (
          <div className="notes-empty">
            <div style={{marginBottom:8,opacity:0.4,display:'flex',justifyContent:'center',color:'var(--accent)'}}>{Icon.fileText(28)}</div>
            <div>Nothing here yet — drop your first note 📝</div>
            <div style={{fontSize:'0.82rem',marginTop:4}}>Click "+ New Note" to create one, or import a PDF, Google Doc, or save study materials from chat</div>
          </div>
        )}

        {filteredNotes.length === 0 && searchQuery.trim() && !isCreatingNew && (
          <div className="notes-empty">
            <div style={{marginBottom:8,opacity:0.4,display:'flex',justifyContent:'center',color:'var(--accent)'}}>{Icon.search(24)}</div>
            <div>No matches for "{searchQuery}"</div>
            <div style={{fontSize:'0.82rem',marginTop:4}}>Try different keywords or check spelling</div>
          </div>
        )}

        {/* ── Notes list ── */}
        <div className="notes-list">
          {filteredNotes.map(note => {
            const isExpanded = expandedId === note.id;
            const isEditing = editingId === note.id;
            const isSearching = searchQuery.trim().length > 0;
            const plainContent = (note.content || '').replace(/<[^>]*>/g, '');
            const snippet = isSearching && note._firstMatch !== undefined
              ? getSnippet(plainContent, note._firstMatch)
              : plainContent.slice(0, 150);

            return (
              <div key={note.id} className={'notes-item' + (isExpanded ? ' expanded' : '')}
                onClick={() => { if (!isEditing) { setExpandedId(isExpanded ? null : note.id); setEditingId(null); } }}>
                {/* ── Editing mode ── */}
                {isEditing ? (
                  <div onClick={e => e.stopPropagation()}>
                    <input className="notes-title-input" value={editingName} onChange={e => setEditingName(e.target.value)}
                      placeholder="Note title..." autoFocus/>
                    <FormatToolbar/>
                    <div ref={editorRef} className="notes-editor" contentEditable data-placeholder="Write something..."
                      onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); execFormat('indent'); }}}/>
                    <div className="notes-edit-actions">
                      <button className="notes-cancel-btn" onClick={cancelEdit}>Cancel</button>
                      <button className="notes-save-btn" onClick={saveEdit}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="notes-item-header">
                      <div className="notes-item-name">{isSearching ? highlightText(note.name) : note.name}</div>
                      <div className="notes-item-meta">
                        {getSourceBadge(note)}
                        {note.updatedAt && <span className="notes-item-date">{fmt(note.updatedAt)}</span>}
                        <EditToolbar
                          className="notes-item-edit-toolbar"
                          enabledActions={['edit', 'drag-handle', 'duplicate', 'delete', 'visibility']}
                          activeAction={{ visibility: isExpanded }}
                          onAction={(action, event) => handleNoteToolbarAction(action, note, isExpanded, event)}
                          ariaLabel={`Edit toolbar for ${note.name}`}
                        />
                      </div>
                    </div>
                    {!isExpanded && snippet && (
                      <div className="notes-item-preview">
                        {isSearching ? highlightText(snippet) : snippet}{!isSearching && plainContent.length > 150 ? '…' : ''}
                      </div>
                    )}
                    {isExpanded && (
                      <div className="notes-item-content" dangerouslySetInnerHTML={{__html: note.content || ''}}/>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════ */
function Toast({message,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,2400);return()=>clearTimeout(t)},[]);
  return(<div style={{position:'fixed',top:20,left:'50%',transform:'translateX(-50%)',zIndex:9999,padding:'10px 20px',borderRadius:14,background:'linear-gradient(135deg,var(--success),#1db954)',color:'#fff',fontWeight:600,fontSize:'0.88rem',boxShadow:'0 4px 24px rgba(46,213,115,0.4),0 0 40px rgba(46,213,115,0.1)',animation:'toastIn .3s cubic-bezier(0.16,1,0.3,1), toastOut .3s ease 2.1s forwards',backdropFilter:'blur(8px)'}}>{message}</div>);
}

/* ─── Typing Dots (loading indicator) ─── */
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAssistantMessage(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';

  const goalMatch = raw.match(/goal:\s*(.*?)(?=quick check:|next move:|$)/is);
  const quickCheckMatch = raw.match(/quick check:\s*(.*?)(?=next move:|$)/is);
  const nextMoveMatch = raw.match(/next move:\s*(.*)$/is);

  if (goalMatch || quickCheckMatch || nextMoveMatch) {
    const goalSection = (goalMatch?.[1] || '').trim();
    const goalParts = goalSection ? goalSection.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean) : [];
    const goalTitle = goalParts[0] || '';
    const goalBullets = goalParts.slice(1);
    const quickCheck = (quickCheckMatch?.[1] || '').trim();
    const nextMove = (nextMoveMatch?.[1] || '').trim();

    const html = `
      <div class="tutor-msg">
        ${goalTitle ? `<div class="tutor-msg-section"><div class="tutor-msg-label">goal</div><div class="tutor-msg-title">${escapeHtml(goalTitle)}</div>${goalBullets.length ? `<ul class="tutor-msg-list">${goalBullets.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</div>` : ''}
        ${quickCheck ? `<div class="tutor-msg-section"><div class="tutor-msg-label">quick check</div><div class="tutor-msg-body">${escapeHtml(quickCheck)}</div></div>` : ''}
        ${nextMove ? `<div class="tutor-msg-section tutor-msg-next"><div class="tutor-msg-label">next move</div><div class="tutor-msg-body">${escapeHtml(nextMove)}</div></div>` : ''}
      </div>
    `;
    return DOMPurify.sanitize(html);
  }

  const withBreaks = escapeHtml(raw)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|<br>)(goal|quick check|next move):/gi, '$1<strong>$2:</strong>')
    .replace(/\n/g, '<br/>');
  return DOMPurify.sanitize(withBreaks);
}

function getLoadingMessage(msgContent, photo, isPlanRequest) {
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

const ThinkingIndicator=({message="thinkisizing…"})=>(
  <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
    <div style={{background:'linear-gradient(135deg,rgba(26,26,46,0.95),rgba(15,15,26,0.95))',border:'1px solid rgba(108,99,255,0.12)',borderRadius:16,borderBottomLeftRadius:4,padding:'10px 18px',display:'inline-flex',alignItems:'center',backdropFilter:'blur(8px)',animation:'borderGlow 2s ease-in-out infinite'}}>
      <span style={{fontSize:13,fontStyle:'italic',background:'linear-gradient(135deg, var(--accent), var(--teal))',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',animation:'textPulse 1.6s ease-in-out infinite'}}>{message}</span>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════
   FIRST-RUN ONBOARDING MODAL
   ═══════════════════════════════════════════════ */
function FirstRunModal({ onClose, onConnectGoogle, onWeatherToggle, weatherEnabled }) {
  const [step, setStep] = useState(1);
  const TOTAL = 3;

  function handleClose() {
    try { localStorage.setItem('sos_onboarded', '1'); } catch(_) {}
    onClose();
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:400,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.7)',backdropFilter:'blur(8px)',animation:'overlayIn .2s ease'}}>
      <div style={{background:'var(--bg2)',border:'1px solid var(--border-mid)',borderRadius:24,padding:'28px 28px 24px',maxWidth:440,width:'calc(100% - 32px)',boxShadow:'0 20px 60px rgba(0,0,0,0.6)',animation:'cardPop .25s ease',position:'relative'}}>
        {/* Progress dots */}
        <div style={{display:'flex',justifyContent:'center',gap:6,marginBottom:24}}>
          {Array.from({length:TOTAL},(_,i)=>(
            <div key={i} style={{width:8,height:8,borderRadius:'50%',background: i+1<=step ? 'var(--accent)' : 'var(--border)',transition:'background .3s'}}/>
          ))}
        </div>

        {step === 1 && (
          <>
            <div style={{fontSize:'1.4rem',fontWeight:800,marginBottom:8,letterSpacing:'-0.5px'}}>Welcome to SOS 👋</div>
            <div style={{fontSize:'0.88rem',color:'var(--text-dim)',lineHeight:1.6,marginBottom:20}}>
              Your AI study sidekick. It knows your tasks, schedule, and notes — so you can just talk to it like a friend.
            </div>
            <div style={{background:'var(--bg)',borderRadius:14,padding:'14px 16px',marginBottom:12,border:'1px solid var(--border)'}}>
              <div style={{fontWeight:700,fontSize:'0.88rem',marginBottom:4}}>Connect Google Calendar</div>
              <div style={{fontSize:'0.78rem',color:'var(--text-dim)',marginBottom:10}}>Auto-sync your events so SOS always knows what's coming up.</div>
              <button onClick={()=>{onConnectGoogle();}} style={{background:'var(--accent)',border:'none',borderRadius:10,color:'#fff',fontWeight:700,fontSize:'0.82rem',padding:'8px 14px',cursor:'pointer',width:'100%'}}>Connect Calendar →</button>
            </div>
            <div style={{background:'var(--bg)',borderRadius:14,padding:'12px 16px',marginBottom:20,border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <div>
                <div style={{fontWeight:700,fontSize:'0.85rem',marginBottom:2}}>Weather-based theme ✨</div>
                <div style={{fontSize:'0.76rem',color:'var(--text-dim)'}}>App colors react to your local weather. Try it.</div>
              </div>
              <button onClick={onWeatherToggle} style={{background:weatherEnabled?'var(--success)':'var(--border)',border:'none',borderRadius:20,color:'#fff',fontWeight:700,fontSize:'0.78rem',padding:'6px 14px',cursor:'pointer',transition:'all .2s',whiteSpace:'nowrap'}}>{weatherEnabled?'On ✓':'Turn on'}</button>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setStep(2)} style={{flex:1,background:'var(--accent)',border:'none',borderRadius:12,color:'#fff',fontWeight:700,fontSize:'0.88rem',padding:'10px',cursor:'pointer'}}>Next →</button>
              <button onClick={()=>setStep(2)} style={{background:'transparent',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-dim)',fontSize:'0.82rem',padding:'10px 14px',cursor:'pointer'}}>Skip for now</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{fontSize:'1.3rem',fontWeight:800,marginBottom:8,letterSpacing:'-0.5px'}}>Add your first task 📋</div>
            <div style={{fontSize:'0.88rem',color:'var(--text-dim)',lineHeight:1.6,marginBottom:20}}>
              Just describe your work and SOS will add it. You can say things like:<br/>
              <span style={{color:'var(--accent)',fontStyle:'italic'}}>"Add a math essay due Friday, 45 mins"</span>
            </div>
            <div style={{background:'rgba(108,99,255,0.08)',border:'1px solid rgba(108,99,255,0.2)',borderRadius:14,padding:'14px 16px',marginBottom:20}}>
              <div style={{fontSize:'0.82rem',color:'var(--text-dim)',marginBottom:8,fontWeight:600}}>Quick examples to try:</div>
              {['I have a bio test on Thursday','Add essay due next Monday, 2 hours','Finish problem set by tomorrow'].map(ex=>(
                <div key={ex} style={{fontSize:'0.80rem',color:'var(--text)',padding:'6px 10px',borderRadius:8,background:'var(--bg)',marginBottom:4,border:'1px solid var(--border)'}}>{ex}</div>
              ))}
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setStep(3)} style={{flex:1,background:'var(--accent)',border:'none',borderRadius:12,color:'#fff',fontWeight:700,fontSize:'0.88rem',padding:'10px',cursor:'pointer'}}>Got it →</button>
              <button onClick={()=>setStep(s=>s-1)} style={{background:'transparent',border:'1px solid var(--border)',borderRadius:12,color:'var(--text-dim)',fontSize:'0.82rem',padding:'10px 14px',cursor:'pointer'}}>← Back</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{fontSize:'1.3rem',fontWeight:800,marginBottom:8,letterSpacing:'-0.5px'}}>Pro tip: Voice input 🎤</div>
            <div style={{fontSize:'0.88rem',color:'var(--text-dim)',lineHeight:1.6,marginBottom:20}}>
              Tap the mic button in the chat bar and just speak. SOS will transcribe and respond instantly — great for hands-free studying.
            </div>
            <div style={{display:'flex',alignItems:'center',gap:14,padding:'14px 16px',background:'var(--bg)',borderRadius:14,border:'1px solid var(--border)',marginBottom:20}}>
              <div style={{width:44,height:44,borderRadius:'50%',background:'rgba(56,216,232,0.12)',border:'1px solid rgba(56,216,232,0.3)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--accent)',flexShrink:0}}>
                {Icon.mic(20)}
              </div>
              <div>
                <div style={{fontWeight:600,fontSize:'0.85rem',marginBottom:2}}>Mic button</div>
                <div style={{fontSize:'0.76rem',color:'var(--text-dim)'}}>Available in the chat input bar below. Tap to start, tap again to send.</div>
              </div>
            </div>
            <button onClick={handleClose} style={{width:'100%',background:'var(--accent)',border:'none',borderRadius:12,color:'#fff',fontWeight:700,fontSize:'0.9rem',padding:'12px',cursor:'pointer'}}>Let's go!</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   SOS MAIN APP
   ═══════════════════════════════════════════════ */
function App() {
  const [user, setUser] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState('login');
  const [authNudge, setAuthNudge] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !localStorage.getItem('sos_onboarded'); } catch(_) { return false; }
  });
  const [authChecked, setAuthChecked] = useState(false);

  // ── Data stores ──
  const [tasks, setTasks] = useState([]);
  const [blocks, setBlocks] = useState({ recurring: [], dates: {} });
  const [notes, setNotes] = useState([]);
  const [events, setEvents] = useState([]);
  const [messages, setMessages] = useState([]);
  const [dbMessageCount, setDbMessageCount] = useState(0); // P1.4: track DB-loaded message count
  const [weatherData, setWeatherData] = useState(null);
  const [weatherCoords, setWeatherCoords] = useState({ lat:42.33, lon:-71.21 });

  // ── UI state ──
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("thinkisizing…");
  const [chatError, setChatError] = useState(null);
  const [contextTrimInfo, setContextTrimInfo] = useState(null); // { shown, total } when tasks trimmed
  const [recentlyCompleted, setRecentlyCompleted] = useState(new Set()); // task IDs completing right now
  const [pendingActions, setPendingActions] = useState([]);
  const [pendingContent, setPendingContent] = useState([]);
  const [pendingTemplateSelector, setPendingTemplateSelector] = useState(null);
  const [pendingClarification, setPendingClarification] = useState(null);
  const [pendingClarificationAnswers, setPendingClarificationAnswers] = useState(null);
  const [aiAutoApprove, setAiAutoApprove] = useState(() => localStorage.getItem('sos_ai_auto_approve') === 'true');
  const [showPeek, setShowPeek] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [layoutMode, setLayoutMode] = useState(() => localStorage.getItem('sos_layout_mode') || 'lofi');
  const [homeLayoutEditMode, setHomeLayoutEditMode] = useState(false);
const [ambientMode, setAmbientMode] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sos_sidebar_collapsed') === 'true');
  const [sidebarCompanionPanel, setSidebarCompanionPanel] = useState(() => localStorage.getItem('sos_sidebar_companion_panel') || 'notes');
  const [activePanel, setActivePanel] = useState('chat');
  const [companionCollapsed, setCompanionCollapsed] = useState(() => localStorage.getItem('sos_companion_collapsed') !== 'false');
  const [autoCollapseSidebarCompanion, setAutoCollapseSidebarCompanion] = useState(() => localStorage.getItem('sos_auto_collapse_sidebar_companion') !== 'false');
  const [compactCompanionToggle, setCompactCompanionToggle] = useState(() => localStorage.getItem('sos_companion_toggle_compact') !== 'false');
  const [weatherThemeEnabled, setWeatherThemeEnabled] = useState(() => localStorage.getItem('sos_weather_theme') === 'true');
  const [tutorMode, setTutorMode] = useState(() => localStorage.getItem('sos_tutor_mode') === 'true');
  const [showTutorIndicatorSidebar, setShowTutorIndicatorSidebar] = useState(() => localStorage.getItem('sos_tutor_indicator_sidebar') !== 'false');
  const [showTutorIndicatorTopbar, setShowTutorIndicatorTopbar] = useState(() => localStorage.getItem('sos_tutor_indicator_topbar') !== 'false');
  const [showPerfIndicatorSidebar, setShowPerfIndicatorSidebar] = useState(() => localStorage.getItem('sos_perf_indicator_sidebar') !== 'false');
  const [showPerfIndicatorTopbar, setShowPerfIndicatorTopbar] = useState(() => localStorage.getItem('sos_perf_indicator_topbar') !== 'false');
  const showSideBySide = showPeek && showNotes;
  const showSidebarCompanion = layoutMode === 'sidebar' && activePanel === 'chat' && sidebarCompanionPanel !== 'none';
  const getWorkspaceContext = useCallback((overridePanel = null) => {
    const effectivePanel = overridePanel || sidebarCompanionPanel;
    if (layoutMode === 'sidebar' && activePanel === 'chat' && !companionCollapsed) {
      if (effectivePanel === 'schedule') return 'schedule';
      if (effectivePanel === 'notes') return 'notes';
    }
    if (layoutMode === 'topbar' && activePanel === 'chat') {
      if (showNotes) return 'notes';
      if (showPeek) return 'schedule';
    }
    if (tutorMode && notes.length > 0 && activePanel === 'chat') return 'notes';
    return activePanel === 'chat' ? 'chat' : 'none';
  }, [sidebarCompanionPanel, layoutMode, activePanel, companionCollapsed, showNotes, showPeek, tutorMode, notes.length]);
  const workspaceContext = getWorkspaceContext();
  const workspaceModeLabel = workspaceContext === 'schedule'
    ? 'Schedule mode'
    : workspaceContext === 'notes'
      ? 'Notes mode'
      : null;
  const openCompanionPanel = useCallback((panel) => {
    setActivePanel('chat');
    setSidebarCompanionPanel(panel);
    setCompanionCollapsed(false);
    if (autoCollapseSidebarCompanion) setSidebarCollapsed(true);
    setShowPeek(false);
    setShowNotes(false);
  }, [autoCollapseSidebarCompanion]);
  const detectCompanionIntent = useCallback((text) => {
    const msg = (text || '').toLowerCase();
    if (!msg) return null;
    if (/\b(notes?|document|docs?|pdf|reference|summarize my notes|in my notes)\b/.test(msg)) return 'notes';
    if (/\b(calendar|schedule|planner|plan my day|today\'s plan|timetable|due date)\b/.test(msg)) return 'schedule';
    return null;
  }, []);
  const [toastMsg, setToastMsg] = useState(null);
  useEffect(() => { if (toastMsg) sfx.chime(); }, [toastMsg]);
  useEffect(() => {
    const onLock   = () => sfx.lock();
    const onReturn = () => sfx.unlock();
    window.addEventListener('sos:idle-lock',        onLock);
    window.addEventListener('sos:presence-return',  onReturn);
    return () => {
      window.removeEventListener('sos:idle-lock',       onLock);
      window.removeEventListener('sos:presence-return', onReturn);
    };
  }, []);
  const [syncStatus, setSyncStatus] = useState('saved'); // 'saving', 'saved', 'error'
  const [contentGenUsed, setContentGenUsed] = useState(0);
  const DAILY_CONTENT_LIMIT = 5;
  const [guestMsgCount, setGuestMsgCount] = useState(
    () => parseInt(localStorage.getItem('sos_guest_msg_count') || '0', 10)
  );
  // Google OAuth state
  const [googleToken, setGoogleToken] = useState(() => {
    const t = sessionStorage.getItem('sos_google_token');
    const exp = Number(sessionStorage.getItem('sos_google_expiry') || 0);
    return (t && exp > Date.now()) ? t : null;
  });
  const [googleExpiry, setGoogleExpiry] = useState(() => Number(sessionStorage.getItem('sos_google_expiry') || 0));
  const [googleUser, setGoogleUser] = useState(null);
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const googleClientRef = useRef(null);
  // Calendar auto-sync state (persisted to localStorage)
  const [calSyncEnabled, setCalSyncEnabled] = useState(() => localStorage.getItem('sos_cal_sync') === 'true');
  const [calSyncStatus, setCalSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'done' | 'error'
  const [calSyncLastAt, setCalSyncLastAt] = useState(() => localStorage.getItem('sos_cal_sync_last') || null);
  const [calSyncCount, setCalSyncCount] = useState(0);
  const [calSyncError, setCalSyncError] = useState(null);
  const syncCalendarRef = useRef(null); // always holds latest syncCalendar fn — avoids stale interval closures

  // Saved conversations state
  const [savedChats, setSavedChats] = useState([]);
  const [showChatSidebar, setShowChatSidebar] = useState(false);
  const [viewingSavedChatId, setViewingSavedChatId] = useState(null);
  const CHAT_SAVE_PREFIX = '[chat-save]';

  // Photo upload state
  const [pendingPhoto, setPendingPhoto] = useState(null); // { base64, preview, mimeType }
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const photoInputRef = useRef(null);

  // Voice-to-text state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const micStreamRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const waveformRef = useRef(null);
  const speechRecRef = useRef(null);             // live SpeechRecognition instance
  const speechTranscriptRef = useRef('');         // fallback transcript from browser
  // Web Audio API for volume visualisation
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const animFrameRef = useRef(null);
  const ring1Ref = useRef(null);
  const ring2Ref = useRef(null);
  const ring3Ref = useRef(null);
  const ring4Ref = useRef(null);

  // Daily Brief state
  const DAILY_BRIEF_ENABLED = false;
  const [dailyBrief, setDailyBrief] = useState(null);
  const briefRequestedRef = useRef(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const chatAreaRef = useRef(null);

  // ── Alternating welcome screen content ──
  const welcomeVariants = useMemo(() => [
    { greeting: "Hey, I'm Your Study Sidekick", desc: "Tell me what's on your plate and I'll help you figure it out. I know your tasks, schedule, and events — so just talk to me like a friend.", chips: ['I have a math test on Friday','What should I work on?','Make me flashcards for biology','Quiz me on chapter 3'] },
    { greeting: "What's the Move Today?", desc: "Drop your homework, tests, or deadlines on me and I'll help you stay on top of everything. No stress, just vibes.", chips: ['I need to study for finals','Break down my science project','What\'s on my schedule?','Summarize my notes'] },
    { greeting: "Ready When You Are", desc: "Tell me about your classes, assignments, or anything school-related. I'll organize it, remind you, and even quiz you when you need it.", chips: ['Add a homework assignment','Make a study plan for this week','I have practice at 4pm','Create an outline for my essay'] },
    { greeting: "Let's Get You Ahead", desc: "I can track your tasks, manage your schedule, create flashcards, and help you study smarter. Just tell me what you need.", chips: ['What\'s due this week?','Quiz me on vocabulary','I finished my essay','Help me plan my study time'] },
    { greeting: "Your Schedule, Simplified", desc: "Think of me as your personal planner that actually talks back. Tell me what's coming up and I'll handle the rest.", chips: ['I have a test tomorrow','Show me my tasks','Make flashcards for history','What should I prioritize?'] },
  ], []);
  const welcomeIdx = 0; // Pinned to first variant for a stable, consistent first impression

  // ── Auth handler ──
  async function handleAuth(authUser) {
    setUser(authUser);
    // Migrate any existing localStorage data to Supabase
    const didMigrate = await migrateLocalStorage(authUser.id);
    if (didMigrate) setToastMsg('Migrated your existing data to the cloud ☁️');

    // Load all data from Supabase
    const data = await loadAllFromSupabase(authUser.id);
    if (data) {
      setTasks(data.tasks);
      setBlocks(data.blocks);
      // Split notes: regular notes vs saved chat conversations
      const regularNotes = [];
      const chatSaves = [];
      (data.notes || []).forEach(n => {
        if (n.name && n.name.startsWith('[chat-save]')) {
          try {
            const parsed = JSON.parse(n.content);
            chatSaves.push({ id: n.id, title: parsed.title || 'Untitled Chat', messages: parsed.messages || [], savedAt: parsed.savedAt || n.updatedAt, messageCount: parsed.messageCount || 0 });
          } catch(e) { regularNotes.push(n); }
        } else { regularNotes.push(n); }
      });
      setNotes(regularNotes);
      setSavedChats(chatSaves);
      setEvents(data.events);
      setMessages(data.messages);
      setDbMessageCount(data.messages.length); // P1.4
      setWeatherCoords(data.weatherCoords);
    }

    // Fetch today's content generation count
    try {
      const now = new Date();
      const nyDate = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const { count } = await sb.from('content_generations')
        .select('*', { count:'exact', head:true })
        .eq('user_id', authUser.id)
        .gte('created_at', nyDate + 'T00:00:00-05:00');
      setContentGenUsed(count || 0);
    } catch(e) { console.error('Failed to fetch content gen count:', e); }

    setDataLoaded(true);
  }

  // ── Check for existing session on mount ──
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) handleAuth(session.user);
      setAuthChecked(true);
    });
  }, []);

  // ── Listen for auth state changes (logout, token refresh, OAuth redirect) ──
  useEffect(() => {
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setDataLoaded(false);
        setTasks([]); setBlocks({ recurring: [], dates: {} }); setNotes([]); setEvents([]); setMessages([]);
        setPendingClarification(null); setPendingClarificationAnswers(null);
      }
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user && !user) {
        handleAuth(session.user);
        setShowAuthModal(false);
        trackEvent(session.user.id, 'session_started'); // P4.2
      }
    });
    return () => subscription.unsubscribe();
  }, [user]);

  // ── Google OAuth initialization ──
  useEffect(() => {
    if (!dataLoaded) return;
    let attempts = 0;
    function tryInit() {
      if (window.google?.accounts?.oauth2) {
        googleClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: '504839570150-i4s8urseqgrjucbhqfjc9phiavrcn08d.apps.googleusercontent.com',
          scope: [
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/docs',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/userinfo.email',
          ].join(' '),
          callback: (resp) => {
            if (resp.access_token) {
              const expiry = Date.now() + ((resp.expires_in || 3600) * 1000);
              setGoogleToken(resp.access_token);
              setGoogleExpiry(expiry);
              sessionStorage.setItem('sos_google_token', resp.access_token);
              sessionStorage.setItem('sos_google_expiry', String(expiry));
              // Fetch the email for display
              fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { 'Authorization': 'Bearer ' + resp.access_token }
              }).then(r => r.json()).then(info => {
                setGoogleUser({ email: info.email, name: info.name });
              }).catch(() => {});
              setToastMsg('Connected to Google ✓');
            }
          },
          error_callback: (e) => { console.error('Google auth error:', e); },
        });
        // Restore saved user email if token still valid
        if (googleToken) {
          fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': 'Bearer ' + googleToken }
          }).then(r => r.ok ? r.json() : null).then(info => {
            if (info) setGoogleUser({ email: info.email, name: info.name });
          }).catch(() => {});
        }
      } else if (attempts < 20) {
        attempts++;
        setTimeout(tryInit, 500);
      }
    }
    tryInit();
  }, [dataLoaded]);

  function isGoogleConnected() { return !!googleToken && googleExpiry > Date.now(); }

  function connectGoogle() {
    if (googleClientRef.current) {
      googleClientRef.current.requestAccessToken({ prompt: isGoogleConnected() ? '' : 'consent' });
    } else {
      setToastMsg('Google not ready — try again in a moment');
    }
  }

  function disconnectGoogle() {
    if (googleToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(googleToken, () => {});
    }
    setGoogleToken(null); setGoogleExpiry(0); setGoogleUser(null);
    sessionStorage.removeItem('sos_google_token');
    sessionStorage.removeItem('sos_google_expiry');
    setToastMsg('Disconnected from Google');
  }

  // ── Auto-scroll ──
  useEffect(() => {
    const chatEl = chatAreaRef.current;
    if (!chatEl) return;
    chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading, pendingActions, pendingContent, pendingClarification]);

  // ── Focus input on load ──
  useEffect(() => { if (dataLoaded) setTimeout(() => inputRef.current?.focus(), 300); }, [dataLoaded]);

  // ── Weather fetch ──
  const [weatherCity, setWeatherCity] = useState(null);
  const fetchWeather = useCallback(async (coords, city) => {
    try {
      const { lat, lon } = coords || weatherCoords;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,windspeed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&temperature_unit=fahrenheit&timezone=auto&forecast_days=3`;
      const res = await fetch(url); if (!res.ok) throw new Error('Weather fetch failed');
      const data = await res.json();
      setWeatherData({ current:data.current, daily:data.daily, city: city || weatherCity, fetchedAt:Date.now() });
    } catch(e) { console.error('Weather fetch error:', e); }
  }, [weatherCoords, weatherCity]);
  // IP-based geolocation on first load (only when using default Boston coords)
  useEffect(() => {
    if (!dataLoaded) return;
    const isDefault = weatherCoords.lat === 42.33 && weatherCoords.lon === -71.21;
    if (isDefault) {
      fetch('https://ipapi.co/json/')
        .then(r => r.json())
        .then(d => {
          if (d.latitude && d.longitude) {
            const coords = { lat: d.latitude, lon: d.longitude };
            setWeatherCoords(coords);
            setWeatherCity(d.city || null);
            fetchWeather(coords, d.city || null);
          } else {
            fetchWeather();
          }
        })
        .catch(() => fetchWeather());
    } else {
      const stale = !weatherData?.fetchedAt || (Date.now() - weatherData.fetchedAt > 3600000);
      if (stale) fetchWeather();
    }
  }, [dataLoaded]);

  // ── Sync helper: wraps a DB write with sync status ──
  async function syncOp(fn) {
    setSyncStatus('saving');
    try { await fn(); setSyncStatus('saved'); } catch(e) { console.error('Sync error:', e); setSyncStatus('error'); }
  }

  // ── Update a single task and sync ──
  function updateTask(taskId, updates) {
    setTasks(prev => {
      const next = prev.map(t => t.id === taskId ? { ...t, ...updates } : t);
      if (user) {
        const updated = next.find(t => t.id === taskId);
        if (updated) syncOp(() => dbUpsertTask(updated, user.id));
      }
      return next;
    });
  }

  // ── Action executor (writes to Supabase) ──
  function executeAction(action) {
    try {
      switch (action.type) {
        case 'add_task': {
          const rawDue = action.due || today();
          const normalizedDue = (() => { try { return toDateStr(new Date(rawDue + 'T12:00:00')); } catch(_) { return today(); } })();
          // Guardrail: if AI resolved a weekday to a past date, advance to today or next occurrence
          const todayVal = today();
          let finalDue = normalizedDue;
          if (normalizedDue < todayVal) {
            const dueDayOfWeek = new Date(normalizedDue + 'T12:00:00').getDay();
            const todayDayOfWeek = new Date(todayVal + 'T12:00:00').getDay();
            const daysAhead = (dueDayOfWeek - todayDayOfWeek + 7) % 7; // 0 = today (same weekday)
            const corrected = new Date(todayVal + 'T12:00:00');
            corrected.setDate(corrected.getDate() + daysAhead);
            finalDue = toDateStr(corrected);
          }
          const task = { id:uid(), title:action.title||'Untitled', subject:action.subject||'', dueDate:finalDue, estTime:action.estimated_minutes||30, status:action.status||'not_started', focusMinutes:0, createdAt:new Date().toISOString() };
          setTasks(prev => {
            const updated = [...prev, task];
            // P2.5: Overloaded day detection
            const dayTasks = updated.filter(t => t.dueDate === task.dueDate && t.status !== 'done');
            const totalMinutes = dayTasks.reduce((sum, t) => sum + (t.estTime || 30), 0);
            if (totalMinutes > 300) { // >5 hours of work
              const dayName = new Date(task.dueDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
              // Find a lighter day
              let suggestDate = null;
              for (let i = 1; i <= 7; i++) {
                const d = new Date(task.dueDate + 'T12:00:00');
                d.setDate(d.getDate() + (i > 3 ? -(i - 3) : i)); // check ±3 days
                const ds = toDateStr(d);
                const loadMins = updated.filter(t => t.dueDate === ds && t.status !== 'done').reduce((s, t) => s + (t.estTime || 30), 0);
                if (loadMins < 180) { suggestDate = ds; break; }
              }
              if (suggestDate) {
                const suggestDay = new Date(suggestDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
                setTimeout(() => {
                  setMessages(prev => [...prev, { role: 'assistant', content: `${dayName}'s looking packed (${totalMinutes} min of work). Want me to move "${task.title}" to ${suggestDay} instead?`, timestamp: Date.now() }]);
                }, 500);
              }
            }
            return updated;
          });
          if (user) syncOp(() => dbUpsertTask(task, user.id));
          if (user) trackEvent(user.id, 'action_confirmed', { type: 'add_task' });
          break;
        }
        case 'complete_task':
          if (action.task_id) {
            updateTask(action.task_id, { status:'done', completedAt:new Date().toISOString() });
            // Brief delight animation — add to set, clear after animation duration
            setRecentlyCompleted(prev => { const n = new Set(prev); n.add(action.task_id); return n; });
            setTimeout(() => setRecentlyCompleted(prev => { const n = new Set(prev); n.delete(action.task_id); return n; }), 900);
          }
          break;
        case 'update_task':
          if (action.task_id) {
            const upd = {};
            if (action.title) upd.title = action.title;
            if (action.due) upd.dueDate = action.due;
            if (action.estimated_minutes) upd.estTime = action.estimated_minutes;
            updateTask(action.task_id, upd);
          }
          break;
        case 'add_block': {
          const date = action.date || today();
          const [sh,sm] = (action.start||'00:00').split(':').map(Number);
          const [eh,em] = (action.end||'01:00').split(':').map(Number);
          const slotOps = [];
          setBlocks(prev => {
            const newDates = { ...(prev.dates||{}) };
            const dayBlocks = { ...(newDates[date]||{}) };
            let ch=sh, cm=sm;
            while (ch<eh||(ch===eh&&cm<em)) {
              const key = String(ch).padStart(2,'0')+':'+String(cm).padStart(2,'0');
              const data = { name:action.activity||'Block', category:action.category||'school' };
              dayBlocks[key] = data;
              slotOps.push({ date, key, data });
              cm+=30; if(cm>=60){ch++;cm=0;}
            }
            newDates[date] = dayBlocks;
            return { ...prev, dates:newDates };
          });
          if (user && slotOps.length > 0) syncOp(() => Promise.all(slotOps.map(s => dbUpsertDateBlock(s.date, s.key, s.data, user.id))));
          break;
        }
        case 'add_event': {
          const rawEvDate = action.date || today();
          const normalizedEvDate = (() => { try { return toDateStr(new Date(rawEvDate + 'T12:00:00')); } catch(_) { return today(); } })();
          const ev = { id:uid(), title:action.title||'Event', type:action.event_type||'other', subject:action.subject||'', date:normalizedEvDate, time:action.time||null, description:action.description||'', location:action.location||'', priority:action.priority||'medium', recurring:'none', createdAt:new Date().toISOString(), source:'manual', googleId:null };
          setEvents(prev => {
            const updated = [...prev, ev];
            // P2.4: Recurring event pattern detection
            const newDay = new Date(ev.date + 'T12:00:00').getDay();
            const titleLower = ev.title.toLowerCase();
            const matches = updated.filter(e =>
              e.title.toLowerCase() === titleLower &&
              new Date(e.date + 'T12:00:00').getDay() === newDay
            );
            if (matches.length >= 2) {
              const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
              setTimeout(() => {
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `Looks like you have "${ev.title}" every ${dayNames[newDay]} — want me to auto-add these going forward?`,
                  timestamp: Date.now()
                }]);
              }, 500);
            }
            return updated;
          });
          if (user) syncOp(() => dbUpsertEvent(ev, user.id));
          if (user) trackEvent(user.id, 'action_confirmed', { type: 'add_event' });
          if (isGoogleConnected() && calSyncEnabled) {
            pushEventToGoogle(ev, googleToken).then(gid => {
              if (gid) {
                setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, googleId: gid } : e));
                if (user) syncOp(() => dbUpsertEvent({ ...ev, googleId: gid }, user.id));
              }
            });
          }
          break;
        }
        case 'add_note': {
          const tabName = action.tab_name||'SOS Note'; const content = action.content||'';
          setNotes(prev => {
            const existing = prev.findIndex(n => n.name.toLowerCase() === tabName.toLowerCase());
            if (existing >= 0) {
              const updated = prev.map((n,i) => i===existing ? { ...n, content:n.content+(n.content?'\n':'')+content, updatedAt:new Date().toISOString() } : n);
              if (user) syncOp(() => dbUpsertNote(updated[existing], user.id));
              return updated;
            }
            const newNote = { id:uid(), name:tabName, content, updatedAt:new Date().toISOString() };
            if (user) syncOp(() => dbUpsertNote(newNote, user.id));
            return [...prev, newNote];
          });
          break;
        }
        case 'edit_note': {
          const noteId = action.note_id;
          const newContent = action.new_content || '';
          setNotes(prev => {
            const updated = prev.map(n => n.id === noteId ? { ...n, content: newContent, updatedAt: new Date().toISOString() } : n);
            const note = updated.find(n => n.id === noteId);
            if (note && user) syncOp(() => dbUpsertNote(note, user.id));
            return updated;
          });
          break;
        }
        case 'delete_note': {
          const noteId = action.note_id;
          setNotes(prev => prev.filter(n => n.id !== noteId));
          if (user) syncOp(() => sb.from('notes').delete().eq('id', noteId).eq('user_id', user.id));
          break;
        }
        case 'break_task': {
          const newTasks = (action.subtasks||[]).map(st => ({
            id:uid(), title:st.title||'Part', subject:action.parent_title||'', dueDate:st.due||today(), estTime:st.estimated_minutes||20, status:'not_started', focusMinutes:0, createdAt:new Date().toISOString()
          }));
          setTasks(prev => [...prev, ...newTasks]);
          if (user && newTasks.length > 0) syncOp(() => Promise.all(newTasks.map(t => dbUpsertTask(t, user.id))));
          break;
        }
        case 'delete_task': {
          setTasks(prev => {
            const match = resolveTask(action.title || action.task_id, prev);
            if (!match) return prev;
            if (user) syncOp(() => dbDeleteTask(match.id, user.id));
            return prev.filter(t => t.id !== match.id);
          });
          break;
        }
        case 'delete_event': {
          setEvents(prev => {
            const match = resolveEvent(action.title || action.event_id, prev);
            if (!match) return prev;
            if (user) syncOp(() => dbDeleteEvent(match.id, user.id));
            if (match.googleId && isGoogleConnected() && calSyncEnabled) {
              deleteEventFromGoogle(match.googleId, googleToken);
            }
            return prev.filter(ev => ev.id !== match.id);
          });
          break;
        }
        case 'update_event': {
          setEvents(prev => {
            const match = resolveEvent(action.title || action.event_id, prev);
            if (!match) return prev;
            const next = prev.map(ev => ev.id === match.id ? {
              ...ev,
              ...(action.new_title && { title: action.new_title }),
              ...(action.date && { date: action.date }),
              ...(action.event_type && { type: action.event_type }),
              ...(action.subject !== undefined && { subject: action.subject })
            } : ev);
            const updated = next.find(ev => ev.id === match.id);
            if (updated && user) syncOp(() => dbUpsertEvent(updated, user.id));
            if (updated && updated.googleId && isGoogleConnected() && calSyncEnabled) {
              pushEventToGoogle(updated, googleToken);
            }
            return next;
          });
          break;
        }
        case 'delete_block':
          if (action.date && action.start) {
            const delDate = action.date;
            const [dsh,dsm] = (action.start).split(':').map(Number);
            const [deh,dem] = (action.end||action.start).split(':').map(Number);
            const delOps = [];
            setBlocks(prev => {
              const newDates = { ...(prev.dates||{}) };
              const dayBlks = { ...(newDates[delDate]||{}) };
              let dch=dsh, dcm=dsm;
              while (dch<deh||(dch===deh&&dcm<dem)) {
                const key = String(dch).padStart(2,'0')+':'+String(dcm).padStart(2,'0');
                delete dayBlks[key];
                delOps.push(key);
                dcm+=30; if(dcm>=60){dch++;dcm=0;}
              }
              newDates[delDate] = dayBlks;
              return { ...prev, dates:newDates };
            });
            if (user && delOps.length > 0) syncOp(() => Promise.all(delOps.map(key => dbUpsertDateBlock(delDate, key, null, user.id))));
          }
          break;
        case 'convert_event_to_block': {
          let sourceEvent = null;
          setEvents(prev => {
            const match = resolveEvent(action.title || action.event_id, prev);
            if (!match) return prev;
            sourceEvent = match;
            return prev.filter(ev => ev.id !== match.id);
          });
          if (!sourceEvent) break;

          const date = action.date || sourceEvent.date || today();
          const [sh, sm] = (action.start || '16:00').split(':').map(Number);
          const [eh, em] = (action.end || addThirtyMinutes(action.start || '16:00')).split(':').map(Number);
          const slotOps = [];
          setBlocks(prev => {
            const newDates = { ...(prev.dates || {}) };
            const dayBlocks = { ...(newDates[date] || {}) };
            let ch = sh, cm = sm;
            while (ch < eh || (ch === eh && cm < em)) {
              const key = String(ch).padStart(2, '0') + ':' + String(cm).padStart(2, '0');
              const data = { name: sourceEvent.title, category: action.category || 'school' };
              dayBlocks[key] = data;
              slotOps.push({ date, key, data });
              cm += 30;
              if (cm >= 60) { ch++; cm = 0; }
            }
            newDates[date] = dayBlocks;
            return { ...prev, dates: newDates };
          });
          if (user) {
            syncOp(() => dbDeleteEvent(sourceEvent.id, user.id));
            if (slotOps.length > 0) syncOp(() => Promise.all(slotOps.map(s => dbUpsertDateBlock(s.date, s.key, s.data, user.id))));
          }
          if (sourceEvent.googleId && isGoogleConnected() && calSyncEnabled) {
            deleteEventFromGoogle(sourceEvent.googleId, googleToken);
          }
          break;
        }
        case 'convert_block_to_event': {
          const range = resolveBlockRange(action, blocks);
          if (!range) break;

          const ev = {
            id: uid(),
            title: action.title || range.name || 'Event',
            type: action.event_type || 'event',
            subject: action.subject || '',
            date: range.date,
            recurring: 'none',
            createdAt: new Date().toISOString(),
            source: 'manual',
            googleId: null
          };
          setEvents(prev => [...prev, ev]);

          const [dsh, dsm] = (range.start).split(':').map(Number);
          const [deh, dem] = (range.end || addThirtyMinutes(range.start)).split(':').map(Number);
          const delOps = [];
          setBlocks(prev => {
            const newDates = { ...(prev.dates || {}) };
            const dayBlks = { ...(newDates[range.date] || {}) };
            let dch = dsh, dcm = dsm;
            while (dch < deh || (dch === deh && dcm < dem)) {
              const key = String(dch).padStart(2, '0') + ':' + String(dcm).padStart(2, '0');
              delete dayBlks[key];
              delOps.push(key);
              dcm += 30; if (dcm >= 60) { dch++; dcm = 0; }
            }
            newDates[range.date] = dayBlks;
            return { ...prev, dates: newDates };
          });

          if (user) {
            syncOp(() => dbUpsertEvent(ev, user.id));
            if (delOps.length > 0) syncOp(() => Promise.all(delOps.map(key => dbUpsertDateBlock(range.date, key, null, user.id))));
          }
          if (isGoogleConnected() && calSyncEnabled) {
            pushEventToGoogle(ev, googleToken).then(gid => {
              if (gid) {
                setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, googleId: gid } : e));
                if (user) syncOp(() => dbUpsertEvent({ ...ev, googleId: gid }, user.id));
              }
            });
          }
          break;
        }
        case 'clear_all':
          setTasks([]);
          setEvents([]);
          setBlocks({ dates:{} });
          if (user) {
            syncOp(() => Promise.all([
              sb.from('tasks').delete().eq('user_id', user.id),
              sb.from('events').delete().eq('user_id', user.id),
              sb.from('date_blocks').delete().eq('user_id', user.id)
            ]));
          }
          break;
        default: console.warn('Unknown action type:', action.type);
      }
    } catch(e) { console.error('Failed to execute action:', action, e); setToastMsg('❌ Couldn\'t complete that — try again'); }
  }

  // ── Confirmation handlers ──
  function handleConfirmAction(idx, action) {
    sfx.confirm();
    executeAction(action);
    setPendingActions(prev => prev.filter((_,i)=>i!==idx));
    const name = action.title||action.activity||'Action';
    const verb = action.type?.startsWith('delete') ? 'removed' : action.type === 'update_event' ? 'updated' : action.type === 'complete_task' ? 'completed' : 'added';
    setToastMsg('✓ ' + name + ' ' + verb);
    const calendarActionTypes = ['add_event','add_block','add_task','delete_event','delete_task','delete_block','update_event','convert_event_to_block','convert_block_to_event'];
    if (calendarActionTypes.includes(action.type)) {
      if (layoutMode === 'sidebar') {
        openCompanionPanel('schedule');
      } else if (!showSideBySide) {
        setShowPeek(true);
      }
    }
  }
  function handleCancelAction(idx) { sfx.dismiss(); setPendingActions(prev => prev.filter((_,i)=>i!==idx)); }

  // ── Content save/dismiss helpers ──
  function formatContentForNote(c) {
    try {
      switch (c.type) {
        case 'create_flashcards':
          return (c.cards||[]).map((card,i) => 'Q' + (i+1) + ': ' + card.q + '\nA: ' + card.a).join('\n\n');
        case 'create_outline':
          return (c.sections||[]).map(s => '## ' + s.heading + '\n' + (s.points||[]).map(p => '- ' + p).join('\n')).join('\n\n');
        case 'create_summary':
          return (c.bullets||[]).map(b => '- ' + b).join('\n');
        case 'create_study_plan':
          return (c.steps||[]).map((s,i) => (i+1) + '. ' + s.step + ' (' + (s.time_minutes||20) + 'min' + (s.day ? ', ' + s.day : '') + ')').join('\n');
        case 'create_quiz':
          return (c.questions||[]).map((q,i) => 'Q' + (i+1) + ': ' + q.q + '\nChoices: ' + (q.choices||[]).join(' | ') + '\nAnswer: ' + q.answer).join('\n\n');
        case 'create_project_breakdown':
          return (c.phases||[]).map(p => '## ' + p.phase + (p.deadline ? ' (due ' + p.deadline + ')' : '') + '\n' + (p.tasks||[]).map(t => '- [ ] ' + t).join('\n')).join('\n\n');
        case 'make_plan':
          return '# ' + (c.title||'Plan') + '\n\n' + (c.summary ? c.summary + '\n\n' : '') + (c.steps||[]).map((s,i) => '- [ ] ' + s.title + (s.date ? ' (' + s.date + ')' : '') + (s.time ? ' ' + s.time : '') + (s.estimated_minutes ? ' ~' + s.estimated_minutes + 'min' : '')).join('\n');
        default: return JSON.stringify(c, null, 2);
      }
    } catch(e) { return JSON.stringify(c, null, 2); }
  }
  function handleSaveContent(idx) {
    const c = pendingContent[idx];
    if (!c) return;
    const formatted = formatContentForNote(c);
    executeAction({ type:'add_note', tab_name: c.title || 'Study Material', content: formatted });
    setPendingContent(prev => prev.filter((_,i) => i !== idx));
    setToastMsg('Saved "' + (c.title || 'content') + '" to notes');
  }
  function handleDismissContent(idx) { setPendingContent(prev => prev.filter((_,i) => i !== idx)); }
  function handleApplyPlan(idx, steps) {
    steps.forEach(step => {
      executeAction({ type:'add_task', title:step.title, subject:'', due:step.date||today(), estimated_minutes:step.estimated_minutes||30 });
    });
    setPendingContent(prev => prev.filter((_,i) => i !== idx));
    setToastMsg('Added ' + steps.length + ' tasks from plan');
  }

  function handleStartPlanTask(step) {
    if (!step?.title) return;
    const dueDate = step.date || today();
    const existing = tasks.find(t => t.title.toLowerCase() === step.title.toLowerCase() && t.dueDate === dueDate);
    if (existing) {
      updateTask(existing.id, { status: 'in_progress' });
      setToastMsg('Started "' + existing.title + '"');
      return;
    }
    executeAction({
      type:'add_task',
      title:step.title,
      subject:'',
      due:dueDate,
      estimated_minutes:step.estimated_minutes||30,
      status:'in_progress'
    });
    setToastMsg('Started "' + step.title + '"');
  }

  // ── Google Docs plan export (create + update) ──
  async function syncPlanToGoogleDocs(planData, existingDocId, token) {
    const title = planData.title || 'Study Plan';
    const steps = planData.steps || [];

    // Build plain text content for the doc
    let body = title + '\n\n';
    if (planData.summary) body += planData.summary + '\n\n';
    body += 'Steps:\n';
    steps.forEach((step, i) => {
      body += (i + 1) + '. ' + step.title;
      if (step.date) body += ' (' + step.date + ')';
      if (step.time) body += ' at ' + step.time;
      if (step.estimated_minutes) body += ' ~' + step.estimated_minutes + 'min';
      body += '\n';
    });

    const authHdr = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    if (existingDocId) {
      // Update: get current doc length, delete all content, then re-insert
      const getRes = await fetch('https://docs.googleapis.com/v1/documents/' + existingDocId, { headers: { 'Authorization': 'Bearer ' + token } });
      if (!getRes.ok) throw new Error('Failed to read Google Doc');
      const docData = await getRes.json();
      const endIndex = docData.body?.content?.slice(-1)?.[0]?.endIndex || 1;

      const requests = [];
      if (endIndex > 2) {
        requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
      }
      requests.push({ insertText: { location: { index: 1 }, text: body } });

      await fetch('https://docs.googleapis.com/v1/documents/' + existingDocId + ':batchUpdate', {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ requests })
      });
      return existingDocId;
    } else {
      // Create new doc
      const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ title })
      });
      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error('Failed to create Google Doc: ' + errText);
      }
      const newDoc = await createRes.json();
      const docId = newDoc.documentId;

      // Insert content
      await fetch('https://docs.googleapis.com/v1/documents/' + docId + ':batchUpdate', {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({
          requests: [{ insertText: { location: { index: 1 }, text: body } }]
        })
      });
      return docId;
    }
  }

  async function handleExportPlanToGoogleDocs(idx, planData) {
    if (!isGoogleConnected()) {
      connectGoogle();
      setToastMsg('Connect Google first, then try again');
      return;
    }
    try {
      const existingDocId = planData.googleDocId || null;
      const docId = await syncPlanToGoogleDocs(planData, existingDocId, googleToken);
      // Store the docId back on the content item for future syncs
      setPendingContent(prev => prev.map((c, i) => i === idx ? { ...c, googleDocId: docId } : c));
      const action = existingDocId ? 'Synced' : 'Exported';
      setToastMsg(action + ' "' + (planData.title || 'Plan') + '" to Google Docs');
    } catch (e) {
      console.error('Google Docs export error:', e);
      setToastMsg('Failed to export — ' + (e.message || 'try again'));
    }
  }

  // ── Plan template handlers ──
  function handleSelectTemplate(template, userContext) {
    const title = (userContext || template.name);
    const planContent = {
      type: 'make_plan',
      title,
      summary: template.skeleton.summary,
      steps: template.skeleton.steps.map(s => ({ ...s })),
      templateName: template.name,
    };
    setPendingTemplateSelector(null);
    setPendingContent(prev => [...prev, planContent]);
    setToastMsg('Created plan from "' + template.name + '" template');
  }

  function handleCustomPlan() {
    setPendingTemplateSelector(null);
    // Send a message to the AI to generate a custom plan
    sendMessage('Make me a custom study plan. Ask me what subject and details you need.');
  }

  function handleDismissTemplateSelector() {
    setPendingTemplateSelector(null);
  }

  // ── Google import handlers ──
  // silent=true: called by auto-sync (no modal close, no toast, returns count for status display)
  function handleImportGoogleEvents(gevents, silent = false) {
    let added = 0; let updated = 0; let skipped = 0;
    setEvents(prev => {
      let next = [...prev];
      gevents.forEach(gev => {
        if (!gev.date) return;
        // First, try to find an existing SOS event with this googleId
        const existingByGoogleId = next.find(ex => ex.googleId && ex.googleId === gev.googleId);
        if (existingByGoogleId) {
          if (existingByGoogleId.title !== gev.title || existingByGoogleId.date !== gev.date) {
            const updatedEv = { ...existingByGoogleId, title: gev.title, date: gev.date };
            next = next.map(ev => ev.id === existingByGoogleId.id ? updatedEv : ev);
            if (user) syncOp(() => dbUpsertEvent(updatedEv, user.id));
            updated++;
          } else { skipped++; }
          return;
        }
        // Legacy dedup: if no googleId match, check title+date
        const dupTitle = (gev.title||'').toLowerCase();
        const isDup = next.some(ex => ex.title.toLowerCase() === dupTitle && ex.date === gev.date);
        if (isDup) { skipped++; return; }
        const ev = { id: uid(), title: gev.title, type: 'event', subject: '', date: gev.date, recurring: 'none', createdAt: new Date().toISOString(), source: 'google_calendar', googleId: gev.googleId };
        next = [...next, ev];
        if (user) syncOp(() => dbUpsertEvent(ev, user.id));
        added++;
      });
      return next;
    });
    if (!silent) {
      setShowGoogleModal(false);
      const parts = [];
      if (added > 0) parts.push('Imported ' + added + ' event' + (added !== 1 ? 's' : ''));
      if (updated > 0) parts.push('updated ' + updated);
      if (skipped > 0) parts.push(skipped + ' unchanged');
      const msg = (parts.join(', ') || 'No changes') + ' from Google Calendar';
      setToastMsg(msg);
    }
    return added;
  }

  // ── Calendar auto-sync ──
  async function syncCalendar() {
    if (!isGoogleConnected()) return;
    setCalSyncStatus('syncing'); setCalSyncError(null);
    try {
      const now = new Date();
      const max = new Date(now.getTime() + 14 * 86400000);
      const params = new URLSearchParams({
        timeMin: now.toISOString(), timeMax: max.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '50'
      });
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + params, {
        headers: { 'Authorization': 'Bearer ' + googleToken }
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('Google session expired — reconnect Google.');
        throw new Error('Calendar fetch failed (' + res.status + ')');
      }
      const data = await res.json();
      const gevents = mapGoogleCalItems(data.items || []);
      // 1. Import/update from Google
      const count = handleImportGoogleEvents(gevents, true);
      // 2. Detect Google-side deletions: use functional updater to read
      //    latest state (after import above) instead of stale closure
      const googleIdSet = new Set(gevents.map(g => g.googleId));
      const todayStr = today();
      const maxStr = toDateStr(max);
      let removedCount = 0;
      setEvents(prev => {
        const toRemove = prev.filter(ev =>
          ev.googleId &&
          ev.source === 'google_calendar' &&
          ev.date >= todayStr &&
          ev.date <= maxStr &&
          !googleIdSet.has(ev.googleId)
        );
        toRemove.forEach(ev => {
          if (user) syncOp(() => sb.from('events').delete().eq('id', ev.id).eq('user_id', user.id));
        });
        removedCount = toRemove.length;
        const removeIds = new Set(toRemove.map(ev => ev.id));
        return prev.filter(ev => !removeIds.has(ev.id));
      });
      // 3. Push local events (no googleId) to Google
      setEvents(prev => {
        const toPush = prev.filter(ev =>
          !ev.googleId &&
          ev.date >= todayStr &&
          ev.date <= maxStr
        );
        toPush.forEach(ev => {
          pushEventToGoogle(ev, googleToken).then(gid => {
            if (gid) {
              setEvents(p => p.map(e => e.id === ev.id ? { ...e, googleId: gid } : e));
              if (user) syncOp(() => dbUpsertEvent({ ...ev, googleId: gid }, user.id));
            }
          });
        });
        return prev;
      });
      setCalSyncCount(count + removedCount);
      const lastAt = new Date().toISOString();
      setCalSyncLastAt(lastAt);
      localStorage.setItem('sos_cal_sync_last', lastAt);
      setCalSyncStatus('done');
    } catch(e) {
      setCalSyncStatus('error');
      setCalSyncError(e.message);
    }
  }

  function toggleCalSync() {
    const next = !calSyncEnabled;
    setCalSyncEnabled(next);
    localStorage.setItem('sos_cal_sync', String(next));
    if (!next) { setCalSyncStatus('idle'); setCalSyncError(null); }
  }

  // Keep ref pointing at the latest syncCalendar (before useEffect so the interval never uses a stale closure)
  syncCalendarRef.current = syncCalendar;

  // Auto-sync: run immediately when enabled, then every 30 minutes
  // Re-runs when the toggle flips or the Google token refreshes
  useEffect(() => {
    if (!calSyncEnabled || !isGoogleConnected()) return;
    syncCalendarRef.current();
    const id = setInterval(() => syncCalendarRef.current(), 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [calSyncEnabled, googleToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Daily Brief: Context Aggregator ──
  async function getMorningContext() {
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 86400000);
      const localTodayEvents = events
        .filter(ev => ev.date === today())
        .slice(0, 25)
        .map(ev => ({
          id: ev.id,
          title: ev.title,
          time: 'Scheduled',
          description: '',
          attachments: []
        }));

      const docContents = {};
      let calendarEvents = localTodayEvents;

      if (!isGoogleConnected()) {
        return { calendarEvents, docContents };
      }

      const params = new URLSearchParams({
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '25'
      });
      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + params,
        { headers: { 'Authorization': 'Bearer ' + googleToken } }
      );
      if (!res.ok) return { calendarEvents, docContents };
      const data = await res.json();
      const items = (data.items || []).filter(e => e.summary);

      calendarEvents = items.map(e => ({
        id: e.id,
        title: e.summary,
        time: e.start?.dateTime
          ? new Date(e.start.dateTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
          : 'All day',
        description: e.description || '',
        attachments: e.attachments || [],
      }));

      // Find Google Doc IDs in event descriptions and attachments
      const docIds = new Set();
      calendarEvents.forEach(ev => {
        for (const m of (ev.description || '').matchAll(/\/document\/d\/([a-zA-Z0-9_-]+)/g)) docIds.add(m[1]);
        (ev.attachments || []).forEach(att => {
          if (att.fileUrl)
            for (const m of att.fileUrl.matchAll(/\/document\/d\/([a-zA-Z0-9_-]+)/g)) docIds.add(m[1]);
        });
      });

      // Fetch first 3000 chars of each linked Google Doc
      await Promise.all([...docIds].map(async (docId) => {
        try {
          const docRes = await fetch(
            'https://docs.googleapis.com/v1/documents/' + docId,
            { headers: { 'Authorization': 'Bearer ' + googleToken } }
          );
          if (docRes.ok) {
            const doc = await docRes.json();
            const text = extractDocsText(doc);
            docContents[docId] = text.slice(0, 3000);
          }
        } catch (_) {}
      }));

      return { calendarEvents, docContents };
    } catch (e) {
      console.error('getMorningContext error:', e);
      return null;
    }
  }

  // ── Daily Brief: Generator (single GPT-OSS API call) ──
  async function generateDailyBrief() {
    if (!DAILY_BRIEF_ENABLED) return;
    if (briefRequestedRef.current) return;
    briefRequestedRef.current = true;
    setIsLoading(true);
    try {
      const context = await getMorningContext();
      if (!context) { setIsLoading(false); return; }

      const todayStr = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
      const activeTasks = tasks.filter(t => t.status !== 'done').slice(0, 10);

      const briefPrompt = `You are SOS, a student's proactive daily planner. Based on the student's calendar and linked documents for today, generate a structured daily brief.

TODAY: ${todayStr}

CALENDAR EVENTS:
${context.calendarEvents.map(e => '- ' + e.time + ': ' + e.title + (e.description ? ' | Notes: ' + e.description.slice(0, 200) : '')).join('\n') || '(no events today)'}

LINKED DOCUMENT EXCERPTS:
${Object.entries(context.docContents).map(([id, text]) => '[Doc ' + id + ']: ' + text.slice(0, 500) + '...').join('\n\n') || '(no linked docs)'}

STUDENT'S TASKS:
${activeTasks.map(t => '- ' + t.title + (t.subject ? ' [' + t.subject + ']' : '') + ' due ' + fmt(t.dueDate)).join('\n') || '(no active tasks)'}

Respond with ONLY a valid JSON object (no markdown, no code fences) in this exact format:
{
  "type": "DAILY_BRIEF",
  "summary": "One sentence overview of the day",
  "schedule_items": [{"time": "HH:MM AM/PM", "event_name": "...", "related_doc_id": "..." or null}],
  "plan_of_action": ["Specific action item 1", "Specific action item 2", "...3-5 items total"],
  "dropdown_options": ["Quick action label 1", "Quick action label 2", "...3-5 options total"],
  "encouragement": "Short motivational sign-off"
}

Make plan_of_action items specific and reference actual events/tasks (e.g. "Review Chapter 4 before 2 PM Bio Lab").
Make dropdown_options actionable quick-actions (e.g. "Generate Study Guide for Bio", "Reschedule Conflicts", "Break down project into subtasks").
If there are no events, base the brief on the student's tasks and suggest a productive plan.`;

      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const response = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY)
        },
        body: JSON.stringify({
          systemPrompt: briefPrompt,
          messages: [{ role: 'user', content: 'Generate my daily brief for today.' }],
          maxTokens: 2048,
          model: 'llama-3.1-8b-instant',
          provider: 'groq',
          isContentGen: false
        })
      });

      if (!response.ok) { setIsLoading(false); return; }
      const data = await response.json();
      const raw = (data?.content || '').trim();

      // Parse JSON from response (strip markdown fences if present)
      const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
      const brief = JSON.parse(jsonStr);
      if (brief.type === 'DAILY_BRIEF') {
        setDailyBrief(brief);
      }
    } catch (e) {
      console.error('Daily brief generation failed:', e);
    }
    setIsLoading(false);
  }

  // ── Daily Brief: Auto-trigger on fresh session when the page opens ──
  useEffect(() => {
    if (!DAILY_BRIEF_ENABLED) return;
    if (!dataLoaded || !googleToken) return;
    if (messages.length > 0 || viewingSavedChatId) return;
    if (!events || events.length === 0) return;
    generateDailyBrief();
  }, [DAILY_BRIEF_ENABLED, dataLoaded, googleToken, messages.length, viewingSavedChatId, events]);

  function handleImportGoogleDoc(title, text) {
    const note = { id: uid(), name: title, content: text, updatedAt: new Date().toISOString(), source: 'google_docs' };
    setNotes(prev => [...prev, note]);
    if (user) syncOp(() => dbUpsertNote(note, user.id));
    setShowGoogleModal(false);
    setToastMsg('Imported "' + title + '" to notes 📄');
  }

  function handleImportPdf(title, text) {
    const note = { id: uid(), name: title, content: text, updatedAt: new Date().toISOString(), source: 'pdf' };
    setNotes(prev => [...prev, note]);
    if (user) syncOp(() => dbUpsertNote(note, user.id));
    setShowGoogleModal(false);
    setToastMsg('Imported PDF "' + title + '" to notes 📑');
  }

  function handleDeleteNote(noteId) {
    setNotes(prev => prev.filter(n => n.id !== noteId));
    if (user) syncOp(() => sb.from('notes').delete().eq('id', noteId).eq('user_id', user.id));
    setToastMsg('Note deleted');
  }

  function handleUpdateNote(updated) {
    setNotes(prev => prev.map(n => n.id === updated.id ? { ...n, ...updated } : n));
    if (user) syncOp(() => dbUpsertNote(updated, user.id));
    setToastMsg('Note saved');
  }

  function handleCreateNote(noteData) {
    const note = { id: uid(), ...noteData, updatedAt: new Date().toISOString() };
    setNotes(prev => [...prev, note]);
    if (user) syncOp(() => dbUpsertNote(note, user.id));
    setToastMsg('Note created');
  }

  // ── Save / Load / Delete chat conversations ──
  function autoSaveCurrentChat() {
    if (messages.length === 0) return;
    if (viewingSavedChatId) return;
    const firstUserMsg = messages.find(m => m.role === 'user');
    const title = firstUserMsg ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? '...' : '') : 'Chat ' + new Date().toLocaleDateString();
    const chatId = uid();
    const savedAt = new Date().toISOString();
    const chatData = { title, messages: messages.slice(), savedAt, messageCount: messages.length };
    // Save to Supabase via notes table with special prefix
    const note = { id: chatId, name: CHAT_SAVE_PREFIX + title, content: JSON.stringify(chatData), updatedAt: savedAt };
    if (user) syncOp(() => dbUpsertNote(note, user.id));
    setSavedChats(prev => [{ id: chatId, ...chatData }, ...prev]);
  }

  function loadSavedChat(chatId) {
    const chat = savedChats.find(c => c.id === chatId);
    if (!chat) return;
    setViewingSavedChatId(chatId);
    setMessages(chat.messages || []);
    setShowChatSidebar(false);
  }

  function deleteSavedChat(chatId) {
    setSavedChats(prev => prev.filter(c => c.id !== chatId));
    if (user) syncOp(() => sb.from('notes').delete().eq('id', chatId).eq('user_id', user.id));
    if (viewingSavedChatId === chatId) { setViewingSavedChatId(null); setMessages([]); setDailyBrief(null); briefRequestedRef.current = false; }
    setToastMsg('Conversation deleted');
  }

  function autoConfirmPending() {
    if (pendingClarification) return;
    if (pendingActions.length > 0) { pendingActions.forEach(a => executeAction(a.action)); setPendingActions([]); }
    if (pendingContent.length > 0) { pendingContent.forEach((c,i) => { const formatted = formatContentForNote(c); executeAction({ type:'add_note', tab_name: c.title || 'Study Material', content: formatted }); }); setPendingContent([]); }
  }

  // ── Send message via Edge Function (multi-model routing) ──
  async function sendMessage(text, opts = {}) {
    const fromClarification = !!opts.fromClarification;
    // Capture pending photo and clear it immediately
    const photo = pendingPhoto;
    setPendingPhoto(null);

    if ((!text?.trim() && !photo) || isLoading) return;
    if (!fromClarification) autoConfirmPending();
    setChatError(null);
    if (user) trackEvent(user.id, 'message_sent'); // P4.2

    const msgContent = text?.trim() || '';

    // Intercept vague plan requests and show template selector
    const isPlanRequest = /^(make|create|build|give)\s*(me\s*)?(a\s*)?(study\s*)?plan$/i.test(msgContent)
      || /^(i need|want)\s*(a\s*)?(study\s*)?plan$/i.test(msgContent)
      || /^plan$/i.test(msgContent);
    if (isPlanRequest && !fromClarification && !photo) {
      const userMsg = { role:'user', content:msgContent, timestamp:Date.now() };
      setMessages(prev => { const n=[...prev,userMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
      setInput('');
      if (user) dbInsertChatMsg('user', msgContent, user.id);
      const assistantMsg = { role:'assistant', content:"I've got a few plan templates ready — pick one or let me create something custom for you!", timestamp:Date.now() };
      setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
      if (user) dbInsertChatMsg('assistant', assistantMsg.content, user.id);
      setPendingTemplateSelector({ context: msgContent });
      return;
    }
    const requestedCompanion = detectCompanionIntent(msgContent);
    if (requestedCompanion) {
      if (layoutMode !== 'sidebar') setLayoutMode('sidebar');
      openCompanionPanel(requestedCompanion);
    }
    const effectiveWorkspaceContext = getWorkspaceContext(requestedCompanion);
    const userMsg = { role:'user', content:msgContent, timestamp:Date.now(), photoPreview:photo?.preview||null, photoUrl:null };
    const updated = [...messages, userMsg];
    while (updated.length > CHAT_MAX_MESSAGES) updated.shift();
    setMessages(updated);
    setInput('');
    setIsLoading(true);
    setLoadingMessage(getLoadingMessage(msgContent, photo, isPlanRequest));

    // Persist demo messages to localStorage so they're migrated to Supabase on sign-up
    if (!user && msgContent) {
      try {
        const demoChat = JSON.parse(localStorage.getItem('cc_chat') || '[]');
        demoChat.push({ role: 'user', content: msgContent });
        localStorage.setItem('cc_chat', JSON.stringify(demoChat));
      } catch (_) {}
    }

    // Upload photo to storage in background + save chat msg with URL when done
    if (photo && user) {
      uploadPhotoToStorage(photo.base64, user.id).then(url => {
        if (url) {
          setMessages(prev => prev.map(m => m.timestamp === userMsg.timestamp ? {...m, photoUrl:url} : m));
          dbInsertChatMsg('user', msgContent, user.id, url);
        } else {
          dbInsertChatMsg('user', msgContent, user.id);
        }
      });
    } else if (user) {
      dbInsertChatMsg('user', msgContent, user.id);
    }

    // Detect content generation requests (for rate limiting + model upgrade)
    const isContentGen = CONTENT_GEN_REGEX.test(text || '');
    const isTutorStudyContentRequest = TUTOR_STUDY_REGEX.test(text || '');
    if (isTutorStudyContentRequest) primeTutorSession();

    try {
      // For image requests: send only last 2 messages to keep payload small for vision model.
      // For content generation: limit to 6 messages to avoid context overflow on Groq.
      const rawHistory = updated.slice(photo ? -2 : isContentGen ? -6 : -12).map(m => ({
        role: m.role,
        content: m.content || '',
      }));
      const historyForApi = rawHistory.filter(m => m.content && m.content.trim());
      const promptPayload = buildSystemPrompt(tasks, blocks, events, notes, 2, { tutorMode, workspaceContext: effectiveWorkspaceContext });
      setContextTrimInfo(promptPayload.trimInfo || null);

      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;

      // Tier routing: pure conversational messages use a lighter system prompt + token budget.
      // NOTE: noTools is intentionally NOT set here — llama-3.3-70b-versatile handles both
      // conversational replies and tool calling in a single pass. When a message has no action
      // intent the model simply returns text with no tool_calls (no card shown). This avoids
      // the bug where phrases like "put in my calendar" were misclassified as conversational
      // and had tools suppressed, producing a text-only response with no confirmation card.
      const hasCorrectionSignal = /\b(actually|i meant|wait no|change that|make it|not [a-z]+,|sorry,|oops)\b/i.test(msgContent);
      const isConversational = !isContentGen && !photo && !isPlanRequest && !fromClarification && !hasCorrectionSignal
        && !/\b(add|create|schedule|delete|remove|cancel|mark|done|complete|update|move|reschedule|block|note|save|remind|break|clear|convert|set|plan|put|log|track|book|enter|register)\b/i.test(msgContent)
        && !/\b(test|exam|quiz|homework|assignment|practice|game|meet|tournament|deadline|event|task|appointment|class|lesson|meeting|dentist|doctor|club|lab)\b/i.test(msgContent)
        && !/\b(calendar|planner|in my|on my)\b/i.test(msgContent);

      // Always use the full tier-2 prompt so the AI always has tool definitions.
      // Tier-1 (conversational) had no tool instructions — casual phrasing like
      // "yeah next Friday works" would fall through with no action generated.
      // useStreaming: enabled for pure conversational messages only. The backend streams
      // text deltas via SSE; tool-call JSON is buffered and sent in the final 'done' event.
      const useStreaming = isConversational && !photo && !isContentGen;
      const chatBody = {
        systemPrompt: promptPayload.prompt,
        // Split static/dynamic for Groq prompt caching (static policy is identical across all users)
        staticSystemPrompt: promptPayload.stablePrompt,
        dynamicContext: promptPayload.dynamicContext,
        messages: historyForApi,
        maxTokens: isContentGen ? 4096 : 1024,
        isContentGen,
        workspaceContext: effectiveWorkspaceContext,
        prompt_version: promptPayload.promptVersion,
        context_chars: promptPayload.contextChars,
        input_tokens_est: promptPayload.estimatedInputTokens,
        ...(useStreaming ? { streaming: true } : {}),
      };
      if (photo) {
        chatBody.imageBase64 = photo.base64;
        chatBody.imageMimeType = photo.mimeType;
      }

      const chatResponse = await fetch(EDGE_FN_URL, {
        method:'POST',
        headers: {
          'Content-Type':'application/json',
          'Authorization':'Bearer ' + (token || SUPABASE_ANON_KEY)
        },
        body: JSON.stringify(chatBody)
      });

      if (!chatResponse.ok) {
        const errData = await chatResponse.json().catch(() => ({}));
        if (chatResponse.status === 429 && errData?.rateLimited) {
          const limitMsg = "hey, you've used all 5 content generations for today — this resets at midnight EST. regular chat still works though, ask me anything else!";
          const assistantMsg = { role:'assistant', content:limitMsg, timestamp:Date.now() };
          setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', limitMsg, user.id);
          setContentGenUsed(errData.used || DAILY_CONTENT_LIMIT);
          setIsLoading(false);
          return;
        }
        throw new Error(errData?.error || errData?.message || 'AI request failed: ' + chatResponse.status);
      }

      // ── Streaming path ────────────────────────────────────────────────────────────
      // Consume SSE text deltas in real-time, updating a placeholder message as tokens
      // arrive. Tool-call JSON is never shown — it arrives only in the final 'done' event.
      let chatData;
      if (useStreaming && chatResponse.headers.get('content-type')?.includes('text/event-stream')) {
        const streamTs = Date.now();
        // Add an empty placeholder message; spinner is replaced by inline streaming text.
        setMessages(prev => {
          const n = [...prev, { role: 'assistant', content: '', timestamp: streamTs, streaming: true }];
          while (n.length > CHAT_MAX_MESSAGES) n.shift();
          return n;
        });
        setIsLoading(false);

        const reader = chatResponse.body.getReader();
        const decoder = new TextDecoder();
        let streamedText = '';
        let sseBuffer = '';
        outerStream: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const raw = trimmed.slice(6).trim();
            if (!raw) continue;
            let evt;
            try { evt = JSON.parse(raw); } catch (_) { continue; }
            if (evt.type === 'text_delta') {
              streamedText += evt.delta;
              setMessages(prev => prev.map(m =>
                m.timestamp === streamTs ? { ...m, content: streamedText } : m
              ));
            } else if (evt.type === 'done') {
              chatData = evt;
              // Finalise the streaming message content (use server's canonical version)
              const finalContent = typeof evt.content === 'string' && evt.content.trim()
                ? evt.content.trim()
                : streamedText;
              setMessages(prev => prev.map(m =>
                m.timestamp === streamTs ? { ...m, content: finalContent, streaming: false } : m
              ));
              if (finalContent) {
                sfx.arrive();
                if (user) dbInsertChatMsg('assistant', finalContent, user.id);
                else {
                  try {
                    const demoChat = JSON.parse(localStorage.getItem('cc_chat') || '[]');
                    demoChat.push({ role: 'assistant', content: finalContent });
                    localStorage.setItem('cc_chat', JSON.stringify(demoChat));
                  } catch (_) {}
                }
              }
              break outerStream;
            }
          }
        }
        // If no 'done' event arrived, use accumulated text as chatData
        if (!chatData) chatData = { content: streamedText, actions: [], clarifications: [] };
      } else {
        chatData = await chatResponse.json();
      }
      // ── End streaming path ────────────────────────────────────────────────────────

      let actions = Array.isArray(chatData?.actions) ? chatData.actions : [];

      // Support multiple clarifications (array) or single (object)
      const clarificationsArr = Array.isArray(chatData?.clarifications) && chatData.clarifications.length > 0
        ? chatData.clarifications
        : (chatData?.clarification && typeof chatData.clarification === 'object' && chatData.clarification.question
          ? [chatData.clarification]
          : (chatData?.clarification_payload && typeof chatData.clarification_payload === 'object' && chatData.clarification_payload.question
            ? [chatData.clarification_payload]
            : []));

      const validClarifications = clarificationsArr.filter(c => c?.question && Array.isArray(c?.options) && c.options.length > 0);

      if (validClarifications.length > 0) {
        // Build assistant message summarizing all questions
        const questionTexts = validClarifications.map((c, i) => {
          const prefix = validClarifications.length > 1 ? `${i + 1}. ` : '';
          return prefix + c.question;
        });
        const reasonText = validClarifications[0].reason ? validClarifications[0].reason.trim() + ' ' : '';
        const assistantPrompt = (reasonText || "I need a few details before I continue.") + '\n\n' + questionTexts.join('\n');
        const assistantMsg = { role:'assistant', content:assistantPrompt, timestamp:Date.now() };
        setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
        if (user) dbInsertChatMsg('assistant', assistantPrompt, user.id);

        // Store all clarifications — ClarificationCard handles arrays
        const mapped = validClarifications.map(c => ({
          reason: c.reason || null,
          question: c.question,
          options: c.options,
          multiSelect: !!c.multiSelect || !!c.multi_select,
          metadata: c.metadata || c.context || null,
          allowOther: true,
          otherPlaceholder: c.otherPlaceholder,
        }));
        setPendingClarification(mapped.length === 1 ? mapped[0] : mapped);
        return;
      }

      const validationWarnings = Array.isArray(chatData?.validation_warnings) ? chatData.validation_warnings : [];
      if (validationWarnings.length > 0) {
        try {
          const validationFailures = validationWarnings.map(w => ({
            action_type: w?.tool || 'unknown_action',
            category: 'validation_failed',
            detail: `Validation failed for ${(w?.tool || 'action')}.`,
            suggestions: (Array.isArray(w?.issues) ? w.issues : []).map(issue => issue?.field).filter(Boolean),
          }));
          const fallback = await fetch(EDGE_FN_URL, {
            method:'POST',
            headers: {
              'Content-Type':'application/json',
              'Authorization':'Bearer ' + (token || SUPABASE_ANON_KEY)
            },
            body: JSON.stringify({
              mode: 'tool_fallback',
              systemPrompt: promptPayload.prompt,
              messages: historyForApi,
              maxTokens: 512,
              workspaceContext: effectiveWorkspaceContext,
              tool_failures: validationFailures,
            }),
          });
          if (fallback.ok) {
            const fallbackData = await fallback.json();
            const followupText = typeof fallbackData?.content === 'string' ? fallbackData.content.trim() : '';
            if (followupText) {
              const assistantMsg = { role:'assistant', content:followupText, timestamp:Date.now() };
              setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
              if (user) dbInsertChatMsg('assistant', followupText, user.id);
              return;
            }
          }
        } catch (validationFallbackErr) {
          console.error('Validation fallback clarification failed:', validationFallbackErr);
        }
      }

      const rawContent = typeof chatData?.content === 'string' ? chatData.content.trim() : '';
      const actionAckByType = {
        update_event: 'got it — I can update that event.',
        add_block: 'got it — I can add that block.',
        add_event: 'got it — I can add that event.',
        add_task: 'got it — I can add that task.',
        delete_event: 'got it — I can remove that event.',
        delete_task: 'got it — I can remove that task.',
        complete_task: 'got it — I can mark that complete.',
        edit_note: 'got it — I can update that note.',
        delete_note: 'got it — I can delete that note.',
      };
      const displayContent = rawContent
        ? rawContent
        : actions.length > 0
          ? (actionAckByType[actions[0]?.type] || 'got it — I can do that.')
          : "hmm, I didn't get a response from the AI. the service may be briefly unavailable — please try again in a moment.";

      // For streamed responses the message was already inserted + persisted above.
      // Only insert here for non-streaming paths.
      if (displayContent && !useStreaming) {
        const assistantMsg = { role:'assistant', content:displayContent, timestamp:Date.now() };
        sfx.arrive();
        setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
        if (user) {
          dbInsertChatMsg('assistant', displayContent, user.id);
        } else {
          // Persist assistant reply to localStorage for demo carry-over on sign-up
          try {
            const demoChat = JSON.parse(localStorage.getItem('cc_chat') || '[]');
            demoChat.push({ role: 'assistant', content: displayContent });
            localStorage.setItem('cc_chat', JSON.stringify(demoChat));
          } catch (_) {}
        }
      }

      // Actions come back as structured tool_use results — no text parsing needed

      async function requestToolFailureFollowup(toolFailures) {
        const fallbackResponse = await fetch(EDGE_FN_URL, {
          method:'POST',
          headers: {
            'Content-Type':'application/json',
            'Authorization':'Bearer ' + (token || SUPABASE_ANON_KEY)
          },
          body: JSON.stringify({
            mode: 'tool_fallback',
            systemPrompt: promptPayload.prompt,
            messages: historyForApi,
            maxTokens: 512,
            workspaceContext: effectiveWorkspaceContext,
            tool_failures: toolFailures,
          }),
        });
        if (!fallbackResponse.ok) {
          const errData = await fallbackResponse.json().catch(() => ({}));
          throw new Error(errData?.error || `tool fallback failed (${fallbackResponse.status})`);
        }
        return fallbackResponse.json();
      }

      function buildResolutionFailure(actionType, detail, candidates = []) {
        const filtered = (candidates || []).filter(Boolean).slice(0, 3);
        return {
          action_type: actionType,
          category: filtered.length > 1 ? 'ambiguous' : 'not_found',
          detail,
          suggestions: filtered,
        };
      }

      // ── Resolve actions: translate AI names → real IDs/ranges using resolveEvent/resolveTask helpers ──
      const resolved = [];
      const resolutionFailures = [];
      for (const a of actions) {
        if (a.type === 'delete_event' || a.type === 'update_event' || a.type === 'convert_event_to_block') {
          const match = resolveEvent(a.title || a.event_id, events);
          if (match) {
            resolved.push({ ...a, event_id: match.id, title: match.title, date: a.date || match.date });
          } else {
            const query = (a.title || a.event_id || '').trim();
            const eventCandidates = events
              .map(ev => ({ title: ev.title, score: matchScore(query, ev.title) }))
              .filter(v => v.score >= 30)
              .sort((x, y) => y.score - x.score)
              .map(v => v.title);
            resolutionFailures.push(buildResolutionFailure(a.type, `Unable to resolve event "${query}".`, eventCandidates));
          }
          continue;
        }
        if (a.type === 'convert_block_to_event') {
          const range = resolveBlockRange(a, blocks);
          if (range) {
            resolved.push({ ...a, date: range.date, start: range.start, end: a.end || range.end, title: a.title || range.name || 'Event' });
          } else {
            resolutionFailures.push({
              action_type: a.type,
              category: 'not_found',
              detail: `Unable to resolve block for date="${a.date || ''}" start="${a.start || ''}".`,
            });
          }
          continue;
        }
        if (a.type === 'delete_task') {
          const match = resolveTask(a.title || a.task_id, tasks);
          if (match) {
            resolved.push({ ...a, task_id: match.id, title: match.title });
          } else {
            const query = (a.title || a.task_id || '').trim();
            const taskCandidates = tasks
              .map(t => ({ title: t.title, score: matchScore(query, t.title) }))
              .filter(v => v.score >= 30)
              .sort((x, y) => y.score - x.score)
              .map(v => v.title);
            resolutionFailures.push(buildResolutionFailure(a.type, `Unable to resolve task "${query}".`, taskCandidates));
          }
          continue;
        }
        if (a.type === 'complete_task') {
          const match = resolveTask(a.title || a.task_id, tasks);
          if (match) {
            resolved.push({ ...a, task_id: match.id, title: match.title });
          } else {
            const query = (a.title || a.task_id || '').trim();
            const taskCandidates = tasks
              .map(t => ({ title: t.title, score: matchScore(query, t.title) }))
              .filter(v => v.score >= 30)
              .sort((x, y) => y.score - x.score)
              .map(v => v.title);
            resolutionFailures.push(buildResolutionFailure(a.type, `Unable to resolve task "${query}".`, taskCandidates));
          }
          continue;
        }
        if (a.type === 'edit_note' || a.type === 'delete_note') {
          const noteName = (a.tab_name || '').toLowerCase();
          const match = notes.find(n => n.name.toLowerCase() === noteName)
            || notes.find(n => n.name.toLowerCase().includes(noteName))
            || notes.find(n => noteName.includes(n.name.toLowerCase()));
          if (match) {
            resolved.push({ ...a, note_id: match.id, tab_name: match.name });
          } else {
            const query = (a.tab_name || '').trim();
            const noteCandidates = notes
              .map(n => ({ name: n.name, score: matchScore(query, n.name) }))
              .filter(v => v.score >= 30)
              .sort((x, y) => y.score - x.score)
              .map(v => v.name);
            resolutionFailures.push(buildResolutionFailure(a.type, `Unable to resolve note "${query}".`, noteCandidates));
          }
          continue;
        }
        if (a.type === 'add_event') {
          const dupTitle = (a.title||'').toLowerCase();
          const dupDate = a.date || today();
          if (events.some(ev => ev.title.toLowerCase() === dupTitle && ev.date === dupDate)) continue;
        }
        resolved.push(a);
      }
      actions = resolved;

      if (resolutionFailures.length > 0) {
        try {
          const fallback = await requestToolFailureFollowup(resolutionFailures);
          const followupText = typeof fallback?.content === 'string' ? fallback.content.trim() : '';
          if (followupText) {
            const msg = { role:'assistant', content: followupText, timestamp:Date.now() };
            setMessages(prev => { const n=[...prev,msg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
            if (user) dbInsertChatMsg('assistant', followupText, user.id);
          }
        } catch (fallbackErr) {
          console.error('Tool fallback clarification failed:', fallbackErr);
          const fallbackMsg = { role:'assistant', content:"I couldn't match part of that action. can you share the exact item name and date/time?", timestamp:Date.now() };
          setMessages(prev => { const n=[...prev,fallbackMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', fallbackMsg.content, user.id);
        }
      }

      if (actions.length > 0) {
        const confirmTypes = ['add_task','add_event','add_block','break_task','delete_task','delete_event','delete_block','update_event','convert_event_to_block','convert_block_to_event','add_recurring_event','clear_all','edit_note','delete_note'];
        const rawContentActions = actions.filter(a => CONTENT_TYPES.includes(a.type));
        const contentActions = rawContentActions.filter(isValidContentAction);
        const droppedContentActions = rawContentActions.filter(a => !isValidContentAction(a));
        if (droppedContentActions.length > 0) {
          console.warn('Dropped invalid content payload(s) from server actions[] response.');
          droppedContentActions.forEach(a => {
            const label = a.type?.replace('create_','').replace('make_','') || 'content';
            const errMsg = { role:'assistant', content:`couldn't generate ${label} — the response was incomplete. try rephrasing your request.`, timestamp:Date.now(), isValidationError: true };
            setMessages(prev => { const n=[...prev,errMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          });
        }
        const tutorContentActions = contentActions.filter(a => a.type === 'create_flashcards' || a.type === 'create_quiz');
        if (tutorContentActions.length > 0) primeTutorSession();
        const blockExecution = pendingClarification && !fromClarification;
        const autoExec = blockExecution ? [] : actions.filter(a => !confirmTypes.includes(a.type) && !CONTENT_TYPES.includes(a.type));
        autoExec.forEach(executeAction);
        if (contentActions.length > 0 && !blockExecution) setPendingContent(prev => [...prev, ...contentActions]);
        const needsConfirm = actions.filter(a => confirmTypes.includes(a.type));
        if (needsConfirm.length > 0) {
          if (aiAutoApprove && !blockExecution) {
            needsConfirm.forEach(executeAction);
          } else {
            setPendingActions(prev => [...prev, ...needsConfirm.map(a => ({ action:a, timestamp:Date.now() }))]);
          }
        }
      }

      // We intentionally keep the initial conversational reply above even if action resolution fails.
      // Resolution errors are surfaced as follow-up assistant messages.
    } catch(err) {
      console.error('Chat error:', err);
      const raw = err.message || '';
      let friendlyMsg;
      if (raw.includes('500') || raw.includes('Internal') || raw.includes('timed out')) {
        friendlyMsg = "the AI service is temporarily unavailable — please try again in a moment.";
      } else if (raw.includes('503') || raw.includes('overloaded')) {
        friendlyMsg = "the AI is a bit overloaded right now — wait a few seconds and try again.";
      } else if (raw.includes('401') || raw.includes('403')) {
        friendlyMsg = "authentication error — please refresh the page and try again.";
      } else if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('network')) {
        friendlyMsg = "couldn't reach the server — check your connection and try again.";
      } else {
        friendlyMsg = raw || "something went wrong — please try again.";
      }
      setChatError(friendlyMsg);
    } finally { setIsLoading(false); }
  }

  function handleClarificationSubmit(payload) {
    if (!pendingClarification) return;
    // payload is either a single object { selected, options, otherText } or an array of them
    const payloads = Array.isArray(payload) ? payload : [payload];
    const responseParts = payloads.map(p => {
      const selectedOptions = (p?.selected || []).map(id => (p?.options || []).find(o => o.id === id)).filter(Boolean);
      const selectedLabels = selectedOptions.map(o => o.label);
      const otherTxt = p?.otherText?.trim() || '';
      const parts = [];
      if (selectedLabels.length > 0) parts.push(selectedLabels.join(', '));
      if (otherTxt) parts.push(otherTxt);
      const answer = parts.join(' — ') || '';
      // Include the question for context if multi-question
      if (payloads.length > 1 && p?.question) return `${p.question}: ${answer}`;
      return answer;
    }).filter(Boolean);
    const readableResponse = responseParts.join('\n') || 'No selection';
    setPendingClarification(null);
    setPendingClarificationAnswers(null);
    sendMessage(readableResponse, { fromClarification: true });
  }

  function incrementGuestCount() {
    setGuestMsgCount(c => {
      const next = c + 1;
      try { localStorage.setItem('sos_guest_msg_count', String(next)); } catch (_) {}
      return next;
    });
  }

  function handleSubmit(e) {
    if(e)e.preventDefault();
    if(!user){
      if(guestMsgCount >= GUEST_DEMO_LIMIT){ setShowAuthModal(true); return; }
      incrementGuestCount();
    }
    if(input.trim()) sfx.send();
    sendMessage(input);
  }
  function sendChip(text) {
    const normalizedText = text === 'Make flashcards'
      ? (notes.length > 0 ? 'Create flashcards from my notes for the topic I should study next.' : 'Create flashcards for the topic I should study next.')
      : text === 'Quiz me'
        ? (notes.length > 0 ? 'Create a quiz from my notes and ask me one question at a time.' : 'Create a quiz for the topic I should study next and ask me one question at a time.')
        : text;
    if (/flashcard|quiz me|create a quiz/i.test(normalizedText)) primeTutorSession();
    if(!user){
      if(guestMsgCount >= GUEST_DEMO_LIMIT){ setInput(normalizedText); setShowAuthModal(true); return; }
      incrementGuestCount();
      setInput('');
      sendMessage(normalizedText);
      return;
    }
    setInput(''); sendMessage(normalizedText);
  }

  async function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be re-selected
    if (file.size > 10 * 1024 * 1024) {
      setToastMsg('Photo is too large — max 10MB');
      return;
    }
    try {
      const result = await resizeImage(file);
      setPendingPhoto(result);
    } catch (err) {
      console.error('Failed to process photo:', err);
      setToastMsg("Couldn't process that photo — try a different one");
    }
  }
  // ── Voice-to-text recording ──
  // ── Audio animation helpers ──
  function startWaveformAnimation(stream) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.75;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    audioContextRef.current = ctx; analyserRef.current = analyser; dataArrayRef.current = data;
    let idlePhase = 0;
    function tick() {
      analyser.getByteFrequencyData(data);
      // Update inline waveform bars
      if (waveformRef.current) {
        const bars = waveformRef.current.children;
        const step = Math.max(1, Math.floor(data.length / bars.length));
        for (let i = 0; i < bars.length; i++) {
          const val = data[Math.min(i * step, data.length - 1)] || 0;
          bars[i].style.height = Math.max(3, (val / 255) * 34) + 'px';
        }
      }
      // Update fullscreen ring overlay (if visible)
      let sum = 0; const bins = Math.min(60, data.length);
      for (let i = 0; i < bins; i++) sum += data[i];
      const vol = Math.min(sum / bins / 85, 1);
      idlePhase += 0.028;
      const idle = Math.sin(idlePhase) * 0.022 + 1;
      if (ring1Ref.current) ring1Ref.current.style.transform = `scale(${(idle + vol * 0.38).toFixed(4)})`;
      if (ring2Ref.current) ring2Ref.current.style.transform = `scale(${(idle * 0.99 + vol * 0.27).toFixed(4)})`;
      if (ring3Ref.current) ring3Ref.current.style.transform = `scale(${(idle * 0.98 + vol * 0.17).toFixed(4)})`;
      if (ring4Ref.current) ring4Ref.current.style.transform = `scale(${(idle * 0.97 + vol * 0.09).toFixed(4)})`;
      animFrameRef.current = requestAnimationFrame(tick);
    }
    animFrameRef.current = requestAnimationFrame(tick);
  }
  function stopWaveformAnimation() {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close().catch(()=>{}); audioContextRef.current = null; analyserRef.current = null; dataArrayRef.current = null; }
  }
  function cleanupMicStream() {
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
  }

  async function startRecording() {
    if (!user) { setAuthModalInitialMode('signup'); setShowAuthModal(true); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      audioChunksRef.current = [];
      speechTranscriptRef.current = '';
      // P0.3: Safari/iOS doesn't support webm — fall back to mp4
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorderRef.current = recorder;
      recorder.start();
      // Start browser SpeechRecognition in parallel as fallback
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        try {
          const recognition = new SR();
          recognition.lang = 'en-US';
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.onresult = (e) => { speechTranscriptRef.current = Array.from(e.results).map(r => r[0].transcript).join(''); };
          recognition.onerror = () => {};
          speechRecRef.current = recognition;
          recognition.start();
        } catch(e) { /* browser doesn't support — fine, Groq is primary */ }
      }
      startWaveformAnimation(stream);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
      setIsRecording(true);
    } catch (err) {
      console.error('Mic access error:', err);
      setToastMsg("Couldn't access microphone — check browser permissions");
    }
  }

  function stopSpeechRec() {
    if (speechRecRef.current) { try { speechRecRef.current.stop(); } catch(e) {} speechRecRef.current = null; }
  }

  function stopRecording() {
    clearInterval(recordingTimerRef.current);
    stopWaveformAnimation();
    stopSpeechRec();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = async () => {
        cleanupMicStream();
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/webm' });
        if (blob.size < 100) { setToastMsg("Recording too short — try again"); return; }
        await transcribeAudio(blob);
      };
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }

  function cancelRecording() {
    clearInterval(recordingTimerRef.current);
    stopWaveformAnimation();
    stopSpeechRec();
    speechTranscriptRef.current = '';
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.stop();
    }
    cleanupMicStream();
    setIsRecording(false);
    setRecordingTime(0);
  }

  async function transcribeAudio(blob) {
    setIsTranscribing(true);
    let transcript = '';
    try {
      // Primary: Groq Whisper via edge function
      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const arrayBuf = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const audioBase64 = btoa(binary);
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY)
        },
        body: JSON.stringify({ mode: 'voice', audioBase64, audioMimeType: blob.type || 'audio/webm' })
      });
      if (res.ok) {
        const data = await res.json();
        transcript = (data.text || '').trim();
      }
    } catch (groqErr) {
      console.warn('Groq transcription failed, checking browser fallback:', groqErr);
    }

    // Fallback: use browser SpeechRecognition transcript collected during recording
    if (!transcript) {
      transcript = (speechTranscriptRef.current || '').trim();
      if (transcript) console.log('Using browser SpeechRecognition fallback');
    }
    speechTranscriptRef.current = '';

    if (transcript) {
      // Auto-send the transcribed message directly
      sendMessage(transcript);
    } else {
      const hasBrowserSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      setToastMsg(hasBrowserSR
        ? "Couldn't catch that — try speaking louder or closer"
        : "Voice isn't available right now — try typing instead");
    }
    setIsTranscribing(false);
  }


  function clearChat() {
    setMessages([]); setPendingActions([]); setPendingClarification(null); setPendingClarificationAnswers(null); setChatError(null);
    setViewingSavedChatId(null);
    if (user) dbClearChat(user.id);
  }

  function startNewChat() {
    autoSaveCurrentChat();
    setActivePanel('chat');
    clearChat();
    closeSidebarCompanion();
  }

  async function handleLogout() {
    await sb.auth.signOut();
  }

  function openSidebarCompanion(panel) {
    setActivePanel('chat');
    setSidebarCompanionPanel(panel);
    setCompanionCollapsed(false);
    if (autoCollapseSidebarCompanion) setSidebarCollapsed(true);
    setShowPeek(false);
    setShowNotes(false);
  }

  function closeSidebarCompanion() {
    setSidebarCompanionPanel('none');
    setCompanionCollapsed(true);
  }

  // ── Keyboard shortcuts ──
  useEffect(()=>{
    function handleKey(e){
      const tag=document.activeElement?.tagName?.toLowerCase();
      if(tag==='input'||tag==='textarea'||tag==='select')return;
      const key=e.key.toLowerCase();
      if(key==='/'){e.preventDefault();inputRef.current?.focus()}
      else if(key==='s'){
        e.preventDefault();
        if (layoutMode === 'topbar') {
          setShowPeek(p=>!p);
        } else if (activePanel === 'chat') {
          openCompanionPanel('schedule');
        } else {
          setShowPeek(p=>!p);
        }
      }
      else if(key==='n'){
        e.preventDefault();
        if (layoutMode === 'topbar') {
          setShowNotes(p=>!p);
        } else if (activePanel === 'chat') {
          openCompanionPanel('notes');
        } else {
          setShowNotes(p=>!p);
        }
      }
      else if(key==='h'){e.preventDefault();setShowChatSidebar(p=>!p)}
      else if(key==='escape'){if(showChatSidebar)setShowChatSidebar(false);if(showPeek)setShowPeek(false);if(showNotes)setShowNotes(false);if(activePanel==='settings')setActivePanel('chat')}
    }
    window.addEventListener('keydown',handleKey);return()=>window.removeEventListener('keydown',handleKey);
  },[showPeek,showNotes,showChatSidebar,activePanel,layoutMode,openCompanionPanel]);

  function toggleTutorMode(nextValue) {
    setTutorMode(nextValue);
    localStorage.setItem('sos_tutor_mode', nextValue ? 'true' : 'false');
  }

  function enterTutorMode() {
    toggleTutorMode(true);
    setActivePanel('tutor');
  }

  function primeTutorSession() {
    toggleTutorMode(true);
    setActivePanel('chat');
    if (notes.length > 0) {
      if (layoutMode === 'sidebar') {
        openCompanionPanel('notes');
      } else {
        setShowNotes(true);
        setShowPeek(false);
      }
    }
  }

  function launchTutorPrompt(message) {
    setActivePanel('chat');
    if (notes.length > 0) {
      if (layoutMode === 'sidebar') {
        if (sidebarCompanionPanel !== 'notes') openCompanionPanel('notes');
      } else {
        setShowNotes(true);
        setShowPeek(false);
      }
    }
    setInput(message);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const activeTaskCount = tasks.filter(t=>t.status!=='done').length;
  const overdueCount = tasks.filter(t=>t.status!=='done'&&daysUntil(t.dueDate)<0).length;
  useEffect(() => { localStorage.setItem('sos_layout_mode', layoutMode); }, [layoutMode]);
  useEffect(() => {
    if (layoutMode !== 'lofi') setHomeLayoutEditMode(false);
  }, [layoutMode]);
  useEffect(() => { localStorage.setItem('sos_sidebar_collapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { localStorage.setItem('sos_sidebar_companion_panel', sidebarCompanionPanel); }, [sidebarCompanionPanel]);
  useEffect(() => { localStorage.setItem('sos_companion_collapsed', String(companionCollapsed)); }, [companionCollapsed]);
  useEffect(() => { localStorage.setItem('sos_auto_collapse_sidebar_companion', String(autoCollapseSidebarCompanion)); }, [autoCollapseSidebarCompanion]);
  useEffect(() => { localStorage.setItem('sos_companion_toggle_compact', String(compactCompanionToggle)); }, [compactCompanionToggle]);
  useEffect(() => { localStorage.setItem('sos_weather_theme', weatherThemeEnabled ? 'true' : 'false'); }, [weatherThemeEnabled]);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme-mode', weatherThemeEnabled ? 'weather' : 'default');
    if (weatherThemeEnabled) {
      root.setAttribute('data-weather-theme', weatherThemeKey(weatherData?.current?.weathercode));
    } else {
      root.removeAttribute('data-weather-theme');
    }
    return () => {
      root.removeAttribute('data-theme-mode');
      root.removeAttribute('data-weather-theme');
    };
  }, [weatherThemeEnabled, weatherData]);

  // ── Loading data after login ──
  if (user && !dataLoaded) {
    return (
      <div className="auth-screen" style={{position:'relative'}}>
        <div style={{position:'absolute',width:200,height:200,background:'radial-gradient(circle, rgba(108,99,255,0.1) 0%, transparent 70%)',borderRadius:'50%',filter:'blur(40px)',pointerEvents:'none',animation:'breathe 3s ease-in-out infinite'}}/>
        <div style={{fontSize:'2.2rem',fontWeight:900,color:'transparent',background:'linear-gradient(135deg, #4de7f5 0%, #38d8e8 55%, #58b8ff 100%)',backgroundSize:'200% 200%',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',marginBottom:16,position:'relative',animation:'gradientShift 3s ease infinite'}}>SOS</div>
        <div style={{width:28,height:28,border:'3px solid rgba(108,99,255,0.15)',borderTopColor:'var(--accent)',borderRightColor:'var(--teal)',borderRadius:'50%',animation:'spin 0.8s linear infinite',position:'relative',boxShadow:'0 0 16px rgba(108,99,255,0.15)'}}/>
        <div style={{marginTop:12,fontSize:'0.85rem',color:'var(--text-dim)',position:'relative',animation:'textReveal 0.4s ease 0.2s both'}}>Loading your data...</div>
      </div>
    );
  }

  // ── Checking session on first load ──
  if (!authChecked) {
    return (
      <div className="auth-screen" style={{position:'relative'}}>
        <div style={{position:'absolute',width:200,height:200,background:'radial-gradient(circle, rgba(108,99,255,0.1) 0%, transparent 70%)',borderRadius:'50%',filter:'blur(40px)',pointerEvents:'none'}}/>
        <div style={{fontSize:'2.2rem',fontWeight:900,color:'transparent',background:'linear-gradient(135deg, #4de7f5 0%, #38d8e8 55%, #58b8ff 100%)',backgroundSize:'200% 200%',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',marginBottom:16,position:'relative',animation:'gradientShift 3s ease infinite'}}>SOS</div>
        <div style={{width:28,height:28,border:'3px solid rgba(108,99,255,0.15)',borderTopColor:'var(--accent)',borderRightColor:'var(--teal)',borderRadius:'50%',animation:'spin 0.8s linear infinite',position:'relative',boxShadow:'0 0 16px rgba(108,99,255,0.15)'}}/>
      </div>
    );
  }

  return (
    <EditModeProvider>
    <div className={layoutMode === 'lofi' ? 'study-app' : 'sos-app'} style={layoutMode !== 'lofi' ? {flexDirection: layoutMode === 'topbar' ? 'column' : 'row'} : undefined}>
      {/* Neon Lofi — corner targeting reticles (decorative) */}
      {layoutMode !== 'lofi' && <>
        <span className="corner-bracket corner-bracket-tl" aria-hidden="true" />
        <span className="corner-bracket corner-bracket-tr" aria-hidden="true" />
        <span className="corner-bracket corner-bracket-bl" aria-hidden="true" />
        <span className="corner-bracket corner-bracket-br" aria-hidden="true" />
      </>}
      {/* Loading scan line */}
      {isLoading && <div className="sos-loading-scan" aria-hidden="true" />}
      {layoutMode === 'lofi' && <StudyTopBar
        user={user}
        syncStatus={syncStatus}
        tutorMode={tutorMode}
        ambientMode={ambientMode}
        onAmbientMode={setAmbientMode}
        onNewChat={() => { sfx.nav(); startNewChat(); }}
        onTutorMode={() => { sfx.nav(); enterTutorMode(); }}
        onImport={() => { sfx.nav(); setShowGoogleModal(true); }}
        onSettings={() => { sfx.nav(); setActivePanel('settings'); }}
        onSwitchLayout={() => setLayoutMode('sidebar')}
        onAuthAction={() => user ? handleLogout() : setShowAuthModal(true)}
      />}
      {layoutMode === 'sidebar' && <aside className={'sos-sidebar'+(sidebarCollapsed?' collapsed':'')}>
        <div className="sos-sidebar-head">
          <div className="sos-sidebar-head-left">
            <div className="sos-sidebar-brand"><img className="sos-brand-logo" src="/brain-logo.svg" alt="SOS" style={{width:sidebarCollapsed?24:30,height:sidebarCollapsed?24:30}}/></div>
            {user && <div className="sync-label" style={{fontSize:'0.73rem',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:4}}>
              <span className={'sync-dot '+(syncStatus==='saving'?'sync-saving':syncStatus==='error'?'sync-error':'sync-saved')}/>
              {syncStatus==='saving'?'Saving...':syncStatus==='error'?'Sync error':'Synced'}
            </div>}
          </div>
          <button className="sos-collapse-btn" onClick={()=>setSidebarCollapsed(prev=>!prev)} title={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'} aria-label={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'}>
            {Icon.panel(16)}
          </button>
        </div>
        <div className="sos-side-actions">
          <button className="sos-side-btn" onClick={()=>{ sfx.nav(); startNewChat(); }} title="New chat">{Icon.plus(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>New chat</span></button>
          <button className="sos-side-btn" onClick={()=>{ sfx.nav(); if(sidebarCompanionPanel==='schedule'&&!companionCollapsed){setCompanionCollapsed(true);}else{openCompanionPanel('schedule');} }} title="Schedule + chat">{Icon.clipboard(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Schedule + chat</span></button>
          <button className="sos-side-btn" onClick={()=>{ sfx.nav(); if(sidebarCompanionPanel==='notes'&&!companionCollapsed){setCompanionCollapsed(true);}else{openCompanionPanel('notes');} }} title="Notes + chat">{Icon.fileText(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Notes + chat</span></button>
          <button className="sos-side-btn" onClick={()=>{ sfx.nav(); enterTutorMode(); }} title="Enter tutor mode">{Icon.bookOpen(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Enter tutor mode</span></button>
          <button className="sos-side-btn" onClick={()=>{ sfx.nav(); setShowGoogleModal(true); }} title="Import">{Icon.link(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Import</span></button>
          <button className="sos-side-btn" onClick={()=>{ sfx.nav(); setActivePanel('settings'); }} title="Settings">{Icon.edit(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Settings</span></button>
        </div>
        <div className="sos-side-meta">
          <span>{activeTaskCount} task{activeTaskCount!==1?'s':''}{overdueCount>0?` • ${overdueCount} overdue`:''}</span>
          <span style={{color:contentGenUsed>=DAILY_CONTENT_LIMIT?'var(--danger)':'var(--text-dim)'}}>{Math.max(0, DAILY_CONTENT_LIMIT - contentGenUsed)}/{DAILY_CONTENT_LIMIT}</span>
        </div>
        {(showTutorIndicatorSidebar || showPerfIndicatorSidebar) && (
          <div className="sos-side-indicators sos-side-meta">
            {showTutorIndicatorSidebar && <TutorIndicator active={tutorMode} />}
            {showPerfIndicatorSidebar && <PerfPill />}
          </div>
        )}
        <div className="sos-side-list">
          {savedChats.length === 0 ? (
            <div className="chat-sidebar-empty" style={{paddingTop:24}}>
              <div style={{marginBottom:8,opacity:0.4,display:'flex',justifyContent:'center',color:'var(--accent)'}}>{Icon.messageCircle(28)}</div>
              <div>No saved chats yet. Like bookmarks, but smarter.</div>
            </div>
          ) : (
            <div className="chat-sidebar-list">
              {savedChats.map(chat => (
                <div key={chat.id} className={'chat-sidebar-item' + (viewingSavedChatId === chat.id ? ' active' : '')}
                  onClick={() => loadSavedChat(chat.id)}>
                  <div className="chat-sidebar-item-title">{chat.title}</div>
                  <div className="chat-sidebar-item-meta">
                    <span>{chat.messageCount} msg · {fmt(chat.savedAt)}</span>
                    <span style={{display:'flex',gap:4}}>
                      <button className="chat-sidebar-item-delete" onClick={e => { e.stopPropagation(); deleteSavedChat(chat.id); }}>Delete</button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{display:'flex',gap:8,padding:'4px 2px 0'}}>
          <button className="sos-side-btn" onClick={()=>setLayoutMode('topbar')} style={{padding:'8px 10px',fontSize:'0.76rem'}} title="Topbar mode">{Icon.chevronLeft(12)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Topbar mode</span></button>
          {user ? (
            <button className="sos-side-btn" onClick={handleLogout} style={{padding:'8px 10px',fontSize:'0.76rem'}} title="Sign out">{Icon.logout(12)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Sign out</span></button>
          ) : (
            <button className="sos-side-btn" onClick={()=>setShowAuthModal(true)} style={{padding:'8px 10px',fontSize:'0.76rem'}} title="Sign in">{Icon.messageCircle(12)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Sign in</span></button>
          )}
        </div>
      </aside>}

      {layoutMode === 'lofi' && (
        <EditableSortableContainer
          isEditMode={homeLayoutEditMode}
          storageKey="sos_home_layout_order"
          modules={[
            {
              editableId: 'lofi-left-panel',
              editableRegistration: {
                schemaPaths: ['homepage.blocks.lofi-left-panel'],
                storage: ['localStorage:sos_home_layout_order'],
              },
              order: 1,
              label: 'Today panel',
              render: () => (
                <LofiLeftPanel
                  tasks={tasks}
                  onToggleTask={(task) => {
                    if (task.status === 'done') {
                      updateTask(task.id, { status: 'not_started', completedAt: null });
                    } else {
                      updateTask(task.id, { status: 'done', completedAt: new Date().toISOString() });
                      setRecentlyCompleted(prev => { const n = new Set(prev); n.add(task.id); return n; });
                      setTimeout(() => setRecentlyCompleted(prev => { const n = new Set(prev); n.delete(task.id); return n; }), 900);
                    }
                  }}
                />
              ),
            },
            {
              editableId: 'lofi-right-panel',
              editableRegistration: {
                schemaPaths: ['homepage.blocks.lofi-right-panel'],
                storage: ['localStorage:sos_home_layout_order'],
              },
              order: 2,
              label: 'Utility panel',
              render: () => (
                <LofiRightPanel
                  weatherData={weatherData}
                  tasks={tasks}
                  blocks={blocks}
                  events={events}
                  notes={notes}
                  onDeleteNote={handleDeleteNote}
                  onUpdateNote={handleUpdateNote}
                  onCreateNote={handleCreateNote}
                />
              ),
            },
          ]}
          renderModule={(module, index) => {
            const slot = index === 0 ? '1' : '3';
            return (
              <div className="editable-sortable-slot" style={{ gridColumn: slot, gridRow: 2 }}>
                {module.render()}
              </div>
            );
          }}
        />
      )}
      <div className={layoutMode === 'lofi' ? 'study-center study-glass' : 'sos-main'}>
      {layoutMode === 'topbar' && <div className="sos-header">
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>setLayoutMode('sidebar')} className="topbar-sidebar-btn" title="Sidebar mode" aria-label="Sidebar mode">{Icon.panel(16)}</button>
          <div className="sos-sidebar-brand" style={{width:34,height:34}}><img className="sos-brand-logo" src="/brain-logo.svg" alt="SOS" style={{width:30,height:30}}/></div>
          {user && <div style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:4}}>
            <span className={'sync-dot '+(syncStatus==='saving'?'sync-saving':syncStatus==='error'?'sync-error':'sync-saved')}/>
            {syncStatus==='saving'?'Saving...':syncStatus==='error'?'Sync error':'Synced'}
          </div>}
        </div>
        <div className="topbar-actions" style={{display:'flex',alignItems:'center',gap:12}}>
          {showTutorIndicatorTopbar && <TutorIndicator active={tutorMode} />}
          {showPerfIndicatorTopbar && <PerfPill />}
          <button onClick={()=>{ openCompanionPanel('schedule'); if(!user){setAuthNudge(true);setTimeout(()=>setAuthNudge(false),5000);} }} className="g-hdr-btn topbar-priority-btn">{Icon.clipboard(14)} <span>Schedule + chat</span></button>
          <button onClick={()=>{ openCompanionPanel('notes'); if(!user){setAuthNudge(true);setTimeout(()=>setAuthNudge(false),5000);} }} className="g-hdr-btn topbar-priority-btn">{Icon.fileText(14)} <span>Notes + chat</span></button>
          <button onClick={enterTutorMode} className="g-hdr-btn">{Icon.bookOpen(14)} <span>Enter tutor mode</span></button>
          <button onClick={()=>setShowChatSidebar(true)} className="g-hdr-btn">{Icon.messageCircle(14)} <span>Saved</span></button>
          <button onClick={()=>setActivePanel('settings')} className="g-hdr-btn">{Icon.edit(14)} <span>Settings</span></button>
        </div>
      </div>}

      {activePanel === 'tutor' ? (
        <div className="sos-chat-area" style={{animation:'fadeIn .25s ease'}}>
          <TutorMissionPage
            tutorMode={tutorMode}
            tasks={tasks}
            events={events}
            notes={notes}
            onBack={() => { toggleTutorMode(false); setActivePanel('chat'); }}
            onToggleTutorMode={toggleTutorMode}
            onPrompt={launchTutorPrompt}
            onOpenNotes={() => openCompanionPanel('notes')}
            onOpenSchedule={() => openCompanionPanel('schedule')}
            onOpenSettings={() => setActivePanel('settings')}
          />
        </div>
      ) : activePanel === 'settings' ? (
        <div className="sos-chat-area" style={{animation:'fadeIn .25s ease'}}>
          <div className="settings-view" style={{animation:'slideUp .28s ease'}}>
            <div className="settings-card">
              <div className="settings-title">Settings</div>
              <div className="settings-sub">Customize your workspace layout and keep the controls for topbar/sidebar behavior in one place.</div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Layout mode</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Switch between lofi grid, sidebar, and topbar navigation.</div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button className={'settings-toggle'+(layoutMode==='lofi'?' settings-toggle-active':'')} onClick={()=>setLayoutMode('lofi')}>Lofi</button>
                  <button className={'settings-toggle'+(layoutMode==='sidebar'?' settings-toggle-active':'')} onClick={()=>setLayoutMode('sidebar')}>Sidebar</button>
                  <button className={'settings-toggle'+(layoutMode==='topbar'?' settings-toggle-active':'')} onClick={()=>setLayoutMode('topbar')}>Topbar</button>
                </div>
              </div>
              {layoutMode === 'lofi' && (
                <div className="settings-row">
                  <div>
                    <div style={{fontWeight:600,fontSize:'0.88rem'}}>Home layout edit mode</div>
                    <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Drag panels or use move up/down controls to reorder your lofi side panels.</div>
                  </div>
                  <button className={'settings-toggle'+(homeLayoutEditMode?' settings-toggle-active':'')} onClick={()=>setHomeLayoutEditMode(prev=>!prev)}>{homeLayoutEditMode ? 'On' : 'Off'}</button>
                </div>
              )}
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Sidebar collapsed</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Applies when sidebar mode is active.</div>
                </div>
                <button className="settings-toggle" onClick={()=>setSidebarCollapsed(prev=>!prev)}>{sidebarCollapsed?'Expand':'Collapse'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Auto-collapse sidebar in notes/schedule mode</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>When opening Notes + chat or Schedule + chat, collapse the left sidebar automatically.</div>
                </div>
                <button className="settings-toggle" onClick={()=>setAutoCollapseSidebarCompanion(prev=>!prev)}>{autoCollapseSidebarCompanion ? 'On' : 'Off'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Auto-approve AI actions</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Execute adds instantly without a confirmation popup. Deletes still require confirm.</div>
                </div>
                <button className="settings-toggle" onClick={()=>{ const next = !aiAutoApprove; setAiAutoApprove(next); localStorage.setItem('sos_ai_auto_approve', next ? 'true' : 'false'); }}>{aiAutoApprove ? 'On' : 'Off'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Sidebar split panel</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Choose whether chat is paired with notes or schedule in sidebar mode.</div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button className="settings-toggle" onClick={()=>openSidebarCompanion('schedule')}>Schedule</button>
                  <button className="settings-toggle" onClick={()=>openSidebarCompanion('notes')}>Notes</button>
                  <button className="settings-toggle" onClick={closeSidebarCompanion}>Off</button>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Companion toggle style</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Switch between the old horizontal bar and the compact icon-only toggle.</div>
                </div>
                <button className="settings-toggle" onClick={()=>setCompactCompanionToggle(prev=>!prev)}>{compactCompanionToggle ? 'Compact' : 'Classic'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Performance mode</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Auto adjusts based on device speed, or pick a fixed tier.</div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button className="settings-toggle" onClick={()=>setPerfOverride(null)}>Auto</button>
                  <button className="settings-toggle" onClick={()=>setPerfOverride('mid')}>Mid</button>
                  <button className="settings-toggle" onClick={()=>setPerfOverride('low')}>Low</button>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Weather-based theme</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Off = default blue gradient. On = theme colors react to local weather.</div>
                </div>
                <button className="settings-toggle" onClick={()=>setWeatherThemeEnabled(prev=>!prev)}>{weatherThemeEnabled ? 'On' : 'Off'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Tutor mode</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Activates a guided, step-by-step learning style. Indicator appears in sidebar and topbar when on.</div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button className={'settings-toggle'+(tutorMode?' settings-toggle-active':'')} onClick={()=>toggleTutorMode(!tutorMode)}>{tutorMode ? 'On' : 'Off'}</button>
                  <button className="settings-toggle" onClick={enterTutorMode}>Enter mode</button>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Tutor indicator — sidebar</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Show or hide the tutor mode indicator in the sidebar.</div>
                </div>
                <button className="settings-toggle" onClick={()=>{ const n=!showTutorIndicatorSidebar; setShowTutorIndicatorSidebar(n); localStorage.setItem('sos_tutor_indicator_sidebar',n?'true':'false'); }}>{showTutorIndicatorSidebar ? 'Visible' : 'Hidden'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Tutor indicator — topbar</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Show or hide the tutor mode indicator in the topbar.</div>
                </div>
                <button className="settings-toggle" onClick={()=>{ const n=!showTutorIndicatorTopbar; setShowTutorIndicatorTopbar(n); localStorage.setItem('sos_tutor_indicator_topbar',n?'true':'false'); }}>{showTutorIndicatorTopbar ? 'Visible' : 'Hidden'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Performance indicator — sidebar</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Show or hide the performance mode pill in the sidebar.</div>
                </div>
                <button className="settings-toggle" onClick={()=>{ const n=!showPerfIndicatorSidebar; setShowPerfIndicatorSidebar(n); localStorage.setItem('sos_perf_indicator_sidebar',n?'true':'false'); }}>{showPerfIndicatorSidebar ? 'Visible' : 'Hidden'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Performance indicator — topbar</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Show or hide the performance mode pill in the topbar.</div>
                </div>
                <button className="settings-toggle" onClick={()=>{ const n=!showPerfIndicatorTopbar; setShowPerfIndicatorTopbar(n); localStorage.setItem('sos_perf_indicator_topbar',n?'true':'false'); }}>{showPerfIndicatorTopbar ? 'Visible' : 'Hidden'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Back</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Return to the conversation view.</div>
                </div>
                <button className="settings-toggle" onClick={()=>setActivePanel('chat')}>Open</button>
              </div>
            </div>
            {/* P4.3: Privacy/Terms links */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:16,padding:'12px 0',fontSize:'0.78rem'}}>
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{color:'var(--text-dim)',textDecoration:'none',transition:'color .15s'}}>Privacy Policy</a>
              <span style={{color:'var(--border)'}}>|</span>
              <a href="/terms" target="_blank" rel="noopener noreferrer" style={{color:'var(--text-dim)',textDecoration:'none',transition:'color .15s'}}>Terms of Service</a>
            </div>
          </div>
        </div>
      ) : (
      <>
      <div className={'sos-chat-shell' + (showSidebarCompanion ? ' companion-open' : '') + (showSidebarCompanion && companionCollapsed ? ' companion-collapsed' : '')}>
      <div className="sos-chat-column">
      {/* ── Chat Area ── */}
      <ErrorBoundary>
      <div className="sos-chat-area" ref={chatAreaRef} style={{animation:'fadeIn .22s ease'}}>
        {messages.length===0&&!isLoading&&(()=>{
          // Default welcome screen
          const wv = welcomeVariants[welcomeIdx];
          return (
          <div style={{position:'relative',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',padding:'48px 24px',textAlign:'center'}}>
            <div style={{position:'absolute',top:'28%',width:240,height:240,background:'radial-gradient(circle, rgba(245,158,11,0.18) 0%, rgba(234,88,12,0.08) 40%, transparent 70%)',borderRadius:'50%',filter:'blur(50px)',pointerEvents:'none',animation:'breathe 4s ease-in-out infinite, orbFloat 8s ease-in-out infinite'}}/>
            <div style={{fontSize:'3.2rem',marginBottom:16,color:'transparent',background:'linear-gradient(135deg, #4de7f5 0%, #38d8e8 55%, #58b8ff 100%)',backgroundSize:'200% 200%',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',fontWeight:900,letterSpacing:'-1px',position:'relative',animation:'gradientShift 4s ease infinite, floatUp 0.6s cubic-bezier(0.16,1,0.3,1) both'}}>SOS</div>
            <div style={{fontSize:'1.35rem',color:'var(--text)',fontWeight:600,marginBottom:8,position:'relative',animation:'textReveal 0.5s ease 0.15s both',fontFamily:"'Crimson Text', Georgia, serif",letterSpacing:'-0.01em'}}>{wv.greeting}</div>
            <div style={{fontSize:'0.88rem',color:'var(--text-dim)',maxWidth:400,lineHeight:1.65,marginBottom:32,position:'relative',animation:'textReveal 0.5s ease 0.3s both'}}>{wv.desc}</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:8,justifyContent:'center',maxWidth:440,position:'relative'}}>
              {wv.chips.map((s,i)=>(
                <button key={s} className="sos-chip" style={{animation:`floatUp 0.4s cubic-bezier(0.16,1,0.3,1) ${0.4+i*0.08}s both`}} onClick={()=>sendChip(s)}>{s}</button>
              ))}
            </div>
          </div>
          );
        })()}
        {messages.map((msg,i)=>(
          <React.Fragment key={i}>
            {/* P1.4: "Earlier in conversation" separator */}
            {i === 0 && dbMessageCount > 0 && messages.length > dbMessageCount && (
              <div className="chat-history-separator">
                <span>Earlier in conversation</span>
              </div>
            )}
            {i === dbMessageCount && dbMessageCount > 0 && messages.length > dbMessageCount && (
              <div className="chat-history-separator">
                <span>New messages</span>
              </div>
            )}
            <div className={`sos-msg ${msg.role==='user'?'sos-msg-user':'sos-msg-ai'}`}>
              <div className={`sos-bubble ${msg.role==='user'?'sos-bubble-user':'sos-bubble-ai'}${msg.streaming?' streaming':''}`}>
                {(msg.photoUrl||msg.photoPreview)&&(
                  <img src={msg.photoUrl||msg.photoPreview} alt="photo"
                    onClick={()=>setLightboxUrl(msg.photoUrl||msg.photoPreview)}
                    onError={(e)=>{e.target.style.display='none';}}
                    style={{maxWidth:240,maxHeight:200,borderRadius:10,marginBottom:msg.content?8:0,cursor:'pointer',display:'block'}}/>
                )}
                {msg.content && (msg.role === 'assistant'
                  ? <div dangerouslySetInnerHTML={{__html: formatAssistantMessage(msg.content)}} />
                  : <span>{msg.content}</span>)}
                <div className="sos-bubble-time">{msg.timestamp?new Date(msg.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</div>
              </div>
            </div>
          </React.Fragment>
        ))}
        {pendingTemplateSelector && (
          <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
            <PlanTemplateSelector
              onSelectTemplate={(tmpl) => handleSelectTemplate(tmpl, pendingTemplateSelector.context)}
              onCustomPlan={handleCustomPlan}
              onDismiss={handleDismissTemplateSelector}
            />
          </div>
        )}
        {pendingClarification && (
          <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px', flexDirection:'column'}}>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,fontSize:'0.72rem',color:'var(--text-dim)',fontWeight:600,letterSpacing:'0.02em'}}>
              <span style={{display:'flex',color:'var(--accent)'}}>{Icon.clipboard(12)}</span>
              <span style={{textTransform:'uppercase',letterSpacing:'0.5px'}}>Collecting details to complete action</span>
            </div>
            <ClarificationCard clarification={pendingClarification} onSubmit={handleClarificationSubmit} onSkip={() => { setPendingClarification(null); setPendingClarificationAnswers(null); }} savedAnswers={pendingClarificationAnswers} onAnswersChange={setPendingClarificationAnswers} />
          </div>
        )}
        {!pendingClarification && pendingActions.length > 1 ? (
          <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
            <BulkConfirmationCard
              actions={pendingActions}
              onConfirmSelected={(checkedArr)=>{
                const toExec=pendingActions.filter((_,i)=>checkedArr[i]);
                toExec.forEach(pa=>{
                  if(pa.action.type==='add_recurring_event'){
                    const dayNameToIndex={Sunday:0,Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6};
                    const dayIndices=(pa.action.days||[]).map(d=>dayNameToIndex[d]).filter(d=>d!==undefined);
                    const start=new Date(pa.action.start_date||today());
                    const endDef=new Date();endDef.setMonth(endDef.getMonth()+3);
                    const end=new Date(pa.action.end_date||toDateStr(endDef));
                    const cursor=new Date(start);let count=0;
                    while(cursor<=end&&count<100){
                      if(dayIndices.includes(cursor.getDay())){
                        const ds=toDateStr(cursor);
                        executeAction({type:'add_event',title:pa.action.title,date:ds,event_type:pa.action.event_type||'event',subject:pa.action.subject||''});
                        count++;
                      }
                      cursor.setDate(cursor.getDate()+1);
                    }
                  } else { executeAction(pa.action); }
                });
                setPendingActions(prev=>prev.filter((_,i)=>!checkedArr[i]));
                if(toExec.length>0){
                  setToastMsg('Added '+toExec.length+' items');
                  const calTypes=['add_event','add_block','add_task','delete_event','delete_task','delete_block','update_event','convert_event_to_block','convert_block_to_event','add_recurring_event'];
                  if(toExec.some(pa=>calTypes.includes(pa.action.type))){
                    if(layoutMode==='sidebar'){openCompanionPanel('schedule');}
                    else if(!showSideBySide){setShowPeek(true);}
                  }
                }
              }}
              onCancel={()=>setPendingActions([])}
            />
          </div>
        ) : !pendingClarification && pendingActions.map((pa,idx)=>(
          <div key={'pa-'+idx} className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
            {pa.action.type==='add_recurring_event' ? (
              <RecurringEventPopup
                action={pa.action}
                onConfirm={(checkedEvents)=>{
                  checkedEvents.forEach(ev=>executeAction({type:'add_event',title:ev.title,date:ev.date,event_type:ev.event_type,subject:ev.subject}));
                  setPendingActions(prev=>prev.filter((_,i)=>i!==idx));
                  setToastMsg('Added '+checkedEvents.length+' recurring events');
                }}
                onCancel={()=>handleCancelAction(idx)}
              />
            ) : (
              <ConfirmationCard
                action={pa.action}
                onConfirm={(action)=>handleConfirmAction(idx,action)}
                onCancel={()=>handleCancelAction(idx)}
                isFallback={pa.isFallback}
                editableId={`confirmation-card-${idx}-${pa.action.type || 'action'}`}
                editableFields={['title','subject','due','estimated_minutes','date','event_type','activity','start','end']}
                onPatch={(_patch, nextDraft) => { void nextDraft; }}
              />
            )}
          </div>
        ))}
        {pendingContent.map((pc,idx)=>(
          <div key={'pc-'+idx} className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
            <ContentTypeRouter content={pc} onSave={()=>handleSaveContent(idx)} onDismiss={()=>handleDismissContent(idx)} onApplyPlan={(steps)=>handleApplyPlan(idx,steps)} onStartPlanTask={(step)=>handleStartPlanTask(step)} onExportGoogleDocs={(planData)=>handleExportPlanToGoogleDocs(idx,planData)} googleConnected={isGoogleConnected()}/>
          </div>
        ))}
        {isLoading&&<ThinkingIndicator message={loadingMessage}/>}
        {chatError&&<div style={{padding:'8px 16px'}}><div style={{padding:'10px 14px',borderRadius:16,background:'rgba(255,71,87,0.08)',border:'1px solid rgba(255,71,87,0.25)',fontSize:'0.84rem',color:'var(--danger)',maxWidth:'80%'}}>{chatError}</div></div>}
        <div ref={messagesEndRef} style={{height:1}}/>
      </div>

      </ErrorBoundary>
      {/* ── Guest Demo Banner ── */}
      {!user && (
        <div style={{padding:'6px 16px 0',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,fontSize:'0.8rem',color:'var(--text-dim)',animation:'fadeIn .3s ease'}}>
          <span>
            {guestMsgCount < GUEST_DEMO_LIMIT
              ? <>Demo mode — <strong style={{color:'var(--accent)'}}>{GUEST_DEMO_LIMIT - guestMsgCount} free message{GUEST_DEMO_LIMIT - guestMsgCount !== 1 ? 's' : ''} left</strong></>
              : <strong style={{color:'var(--warning)'}}>Demo limit reached — sign up to keep going</strong>
            }
          </span>
          <button onClick={()=>{setAuthModalInitialMode('signup');setShowAuthModal(true);}} style={{background:'var(--accent)',border:'none',borderRadius:14,color:'#fff',fontSize:'0.76rem',fontWeight:700,padding:'4px 10px',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>Sign up free →</button>
        </div>
      )}
      {/* ── Input Area ── */}
      <div className="sos-input-area">
        {contextTrimInfo&&(
          <div style={{fontSize:'0.72rem',color:'var(--text-dim)',marginBottom:6,paddingLeft:4,opacity:0.7}}>
            showing {contextTrimInfo.shown} of {contextTrimInfo.total} tasks in AI context
          </div>
        )}
        {messages.length>0&&(
          <div style={{display:'flex',gap:8,marginBottom:8,overflowX:'auto',paddingBottom:2}}>
            <button className="sos-chip" onClick={()=>setShowChatSidebar(true)} style={{background:'rgba(108,99,255,0.06)',borderColor:'rgba(108,99,255,0.15)',color:'var(--accent)'}}>History</button>
          </div>
        )}
        {pendingPhoto&&(
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,padding:'6px 10px',background:'var(--bg)',borderRadius:16,border:'1px solid var(--border)',animation:'fadeIn .2s ease'}}>
            <img src={pendingPhoto.preview} alt="attached" style={{width:48,height:48,borderRadius:12,objectFit:'cover'}}/>
            <span style={{fontSize:'0.82rem',color:'var(--text-dim)',flex:1}}>Photo attached</span>
            <button onClick={()=>setPendingPhoto(null)} style={{background:'transparent',border:'none',color:'var(--danger)',cursor:'pointer',padding:'4px 8px',display:'flex'}}>{Icon.x(16)}</button>
          </div>
        )}
        {isRecording ? (
          /* ── Inline Voice Recording Bar ── */
          <div className="voice-bar">
            <div className="voice-bar-indicator">
              <div className="voice-bar-dot"/>
              <div className="voice-bar-timer">{Math.floor(recordingTime/60)}:{String(recordingTime%60).padStart(2,'0')}</div>
            </div>
            <div className="voice-bar-waveform" ref={waveformRef}>
              {Array.from({length:40},(_,i)=><div key={i} className="voice-bar-bar" style={{height:'3px'}}/>)}
            </div>
            <button className="voice-bar-cancel" onClick={cancelRecording} title="Cancel">{Icon.trash(16)}</button>
            <button className="voice-bar-send" onClick={stopRecording} title="Send voice">{Icon.send(18)}</button>
          </div>
        ) : isTranscribing ? (
          /* ── Transcribing indicator ── */
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,padding:'14px 16px',background:'linear-gradient(135deg,rgba(26,26,46,0.97),rgba(15,15,26,0.97))',border:'1px solid rgba(108,99,255,0.15)',borderRadius:20}}>
            <div style={{width:18,height:18,border:'2px solid var(--accent)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>
            <span style={{fontSize:'0.85rem',color:'var(--text-dim)'}}>Transcribing...</span>
          </div>
        ) : messages.length >= CHAT_MAX_MESSAGES ? (
          /* ── Chat at hard limit ── */
          <div style={{textAlign:'center',padding:'14px 16px',background:'rgba(255,71,87,0.06)',border:'1px solid rgba(255,71,87,0.2)',borderRadius:18,animation:'fadeIn .2s ease'}}>
            <div style={{fontSize:'0.85rem',color:'var(--danger)',fontWeight:600,marginBottom:10}}>Chat history is full</div>
            <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
              <button onClick={startNewChat} style={{background:'var(--accent)',border:'none',borderRadius:10,color:'#fff',fontSize:'0.82rem',fontWeight:700,padding:'8px 16px',cursor:'pointer'}}>Start fresh conversation</button>
              <button onClick={clearChat} style={{background:'transparent',border:'1px solid var(--border)',borderRadius:10,color:'var(--text-dim)',fontSize:'0.82rem',padding:'8px 14px',cursor:'pointer'}}>Clear history</button>
            </div>
          </div>
        ) : (
          /* ── Normal chat input form ── */
          <>
            {messages.length >= 55 && (
              <div style={{fontSize:'0.76rem',color:'var(--warning)',marginBottom:8,padding:'6px 10px',background:'rgba(255,159,67,0.08)',borderRadius:10,border:'1px solid rgba(255,159,67,0.18)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span>Chat is getting long — consider starting fresh for better AI responses</span>
                <button onClick={startNewChat} style={{background:'transparent',border:'1px solid rgba(255,159,67,0.3)',borderRadius:8,color:'var(--warning)',fontSize:'0.72rem',padding:'3px 8px',cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>Start fresh</button>
              </div>
            )}
            <form onSubmit={handleSubmit} style={{display:'flex',gap:8,alignItems:'center'}}>
              <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={handlePhotoSelect}/>
              {workspaceModeLabel && (
                <span title={workspaceContext === 'notes' ? 'Your notes are in context — SOS will reference them in answers.' : 'Your schedule is in context — SOS will reference it in answers.'} style={{padding:'4px 9px',borderRadius:999,fontSize:'0.72rem',fontWeight:600,color:'var(--accent)',background:'rgba(108,99,255,0.1)',border:'1px solid rgba(108,99,255,0.24)',whiteSpace:'nowrap',cursor:'default'}}>{workspaceModeLabel}</span>
              )}
              <button type="button" onClick={()=>photoInputRef.current?.click()} disabled={isLoading}
                style={{width:40,height:40,borderRadius:'50%',background:'transparent',border:'1px solid '+(pendingPhoto?'var(--accent)':'var(--border)'),color:pendingPhoto?'var(--accent)':'var(--text-dim)',cursor:isLoading?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .2s',opacity:isLoading?0.5:1}}>
                {Icon.camera(18)}
              </button>
              <button type="button" onClick={startRecording} disabled={isLoading}
                style={{width:40,height:40,borderRadius:'50%',background:'transparent',border:'1px solid var(--border)',color:'var(--text-dim)',cursor:isLoading?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .2s',opacity:isLoading?0.5:1}}>
                {Icon.mic(18)}
              </button>
              <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
                placeholder={pendingPhoto?"add a message or just send the photo...":messages.length===0?["What's on your plate today?","What do you need help with?","Tell me about your classes...","What's coming up this week?","Anything on your mind?"][welcomeIdx]:"type anything..."}
                disabled={isLoading}
                style={{flex:1,background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:24,padding:'12px 20px',fontSize:'0.92rem',outline:'none',opacity:isLoading?0.5:1,transition:'all .25s cubic-bezier(0.16,1,0.3,1)'}}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSubmit()}}}/>
              <button type="submit" className="sos-send-btn neon-primary" disabled={isLoading||(!input.trim()&&!pendingPhoto)} style={{width:44,height:44,borderRadius:14,background:'rgba(255,255,255,0.08)',backdropFilter:'blur(12px)',color:'var(--neon-cyan)',border:'1px solid rgba(0,229,204,0.3)',cursor:(isLoading||(!input.trim()&&!pendingPhoto))?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all .15s',flexShrink:0,opacity:(isLoading||(!input.trim()&&!pendingPhoto))?0.3:1}}>{Icon.send(18)}</button>
            </form>
          </>
        )}
        <div style={{display:'flex',justifyContent:'center',marginTop:8,fontSize:'0.68rem'}}><a href="privacy.html" style={{color:'var(--text-dim)',textDecoration:'none',opacity:0.6,transition:'opacity .15s'}} onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0.6}>Privacy Policy</a></div>
      </div>
      </div>
      {showSidebarCompanion && (
        <div className={'sos-chat-companion' + (companionCollapsed ? ' collapsed' : '')}>
          <button
            className={'sos-companion-toggle' + (compactCompanionToggle ? ' icon-only' : ' classic-bar')}
            onClick={() => setCompanionCollapsed(prev => !prev)}
            title={companionCollapsed ? 'Expand side panel' : 'Collapse side panel'}
            aria-label={companionCollapsed ? 'Expand side panel' : 'Collapse side panel'}
          >
            <span>{Icon.panel(14)}</span>
            {!compactCompanionToggle && <span>{companionCollapsed ? 'Open panel' : 'Collapse'}</span>}
          </button>
          {!companionCollapsed && (sidebarCompanionPanel === 'schedule' || sidebarCompanionPanel === 'notes') && (
            <div style={{padding:'6px 10px 0'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <div style={{fontSize:'0.76rem',fontWeight:700,color:'var(--text-dim)',letterSpacing:'0.02em',textTransform:'uppercase'}}>
                  {sidebarCompanionPanel === 'schedule' ? 'Schedule workflows' : 'Notes workflows'}
                </div>
                <button className="settings-toggle" onClick={closeSidebarCompanion} style={{padding:'4px 8px',fontSize:'0.68rem'}}>Close panel</button>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
                {sidebarCompanionPanel === 'schedule' && ['Plan today','Find free block','Due soon'].map((chip) => (
                  <button key={chip} className="sos-chip" onClick={()=>sendChip(chip)}>{chip}</button>
                ))}
                {sidebarCompanionPanel === 'notes' && ['Summarize note','Make flashcards','Quiz me'].map((chip) => (
                  <button key={chip} className="sos-chip" onClick={()=>sendChip(chip)}>{chip}</button>
                ))}
              </div>
            </div>
          )}
          {!companionCollapsed && sidebarCompanionPanel === 'schedule' && (
            <ErrorBoundary><SchedulePeek tasks={tasks} blocks={blocks} events={events} weatherData={weatherData} recentlyCompleted={recentlyCompleted} embedded/></ErrorBoundary>
          )}
          {!companionCollapsed && sidebarCompanionPanel === 'notes' && (
            <NotesPanel notes={notes} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} onCreateNote={handleCreateNote} embedded/>
          )}
        </div>
      )}
      </div>
      </>
      )}
      </div>

      {layoutMode === 'lofi' && <StudyBottomBar
        tasks={tasks}
        recentlyCompleted={[...tasks].filter(t => recentlyCompleted.has(t.id))}
      />}

      {showSideBySide && (
        <>
          <div className="peek-overlay" onClick={() => { setShowPeek(false); setShowNotes(false); }}/>
          <div className="split-workspace">
            <div className="split-workspace-head">
              <div style={{display:'flex',alignItems:'center',gap:8,fontWeight:700}}>{Icon.panel(16)} Notes + Schedule</div>
              <button className="g-modal-close" onClick={() => { setShowPeek(false); setShowNotes(false); }}>{Icon.x(16)}</button>
            </div>
            <div className="split-workspace-grid">
              <ErrorBoundary><SchedulePeek tasks={tasks} blocks={blocks} events={events} weatherData={weatherData} recentlyCompleted={recentlyCompleted} embedded/></ErrorBoundary>
              <NotesPanel notes={notes} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} onCreateNote={handleCreateNote} embedded/>
            </div>
          </div>
        </>
      )}
      {!showSideBySide && showPeek&&<ErrorBoundary><SchedulePeek tasks={tasks} blocks={blocks} events={events} weatherData={weatherData} recentlyCompleted={recentlyCompleted} onClose={()=>setShowPeek(false)}/></ErrorBoundary>}
      {!showSideBySide && showNotes&&<NotesPanel notes={notes} onClose={()=>setShowNotes(false)} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} onCreateNote={handleCreateNote}/>} 
      {authNudge&&(
        <div style={{position:'fixed',top:54,right:12,zIndex:300,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:12,padding:'9px 13px',fontSize:'0.8rem',color:'var(--text)',display:'flex',alignItems:'center',gap:8,boxShadow:'0 4px 20px rgba(0,0,0,0.5)',animation:'fadeIn .2s ease'}}>
          <span>Sign in to save notes across sessions →</span>
          <button onClick={()=>{setAuthModalInitialMode('signup');setShowAuthModal(true);setAuthNudge(false);}} style={{background:'var(--accent)',border:'none',borderRadius:8,color:'#fff',fontSize:'0.74rem',fontWeight:700,padding:'3px 9px',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>Sign up free</button>
          <button onClick={()=>setAuthNudge(false)} style={{background:'transparent',border:'none',color:'var(--text-dim)',cursor:'pointer',padding:'2px 5px',fontSize:'1rem',lineHeight:1}}>×</button>
        </div>
      )}
      {showChatSidebar&&(
        <>
          <div className="chat-sidebar-overlay" onClick={()=>setShowChatSidebar(false)}/>
          <div className="chat-sidebar">
            <div className="chat-sidebar-header">
              <div className="chat-sidebar-title"><span style={{display:'flex',color:'var(--accent)'}}>{Icon.messageCircle(18)}</span> Saved Chats</div>
              <button className="g-modal-close" onClick={()=>setShowChatSidebar(false)}>{Icon.x(16)}</button>
            </div>
            {savedChats.length === 0 ? (
              <div className="chat-sidebar-empty">
                <div style={{marginBottom:8,opacity:0.4,display:'flex',justifyContent:'center',color:'var(--accent)'}}>{Icon.messageCircle(28)}</div>
                <div>No saved chats yet.</div>
                <div style={{fontSize:'0.78rem',marginTop:4}}>Save this conversation using the bookmark icon above.</div>
              </div>
            ) : (
              <div className="chat-sidebar-list">
                {savedChats.map(chat => (
                  <div key={chat.id} className={'chat-sidebar-item' + (viewingSavedChatId === chat.id ? ' active' : '')}
                    onClick={() => loadSavedChat(chat.id)}>
                    <div className="chat-sidebar-item-title">{chat.title}</div>
                    <div className="chat-sidebar-item-meta">
                      <span>{chat.messageCount} message{chat.messageCount !== 1 ? 's' : ''} · {fmt(chat.savedAt)}</span>
                      <span style={{display:'flex',gap:4}}>
                        <button className="chat-sidebar-item-delete" onClick={e => { e.stopPropagation(); deleteSavedChat(chat.id); }}>Delete</button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {showGoogleModal && (
        <GoogleImportModal
          googleToken={googleToken}
          googleUser={googleUser}
          onClose={()=>setShowGoogleModal(false)}
          onImportEvents={handleImportGoogleEvents}
          onImportDoc={handleImportGoogleDoc}
          onImportPdf={handleImportPdf}
          onDisconnect={()=>{ disconnectGoogle(); setShowGoogleModal(false); }}
          onConnect={connectGoogle}
          calSyncEnabled={calSyncEnabled}
          calSyncStatus={calSyncStatus}
          calSyncLastAt={calSyncLastAt}
          calSyncCount={calSyncCount}
          calSyncError={calSyncError}
          onToggleCalSync={toggleCalSync}
          onSyncNow={()=>syncCalendarRef.current()}
        />
      )}
      {showOnboarding && <FirstRunModal
        onClose={()=>setShowOnboarding(false)}
        onConnectGoogle={()=>{connectGoogle();}}
        onWeatherToggle={()=>setWeatherThemeEnabled(v=>!v)}
        weatherEnabled={weatherThemeEnabled}
      />}
      {showAuthModal && <AuthModal onAuth={(u)=>{handleAuth(u);setShowAuthModal(false);setAuthModalInitialMode('login');}} onClose={()=>{setShowAuthModal(false);setAuthModalInitialMode('login');}} initialMode={authModalInitialMode} />}
      {toastMsg&&<Toast message={toastMsg} onDone={()=>setToastMsg(null)}/>}
      <PresenceDetector />
      <IdleLockScreen />
      {layoutMode !== 'lofi' && <SfxToggle />}

      {lightboxUrl&&(
        <div onClick={()=>setLightboxUrl(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',animation:'overlayIn .2s ease'}}>
          <img src={lightboxUrl} alt="full size" style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:12,objectFit:'contain'}}/>
        </div>
      )}
    </div>
    </EditModeProvider>
  );
}


export default App;
