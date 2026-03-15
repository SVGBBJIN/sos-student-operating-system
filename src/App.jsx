import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import * as pdfjsLib from 'pdfjs-dist';
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY, EDGE_FN_URL, CHAT_MAX_MESSAGES } from './lib/supabase';
import Icon from './lib/icons';
import { trackEvent } from './lib/analytics';
import ErrorBoundary from './components/ErrorBoundary';
import { getPerfTier, setPerfOverride } from './lib/perfAdjuster';

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

// CHAT_MAX_MESSAGES imported from ./lib/supabase

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
function buildSystemPrompt(tasks, blocks, events, notes, tier = 2) {
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
  const taskList = activeTasks.map(t =>
    '- ' + t.title + (t.subject ? ' [' + t.subject + ']' : '') +
    ' | due ' + fmt(t.dueDate) + ' (' + daysUntil(t.dueDate) + 'd)' +
    ' | ' + t.estTime + 'min | ' + t.status.replace('_',' ') + ' | id:' + t.id
  ).join('\n');

  // ── Build notes section for AI context ──
  const noteNames = notes.map(n => n.name).join(', ') || 'none';
  let notesSection = '';
  if (notes.length > 0) {
    // Sort: PDF-sourced first (reference docs), then Docs, then AI-generated
    const sortOrder = { pdf: 0, google_docs: 1 };
    const sorted = notes.slice().sort((a, b) => (sortOrder[a.source] ?? 2) - (sortOrder[b.source] ?? 2));
    const maxTotal = 8000;
    let totalLen = 0;
    sorted.forEach(n => {
      if (totalLen >= maxTotal) return;
      const src = n.source === 'pdf' ? 'PDF' : n.source === 'google_docs' ? 'Google Doc' : 'study material';
      const maxPer = 2000;
      const content = (n.content || '').slice(0, maxPer) + ((n.content || '').length > maxPer ? '\n[truncated]' : '');
      const entry = '--- ' + n.name + ' (source: ' + src + ') ---\n' + content + '\n\n';
      if (totalLen + entry.length <= maxTotal) {
        notesSection += entry;
        totalLen += entry.length;
      }
    });
  }

  // ── Tier 1 (Llama) gets a lean prompt — no task list to hallucinate from ──
  if (tier === 1) {
    const allClear = activeTasks.length === 0 && overdueTasks.length === 0 && upcomingEvents.length === 0;
    const scheduleStr = summarizeBlockSlots(todayBlocks).join(', ') || 'nothing scheduled';
    return `You are SOS, a chill study sidekick. Talk like a supportive friend — casual, brief (2-3 sentences max), never condescending.

TODAY: ${todayStr}
TODAY'S SCHEDULE: ${scheduleStr}
COMPLETED THIS WEEK: ${doneThisWeek} task${doneThisWeek !== 1 ? 's' : ''}
${allClear ? 'STATUS: All clear — no overdue tasks, no upcoming events, nothing on the list.' : `ACTIVE TASKS: ${activeTasks.length} task${activeTasks.length !== 1 ? 's' : ''} pending${overdueTasks.length > 0 ? ' (' + overdueTasks.length + ' overdue)' : ''}. UPCOMING EVENTS: ${upcomingEvents.length > 0 ? upcomingEvents.join(', ') : 'none'}.`}
NOTES: ${noteNames}

RULES:
1. NEVER invent specific tasks, deadlines, or events. If it's not explicitly listed above, it doesn't exist — do not make it up.
2. If student asks about their schedule/tasks and STATUS is "All clear", respond with an upbeat "all clear" message. Examples: "you're free! no overdue stuff, nothing coming up — go enjoy yourself 🎉" or "all good! completely clear schedule, go take a break ✌️"
3. If student asks how they're doing and there ARE tasks, just say something like "you've got [N] things on the list" without inventing specific titles.
4. If asked about notes content, say you can see they have notes on those topics but suggest they ask a study question for detailed help.
5. Stay warm, brief, and casual.`;
  }

  return `You are SOS — a chill, smart study companion built into the Student Operating System. You're like that one friend who's weirdly organized but never makes it weird. You talk casually, keep it brief, and genuinely care about the student's wellbeing.

VOICE & PERSONALITY:
- Talk like a supportive friend, not a teacher or assistant. Casual language, lowercase-ish energy.
- Keep responses to 2-4 sentences unless they ask for detail. No walls of text.
- Celebrate wins without being corny. Light humor when it fits.
- Never condescending. This student is smart — they just need help managing time.
- When they're stressed, be calming. When they're procrastinating, be gently honest.
- You're not a planner — you're their study sidekick who happens to run their schedule.

CORE BEHAVIORS:
1. SLEEP PROTECTION: Never schedule or suggest work past 10pm. If they try to, gently push back: "that's sleep territory — let's find time earlier."
2. TASK DECOMPOSITION: For big projects (>60 min or multi-day), suggest breaking into 2-4 smaller chunks with their own dates.
3. WORKLOAD BALANCING: If a day has 2+ hours of tasks, suggest spreading to lighter days.
4. MISSED TASK RECOVERY: For overdue tasks, don't guilt — suggest a realistic new date. "no stress, let's just move it."
5. SMART SCHEDULING: Consider existing blocks (swim, debate, etc.) when suggesting times. Don't double-book.
6. ENCOURAGEMENT: Notice streaks, completed tasks, good planning. Mention it naturally.
7. REFERENCE DOCUMENTS: The student may have imported PDFs and docs as reference materials. When they ask questions about topics covered in their notes, use the note content to give accurate, specific answers. Mention which note you're referencing.

TODAY: ${todayStr} (${currentHour >= 12 ? 'afternoon' : 'morning'})

ACTIVE TASKS (sorted by urgency):
${taskList || '(none)'}

${overdueTasks.length > 0 ? 'OVERDUE: ' + overdueTasks.map(t => t.title + ' (' + Math.abs(daysUntil(t.dueDate)) + 'd late)').join(', ') : ''}

TODAY'S SCHEDULE:
${summarizeBlockSlots(todayBlocks).join('\n') || '(nothing scheduled)'}

THIS WEEK:
${weekSummary.join('\n') || '(no scheduled activities)'}

UPCOMING EVENTS: ${upcomingEvents.join(', ') || 'none'}
${overloadedDays.length > 0 ? 'OVERLOADED DAYS: ' + overloadedDays.join(', ') : ''}
COMPLETED THIS WEEK: ${doneThisWeek} tasks

${notesSection ? `STUDENT'S NOTES & REFERENCE DOCUMENTS:
${notesSection}` : 'NOTES: (none)'}

TOOLS — you have built-in tools to manage the student's calendar, tasks, blocks, and notes. Use them whenever the student mentions anything actionable. Keep your text response natural and brief — just mention what you did casually, don't explain the action in detail.

RULES:
1. Any mention of a test, exam, quiz, practice, game, meet, deadline, homework, assignment, or event → call the appropriate tool immediately. Never ask "should I add this?" for confirmation — just do it ONLY when ALL required details are explicitly stated by the student.
2. Even casual phrasing counts: "got a calc test fri" = add_event (title: calc test, date: friday). "gotta finish essay by thursday" = add_task.
3. *** HARD RULE — NEVER GUESS OR FABRICATE DETAILS ***: If the student's message does NOT explicitly contain the information needed for a tool field, you MUST call ask_clarification BEFORE calling any action tool. This is NON-NEGOTIABLE. Specifically:
   - If the student did NOT say what the event/block/task IS (title/activity) → ASK. Never invent a generic name like "study session" or "event".
   - If the student did NOT say WHEN (date) → ASK. Never guess today or tomorrow.
   - If the student did NOT say what TIME (start/end for blocks) → ASK. Never invent times like "15:00-16:00".
   - If the student did NOT say what SUBJECT → ASK for academic items. Never guess a subject.
   - Example: "add a new block" → the student gave NO details. You MUST ask what activity, what date, and what time. Do NOT create a block with made-up values.
   - Example: "add a block for math" → you know the activity (math) but NOT the date or time. Ask for date and time.
   - Example: "add a math block tomorrow 3-4pm" → all details present. Create it immediately.
4. When multiple fields are missing, make a SEPARATE ask_clarification tool call for EACH missing field — all in the same response. For example, if activity, date, and time are all unknown, make THREE ask_clarification calls: one asking "What activity?", one asking "What date?", one asking "What time?". Each call should have its own focused options. The system will display them all at once as individual question cards. NEVER split them across multiple conversation turns — call them all in the same response.
5. PROACTIVE CLARIFICATION — also use ask_clarification when:
   - The request is vague and could mean very different things (e.g. "help me study" → ask which subject)
   - The student asks for content generation (flashcards, study plan, quiz, etc.) but hasn't specified the topic or scope
   - Multiple reasonable interpretations exist and guessing wrong would waste their time
   - The student seems unsure or mentions multiple subjects/topics without specifying which one
6. DON'T ask for clarification ONLY when:
   - ALL required details are explicitly stated in the student's message
   - The student just said "yes" or confirmed something you already asked about
   - The student is having a casual conversation (not requesting any action)
7. Keep the same brief/casual voice for clarification questions and for tool follow-up.
8. *** ZERO TOLERANCE FOR FABRICATION ***: If you call add_event, add_task, add_block, or any action tool with a value the student never said or clearly implied, that is a critical error. When in doubt, ALWAYS ask. The cost of one extra question is far less than creating a wrong item the student has to delete. Today is ${todayKey}.
9. For day names, calculate the real YYYY-MM-DD date.
10. For delete/update: use the title — the system finds the right one automatically. You do NOT need to know IDs.
11. If something ALREADY EXISTS in UPCOMING EVENTS or ACTIVE TASKS with the same name and date, do NOT duplicate — just acknowledge it.
12. Categories: school, swim, debate, free time, sleep, other. Event types: test, exam, quiz, practice, game, match, meet, tournament, event, other.
13. For recurring events ("every Mon/Wed/Fri", "weekly practice", "Tuesdays and Thursdays") → add_recurring_event. Default end date: 3 months from today unless specified.
14. If user asks to add/schedule a time for an existing date-only event, use convert_event_to_block (event → block) instead of update_event.
15. If user asks to simplify/remove time from a scheduled block, use convert_block_to_event (block → event).
16. EVENT/BLOCK FIELD VALIDATION — before calling add_event or add_block, check each field against what the student ACTUALLY said:
   - title/activity: Did the student say what this is? If not → ask_clarification. Never use generic placeholders.
   - date: Did the student specify or clearly imply a date? If not → ask_clarification.
   - time/start/end: Did the student mention a time? If not and the action requires it (add_block always does) → ask_clarification.
   - subject: For academic items, did the student mention the subject? If not → ask_clarification.
   - priority: Can be inferred (exam = high). Only ask if genuinely ambiguous.
   If ANY important field would require you to guess, call ask_clarification FIRST. Make a SEPARATE ask_clarification call for each missing field — all in the same response. They will be shown as individual question cards.

PHOTO ANALYSIS:
When the student sends a photo/image:
1. DESCRIBE what you see first — "looks like a syllabus for..." or "I see a quadratic equation..."
2. SCHEDULE DETECTION: If you see dates, due dates, assignments, syllabi, planners, or calendars:
   - Extract EVERY date and assignment you can read
   - Call add_event for tests/exams/events, add_task for homework/assignments — one tool call per item
   - Tell the student how many items you found: "found 5 assignments on this syllabus, adding them all"
   - Best-guess the year as ${new Date().getFullYear()} and calculate real YYYY-MM-DD dates
3. HOMEWORK HELP: If you see a math problem, science question, essay prompt, or diagram — help solve or explain it step by step.
4. If the image is unclear, say so honestly: "the photo's a bit blurry, can you retake it?"

CONTENT GENERATION:
When the student asks for study materials (flashcards, outlines, summaries, study plans, quizzes, project breakdowns), respond with ONLY a valid JSON object (no markdown, no code fences). Use these formats:

For study plans: {"type":"make_plan","title":"Plan Title","summary":"One sentence overview of what this plan covers","steps":[{"title":"Step description","date":"YYYY-MM-DD","time":"HH:MM AM/PM","estimated_minutes":30}]}
For flashcards: {"type":"create_flashcards","title":"Topic","cards":[{"q":"Question","a":"Answer"}]}
For quizzes: {"type":"create_quiz","title":"Topic","questions":[{"q":"Question","choices":["A","B","C","D"],"answer":"A"}]}
For outlines: {"type":"create_outline","title":"Topic","sections":[{"heading":"Section","points":["Point 1","Point 2"]}]}
For summaries: {"type":"create_summary","title":"Topic","bullets":["Bullet 1","Bullet 2"]}
For study plans: {"type":"create_study_plan","title":"Topic","steps":[{"step":"Description","time_minutes":20,"day":"Monday"}]}
For project breakdowns: {"type":"create_project_breakdown","title":"Project","phases":[{"phase":"Phase name","deadline":"YYYY-MM-DD","tasks":["Task 1","Task 2"]}]}

Always include the "summary" field in make_plan responses. Generate 4-7 steps with realistic time estimates.`;
}

/* ─── Action parser ─── */
function parseActions(text) {
  const actions = []; const regex = /<action>([\s\S]*?)<\/action>/g; let match;
  while ((match = regex.exec(text)) !== null) {
    try { actions.push(JSON.parse(match[1].trim())); } catch (e) { console.error('Failed to parse action:', match[1], e); }
  }
  return actions;
}
function parseActionsDetailed(text) {
  const actions = []; const malformedFragments = [];
  const regex = /<action>([\s\S]*?)<\/action>/g; let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1].trim();
    try { actions.push(JSON.parse(raw)); } catch (e) { console.error('Malformed action JSON:', raw, e); malformedFragments.push(raw); }
  }
  return { actions, malformedFragments };
}
async function parseActionsWithRecovery(rawContent, token) {
  const { actions, malformedFragments } = parseActionsDetailed(rawContent);
  if (malformedFragments.length === 0) return actions;
  console.warn('Attempting JSON recovery for', malformedFragments.length, 'malformed fragment(s)');
  try {
    const fixPrompt = 'Fix the following malformed JSON action tags. Return ONLY valid <action>JSON</action> tags, nothing else.\n\nMalformed fragments:\n' +
      malformedFragments.map((f, i) => 'Fragment ' + (i+1) + ': ' + f).join('\n') +
      '\n\nRules:\n- Fix syntax errors (missing quotes, trailing commas, unescaped characters)\n- Do NOT change the intent or values — only fix the JSON syntax\n- Return each fixed action in <action>...</action> tags';
    const response = await fetch(EDGE_FN_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||SUPABASE_ANON_KEY)},
      body:JSON.stringify({ systemPrompt:fixPrompt, messages:[{role:'user',content:'Fix the JSON above.'}], maxTokens:512, model:'llama-3.1-8b-instant', provider:'groq', isContentGen:false })
    });
    if (response.ok) {
      const data = await response.json();
      const fixedActions = parseActions(data?.content || '');
      return [...actions, ...fixedActions];
    }
  } catch (e) { console.error('JSON recovery re-prompt failed:', e); }
  return actions;
}
function stripActionTags(text) {
  return (text || '')
    .replace(/<action>[\s\S]*?<\/action>/gi, '')
    .replace(/<action[\s\S]*$/gi, '')
    .trim();
}

function parseActionDecisionResponse(text) {
  const raw = (text || '').trim();
  if (!raw || /^no$/i.test(raw)) return [];

  // Preferred format: command lines mapped into local templates
  // Example: add_event; title=Math Test; date=2026-02-14; event_type=test; subject=Math
  const parseScalar = (v) => {
    const t = (v || '').trim();
    if (!t) return '';
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
    if (/^-?\d+$/.test(t)) return Number(t);
    if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
    return t;
  };

  const parseParams = (paramText) => {
    const out = {};
    for (const part of (paramText || '').split(';')) {
      const seg = part.trim();
      if (!seg) continue;
      const idx = seg.indexOf('=');
      if (idx === -1) continue;
      const key = seg.slice(0, idx).trim();
      const valueRaw = seg.slice(idx + 1).trim();
      if (!key) continue;
      if (key === 'days') {
        out.days = valueRaw.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
        continue;
      }
      if (key === 'subtasks') {
        try { out.subtasks = JSON.parse(valueRaw); } catch (_) { out.subtasks = []; }
        continue;
      }
      out[key] = parseScalar(valueRaw);
    }
    return out;
  };

  const fromTemplate = (type, p) => {
    switch ((type || '').trim()) {
      case 'add_task': return { type:'add_task', title:p.title||'Untitled', subject:p.subject||'', due:p.due||today(), estimated_minutes:Number(p.estimated_minutes||30) };
      case 'add_event': return { type:'add_event', title:p.title||'Event', date:p.date||today(), event_type:p.event_type||'event', subject:p.subject||'' };
      case 'add_block': return { type:'add_block', activity:p.activity||'Block', date:p.date||today(), start:p.start||'16:00', end:p.end||'17:00', category:p.category||'school' };
      case 'complete_task': return { type:'complete_task', task_id:p.task_id||'' };
      case 'delete_task': return { type:'delete_task', title:p.title||p.task_id||'' };
      case 'delete_event': return { type:'delete_event', title:p.title||p.event_id||'' };
      case 'update_event': return { type:'update_event', title:p.title||'', new_title:p.new_title||undefined, date:p.date||undefined, event_type:p.event_type||undefined, subject:p.subject };
      case 'delete_block': return { type:'delete_block', date:p.date||today(), start:p.start||'16:00', end:p.end||'17:00' };
      case 'convert_event_to_block': return { type:'convert_event_to_block', title:p.title||p.event_id||'', event_id:p.event_id||undefined, date:p.date||today(), start:p.start||'16:00', end:p.end||'17:00', category:p.category||'school' };
      case 'convert_block_to_event': return { type:'convert_block_to_event', date:p.date||today(), start:p.start||'16:00', end:p.end||undefined, title:p.title||'Event', event_type:p.event_type||'event', subject:p.subject||'' };
      case 'break_task': return { type:'break_task', parent_title:p.parent_title||p.title||'Task', subtasks:Array.isArray(p.subtasks)?p.subtasks:[] };
      case 'add_recurring_event': return { type:'add_recurring_event', title:p.title||'Recurring Event', event_type:p.event_type||'practice', subject:p.subject||'', days:Array.isArray(p.days)?p.days:[], start_date:p.start_date||today(), end_date:p.end_date||today() };
      case 'clear_all': return { type:'clear_all' };
      default: return null;
    }
  };

  const commandActions = raw.split(/\|\|/).map(s => s.trim()).filter(Boolean).map(cmd => {
    const [typePart, ...rest] = cmd.split(';');
    const type = (typePart || '').trim().toLowerCase();
    const params = parseParams(rest.join(';'));
    return fromTemplate(type, params);
  }).filter(Boolean);
  if (commandActions.length > 0) return commandActions;

  const tagged = parseActions(raw);
  if (tagged.length > 0) return tagged;

  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch (e) {
    console.warn('Failed to parse action decision JSON:', e);
  }
  return [];
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

/* Regex-based classifier (kept as fast fallback) */
function classifyMessageRegex(text) {
  if (/flashcard|outline|summar|study\s*plan|study\s*guide|quiz\s+me|practice\s*question|project\s*breakdown|review\s*sheet|cheat\s*sheet/i.test(text)) {
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
function AuthModal({ onAuth, onClose }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

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
        }
      } else {
        const { data, error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) throw err;
        if (data.user) onAuth(data.user);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
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

        {error && <div className="auth-error">{error}</div>}

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

          <button className="auth-btn auth-btn-primary" type="submit" disabled={loading}>
            {loading ? 'Loading...' : (mode === 'login' ? 'Sign in' : 'Create account')}
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
function ConfirmationCard({ action, onConfirm, onCancel, isFallback }) {
  const [editing, setEditing] = useState(!!isFallback);
  const [editingField, setEditingField] = useState(null); // P1.3: inline field editing
  const [editData, setEditData] = useState({});
  useEffect(() => { setEditData({ ...action }); }, [action]);

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
    <div className="confirm-card" style={{borderLeftColor:info.borderColor,background:info.bgTint?`linear-gradient(160deg,${info.bgTint},rgba(15,15,30,0.92))`:''}}>
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
          onClick={f.editable ? () => { setEditingField(f.key); setEditData(prev => ({...prev})); } : undefined}
          style={f.editable ? {cursor:'pointer'} : {}}>
          <span className="confirm-card-label">{f.label}</span>
          {editingField === f.key ? (
            <input className="confirm-edit-input" type={fieldTypes[f.key]||'text'}
              value={editData[f.key]??action[f.key]??''} autoFocus
              min={f.key==='estimated_minutes'?'5':undefined} step={f.key==='estimated_minutes'?'5':undefined}
              onChange={e=>setEditData(p=>({...p,[f.key]:fieldTypes[f.key]==='number'?Number(e.target.value):e.target.value}))}
              onBlur={()=>setEditingField(null)}
              onKeyDown={e=>{if(e.key==='Enter')setEditingField(null);}}
              style={{flex:1,maxWidth:160}}/>
          ) : (
            <span className="confirm-card-value" style={f.editable?{borderBottom:'1px dashed rgba(108,99,255,0.3)'}:{}}>
              {editData[f.key] && editData[f.key] !== action[f.key]
                ? (fieldTypes[f.key]==='date'?fmt(editData[f.key]):fieldTypes[f.key]==='number'?editData[f.key]+' min':editData[f.key])
                : f.value}
              {f.editable && <span style={{marginLeft:4,opacity:0.4,display:'inline-flex'}}>{Icon.edit(10)}</span>}
            </span>
          )}
        </div>
      )) : (
        <div>
          {(action.type === 'add_task') && <>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Title</span><input className="confirm-edit-input" value={editData.title||''} onChange={e=>setEditData(p=>({...p,title:e.target.value}))}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Due</span><input className="confirm-edit-input" type="date" value={editData.due||''} onChange={e=>setEditData(p=>({...p,due:e.target.value}))}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Mins</span><input className="confirm-edit-input" type="number" min="5" step="5" value={editData.estimated_minutes||30} onChange={e=>setEditData(p=>({...p,estimated_minutes:Number(e.target.value)}))}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Class</span><input className="confirm-edit-input" value={editData.subject||''} onChange={e=>setEditData(p=>({...p,subject:e.target.value}))} placeholder="e.g. Math"/></div>
          </>}
          {(action.type === 'add_event') && <>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Title</span><input className="confirm-edit-input" value={editData.title||''} onChange={e=>setEditData(p=>({...p,title:e.target.value}))}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Date</span><input className="confirm-edit-input" type="date" value={editData.date||''} onChange={e=>setEditData(p=>({...p,date:e.target.value}))}/></div>
          </>}
          {(action.type === 'add_block') && <>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>What</span><input className="confirm-edit-input" value={editData.activity||''} onChange={e=>setEditData(p=>({...p,activity:e.target.value}))}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Date</span><input className="confirm-edit-input" type="date" value={editData.date||''} onChange={e=>setEditData(p=>({...p,date:e.target.value}))}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Start</span><input className="confirm-edit-input" type="time" value={editData.start||''} onChange={e=>setEditData(p=>({...p,start:e.target.value}))}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>End</span><input className="confirm-edit-input" type="time" value={editData.end||''} onChange={e=>setEditData(p=>({...p,end:e.target.value}))}/></div>
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
    </div>
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

function ClarificationCard({ clarification, onSubmit }) {
  // Support both single clarification and array of clarifications
  const clarifications = Array.isArray(clarification) ? clarification : [clarification];
  const questionCount = clarifications.length;

  // Per-question state: selected options and free-form text
  const [answers, setAnswers] = useState(() => clarifications.map(() => ({ selected: [], otherText: '' })));

  useEffect(() => {
    setAnswers(clarifications.map(() => ({ selected: [], otherText: '' })));
  }, [clarification]);

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

  function toggleOption(qIdx, optId, multiSelect) {
    setAnswers(prev => {
      const next = [...prev];
      const cur = { ...next[qIdx] };
      if (!multiSelect) {
        cur.selected = [optId];
      } else {
        cur.selected = cur.selected.includes(optId)
          ? cur.selected.filter(v => v !== optId)
          : [...cur.selected, optId];
      }
      next[qIdx] = cur;
      return next;
    });
  }

  function setOtherText(qIdx, text) {
    setAnswers(prev => {
      const next = [...prev];
      next[qIdx] = { ...next[qIdx], otherText: text };
      return next;
    });
  }

  // Check if every question has at least one answer (selected option or text)
  const allAnswered = answers.every((a, i) => {
    const opts = Array.isArray(clarifications[i]?.options) ? clarifications[i].options : [];
    // If question has no options (text-only), require text
    if (opts.length === 0) return !!a.otherText.trim();
    return a.selected.length > 0 || !!a.otherText.trim();
  });

  function handleSubmit() {
    // Build per-question payloads
    const payloads = clarifications.map((c, i) => {
      const opts = Array.isArray(c?.options) ? c.options.map(normalizeOption) : [];
      return {
        selected: answers[i].selected,
        options: opts,
        otherText: answers[i].otherText,
        question: c?.question || '',
      };
    });
    onSubmit(payloads);
  }

  // Shared reason — show once if all share same reason, otherwise per-question
  const sharedReason = questionCount > 1 && clarifications.every(c => c?.reason === clarifications[0]?.reason)
    ? clarifications[0]?.reason || ''
    : '';

  return (
    <div style={{
      background:'linear-gradient(135deg, rgba(26,26,46,0.98), rgba(15,15,26,0.95))',
      border:'1px solid rgba(43,203,186,0.2)',
      borderRadius:18,
      padding:0,
      maxWidth:440,
      width:'100%',
      boxShadow:'0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(43,203,186,0.08)',
    }}>
      {/* Header */}
      <div style={{
        background:'linear-gradient(135deg, rgba(43,203,186,0.15), rgba(108,99,255,0.1))',
        padding:'14px 18px',
        borderBottom:'1px solid rgba(43,203,186,0.1)',
        display:'flex',
        alignItems:'center',
        gap:10,
        borderRadius:'18px 18px 0 0'
      }}>
        <div style={{
          width:32, height:32, borderRadius:8,
          background:'linear-gradient(135deg, var(--teal), var(--accent))',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 12px rgba(43,203,186,0.3)',
          flexShrink:0
        }}>
          {Icon.helpCircle(16)}
        </div>
        <div>
          <div style={{fontWeight:800, fontSize:'0.9rem', color:'var(--text)', letterSpacing:'-0.3px'}}>
            {questionCount > 1 ? `A few quick questions` : 'Quick question'}
          </div>
        </div>
      </div>

      {/* Shared reason banner */}
      {sharedReason && (
        <div style={{
          padding:'10px 18px',
          background:'rgba(43,203,186,0.04)',
          borderBottom:'1px solid rgba(255,255,255,0.04)',
          fontSize:'0.8rem',
          color:'var(--text-dim)',
          lineHeight:1.5,
          fontStyle:'italic'
        }}>
          {sharedReason}
        </div>
      )}

      {/* Individual question sections */}
      {clarifications.map((c, qIdx) => {
        const options = Array.isArray(c?.options) ? c.options : [];
        const multiSelect = !!c?.multiSelect || !!c?.multi_select;
        const reason = !sharedReason ? (c?.reason || '') : '';
        const normalizedOptions = options.map(normalizeOption);
        const answer = answers[qIdx] || { selected: [], otherText: '' };

        return (
          <div key={qIdx} style={{
            borderBottom: qIdx < questionCount - 1 ? '1px solid rgba(43,203,186,0.12)' : 'none',
          }}>
            {/* Per-question reason */}
            {reason && (
              <div style={{
                padding:'8px 18px',
                background:'rgba(43,203,186,0.04)',
                borderBottom:'1px solid rgba(255,255,255,0.04)',
                fontSize:'0.78rem',
                color:'var(--text-dim)',
                lineHeight:1.5,
                fontStyle:'italic'
              }}>
                {reason}
              </div>
            )}

            {/* Question label */}
            <div style={{
              padding:'12px 18px 6px',
              fontSize:'0.86rem',
              color:'var(--text)',
              lineHeight:1.5,
              fontWeight:600
            }}>
              {questionCount > 1 && <span style={{color:'var(--teal)', marginRight:6, fontWeight:800}}>{qIdx + 1}.</span>}
              {c?.question || 'Can you clarify?'}
            </div>

            {/* Options for this question */}
            {normalizedOptions.length > 0 && (
              <div style={{padding:'6px 18px 4px'}}>
                {normalizedOptions.map((opt) => {
                  const isSelected = answer.selected.includes(opt.id);
                  return (
                    <div key={opt.id}
                      onClick={() => toggleOption(qIdx, opt.id, multiSelect)}
                      style={{
                        display:'flex', alignItems:'center', gap:10,
                        padding:'9px 12px',
                        marginBottom:5,
                        borderRadius:10,
                        cursor:'pointer',
                        border: isSelected ? '1px solid rgba(43,203,186,0.4)' : '1px solid rgba(255,255,255,0.06)',
                        background: isSelected ? 'rgba(43,203,186,0.08)' : 'rgba(255,255,255,0.02)',
                        transition:'all .15s'
                      }}>
                      <div style={{
                        width:18, height:18, borderRadius: multiSelect ? 4 : 9,
                        border: isSelected ? '2px solid var(--teal)' : '2px solid rgba(255,255,255,0.15)',
                        background: isSelected ? 'var(--teal)' : 'transparent',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        flexShrink:0,
                        transition:'all .15s'
                      }}>
                        {isSelected && Icon.check(10)}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:'0.82rem', color:'var(--text)', fontWeight:500}}>{opt.label}</div>
                        {opt.description && (
                          <div style={{fontSize:'0.72rem', color:'var(--text-dim)', marginTop:2, lineHeight:1.4}}>{opt.description}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Free-form text input */}
            <div style={{padding:'2px 18px 10px'}}>
              <input
                type="text"
                value={answer.otherText}
                onChange={(e) => setOtherText(qIdx, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && allAnswered) handleSubmit(); }}
                placeholder={c?.otherPlaceholder || 'Or type your own answer...'}
                style={{
                  width:'100%',
                  background:'rgba(255,255,255,0.04)',
                  border:'1px solid rgba(255,255,255,0.08)',
                  borderRadius:10,
                  padding:'9px 12px',
                  color:'var(--text)',
                  fontSize:'0.8rem',
                  outline:'none',
                  transition:'border-color .15s',
                  boxSizing:'border-box'
                }}
                onFocus={e => e.target.style.borderColor='rgba(43,203,186,0.3)'}
                onBlur={e => e.target.style.borderColor='rgba(255,255,255,0.08)'}
              />
            </div>
          </div>
        );
      })}

      {/* Submit all */}
      <div style={{
        padding:'10px 18px 14px',
        borderTop:'1px solid rgba(255,255,255,0.06)'
      }}>
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          style={{
            width:'100%',
            background: allAnswered ? 'linear-gradient(135deg, var(--teal), rgba(43,203,186,0.8))' : 'rgba(255,255,255,0.05)',
            border:'none',
            borderRadius:10,
            padding:'10px 16px',
            color: allAnswered ? '#fff' : 'var(--text-dim)',
            fontSize:'0.84rem',
            fontWeight:700,
            cursor: allAnswered ? 'pointer' : 'default',
            display:'flex',
            alignItems:'center',
            justifyContent:'center',
            gap:6,
            transition:'all .15s',
            opacity: allAnswered ? 1 : 0.5
          }}
        >
          {Icon.send(14)} {questionCount > 1 ? 'Submit All' : 'Submit'}
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
function SchedulePeek({ tasks, blocks, events, weatherData, onClose, embedded = false }) {
  const todayKey = today(); const todayDow = new Date().getDay();
  const [isFullscreen, setIsFullscreen] = useState(false);
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
  const activeTasks=useMemo(()=>tasks.filter(t=>t.status!=='done'&&daysUntil(t.dueDate)>=0).sort((a,b)=>getPriority(a)-getPriority(b)).slice(0,5),[tasks]);
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

      {/* ── Fullscreen: Month Calendar Grid ── */}
      {isFullscreen && (
        <div style={{marginBottom:16}}>
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
        </div>
      )}

      {/* ── Regular peek content ── */}
      <div className="peek-section">
        <div className="peek-section-title">Today's Schedule</div>
        {condensed.length===0?<div style={{fontSize:'0.85rem',color:'var(--text-dim)',padding:'8px 0'}}>Nothing scheduled today</div>:
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
      {activeTasks.length>0&&<div className="peek-section"><div className="peek-section-title">Upcoming Tasks ({activeTasks.length})</div>
        {activeTasks.map(task=>{const d=daysUntil(task.dueDate);const dotColor=d<=1?'var(--warning)':d<=3?'var(--accent)':'var(--text-dim)';
          return(<div key={task.id} className="peek-task-item"><div className="peek-task-dot" style={{background:dotColor}}/><div style={{flex:1}}><div style={{fontWeight:500}}>{task.title}</div><div style={{fontSize:'0.75rem',color:'var(--text-dim)'}}>{task.subject&&task.subject+' · '}{d===0?'Today':d===1?'Tomorrow':fmt(task.dueDate)}{' · '+(task.estTime||30)+'min'}</div></div><div style={{color:dotColor,display:'flex'}}>{task.status==='in_progress'?Icon.circleDot(14):Icon.circle(14)}</div></div>)
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
            <div>No notes yet</div>
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
                        <button className="notes-toolbar-btn" onClick={e => startEdit(note, e)} title="Edit" style={{fontSize:'0.72rem',padding:'3px 7px'}}>✎</button>
                        <button className="notes-delete" style={{display:'flex',alignItems:'center',gap:2}} onClick={e => { e.stopPropagation(); onDeleteNote(note.id); }}>{Icon.trash(12)} Delete</button>
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
const TypingDots=()=>(
  <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
    <div style={{background:'linear-gradient(135deg,rgba(26,26,46,0.95),rgba(15,15,26,0.95))',border:'1px solid rgba(108,99,255,0.12)',borderRadius:16,borderBottomLeftRadius:4,padding:'12px 18px',display:'flex',gap:6,alignItems:'center',backdropFilter:'blur(8px)',animation:'borderGlow 2s ease-in-out infinite'}}>
      {[0,1,2].map(i=>(<span key={i} style={{width:7,height:7,borderRadius:'50%',background:'linear-gradient(135deg, var(--accent), var(--teal))',display:'inline-block',animation:'dotPulse 1.2s ease-in-out infinite',animationDelay:(i*0.15)+'s',boxShadow:'0 0 8px rgba(108,99,255,0.3)'}}/>))}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════
   SOS MAIN APP
   ═══════════════════════════════════════════════ */
function App() {
  const [user, setUser] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
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
  const [chatError, setChatError] = useState(null);
  const [pendingActions, setPendingActions] = useState([]);
  const [pendingContent, setPendingContent] = useState([]);
  const [pendingTemplateSelector, setPendingTemplateSelector] = useState(null);
  const [pendingClarification, setPendingClarification] = useState(null);
  const [aiAutoApprove, setAiAutoApprove] = useState(() => localStorage.getItem('sos_ai_auto_approve') === 'true');
  const [showPeek, setShowPeek] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [layoutMode, setLayoutMode] = useState(() => localStorage.getItem('sos_layout_mode') || 'sidebar');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sos_sidebar_collapsed') === 'true');
  const [sidebarCompanionPanel, setSidebarCompanionPanel] = useState(() => localStorage.getItem('sos_sidebar_companion_panel') || 'notes');
  const [activePanel, setActivePanel] = useState('chat');
  const [companionCollapsed, setCompanionCollapsed] = useState(() => localStorage.getItem('sos_companion_collapsed') !== 'false');
  const [autoCollapseSidebarCompanion, setAutoCollapseSidebarCompanion] = useState(() => localStorage.getItem('sos_auto_collapse_sidebar_companion') !== 'false');
  const [compactCompanionToggle, setCompactCompanionToggle] = useState(() => localStorage.getItem('sos_companion_toggle_compact') !== 'false');
  const showSideBySide = showPeek && showNotes;
  const showSidebarCompanion = layoutMode === 'sidebar' && activePanel === 'chat' && sidebarCompanionPanel !== 'none';
  const getWorkspaceContext = useCallback((overridePanel = null) => {
    const effectivePanel = overridePanel || sidebarCompanionPanel;
    if (layoutMode === 'sidebar' && activePanel === 'chat' && !companionCollapsed) {
      if (effectivePanel === 'schedule') return 'schedule';
      if (effectivePanel === 'notes') return 'notes';
    }
    return activePanel === 'chat' ? 'chat' : 'none';
  }, [sidebarCompanionPanel, layoutMode, activePanel, companionCollapsed]);
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
  const [syncStatus, setSyncStatus] = useState('saved'); // 'saving', 'saved', 'error'
  const [contentGenUsed, setContentGenUsed] = useState(0);
  const DAILY_CONTENT_LIMIT = 5;
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
  const welcomeIdx = useMemo(() => Math.floor(Math.random() * 5), []);

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
        setPendingClarification(null);
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
  const fetchWeather = useCallback(async () => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${weatherCoords.lat}&longitude=${weatherCoords.lon}&current=temperature_2m,weathercode,windspeed_10m&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max&temperature_unit=fahrenheit&timezone=auto&forecast_days=3`;
      const res = await fetch(url); if (!res.ok) throw new Error('Weather fetch failed');
      const data = await res.json();
      setWeatherData({ current:data.current, daily:data.daily, fetchedAt:Date.now() });
    } catch(e) { console.error('Weather fetch error:', e); }
  }, [weatherCoords]);
  useEffect(() => { if (dataLoaded) { const stale = !weatherData?.fetchedAt || (Date.now() - weatherData.fetchedAt > 3600000); if (stale) fetchWeather(); } }, [dataLoaded]);

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
          const task = { id:uid(), title:action.title||'Untitled', subject:action.subject||'', dueDate:action.due||today(), estTime:action.estimated_minutes||30, status:action.status||'not_started', focusMinutes:0, createdAt:new Date().toISOString() };
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
          if (action.task_id) updateTask(action.task_id, { status:'done', completedAt:new Date().toISOString() });
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
          const ev = { id:uid(), title:action.title||'Event', type:action.event_type||'other', subject:action.subject||'', date:action.date||today(), time:action.time||null, description:action.description||'', location:action.location||'', priority:action.priority||'medium', recurring:'none', createdAt:new Date().toISOString(), source:'manual', googleId:null };
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
    } catch(e) { console.error('Failed to execute action:', action, e); }
  }

  // ── Confirmation handlers ──
  function handleConfirmAction(idx, action) {
    executeAction(action);
    setPendingActions(prev => prev.filter((_,i)=>i!==idx));
    const name = action.title||action.activity||'Action';
    const verb = action.type?.startsWith('delete') ? 'removed' : action.type === 'update_event' ? 'updated' : action.type === 'complete_task' ? 'completed' : 'added';
    setToastMsg('✓ ' + name + ' ' + verb);
  }
  function handleCancelAction(idx) { setPendingActions(prev => prev.filter((_,i)=>i!==idx)); }

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
  function saveChat() {
    if (messages.length === 0) return;
    const firstUserMsg = messages.find(m => m.role === 'user');
    const title = firstUserMsg ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? '...' : '') : 'Chat ' + new Date().toLocaleDateString();
    const chatId = uid();
    const savedAt = new Date().toISOString();
    const chatData = { title, messages: messages.slice(), savedAt, messageCount: messages.length };
    // Save to Supabase via notes table with special prefix
    const note = { id: chatId, name: CHAT_SAVE_PREFIX + title, content: JSON.stringify(chatData), updatedAt: savedAt };
    if (user) syncOp(() => dbUpsertNote(note, user.id));
    setSavedChats(prev => [{ id: chatId, ...chatData }, ...prev]);
    // Clear current chat
    setMessages([]); setPendingActions([]); setPendingClarification(null); setChatError(null);
    if (user) dbClearChat(user.id);
    setToastMsg('Chat saved');
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

  function exitSavedChatView() {
    setViewingSavedChatId(null);
    setMessages([]);
    // Reset daily brief so it can re-trigger for fresh session
    setDailyBrief(null);
    briefRequestedRef.current = false;
    // Reload current chat from DB
    if (user) {
      sb.from('chat_messages').select('*').eq('user_id', user.id).order('created_at').then(({ data }) => {
        if (data) {
          const msgs = data.map(m => ({ role: m.role, content: m.content, timestamp: new Date(m.created_at).getTime(), photoUrl: m.photo_url || null }));
          setMessages(msgs);
          setDbMessageCount(msgs.length); // P1.4
        }
      });
    }
  }

  function resumeSavedChat(chatId) {
    const chat = savedChats.find(c => c.id === chatId);
    if (!chat) return;
    // Clear viewing lock so user can type
    setViewingSavedChatId(null);
    setMessages(chat.messages || []);
    setShowChatSidebar(false);
    setPendingActions([]);
    setPendingClarification(null);
    setChatError(null);
    // Persist resumed messages as the new active chat in DB
    if (user) {
      dbClearChat(user.id).then(() => {
        (chat.messages || []).forEach(m => {
          dbInsertChatMsg(m.role, m.content, user.id, m.photoUrl || null);
        });
      });
    }
    // Remove from saved chats since it's now the active chat
    setSavedChats(prev => prev.filter(c => c.id !== chatId));
    if (user) syncOp(() => sb.from('notes').delete().eq('id', chatId).eq('user_id', user.id));
    setToastMsg('Chat resumed');
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

    try {
      // For image requests: send only last 2 messages to keep payload small for vision model.
      const rawHistory = updated.slice(photo ? -2 : -12).map(m => ({
        role: m.role,
        content: m.content || '',
      }));
      const historyForApi = rawHistory.filter(m => m.content && m.content.trim());
      const chatPrompt = buildSystemPrompt(tasks, blocks, events, notes, 2);

      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;

      // Detect content generation requests (for rate limiting + model upgrade)
      const isContentGen = /flashcard|outline|summar|study\s*plan|study\s*guide|quiz\s+me|practice\s*question|project\s*breakdown|review\s*sheet|cheat\s*sheet/i.test(text || '');

      // Tier routing: pure conversational messages skip tools for lower latency
      const isConversational = !isContentGen && !photo && !isPlanRequest && !fromClarification
        && !/\b(add|create|schedule|delete|remove|cancel|mark|done|complete|update|move|reschedule|block|note|save|remind|break|clear|convert|set|plan)\b/i.test(msgContent)
        && !/\b(test|exam|quiz|homework|assignment|practice|game|meet|tournament|deadline|event|task)\b/i.test(msgContent);

      const chatPromptFinal = isConversational ? buildSystemPrompt(tasks, blocks, events, notes, 1) : chatPrompt;
      const chatBody = {
        systemPrompt: chatPromptFinal,
        messages: historyForApi,
        maxTokens: isContentGen ? 4096 : isConversational ? 512 : 1024,
        isContentGen,
        workspaceContext: effectiveWorkspaceContext,
        ...(isConversational ? { noTools: true } : {}),
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

      const chatData = await chatResponse.json();
      let actions = Array.isArray(chatData?.actions) ? chatData.actions : [];

      // For content gen, parse content types from raw text response (AI outputs JSON when tools are disabled)
      if (isContentGen && actions.length === 0 && chatData?.content) {
        const raw = (chatData.content || '').trim();
        // Try parsing as JSON (AI may output raw JSON object)
        const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
        try {
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed === 'object' && parsed.type && CONTENT_TYPES.includes(parsed.type)) {
            actions = [parsed];
          } else if (Array.isArray(parsed)) {
            actions = parsed.filter(p => p && p.type && CONTENT_TYPES.includes(p.type));
          }
        } catch (_) {
          // Also try parsing <action> tags from text
          const taggedActions = parseActions(raw);
          if (taggedActions.length > 0) {
            actions = taggedActions.filter(a => CONTENT_TYPES.includes(a.type));
          }
        }
      }

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
          : "hmm, didn't get a response. try again?";

      if (displayContent) {
        const assistantMsg = { role:'assistant', content:displayContent, timestamp:Date.now() };
        setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
        if (user) dbInsertChatMsg('assistant', displayContent, user.id);
      }

      // Actions come back as structured tool_use results — no text parsing needed

      // ── Resolve actions: translate AI names → real IDs/ranges using resolveEvent/resolveTask helpers ──
      const resolved = [];
      for (const a of actions) {
        if (a.type === 'delete_event' || a.type === 'update_event' || a.type === 'convert_event_to_block') {
          const match = resolveEvent(a.title || a.event_id, events);
          if (match) {
            resolved.push({ ...a, event_id: match.id, title: match.title, date: a.date || match.date });
          } else {
            const msg = { role:'assistant', content: a.type === 'delete_event'
              ? "hmm, I couldn't find that event to remove. what's the exact name?"
              : a.type === 'update_event'
                ? "I couldn't find that event to update. which one did you mean?"
                : "I couldn't find that event to convert. which one did you mean?", timestamp:Date.now() };
            setMessages(prev => { const n=[...prev,msg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          }
          continue;
        }
        if (a.type === 'convert_block_to_event') {
          const range = resolveBlockRange(a, blocks);
          if (range) {
            resolved.push({ ...a, date: range.date, start: range.start, end: a.end || range.end, title: a.title || range.name || 'Event' });
          } else {
            const msg = { role:'assistant', content:"I couldn't find that block to convert. can you share the date/time?", timestamp:Date.now() };
            setMessages(prev => { const n=[...prev,msg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          }
          continue;
        }
        if (a.type === 'delete_task') {
          const match = resolveTask(a.title || a.task_id, tasks);
          if (match) {
            resolved.push({ ...a, task_id: match.id, title: match.title });
          } else {
            const msg = { role:'assistant', content:"hmm, I couldn't find that task. what's the exact name?", timestamp:Date.now() };
            setMessages(prev => { const n=[...prev,msg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          }
          continue;
        }
        if (a.type === 'complete_task') {
          const match = resolveTask(a.title || a.task_id, tasks);
          if (match) {
            resolved.push({ ...a, task_id: match.id, title: match.title });
          } else {
            const msg = { role:'assistant', content:"hmm, I couldn't find that task to mark done. what's the exact name?", timestamp:Date.now() };
            setMessages(prev => { const n=[...prev,msg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
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
            const msg = { role:'assistant', content:"I couldn't find that note. what's the exact name?", timestamp:Date.now() };
            setMessages(prev => { const n=[...prev,msg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
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

      if (actions.length > 0) {
        const confirmTypes = ['add_task','add_event','add_block','break_task','delete_task','delete_event','delete_block','update_event','convert_event_to_block','convert_block_to_event','add_recurring_event','clear_all','edit_note','delete_note'];
        const contentActions = actions.filter(a => CONTENT_TYPES.includes(a.type));
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
      const msg = err.message || '';
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        setChatError("I'm getting a lot of requests right now — give me a few seconds and try again!");
      } else {
        setChatError(msg || "couldn't reach the server — check your connection");
      }
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
    sendMessage(readableResponse, { fromClarification: true });
  }

  function handleSubmit(e) { if(e)e.preventDefault(); if(viewingSavedChatId)return; if(!user){setShowAuthModal(true);return;} sendMessage(input); }
  function sendChip(text) { if(viewingSavedChatId)return; if(!user){setInput(text);setShowAuthModal(true);return;} setInput(''); sendMessage(text); }

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
    if (!user) { setShowAuthModal(true); return; }
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
      setToastMsg("Couldn't catch that — try speaking louder or closer");
    }
    setIsTranscribing(false);
  }


  function clearChat() {
    setMessages([]); setPendingActions([]); setPendingClarification(null); setChatError(null);
    if (user) dbClearChat(user.id);
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
        if (activePanel === 'chat') {
          if (layoutMode !== 'sidebar') setLayoutMode('sidebar');
          openCompanionPanel('schedule');
        } else {
          setShowPeek(p=>!p);
        }
      }
      else if(key==='n'){
        e.preventDefault();
        if (activePanel === 'chat') {
          if (layoutMode !== 'sidebar') setLayoutMode('sidebar');
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

  const quickChips = [
    { label:'What should I do?', msg:'What should I work on right now?' },
    { label:'Add a task', msg:'I need to add a task' },
    { label:'My schedule', action:()=>setShowPeek(true) },
    { label:'Flashcards', msg:'Make me flashcards for what I studied last' },
    { label:'Quiz me', msg:'Quiz me on what I need to study' },
    { label:'Notes', action:()=>setShowNotes(true) },
    { label:'Import', action:()=>setShowGoogleModal(true) },
    { label:'Settings', action:()=>setActivePanel('settings') },
  ];

  const activeTaskCount = tasks.filter(t=>t.status!=='done').length;
  const overdueCount = tasks.filter(t=>t.status!=='done'&&daysUntil(t.dueDate)<0).length;
  useEffect(() => { localStorage.setItem('sos_layout_mode', layoutMode); }, [layoutMode]);
  useEffect(() => { localStorage.setItem('sos_sidebar_collapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { localStorage.setItem('sos_sidebar_companion_panel', sidebarCompanionPanel); }, [sidebarCompanionPanel]);
  useEffect(() => { localStorage.setItem('sos_companion_collapsed', String(companionCollapsed)); }, [companionCollapsed]);
  useEffect(() => { localStorage.setItem('sos_auto_collapse_sidebar_companion', String(autoCollapseSidebarCompanion)); }, [autoCollapseSidebarCompanion]);
  useEffect(() => { localStorage.setItem('sos_companion_toggle_compact', String(compactCompanionToggle)); }, [compactCompanionToggle]);

  // ── Loading data after login ──
  if (user && !dataLoaded) {
    return (
      <div className="auth-screen" style={{position:'relative'}}>
        <div style={{position:'absolute',width:200,height:200,background:'radial-gradient(circle, rgba(108,99,255,0.1) 0%, transparent 70%)',borderRadius:'50%',filter:'blur(40px)',pointerEvents:'none',animation:'breathe 3s ease-in-out infinite'}}/>
        <div style={{fontSize:'2.2rem',fontWeight:900,background:'linear-gradient(135deg, #7B6CFF 0%, var(--teal) 50%, #45aaf2 100%)',backgroundSize:'200% 200%',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',marginBottom:16,position:'relative',animation:'gradientShift 3s ease infinite'}}>SOS</div>
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
        <div style={{fontSize:'2.2rem',fontWeight:900,background:'linear-gradient(135deg, #7B6CFF 0%, var(--teal) 50%, #45aaf2 100%)',backgroundSize:'200% 200%',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',marginBottom:16,position:'relative',animation:'gradientShift 3s ease infinite'}}>SOS</div>
        <div style={{width:28,height:28,border:'3px solid rgba(108,99,255,0.15)',borderTopColor:'var(--accent)',borderRightColor:'var(--teal)',borderRadius:'50%',animation:'spin 0.8s linear infinite',position:'relative',boxShadow:'0 0 16px rgba(108,99,255,0.15)'}}/>
      </div>
    );
  }

  return (
    <div className="sos-app" style={{flexDirection: layoutMode === 'topbar' ? 'column' : 'row'}}>
      {layoutMode === 'sidebar' && <aside className={'sos-sidebar'+(sidebarCollapsed?' collapsed':'')}>
        <div className="sos-sidebar-head">
          <div className="sos-sidebar-head-left">
            <div className="sos-sidebar-brand"><img className="sos-brand-logo" src="assets/brain-logo.svg" alt="SOS" style={{width:sidebarCollapsed?24:30,height:sidebarCollapsed?24:30}}/></div>
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
          <button className="sos-side-btn" onClick={()=>{ setActivePanel('chat'); clearChat(); }} title="New chat">{Icon.plus(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>New chat</span></button>
          <button className="sos-side-btn" onClick={()=>openCompanionPanel('schedule')} title="Schedule + chat">{Icon.clipboard(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Schedule + chat</span></button>
          <button className="sos-side-btn" onClick={()=>openCompanionPanel('notes')} title="Notes + chat">{Icon.fileText(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Notes + chat</span></button>
          <button className="sos-side-btn" onClick={()=>setShowGoogleModal(true)} title="Import">{Icon.link(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Import</span></button>
          <button className="sos-side-btn" onClick={()=>setActivePanel('settings')} title="Settings">{Icon.edit(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Settings</span></button>
        </div>
        <div className="sos-side-meta">
          <span>{activeTaskCount} task{activeTaskCount!==1?'s':''}{overdueCount>0?` • ${overdueCount} overdue`:''}</span>
          <span style={{color:contentGenUsed>=DAILY_CONTENT_LIMIT?'var(--danger)':'var(--text-dim)'}}>{Math.max(0, DAILY_CONTENT_LIMIT - contentGenUsed)}/{DAILY_CONTENT_LIMIT}</span>
        </div>
        <div className="sos-side-list">
          {savedChats.length === 0 ? (
            <div className="chat-sidebar-empty" style={{paddingTop:24}}>
              <div style={{marginBottom:8,opacity:0.4,display:'flex',justifyContent:'center',color:'var(--accent)'}}>{Icon.messageCircle(28)}</div>
              <div>No saved conversations yet</div>
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
                      <button className="chat-sidebar-item-delete" style={{color:'var(--teal,#2bd5ba)'}} onClick={e => { e.stopPropagation(); resumeSavedChat(chat.id); }}>Resume</button>
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

      <div className="sos-main">
      {layoutMode === 'topbar' && <div className="sos-header">
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>setLayoutMode('sidebar')} className="topbar-sidebar-btn" title="Sidebar mode" aria-label="Sidebar mode">{Icon.panel(16)}</button>
          <div className="sos-sidebar-brand" style={{width:34,height:34}}><img className="sos-brand-logo" src="assets/brain-logo.svg" alt="SOS" style={{width:30,height:30}}/></div>
          {user && <div style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:4}}>
            <span className={'sync-dot '+(syncStatus==='saving'?'sync-saving':syncStatus==='error'?'sync-error':'sync-saved')}/>
            {syncStatus==='saving'?'Saving...':syncStatus==='error'?'Sync error':'Synced'}
          </div>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <PerfPill />
          <button onClick={()=>setShowPeek(true)} className="g-hdr-btn">{Icon.clipboard(14)} Peek</button>
          <button onClick={()=>setShowNotes(true)} className="g-hdr-btn">{Icon.fileText(14)} Notes</button>
          <button onClick={()=>setShowChatSidebar(true)} className="g-hdr-btn">{Icon.messageCircle(14)} History</button>
          <button onClick={()=>setActivePanel('settings')} className="g-hdr-btn">{Icon.edit(14)} Settings</button>
        </div>
      </div>}

      {activePanel === 'settings' ? (
        <div className="sos-chat-area" style={{animation:'fadeIn .25s ease'}}>
          <div className="settings-view" style={{animation:'slideUp .28s ease'}}>
            <div className="settings-card">
              <div className="settings-title">Settings</div>
              <div className="settings-sub">Customize your workspace layout and keep the controls for topbar/sidebar behavior in one place.</div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Layout mode</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Switch between topbar and sidebar navigation.</div>
                </div>
                <button className="settings-toggle" onClick={()=>setLayoutMode(layoutMode==='topbar'?'sidebar':'topbar')}>{layoutMode==='topbar'?'Use sidebar':'Use topbar'}</button>
              </div>
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
        {viewingSavedChatId && (
          <div style={{padding:'8px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',background:'rgba(108,99,255,0.06)',border:'1px solid rgba(108,99,255,0.2)',borderRadius:12,margin:'0 16px 8px',animation:'fadeIn .2s ease'}}>
            <span style={{fontSize:'0.82rem',color:'var(--accent)',fontWeight:600}}>Viewing saved conversation</span>
            <div style={{display:'flex',gap:6}}>
              <button onClick={() => resumeSavedChat(viewingSavedChatId)} style={{background:'var(--teal,#2bd5ba)',color:'#fff',border:'none',borderRadius:8,padding:'5px 12px',fontSize:'0.78rem',fontWeight:600,cursor:'pointer',transition:'all .15s'}}>Resume</button>
              <button onClick={exitSavedChatView} style={{background:'var(--accent)',color:'#fff',border:'none',borderRadius:8,padding:'5px 12px',fontSize:'0.78rem',fontWeight:600,cursor:'pointer',transition:'all .15s'}}>Back</button>
            </div>
          </div>
        )}
        {messages.length===0&&!isLoading&&!viewingSavedChatId&&(()=>{
          // Default welcome screen
          const wv = welcomeVariants[welcomeIdx];
          return (
          <div style={{position:'relative',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',padding:'48px 24px',textAlign:'center'}}>
            <div style={{position:'absolute',top:'28%',width:240,height:240,background:'radial-gradient(circle, rgba(108,99,255,0.12) 0%, rgba(43,203,186,0.06) 40%, transparent 70%)',borderRadius:'50%',filter:'blur(50px)',pointerEvents:'none',animation:'breathe 4s ease-in-out infinite, orbFloat 8s ease-in-out infinite'}}/>
            <div style={{fontSize:'3.2rem',marginBottom:16,background:'linear-gradient(135deg, #7B6CFF 0%, var(--teal) 50%, #45aaf2 100%)',backgroundSize:'200% 200%',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',fontWeight:900,letterSpacing:'-1px',position:'relative',animation:'gradientShift 4s ease infinite, floatUp 0.6s cubic-bezier(0.16,1,0.3,1) both'}}>SOS</div>
            <div style={{fontSize:'1.05rem',color:'var(--text)',fontWeight:600,marginBottom:8,position:'relative',animation:'textReveal 0.5s ease 0.15s both'}}>{wv.greeting}</div>
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
              <div className={`sos-bubble ${msg.role==='user'?'sos-bubble-user':'sos-bubble-ai'}`}>
                {(msg.photoUrl||msg.photoPreview)&&(
                  <img src={msg.photoUrl||msg.photoPreview} alt="photo"
                    onClick={()=>setLightboxUrl(msg.photoUrl||msg.photoPreview)}
                    onError={(e)=>{e.target.style.display='none';}}
                    style={{maxWidth:240,maxHeight:200,borderRadius:10,marginBottom:msg.content?8:0,cursor:'pointer',display:'block'}}/>
                )}
                {msg.content&&<span>{msg.content}</span>}
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
          <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
            <ClarificationCard clarification={pendingClarification} onSubmit={handleClarificationSubmit} />
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
                if(toExec.length>0)setToastMsg('Added '+toExec.length+' items');
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
              <ConfirmationCard action={pa.action} onConfirm={(action)=>handleConfirmAction(idx,action)} onCancel={()=>handleCancelAction(idx)} isFallback={pa.isFallback}/>
            )}
          </div>
        ))}
        {pendingContent.map((pc,idx)=>(
          <div key={'pc-'+idx} className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
            <ContentTypeRouter content={pc} onSave={()=>handleSaveContent(idx)} onDismiss={()=>handleDismissContent(idx)} onApplyPlan={(steps)=>handleApplyPlan(idx,steps)} onStartPlanTask={(step)=>handleStartPlanTask(step)} onExportGoogleDocs={(planData)=>handleExportPlanToGoogleDocs(idx,planData)} googleConnected={isGoogleConnected()}/>
          </div>
        ))}
        {isLoading&&<TypingDots/>}
        {chatError&&<div style={{padding:'8px 16px'}}><div style={{padding:'10px 14px',borderRadius:12,background:'rgba(255,71,87,0.08)',border:'1px solid rgba(255,71,87,0.25)',fontSize:'0.84rem',color:'var(--danger)',maxWidth:'80%'}}>{chatError}</div></div>}
        <div ref={messagesEndRef} style={{height:1}}/>
      </div>

      </ErrorBoundary>
      {/* ── Input Area ── */}
      <div className="sos-input-area">
        {messages.length>0&&(
          <div style={{display:'flex',gap:8,marginBottom:8,overflowX:'auto',paddingBottom:2}}>
            {quickChips.map((chip,i)=>(<button key={i} className="sos-chip" onClick={()=>chip.action?chip.action():sendChip(chip.msg)}>{chip.label}</button>))}
            {!viewingSavedChatId && <button className="sos-chip" onClick={saveChat} style={{background:'rgba(46,213,115,0.08)',borderColor:'rgba(46,213,115,0.2)',color:'var(--success)'}}>Save chat</button>}
            {viewingSavedChatId && <button className="sos-chip" onClick={() => resumeSavedChat(viewingSavedChatId)} style={{background:'rgba(46,213,115,0.08)',borderColor:'rgba(46,213,115,0.2)',color:'var(--success)'}}>Resume chat</button>}
            {viewingSavedChatId && <button className="sos-chip" onClick={exitSavedChatView} style={{background:'rgba(108,99,255,0.08)',borderColor:'rgba(108,99,255,0.2)',color:'var(--accent)'}}>Back</button>}
            <button className="sos-chip" onClick={()=>setShowChatSidebar(true)} style={{background:'rgba(108,99,255,0.06)',borderColor:'rgba(108,99,255,0.15)',color:'var(--accent)'}}>History</button>
          </div>
        )}
        {pendingPhoto&&(
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,padding:'6px 10px',background:'var(--bg)',borderRadius:12,border:'1px solid var(--border)',animation:'fadeIn .2s ease'}}>
            <img src={pendingPhoto.preview} alt="attached" style={{width:48,height:48,borderRadius:8,objectFit:'cover'}}/>
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
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,padding:'14px 16px',background:'linear-gradient(135deg,rgba(26,26,46,0.97),rgba(15,15,26,0.97))',border:'1px solid rgba(108,99,255,0.15)',borderRadius:28}}>
            <div style={{width:18,height:18,border:'2px solid var(--accent)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>
            <span style={{fontSize:'0.85rem',color:'var(--text-dim)'}}>Transcribing...</span>
          </div>
        ) : (
          /* ── Normal chat input form ── */
          <form onSubmit={handleSubmit} style={{display:'flex',gap:8,alignItems:'center'}}>
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={handlePhotoSelect}/>
            {workspaceModeLabel && (
              <span style={{padding:'4px 9px',borderRadius:999,fontSize:'0.72rem',fontWeight:600,color:'var(--accent)',background:'rgba(108,99,255,0.1)',border:'1px solid rgba(108,99,255,0.24)',whiteSpace:'nowrap'}}>{workspaceModeLabel}</span>
            )}
            <button type="button" onClick={()=>photoInputRef.current?.click()} disabled={isLoading}
              style={{width:40,height:40,borderRadius:'50%',background:'transparent',border:'1px solid '+(pendingPhoto?'var(--accent)':'var(--border)'),color:pendingPhoto?'var(--accent)':'var(--text-dim)',cursor:isLoading?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .2s',opacity:isLoading?0.5:1}}>
              {Icon.camera(18)}
            </button>
            <button type="button" onClick={startRecording} disabled={isLoading||!!viewingSavedChatId}
              style={{width:40,height:40,borderRadius:'50%',background:'transparent',border:'1px solid var(--border)',color:'var(--text-dim)',cursor:(isLoading||viewingSavedChatId)?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .2s',opacity:(isLoading||viewingSavedChatId)?0.5:1}}>
              {Icon.mic(18)}
            </button>
            <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
              placeholder={viewingSavedChatId?"viewing saved chat — click 'Resume' to continue":pendingPhoto?"add a message or just send the photo...":messages.length===0?["What's on your plate today?","What do you need help with?","Tell me about your classes...","What's coming up this week?","Anything on your mind?"][welcomeIdx]:"type anything..."}
              disabled={isLoading||!!viewingSavedChatId}
              style={{flex:1,background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:24,padding:'12px 20px',fontSize:'0.92rem',outline:'none',opacity:(isLoading||viewingSavedChatId)?0.5:1,transition:'all .25s cubic-bezier(0.16,1,0.3,1)'}}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSubmit()}}}/>
            <button type="submit" disabled={isLoading||!!viewingSavedChatId||(!input.trim()&&!pendingPhoto)} style={{width:44,height:44,borderRadius:'50%',background:(isLoading||!!viewingSavedChatId||(!input.trim()&&!pendingPhoto))?'var(--border)':'linear-gradient(135deg,var(--accent),#5a54d4)',color:'#fff',border:'none',cursor:(isLoading||!!viewingSavedChatId||(!input.trim()&&!pendingPhoto))?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all .2s',flexShrink:0,boxShadow:(isLoading||!!viewingSavedChatId||(!input.trim()&&!pendingPhoto))?'none':'0 2px 12px rgba(108,99,255,0.3)'}}>{Icon.send(18)}</button>
          </form>
        )}
        <div style={{display:'flex',justifyContent:'center',gap:16,marginTop:8,fontSize:'0.68rem',color:'var(--text-dim)',flexWrap:'wrap'}}><span>/ focus input</span><span>S opens Schedule tab</span><span>N opens Notes tab</span><span>Shift+S closes side panel</span><span>H history</span><span>Cam photo</span><span>Mic voice</span><a href="privacy.html" style={{color:'var(--text-dim)',textDecoration:'none',opacity:0.6,transition:'opacity .15s'}} onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0.6}>Privacy Policy</a></div>
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
            <ErrorBoundary><SchedulePeek tasks={tasks} blocks={blocks} events={events} weatherData={weatherData} embedded/></ErrorBoundary>
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

      {showSideBySide && (
        <>
          <div className="peek-overlay" onClick={() => { setShowPeek(false); setShowNotes(false); }}/>
          <div className="split-workspace">
            <div className="split-workspace-head">
              <div style={{display:'flex',alignItems:'center',gap:8,fontWeight:700}}>{Icon.panel(16)} Notes + Schedule</div>
              <button className="g-modal-close" onClick={() => { setShowPeek(false); setShowNotes(false); }}>{Icon.x(16)}</button>
            </div>
            <div className="split-workspace-grid">
              <ErrorBoundary><SchedulePeek tasks={tasks} blocks={blocks} events={events} weatherData={weatherData} embedded/></ErrorBoundary>
              <NotesPanel notes={notes} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} onCreateNote={handleCreateNote} embedded/>
            </div>
          </div>
        </>
      )}
      {!showSideBySide && showPeek&&<ErrorBoundary><SchedulePeek tasks={tasks} blocks={blocks} events={events} weatherData={weatherData} onClose={()=>setShowPeek(false)}/></ErrorBoundary>}
      {!showSideBySide && showNotes&&<NotesPanel notes={notes} onClose={()=>setShowNotes(false)} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} onCreateNote={handleCreateNote}/>} 
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
                <div>No saved conversations yet</div>
                <div style={{fontSize:'0.78rem',marginTop:4}}>Use "Save chat" to keep a conversation</div>
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
                        <button className="chat-sidebar-item-delete" style={{color:'var(--teal,#2bd5ba)'}} onClick={e => { e.stopPropagation(); resumeSavedChat(chat.id); }}>Resume</button>
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
      {showAuthModal && <AuthModal onAuth={(u)=>{handleAuth(u);setShowAuthModal(false);}} onClose={()=>setShowAuthModal(false)} />}
      {toastMsg&&<Toast message={toastMsg} onDone={()=>setToastMsg(null)}/>}


      {lightboxUrl&&(
        <div onClick={()=>setLightboxUrl(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',animation:'overlayIn .2s ease'}}>
          <img src={lightboxUrl} alt="full size" style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:12,objectFit:'contain'}}/>
        </div>
      )}
    </div>
  );
}


export default App;
