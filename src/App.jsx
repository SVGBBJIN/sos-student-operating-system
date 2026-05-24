import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import * as pdfjsLib from 'pdfjs-dist';
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY, EDGE_FN_URL, CHAT_MAX_MESSAGES } from './lib/supabase';
import { streamChat } from './lib/streamChat';
import Icon from './lib/icons';
import { trackEvent } from './lib/analytics';
import { dbInsertTaskEvent } from './lib/dataHandlers';
import ErrorBoundary from './components/ErrorBoundary';

import * as sfx from './lib/sfx';
import { getPerfTier, setPerfOverride } from './lib/perfAdjuster';
import StudyTopBar from './components/StudyTopBar';
import StudyBottomBar from './components/StudyBottomBar';
import LofiLeftPanel from './components/LofiLeftPanel';
import PomodoroTimer from './components/PomodoroTimer';
import ScheduleWidget from './components/ScheduleWidget';
import SosNotification from './components/SosNotification';
import LofiRightPanel from './components/LofiRightPanel';
import StudioSidebar from './components/StudioSidebar';
import RateLimitBanner from './components/RateLimitBanner';
import GooglePermissionSummary from './components/GooglePermissionSummary';
import { useAgenticMode } from './hooks/useSettings';
import AppearanceSettings from './components/AppearanceSettings';
import ProofreadPanel from './components/ProofreadPanel';
import { buildOAuthRedirectUrl } from './lib/auth/oauthRedirect';
import { dbEventToApp as dbEventToAppShared, appEventToDb as appEventToDbShared } from './lib/eventShape.js';
import { extractWikilinks, renderWikilinks, resolveLinkName, findEntityMentions, stripHtml as stripNoteHtml } from './lib/wikilinks';
import { bestSuggestion, flattenEntities } from './lib/linkSuggestions';
import { inferSubjectFromTitle, SUBJECT_LIST } from '../shared/subjects.js';
import { rankTasks, buildCalendarDensity } from '../shared/scheduling/priority.ts';
import { MODEL_DEEP, MODEL_FAST } from './lib/aiClient.js';
import LinkSuggestionCard from './components/LinkSuggestionCard';
import { useWikilinkAutocomplete } from './components/WikilinkAutocomplete';
import { useColumnLayout } from './hooks/useColumnLayout';
import { ColumnResizeHandles, ColumnLockToggle } from './components/ColumnResizeHandles';
import HomeScreen, { HOME_BACKGROUNDS, HOME_FOCUS_OPTIONS, getHomePrefs, setHomePref } from './components/HomeScreen';

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

/* ── Notification scheduling helper ──────────────────────────── */
function buildNotifications(tasks, events, prefs) {
  const notes = [];
  const now = Date.now();
  function atDate(dateStr, hour = 9) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  }
  if (prefs.tasks) {
    tasks.filter(t => t.status !== 'done' && t.dueDate).forEach(t => {
      const d = daysUntil(t.dueDate);
      if (d === 1) notes.push({ title: '⏰ Due tomorrow', body: t.title, fireAt: atDate(t.dueDate, 8), tag: 'task-' + t.id + '-1d' });
      if (d === 0) notes.push({ title: '🔴 Due today', body: t.title, fireAt: now + 60000, tag: 'task-' + t.id + '-today' });
    });
  }
  if (prefs.exams) {
    events.filter(ev => /exam|test|midterm|final/i.test(ev.title || '')).forEach(ev => {
      const d = daysUntil(ev.date);
      if (d === 3) notes.push({ title: '📚 Exam in 3 days', body: ev.title, fireAt: atDate(ev.date, 8) - 2 * 86400000, tag: 'exam-' + ev.id + '-3d' });
      if (d === 1) notes.push({ title: '📚 Exam tomorrow!', body: ev.title, fireAt: atDate(ev.date, 8) - 86400000, tag: 'exam-' + ev.id + '-1d' });
    });
  }
  if (prefs.daily) {
    const dailyHour = parseInt(localStorage.getItem('sos-notif-daily-hour') || '8', 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    const fireAt = atDate(todayStr, dailyHour);
    if (fireAt > now) {
      notes.push({ title: '📋 Good morning — here\'s your plan', body: `You have ${tasks.filter(t=>t.status!=='done').length} active tasks today.`, fireAt, tag: 'daily-plan' });
    }
  }
  return notes;
}

async function scheduleNotificationsToSW(notifications) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: 'SCHEDULE_NOTIFICATIONS', notifications });
  } catch(_) {}
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
    completedAt: row.completed_at, createdAt: row.created_at,
    study_plan_id: row.study_plan_id || null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    commitment: row.commitment || 'confirmed',
  };
}
function appTaskToDb(t, userId) {
  return {
    id: t.id, user_id: userId, title: t.title, subject: t.subject || '',
    due_date: t.dueDate, est_time: t.estTime || 30,
    status: t.status || 'not_started', focus_minutes: t.focusMinutes || 0,
    completed_at: t.completedAt || null, created_at: t.createdAt || new Date().toISOString(),
    study_plan_id: t.study_plan_id || null,
    confidence: typeof t.confidence === 'number' ? t.confidence : null,
    commitment: t.commitment || 'confirmed',
  };
}
// Delegate to shared shape helpers — single source of truth for event ↔ DB conversion.
function dbEventToApp(row) { return dbEventToAppShared(row); }
function appEventToDb(e, userId) { return appEventToDbShared(e, userId); }
function dbNoteToApp(row) {
  return {
    id: row.id,
    name: row.name,
    content: row.content || '',
    updatedAt: row.updated_at,
    parent_id: row.parent_id || null,
    is_folder: !!row.is_folder,
  };
}
function appNoteToDb(n, userId) {
  return {
    id: n.id,
    user_id: userId,
    name: n.name,
    content: n.content || '',
    updated_at: n.updatedAt || new Date().toISOString(),
    parent_id: n.parent_id || null,
    is_folder: !!n.is_folder,
  };
}

/* Full load from Supabase */
async function loadAllFromSupabase(userId) {
  try {
    const [tasksRes, eventsRes, notesRes, chatRes, recurringRes, dateBlocksRes, profileRes, linksRes, studyPlansRes] = await Promise.all([
      sb.from('tasks').select('*').eq('user_id', userId),
      sb.from('events').select('*').eq('user_id', userId),
      sb.from('notes').select('*').eq('user_id', userId),
      sb.from('chat_messages').select('*').eq('user_id', userId).order('created_at', { ascending: true }).limit(CHAT_MAX_MESSAGES),
      sb.from('recurring_blocks').select('*').eq('user_id', userId),
      sb.from('date_blocks').select('*').eq('user_id', userId),
      sb.from('profiles').select('*').eq('id', userId).single(),
      sb.from('entity_links').select('*').eq('user_id', userId),
      sb.from('study_plans').select('id,title,created_at,applied_at,status,plan_json,total_tasks,review_cadence_days').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
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

    const entityLinks = linksRes.error ? [] : (linksRes.data || []);
    const studyPlans = studyPlansRes.error ? [] : (studyPlansRes.data || []);

    return { tasks, events, notes, messages, blocks, weatherCoords, entityLinks, studyPlans };
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
/* ── Entity links: bidirectional graph between notes/events/tasks ── */
async function dbInsertEntityLink(link, userId) {
  const row = {
    user_id: userId,
    source_type: link.source_type,
    source_id: link.source_id,
    target_type: link.target_type,
    target_id: link.target_id,
    origin: link.origin || 'manual',
    confirmed_at: link.confirmed_at || (link.origin === 'rejected' ? null : new Date().toISOString()),
  };
  const { data, error } = await sb.from('entity_links')
    .upsert(row, { onConflict: 'user_id,source_type,source_id,target_type,target_id' })
    .select()
    .single();
  if (error) { console.error('Entity link insert error:', error); return null; }
  return data;
}
async function dbDeleteEntityLink(linkId, userId) {
  const { error } = await sb.from('entity_links').delete().eq('id', linkId).eq('user_id', userId);
  if (error) console.error('Entity link delete error:', error);
}
async function dbDeleteEntityLinkByPair(link, userId) {
  const { error } = await sb.from('entity_links').delete()
    .eq('user_id', userId)
    .eq('source_type', link.source_type).eq('source_id', link.source_id)
    .eq('target_type', link.target_type).eq('target_id', link.target_id);
  if (error) console.error('Entity link delete by pair error:', error);
}
async function dbLoadEntityLinks(userId) {
  const { data, error } = await sb.from('entity_links').select('*').eq('user_id', userId);
  if (error) { console.error('Entity links load error:', error); return []; }
  return data || [];
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
async function dbSaveFlashcardDeck(deck, userId) {
  const { data, error } = await sb.from('flashcard_decks').insert({
    user_id: userId,
    title: (deck.title || 'Flashcard Deck').slice(0, 200),
    summary: deck.summary || null,
    cards: deck.cards || [],
    source: deck.source || 'ai',
    card_count: (deck.cards || []).length,
  }).select('id').single();
  if (error) { console.error('flashcard_decks insert error:', error); return null; }
  return data?.id || null;
}
async function dbSaveStudyPlan(plan, userId) {
  const title = (plan.summary || '').slice(0, 120) || 'Study Plan';
  const { data, error } = await sb.from('study_plans').insert({
    user_id: userId, title, applied_at: new Date().toISOString(), status: 'active',
    plan_json: plan, total_tasks: (plan.milestone_tasks || []).length,
    review_cadence_days: plan.review_cadence?.every_n_days || null,
  }).select('id').single();
  if (error) { console.error('study_plans insert error:', error); return null; }
  return data?.id || null;
}
async function dbUpdateStudyPlan(planId, patch, userId) {
  const { error } = await sb.from('study_plans').update(patch).eq('id', planId).eq('user_id', userId);
  if (error) console.error('study_plans update error:', error);
}
async function dbSaveStudyPack(pack, userId, opts = {}) {
  const artifacts = [
    { kind: 'summary', data: { bullets: pack.summary || [], key_concepts: pack.key_concepts || [] } },
    { kind: 'flashcards', data: pack.flashcards || [] },
    { kind: 'quiz', data: pack.quiz || [] },
  ];
  const { data, error } = await sb.from('study_packs').insert({
    user_id: userId,
    title: (pack.title || 'Study Pack').slice(0, 200),
    subject: pack.subject || null,
    topic: pack.topic || null,
    status: 'ready',
    source_kind: opts.sourceKind || 'manual',
    artifacts,
    linked_event_id: opts.linkedEventId || null,
  }).select('id').single();
  if (error) { console.error('study_packs insert error:', error); return null; }
  return data?.id || null;
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
    if (import.meta.env.DEV) console.log('Migration complete');
    return true;
  } catch (e) {
    console.error('Migration error:', e);
    return false;
  }
}

/* ═══════════════════════════════════════════════
   SOS SYSTEM PROMPT BUILDER
   ═══════════════════════════════════════════════ */
const SYSTEM_PROMPT_VERSION = 'sos-policy-v3-modular';
const SYSTEM_PROMPT_CHAR_BUDGET = 3200;
const CONVERSATIONAL_CONTEXT_TOKEN_MAX = 100;
const CONVERSATIONAL_CONTEXT_CHAR_BUDGET = Math.floor(CONVERSATIONAL_CONTEXT_TOKEN_MAX * 3.8); // keep under ~100 tokens with buffer
const CONTEXT_SECTION_BUDGETS = {
  tasks: 900,
  events: 500,
  week: 700,
  notes: 900,
  schedule: 600,
};

const POLICY_MODULES = {
  core: 'You are SOS — a sharp, laid-back study sidekick who gets student life: the 11pm panic, the procrastination spiral, pulling up SparkNotes 10 minutes before class, texting "did you study?" right before an exam. You\'re not a professor — you\'re the friend who actually gets it. Match the student\'s tone and energy: brief when they\'re brief, casual when they\'re casual, calm when they\'re stressed. Skip hollow openers ("Certainly!", "Great question!", "Of course!") — just respond. Use contractions naturally. Sound like a person, not a help desk.',
  no_hallucination: 'Never invent schedule/tasks/deadlines or note content.',
  workspace: 'Prioritize workspace_context when useful (notes vs schedule vs chat).',
  clarification: 'If a required field for an action (title, date, due_date, subject, time, days, start, end) is missing or ambiguous, you MUST call the ask_clarification tool — never invent values, never use placeholders, never reply in plain text to ask. For add_block specifically: NEVER generate or infer start/end times — the student must state exact times; if either is absent, call ask_clarification with missing_fields containing the absent fields. For greetings, small talk, or non-action messages, respond naturally with no tool call.',
  clarification_style: 'Execute when the student\'s message clearly contains all required fields. Use ask_clarification whenever a required field is missing, ambiguous, or only partially given.',
  action_tools: "When details are explicit, call the matching action tool — even when the student STATES rather than COMMANDS. \"I have a chem test Friday\", \"There's a paper due Monday\", \"I just got assigned a 5-page essay\", \"got a calc midterm next week\" are all implicit create-action requests, not casual chat. Treat them like \"add a chem test for Friday\". Pick add_event for tests/exams/quizzes/games/practices/meetings/appointments; pick add_task for homework/essays/projects/papers/assignments. If title or date is fully missing or ambiguous, use ask_clarification — but if the message names BOTH (even informally), execute. Use specific student-provided titles only — never make up names.",
  planning_guardrails: 'Protect sleep (avoid work past 10pm), rebalance overloaded days, and handle overdue work without guilt.',
  corrections: '"actually / wait / I meant / oops" updates the latest related item.',
  conversational_capabilities: 'You\'re backed by a system that can: add events/deadlines to the calendar, create and prioritize tasks, schedule study blocks, break big projects into steps, and generate flashcards, quizzes, or full study plans in Studio. When the student signals stress, a crunch, or an upcoming deadline — even just venting — acknowledge it AND name the specific thing you can do to help. Don\'t just sympathize and move on.',
  date_resolution: 'Weekday references must resolve to current or next upcoming occurrence, never past dates.',
  vision: 'For image input, describe what is visible first, then extract actionable details.',
  timers: "For timer requests: use set_timer with `label` (the student's wording) and EXACTLY ONE of duration_seconds (1..86400), fire_at (ISO 8601 with timezone), or preset (pomodoro|short_break|long_break). Convert phrases — \"20 minutes\" → duration_seconds=1200, \"1 hour\" → 3600, \"half hour\" → 1800. NEVER guess a duration. If the student says \"set a timer\" with no length, call ask_clarification with missing_fields=['duration_seconds']. Anything longer than 24h belongs as an event, not a timer. To stop/cancel a running timer use cancel_timer with the label shown in ACTIVE TIMERS. If no timers are running and the student asks to cancel, say so — don't call cancel_timer.",
  notes_flow: "For add_note (create a note): always populate `subject` — it becomes the folder. If the subject, source, or title is missing, call ask_clarification with context_action='add_note' for the FIRST missing field only (do not ask for multiple fields in one call). Source values: 'user' = student writes it, 'imported' = pasting external content, 'ai_generated' = you draft it.",
};

function estimateInputTokens(text = '') {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

// Build a "LINKED CONTEXT" block for a chat message: pull referenced entities
// (via [[wikilinks]] + fuzzy title matches) and their 1-hop graph neighbors,
// formatted as text the model can read. Strict budget: 3 sources × 5 neighbors,
// 300 chars per neighbor preview, ~1.1k tokens worst case.
function buildLinkedContextBlock({ message, notes, events, tasks, entityLinks, normalizeFn }) {
  if (!message || !Array.isArray(entityLinks) || entityLinks.length === 0) return '';
  const explicit = extractWikilinks(message)
    .map(w => resolveLinkName(w.name, { notes, events, tasks }, normalizeFn))
    .filter(Boolean);
  const fuzzy = findEntityMentions(message, { notes, events }, normalizeFn);
  const seen = new Set();
  const sources = [];
  for (const e of [...explicit, ...fuzzy]) {
    if (!e) continue;
    const key = `${e.type}:${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(e);
    if (sources.length >= 3) break;
  }
  if (sources.length === 0) return '';

  function fetchEntity(type, id) {
    if (type === 'note') { const n = notes.find(x => x.id === id); return n ? { type, id, title: n.name, body: stripNoteHtml(n.content || '') } : null; }
    if (type === 'event') { const ev = events.find(x => x.id === id); return ev ? { type, id, title: ev.title, body: ev.description || '' } : null; }
    if (type === 'task') { const t = tasks.find(x => x.id === id); return t ? { type, id, title: t.title, body: '' } : null; }
    return null;
  }
  function neighborsOf(src) {
    const n = [];
    for (const l of entityLinks) {
      if (l.origin === 'rejected') continue;
      if (l.source_type === src.type && l.source_id === src.id) n.push(fetchEntity(l.target_type, l.target_id));
      else if (l.target_type === src.type && l.target_id === src.id) n.push(fetchEntity(l.source_type, l.source_id));
    }
    return n.filter(Boolean).slice(0, 5);
  }

  const blocks = [];
  let totalChars = 0;
  const HARD_CAP = 4500;
  for (const src of sources) {
    if (totalChars >= HARD_CAP) break;
    const srcFull = fetchEntity(src.type, src.id);
    if (!srcFull) continue;
    const lines = [`LINKED CONTEXT FOR "${truncateWithEllipsis(srcFull.title, 60)}" (${srcFull.type}):`];
    if (srcFull.body) lines.push(`  - source body: ${truncateWithEllipsis(srcFull.body.replace(/\s+/g,' ').trim(), 300)}`);
    const nbrs = neighborsOf(srcFull);
    if (nbrs.length === 0) {
      lines.push('  - (no linked neighbors)');
    } else {
      for (const nb of nbrs) {
        if (totalChars >= HARD_CAP) break;
        const preview = truncateWithEllipsis((nb.body || '').replace(/\s+/g,' ').trim(), 300);
        const line = `  - linked ${nb.type}: "${truncateWithEllipsis(nb.title, 60)}"${preview ? ` — ${preview}` : ''}`;
        lines.push(line);
        totalChars += line.length;
      }
    }
    const block = lines.join('\n');
    blocks.push(block);
    totalChars += block.length;
  }
  if (blocks.length === 0) return '';
  return blocks.join('\n\n');
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
  const workspaceContext = options.workspaceContext || 'chat';
  const intentType = options.intentType || 'chat';
  const actionFocusedPrompt = intentType === 'action';
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
  // Build a compact "link graph index" so the model knows which entities are
  // connected without paying the token cost of full linked content.
  const entityLinks = Array.isArray(options.entityLinks) ? options.entityLinks : [];
  const graphIndexLines = (() => {
    if (entityLinks.length === 0) return [];
    const counts = new Map(); // key: type:id → { title, type, neighbors: { note:0, event:0, task:0 } }
    function nameOf(type, id) {
      if (type === 'note') return notes.find(n => n.id === id)?.name;
      if (type === 'event') return events.find(e => e.id === id)?.title;
      if (type === 'task') return tasks.find(t => t.id === id)?.title;
      return null;
    }
    function bump(type, id, otherType) {
      const key = `${type}:${id}`;
      let bucket = counts.get(key);
      if (!bucket) {
        const title = nameOf(type, id);
        if (!title) return;
        bucket = { title, type, neighbors: { note: 0, event: 0, task: 0 } };
        counts.set(key, bucket);
      }
      bucket.neighbors[otherType] = (bucket.neighbors[otherType] || 0) + 1;
    }
    for (const l of entityLinks) {
      if (l.origin === 'rejected') continue;
      bump(l.source_type, l.source_id, l.target_type);
      bump(l.target_type, l.target_id, l.source_type);
    }
    const sorted = [...counts.values()].sort((a, b) => {
      const ta = a.neighbors.note + a.neighbors.event + a.neighbors.task;
      const tb = b.neighbors.note + b.neighbors.event + b.neighbors.task;
      return tb - ta;
    });
    return sorted.map(b => {
      const parts = [];
      if (b.neighbors.note) parts.push(`${b.neighbors.note} note${b.neighbors.note === 1 ? '' : 's'}`);
      if (b.neighbors.event) parts.push(`${b.neighbors.event} event${b.neighbors.event === 1 ? '' : 's'}`);
      if (b.neighbors.task) parts.push(`${b.neighbors.task} task${b.neighbors.task === 1 ? '' : 's'}`);
      return `- "${truncateWithEllipsis(b.title, 50)}" (${b.type}) ↔ ${parts.join(', ')}`;
    });
  })();
  if (notes.length > 0) {
    const sortOrder = { pdf: 0, google_docs: 1 };
    const sorted = notes.slice().sort((a, b) => (sortOrder[a.source] ?? 2) - (sortOrder[b.source] ?? 2));
    sorted.forEach(n => {
      const src = n.source === 'pdf' ? 'PDF' : n.source === 'google_docs' ? 'Google Doc' : 'study material';
      const preview = truncateWithEllipsis((n.content || '').replace(/\s+/g, ' ').trim(), actionFocusedPrompt ? 180 : 500);
      noteLines.push('- ' + n.name + ' (' + src + '): ' + preview);
    });
  }

  const notesBudget = actionFocusedPrompt ? 700 : CONTEXT_SECTION_BUDGETS.notes;
  const taskCapInfo = capLinesInfo(taskLines, CONTEXT_SECTION_BUDGETS.tasks, 'tasks');

  const recentActionsLines = (options.recentlyExecutedActions || [])
    .map(a => '- ' + a.type.replace(/_/g, ' ') + ': ' + a.summary);

  const fullDynamicSections = [
    'DYNAMIC CONTEXT:',
    'TODAY: ' + todayStr + ' (' + (currentHour >= 12 ? 'afternoon' : 'morning') + ')',
    '',
    'TODAY\'S SCHEDULE:',
    capLines(summarizeBlockSlots(todayBlocks), CONTEXT_SECTION_BUDGETS.schedule, 'schedule blocks') || '(nothing scheduled)',
    '',
    'ACTIVE TASKS (budgeted):',
    taskCapInfo.text || '(none)',
    (overdueTasks.length > 0 ? ('OVERDUE: ' + overdueTasks.map(t => truncateWithEllipsis(t.title, 80) + ' (' + Math.abs(daysUntil(t.dueDate)) + 'd late)').join(', ')) : ''),
    ...(recentActionsLines.length > 0 ? ['', 'RECENTLY COMPLETED ACTIONS (do not re-ask about these):', recentActionsLines.join('\n')] : []),
    ...(() => {
      const timers = options.activeTimers || [];
      if (!timers.length) return [];
      const now = Date.now();
      const lines = timers.map(t => {
        const secsLeft = Math.max(0, Math.round((t.fireAt - now) / 1000));
        const human = secsLeft >= 3600 ? `${Math.floor(secsLeft/3600)}h ${Math.round((secsLeft%3600)/60)}m left`
          : secsLeft >= 60 ? `${Math.round(secsLeft/60)} min left`
          : `${secsLeft}s left`;
        return `- "${t.label}" (${human})`;
      });
      return ['', 'ACTIVE TIMERS (use cancel_timer to stop one):', ...lines];
    })(),
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
    capLines(noteLines, notesBudget, 'note previews') || '(none)',
    ...(graphIndexLines.length > 0 ? ['', 'LINK GRAPH INDEX (compact, neighbors only):', capLines(graphIndexLines, 400, 'links')] : []),
    '',
    'MODE FLAGS:',
    '- workspace_context: ' + workspaceContext,
    '- intent_type: ' + intentType,
    options.responseStyle && options.responseStyle !== 'balanced'
      ? '- response_style: ' + options.responseStyle + (options.responseStyle === 'concise' ? ' (keep replies to 1-2 sentences)' : ' (provide thorough explanations)')
      : '',
  ].filter(Boolean).join('\n');

  const conversationalDynamicSections = [
    'DYNAMIC CONTEXT:',
    'TODAY: ' + todayStr,
    'TASKS: ' + activeTasks.length + (overdueTasks.length > 0 ? ` active (${overdueTasks.length} overdue)` : ' active'),
    'UPCOMING EVENTS: ' + upcomingEvents.length,
    'WORKSPACE: ' + workspaceContext,
    options.responseStyle && options.responseStyle !== 'balanced' ? 'STYLE: ' + options.responseStyle : '',
  ].filter(Boolean).join('\n');

  const contextBlock = intentType === 'chat'
    ? truncateWithEllipsis(dedupeRepeatedLines(conversationalDynamicSections), CONVERSATIONAL_CONTEXT_CHAR_BUDGET)
    : truncateWithEllipsis(dedupeRepeatedLines(fullDynamicSections), SYSTEM_PROMPT_CHAR_BUDGET);

  const stablePolicyTier1 = `STABLE POLICY (${SYSTEM_PROMPT_VERSION})
You are SOS — a sharp, laid-back study sidekick who gets student life: the 11pm panic, the procrastination spiral, pulling up SparkNotes 10 minutes before class. You're not a professor — you're the friend who actually gets it. Match the student's tone: brief when they're brief, casual when they're casual, calm when they're stressed. No hollow openers — just respond like a person. Keep replies short (2-3 sentences max).
Never invent tasks/events/deadlines that are not present in dynamic context.
If schedule/tasks are clear, say so directly.
If student asks about note content, reference only available notes and ask a focused follow-up when details are missing.`;

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

  const baseModules = [
    POLICY_MODULES.core,
    POLICY_MODULES.no_hallucination,
    POLICY_MODULES.workspace,
    POLICY_MODULES.clarification,
    POLICY_MODULES.clarification_style,
  ];
  const intentModules = intentType === 'chat'
    ? [
        POLICY_MODULES.conversational_capabilities,
      ]
    : [
        POLICY_MODULES.action_tools,
        POLICY_MODULES.planning_guardrails,
        POLICY_MODULES.corrections,
        POLICY_MODULES.date_resolution,
        POLICY_MODULES.vision,
        POLICY_MODULES.timers,
        POLICY_MODULES.notes_flow,
      ];
  const stablePolicyTier2 = `STABLE POLICY (${SYSTEM_PROMPT_VERSION})
${[...baseModules, ...intentModules].map((line) => '- ' + line).join('\n')}`;

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
const CONTENT_TYPES = ['create_flashcards','create_outline','create_summary','create_quiz','create_project_breakdown','make_plan','make_intent_plan','make_study_pack'];
const STUDY_PACK_REGEX = /\bstudy\s?packs?\b|\bstudy\s?sets?\b/i;
const CONTENT_GEN_REGEX = /flashcards?|outline|summar|quiz\s+me|make\s+(?:me\s+)?(?:a\s+)?quiz|create\s+(?:a\s+)?quiz|practice\s*questions?|project\s*breakdown|review\s*sheet|cheat\s*sheet/i;
const PLANNING_REGEX = /\b(study\s*plan|study\s*guide|plan\s+(my|for|out|this)|exam\s+prep|prep\s+for|plan\s+to\s+study|make\s+(?:me\s+)?a\s+plan|create\s+(?:a\s+)?(?:study\s+)?plan)\b/i;
const INTENT_PLAN_REGEX = /\b(survive\s+finals|finals\s+week|help\s+me\s+(survive|balance|prepare|get\s+through)|improve\s+(my\s+)?(?:chinese|mandarin|spanish|french|korean|japanese|german|language|speaking|math|coding|programming)|build\s+a\s+routine|create\s+a\s+routine|set\s+up\s+(?:a\s+)?routine|balance\s+(?:my\s+)?(?:life|school|work|coding)|plan\s+(?:my\s+)?(?:week|month|semester)|semester\s+plan|weekly\s+(?:routine|schedule|plan))\b/i;

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
    case 'create_project_breakdown':
      return Array.isArray(action.phases) && action.phases.length > 0 && action.phases.every(p => typeof p?.phase === 'string' && isStringArray(p?.tasks, 1));
    case 'make_plan':
      return typeof action.title === 'string' && Array.isArray(action.steps) && action.steps.length > 0 && action.steps.every(s => typeof s?.title === 'string');
    case 'make_study_pack':
      return typeof action.title === 'string'
        && Array.isArray(action.flashcards) && action.flashcards.length > 0 && action.flashcards.every(c => typeof c?.q === 'string' && typeof c?.a === 'string')
        && Array.isArray(action.quiz) && action.quiz.length > 0 && action.quiz.every(q => typeof q?.q === 'string' && isStringArray(q?.choices, 2) && typeof q?.answer === 'string');
    default:
      return false;
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

  // Negations: "I don't have a test today" should NOT create anything.
  if (/\b(don'?t|do\s+not|never|no(?:\s+longer|t)\b)\s+(have|need|got|gotta|want)\b/i.test(text)) return null;

  const eventWords = /\b(test|exam|quiz|midterm|final|game|match|practice|rehearsal|tryout|meet|tournament|scrimmage|recital|concert|lesson|appointment|meeting|class|interview|workshop|seminar|orientation|deadline)\b/i;
  const taskWords = /\b(hw|homework|essay|project|paper|assignment|lab|report|presentation|deck|slides|writeup|outline|draft|chapter|chapters|reading|worksheet|pset|problem\s+set|finish|complete|do|write|study)\b/i;

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

  // Try to build a title — strip scheduling noise + statement-form openers
  let title = text.trim()
    .replace(/\b(hey|so|um|btw|just|fyi|also)\b[\s,]*/gi, ' ')
    .replace(/\b(add|create|schedule|put|mark|set\s*up|log|i\s+have|i'?ve\s+got|ive\s+got|i\s+just\s+got|i\s+just\s+found\s+out|there'?s\s+a|got|gotta|need\s*to|have\s*to|hafta|i'?m\s+supposed\s+to|supposed\s+to|remind\s+me\s+to|remind\s+me\s+about|on|at|by|due|this|next|my|a|an|the|for|to)\b/gi, ' ')
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
        options: { redirectTo: buildOAuthRedirectUrl(window.location.href) }
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
function ConfirmationCard({ action, onConfirm, onCancel, isFallback }) {
  const [editing, setEditing] = useState(!!isFallback);
  const [editingField, setEditingField] = useState(null); // P1.3: inline field editing
  const [editData, setEditData] = useState({});
  useEffect(() => { setEditData({ ...action }); }, [action]);

  // P1.3: field type map for inline editing
  const fieldTypes = { due:'date', due_date:'date', date:'date', estimated_minutes:'number', start:'time', end:'time', time:'time' };

  function getCardInfo() {
    switch (action.type) {
      case 'add_task': return { icon:Icon.clipboard(16), label:'New Task', badge:'task', badgeColor:'var(--accent)', borderColor:'var(--accent)', bgTint:'rgba(108,99,255,0.03)', fields: [
        { key:'task_name', label:'Title', value:action.task_name||action.title, editable:true }, { key:'subject', label:'Class', value:action.subject||'—', editable:true },
        { key:'due_date', label:'Due', value:(action.due_date||action.due)?fmt(action.due_date||action.due):'No date', editable:true }, { key:'estimated_minutes', label:'Time', value:(action.estimated_minutes||30)+' min', editable:true }
      ]};
      case 'add_event': return { icon:Icon.calendar(16), label:'New Event', badge:'event', badgeColor:'var(--teal)', borderColor:'var(--teal)', bgTint:'rgba(43,203,186,0.03)', fields: [
        { key:'title', label:'Event', value:action.title, editable:true }, { key:'date', label:'Date', value:action.date?fmt(action.date):'No date', editable:true },
        { key:'event_type', label:'Type', value:action.event_type||'other', editable:true }, { key:'subject', label:'Class', value:action.subject||'—', editable:true },
        ...((action.time || action.startTime) ? [{ key:'time', label:'Time', value:(action.time||action.startTime) + ((action.endTime||action.end_time) ? ' — ' + (action.endTime||action.end_time) : '') }] : [])
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
  const isEditFlow = ['update_event','convert_event_to_block','convert_block_to_event','edit_note'].includes(action.type);
  const hasEdits = Object.keys(editData).some(k => k !== 'type' && editData[k] !== action[k]);

  return (
    <div className={'confirm-card sos-confirm-card' + (isEditFlow ? ' confirm-card-edit-flow' : '')} data-action={action.type} style={{borderLeftColor:info.borderColor,background:info.bgTint?`linear-gradient(160deg,${info.bgTint},rgba(15,15,30,0.92))`:''}}>
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
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Title</span><input className="confirm-edit-input" value={editData.task_name||editData.title||''} onChange={e=>setEditData(p=>({...p,task_name:e.target.value}))}/></div>
            <div className="confirm-edit-row"><span style={{fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600,width:52,textTransform:'uppercase',letterSpacing:'0.5px',flexShrink:0}}>Due</span><input className="confirm-edit-input" type="date" value={editData.due_date||editData.due||''} onChange={e=>setEditData(p=>({...p,due_date:e.target.value}))}/></div>
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

/* ═══════════════════════════════════════════════
   STRUCTURED CLARIFICATION (multi-field, direct-merge)
   ═══════════════════════════════════════════════ */

// Maps a missing field name to the input control we want to render for it.
// 'time' is special: it drives a two-thumb time-range slider that also writes endTime.
const FIELD_INPUT_TYPES = {
  title: 'text', task_name: 'text', activity: 'text', new_title: 'text',
  date: 'date', due_date: 'date', due: 'date', start_date: 'date', end_date: 'date',
  time: 'time-range', start: 'time', end: 'time',
  subject: 'subject-picker',
  event_type: 'event-type-picker',
  category: 'category-picker',
};

const SUBJECT_QUICK_PICKS = [
  'Mathematics', 'Calculus', 'Biology', 'Chemistry', 'Physics',
  'English', 'Literature', 'History', 'Spanish', 'Computer Science',
];

const EVENT_TYPE_QUICK_PICKS = [
  { id: 'test', label: 'Test' },
  { id: 'exam', label: 'Exam' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'practice', label: 'Practice' },
  { id: 'game', label: 'Game' },
  { id: 'event', label: 'Other' },
];

const FIELD_LABELS = {
  title: 'Title', task_name: 'Title', activity: 'Activity', new_title: 'New title',
  date: 'Date', due_date: 'Due date', due: 'Due date', start_date: 'Start date', end_date: 'End date',
  time: 'Time', start: 'Start time', end: 'End time',
  subject: 'Subject', event_type: 'Type', category: 'Category',
};

const ACTION_SCHEMAS = {
  add_event: {
    required: ['title', 'date'],
    recommended: ['event_type'],
    optional: ['subject', 'time', 'end_time', 'description', 'location', 'priority'],
  },
  add_task: {
    required: ['title', 'due_date'],
    recommended: ['subject'],
    optional: ['est_time', 'priority', 'description'],
  },
  add_note: {
    required: ['title', 'subject', 'source'],
    recommended: [],
    optional: ['content'],
  },
  set_timer: {
    required: ['label'],
    recommended: ['duration_seconds'],
    optional: ['fire_at', 'preset'],
  },
};

function readField(action, key) {
  if (action == null) return undefined;
  const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (action[key] !== undefined && action[key] !== null && String(action[key]).trim() !== '') return action[key];
  if (action[camel] !== undefined && action[camel] !== null && String(action[camel]).trim() !== '') return action[camel];
  if (key === 'title' && action.task_name) return action.task_name;
  if (key === 'due_date' && action.due) return action.due;
  return undefined;
}

function validateActionSchema(action) {
  const schema = ACTION_SCHEMAS[action?.type];
  if (!schema) return { valid: true, missing_required: [], missing_recommended: [] };
  const missing = (keys) => keys.filter(k => readField(action, k) === undefined);
  const missing_required = missing(schema.required);
  const missing_recommended = missing(schema.recommended);
  return { valid: missing_required.length === 0, missing_required, missing_recommended };
}

function defaultsForAction(actionType) {
  if (actionType === 'add_event') return { event_type: 'other', subject: '', time: null, end_time: null };
  if (actionType === 'add_task')  return { subject: '', est_time: 30, priority: 'medium' };
  return {};
}

function valueForAssumption(field, clarification) {
  const sd = clarification?.suggested_defaults?.[field];
  if (sd !== undefined && sd !== null) return sd;
  const d = defaultsForAction(clarification?.context_action)[field];
  return d !== undefined ? d : null;
}

function buildLocalClarification({ contextAction, knownFields = {}, missingFields = [], message, suggestedDefaults = {}, optionsByField = {} }) {
  const checklist = missingFields.map(f => ({
    field: f,
    status: 'pending',
    value: null,
    options: Array.isArray(optionsByField[f]) ? optionsByField[f].slice(0, 6) : null,
  }));
  return {
    question: message || `A few details for this ${contextAction.replace(/_/g, ' ')}.`,
    context_action: contextAction,
    known_fields: knownFields,
    missing_fields: missingFields,
    suggested_defaults: suggestedDefaults,
    checklist,
    multi_field: true,
  };
}

function TimeRangeSlider({ start, end, onChange }) {
  const STEP = 15;          // 15-minute increments
  const MIN_MIN = 6 * 60;   // 6 AM
  const MAX_MIN = 23 * 60;  // 11 PM
  const toMins = (hhmm) => {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const toHHMM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const toLabel = (mins) => {
    const h = Math.floor(mins / 60), m = mins % 60;
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  };
  const startMin = toMins(start) ?? 17 * 60;
  const endMin = toMins(end) ?? Math.min(startMin + 60, MAX_MIN);
  const handleStart = (v) => {
    const newStart = Math.max(MIN_MIN, Math.min(Number(v), MAX_MIN - STEP));
    const newEnd = newStart >= endMin ? Math.min(newStart + STEP, MAX_MIN) : endMin;
    onChange(toHHMM(newStart), toHHMM(newEnd));
  };
  const handleEnd = (v) => {
    const newEnd = Math.max(MIN_MIN + STEP, Math.min(Number(v), MAX_MIN));
    const newStart = newEnd <= startMin ? Math.max(newEnd - STEP, MIN_MIN) : startMin;
    onChange(toHHMM(newStart), toHHMM(newEnd));
  };
  const totalMins = Math.max(0, endMin - startMin);
  const hours = Math.floor(totalMins / 60), mins = totalMins % 60;
  const durationLabel = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
  const startPct = ((startMin - MIN_MIN) / (MAX_MIN - MIN_MIN)) * 100;
  const endPct = ((endMin - MIN_MIN) / (MAX_MIN - MIN_MIN)) * 100;
  return (
    <div style={{padding:'4px 0 8px'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10, fontSize:'0.92rem'}}>
        <span style={{color:'var(--teal)', fontWeight:700}}>{toLabel(startMin)}</span>
        <span style={{fontSize:'0.74rem', color:'var(--text-dim)', fontWeight:600}}>{durationLabel}</span>
        <span style={{color:'var(--teal)', fontWeight:700}}>{toLabel(endMin)}</span>
      </div>
      <div style={{position:'relative', height:36}}>
        <div style={{position:'absolute', top:16, left:0, right:0, height:4, background:'rgba(255,255,255,0.08)', borderRadius:2}}/>
        <div style={{position:'absolute', top:16, height:4, borderRadius:2, background:'var(--teal)', left:`${startPct}%`, width:`${endPct - startPct}%`}}/>
        <input type="range" min={MIN_MIN} max={MAX_MIN} step={STEP} value={startMin}
          onChange={(e) => handleStart(e.target.value)}
          style={{position:'absolute', top:0, left:0, width:'100%', height:36, background:'transparent', appearance:'none', WebkitAppearance:'none', pointerEvents:'auto'}}
          className="sos-time-range-input"/>
        <input type="range" min={MIN_MIN} max={MAX_MIN} step={STEP} value={endMin}
          onChange={(e) => handleEnd(e.target.value)}
          style={{position:'absolute', top:0, left:0, width:'100%', height:36, background:'transparent', appearance:'none', WebkitAppearance:'none', pointerEvents:'auto'}}
          className="sos-time-range-input"/>
      </div>
    </div>
  );
}

function FieldInput({ field, value, secondaryValue, onChange, options }) {
  const inputType = FIELD_INPUT_TYPES[field] || 'text';
  // AI-supplied options take precedence over the default control: render up to 6 chips.
  if (Array.isArray(options) && options.length > 0) {
    const visible = options.slice(0, 6);
    return (
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {visible.map(opt => {
          const selected = String(value || '').toLowerCase() === String(opt).toLowerCase();
          return (
            <button key={opt} onClick={() => onChange(opt)} style={{
              background: selected ? 'rgba(108,99,255,0.18)' : 'rgba(255,255,255,0.05)',
              border: selected ? '1px solid rgba(108,99,255,0.45)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600,
              color: selected ? 'var(--accent)' : 'var(--text)', cursor: 'pointer',
            }}>{opt}</button>
          );
        })}
      </div>
    );
  }
  if (inputType === 'date') {
    const todayStr = today();
    const tomorrow = new Date(todayStr + 'T12:00:00'); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = toDateStr(tomorrow);
    const inWeek = new Date(todayStr + 'T12:00:00'); inWeek.setDate(inWeek.getDate() + 7);
    const inWeekStr = toDateStr(inWeek);
    const quicks = [
      { label: 'Today', val: todayStr },
      { label: 'Tomorrow', val: tomorrowStr },
      { label: 'In a week', val: inWeekStr },
    ];
    return (
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
          {quicks.map(q => (
            <button key={q.val} onClick={() => onChange(q.val)} style={{
              background: value === q.val ? 'rgba(43,203,186,0.18)' : 'rgba(255,255,255,0.05)',
              border: value === q.val ? '1px solid rgba(43,203,186,0.45)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600,
              color: value === q.val ? 'var(--teal)' : 'var(--text)', cursor: 'pointer',
            }}>{q.label}</button>
          ))}
        </div>
        <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)}
          style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, color:'var(--text)', fontSize:'0.86rem', padding:'8px 10px', outline:'none', colorScheme:'dark'}}/>
      </div>
    );
  }
  if (inputType === 'time-range') {
    return <TimeRangeSlider start={value} end={secondaryValue} onChange={(s, e) => onChange(s, e)}/>;
  }
  if (inputType === 'subject-picker') {
    const isCustom = value && !SUBJECT_QUICK_PICKS.some(s => s.toLowerCase() === String(value).toLowerCase());
    return (
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
          {SUBJECT_QUICK_PICKS.map(s => {
            const selected = value && value.toLowerCase() === s.toLowerCase();
            return (
              <button key={s} onClick={() => onChange(s.toLowerCase())} style={{
                background: selected ? 'rgba(108,99,255,0.18)' : 'rgba(255,255,255,0.05)',
                border: selected ? '1px solid rgba(108,99,255,0.45)' : '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600,
                color: selected ? 'var(--accent)' : 'var(--text)', cursor: 'pointer',
              }}>{s}</button>
            );
          })}
        </div>
        <input type="text" value={isCustom ? value : ''} onChange={(e) => onChange(e.target.value)}
          placeholder="Or type a custom subject"
          style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, color:'var(--text)', fontSize:'0.86rem', padding:'8px 10px', outline:'none'}}/>
      </div>
    );
  }
  if (inputType === 'event-type-picker') {
    return (
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {EVENT_TYPE_QUICK_PICKS.map(t => {
          const selected = value === t.id;
          return (
            <button key={t.id} onClick={() => onChange(t.id)} style={{
              background: selected ? 'rgba(43,203,186,0.18)' : 'rgba(255,255,255,0.05)',
              border: selected ? '1px solid rgba(43,203,186,0.45)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600,
              color: selected ? 'var(--teal)' : 'var(--text)', cursor: 'pointer',
            }}>{t.label}</button>
          );
        })}
      </div>
    );
  }
  // Default: free-text input (title, task_name, activity)
  return (
    <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)}
      placeholder={field === 'task_name' || field === 'title' ? 'e.g. Physics problem set' : 'Type here…'}
      style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, color:'var(--text)', fontSize:'0.92rem', padding:'10px 12px', outline:'none', width:'100%'}}/>
  );
}

function MultiFieldClarificationCard({ clarification, onSubmit, onSkip, savedAnswers, onAnswersChange }) {
  const { context_action, known_fields = {}, missing_fields = [], question, suggested_defaults = {}, checklist = [] } = clarification || {};
  const optionsFor = (field) => {
    const fromChecklist = checklist.find(c => c.field === field)?.options;
    return Array.isArray(fromChecklist) && fromChecklist.length > 0 ? fromChecklist.slice(0, 6) : null;
  };
  const initialValues = () => {
    const init = {};
    if (missing_fields.includes('time')) { init.time = '17:00'; init.endTime = '18:00'; }
    for (const [k, v] of Object.entries(suggested_defaults || {})) {
      if (missing_fields.includes(k) && !(k in init) && v !== undefined && v !== null && v !== '') init[k] = v;
    }
    return init;
  };
  const [fieldValues, setFieldValues] = useState(() =>
    (savedAnswers && typeof savedAnswers === 'object' && !Array.isArray(savedAnswers))
      ? savedAnswers : initialValues()
  );
  const [fieldStatuses, setFieldStatuses] = useState(() => {
    const s = {};
    for (const f of missing_fields) s[f] = 'pending';
    return s;
  });
  const [stepIdx, setStepIdx] = useState(0);
  const ctxKey = `${context_action}|${missing_fields.join(',')}`;
  useEffect(() => {
    if (savedAnswers && typeof savedAnswers === 'object' && !Array.isArray(savedAnswers)) return;
    setFieldValues(initialValues());
    const s = {}; for (const f of missing_fields) s[f] = 'pending'; setFieldStatuses(s);
    setStepIdx(0);
  }, [ctxKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField(name, value, secondary) {
    setFieldValues(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'time' && secondary !== undefined) next.endTime = secondary;
      if (onAnswersChange) onAnswersChange(next);
      return next;
    });
    setFieldStatuses(prev => ({ ...prev, [name]: 'answered' }));
  }

  const totalSteps = missing_fields.length;
  const currentField = missing_fields[stepIdx];
  const currentValue = fieldValues[currentField];
  const currentFilled = currentValue !== undefined && currentValue !== null && String(currentValue).trim().length > 0;
  const allFilled = missing_fields.every(f => {
    const v = fieldValues[f];
    return v !== undefined && v !== null && String(v).trim().length > 0;
  });
  const isLast = stepIdx === totalSteps - 1;

  function submitAll(values) {
    onSubmit({ context_action, known_fields, field_values: values, statuses: fieldStatuses, multi_field: true });
  }

  function handleNext() {
    if (!currentFilled) return;
    if (isLast) submitAll(fieldValues);
    else setStepIdx(i => i + 1);
  }

  function handleAssume() {
    const v = valueForAssumption(currentField, clarification);
    const next = { ...fieldValues, [currentField]: v == null ? '' : v };
    if (currentField === 'time' && (v == null || v === '')) {
      next.time = '17:00'; next.endTime = '18:00';
    }
    setFieldValues(next);
    setFieldStatuses(prev => ({ ...prev, [currentField]: 'assumed' }));
    if (onAnswersChange) onAnswersChange(next);
    if (isLast) submitAll(next);
    else setStepIdx(i => i + 1);
  }

  const assumeAvailable = (() => {
    const v = valueForAssumption(currentField, clarification);
    return v !== null && v !== undefined;
  })();

  const labelFor = (f) => FIELD_LABELS[f] || f.replace(/_/g, ' ');

  const dots = missing_fields.map((_, i) => {
    const f = missing_fields[i];
    const status = fieldStatuses[f] || 'pending';
    const v = fieldValues[f];
    const filled = v !== undefined && v !== null && String(v).trim().length > 0;
    const active = i === stepIdx;
    let bg = 'rgba(255,255,255,0.12)';
    if (active) bg = 'var(--accent)';
    else if (status === 'assumed') bg = 'rgba(108,99,255,0.45)';
    else if (filled) bg = 'rgba(255,255,255,0.35)';
    return (
      <button key={i} onClick={() => setStepIdx(i)} style={{
        width: active ? 20 : 7, height:7,
        borderRadius:4, border:'none', padding:0, cursor:'pointer',
        background: bg, transition:'width 0.2s, background 0.2s',
      }}/>
    );
  });

  return (
    <div className="sos-clarification-card sos-clarification-card-multi" role="dialog" style={{
      background:'rgba(22,22,36,0.98)', border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:18, padding:0, maxWidth:460, width:'100%',
      boxShadow:'0 8px 32px rgba(0,0,0,0.4)', overflow:'hidden',
    }}>
      {/* Header */}
      <div style={{padding:'18px 20px 10px', display:'flex', alignItems:'flex-start', gap:12}}>
        <div style={{flex:1}}>
          <div style={{fontSize:'0.7rem', color:'var(--text-dim)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4}}>
            {question || 'A few quick details'} · {stepIdx + 1} of {totalSteps}
          </div>
          <div style={{fontSize:'1.05rem', fontWeight:700, color:'var(--text)', lineHeight:1.3}}>
            {labelFor(currentField)}
          </div>
        </div>
        <button onClick={onSkip} style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)', padding:'2px 6px', fontSize:'1.1rem', lineHeight:1}}>×</button>
      </div>

      {/* Known fields summary chips */}
      {Object.keys(known_fields).length > 0 && (
        <div style={{padding:'0 20px 8px', display:'flex', flexWrap:'wrap', gap:5}}>
          {Object.entries(known_fields).map(([k, v]) => (
            <span key={k} style={{
              fontSize:'0.68rem', color:'var(--text-dim)', background:'rgba(255,255,255,0.04)',
              padding:'2px 7px', borderRadius:10, border:'1px solid rgba(255,255,255,0.06)',
            }}>{labelFor(k)}: <span style={{color:'var(--text)'}}>{String(v)}</span></span>
          ))}
        </div>
      )}

      {/* Completed steps summary */}
      {stepIdx > 0 && (
        <div style={{padding:'0 20px 8px', display:'flex', flexWrap:'wrap', gap:5}}>
          {missing_fields.slice(0, stepIdx).map(f => {
            const v = fieldValues[f];
            if (v === undefined || v === null || String(v).trim().length === 0) return null;
            return (
              <button key={f} onClick={() => setStepIdx(missing_fields.indexOf(f))} style={{
                fontSize:'0.68rem', color:'rgba(255,255,255,0.6)', background:'rgba(255,255,255,0.06)',
                padding:'2px 7px', borderRadius:10, border:'1px solid rgba(255,255,255,0.10)',
                cursor:'pointer', fontFamily:'inherit',
              }}>{labelFor(f)}: <span style={{color:'var(--text)'}}>{f === 'time' ? `${v}${fieldValues.endTime ? ' — ' + fieldValues.endTime : ''}` : String(v)}</span> ✎</button>
            );
          })}
        </div>
      )}

      <div style={{padding:'10px 20px 18px', borderTop:'1px solid rgba(255,255,255,0.06)'}}>
        <FieldInput
          field={currentField}
          value={currentValue}
          secondaryValue={currentField === 'time' ? fieldValues.endTime : undefined}
          onChange={(v, secondary) => setField(currentField, v, secondary)}
          options={optionsFor(currentField)}
        />
        {assumeAvailable && (
          <button onClick={handleAssume} style={{
            marginTop:10, background:'transparent', border:'1px dashed rgba(255,255,255,0.18)',
            borderRadius:8, padding:'6px 10px', color:'var(--text-dim)', fontSize:'0.78rem',
            fontWeight:600, cursor:'pointer',
          }}>Let AI decide</button>
        )}
      </div>

      <div style={{display:'flex', alignItems:'center', gap:8, padding:'8px 16px 14px', borderTop:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{display:'flex', alignItems:'center', gap:4, flex:'0 0 auto'}}>
          {dots}
        </div>
        <div style={{flex:1}}/>
        {stepIdx > 0 && (
          <button onClick={() => setStepIdx(i => i - 1)} style={{
            background:'transparent', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'8px 14px', color:'var(--text-dim)', fontSize:'0.84rem', fontWeight:600, cursor:'pointer',
          }}>← Back</button>
        )}
        <button onClick={onSkip} style={{
          background:'transparent', border:'1px solid rgba(255,255,255,0.1)',
          borderRadius:8, padding:'8px 14px', color:'var(--text-dim)', fontSize:'0.84rem', fontWeight:600, cursor:'pointer',
        }}>Skip</button>
        <button onClick={handleNext} disabled={!currentFilled} style={{
          background: currentFilled ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
          border: currentFilled ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
          borderRadius:8, padding:'8px 18px',
          color: currentFilled ? '#fff' : 'rgba(255,255,255,0.3)',
          fontSize:'0.86rem', fontWeight:700, cursor: currentFilled ? 'pointer' : 'default',
        }}>{isLast ? 'Add it →' : 'Next →'}</button>
      </div>
    </div>
  );
}

function SubjectChipGroup({ subjects, value, otherText, onPick, onOtherText }) {
  const [expanded, setExpanded] = useState(false);
  const list = subjects.filter(s => s.toLowerCase() !== 'other');
  const visible = expanded ? list : list.slice(0, 6);
  const isOther = value === 'other';
  return (
    <div style={{flex:1, display:'flex', flexDirection:'column', gap:6}}>
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {visible.map(s => {
          const selected = String(value || '').toLowerCase() === s.toLowerCase();
          return (
            <button key={s} onClick={() => onPick(s)} style={{
              background: selected ? 'rgba(108,99,255,0.18)' : 'rgba(255,255,255,0.05)',
              border: selected ? '1px solid rgba(108,99,255,0.45)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, padding: '4px 10px', fontSize: '0.76rem', fontWeight: 600,
              color: selected ? 'var(--accent)' : 'var(--text)', cursor: 'pointer',
            }}>{s}</button>
          );
        })}
        {!expanded && list.length > 6 && (
          <button onClick={() => setExpanded(true)} style={{
            background:'transparent', border:'1px dashed rgba(255,255,255,0.18)',
            borderRadius:16, padding:'4px 10px', fontSize:'0.76rem', fontWeight:600,
            color:'var(--text-dim)', cursor:'pointer',
          }}>More…</button>
        )}
        <button onClick={() => onPick('other')} style={{
          background: isOther ? 'rgba(108,99,255,0.18)' : 'rgba(255,255,255,0.05)',
          border: isOther ? '1px solid rgba(108,99,255,0.45)' : '1px dashed rgba(255,255,255,0.18)',
          borderRadius: 16, padding: '4px 10px', fontSize: '0.76rem', fontWeight: 600,
          color: isOther ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer',
        }}>Other</button>
      </div>
      {isOther && (
        <input type="text" value={otherText || ''} onChange={(e) => onOtherText(e.target.value)}
          placeholder="Type the subject"
          style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, color:'var(--text)', fontSize:'0.84rem', padding:'6px 10px', outline:'none'}}/>
      )}
    </div>
  );
}

function ClarificationCard({ clarification, onSubmit, onSkip, savedAnswers, onAnswersChange }) {
  // Support both single clarification and array of clarifications
  const clarifications = Array.isArray(clarification) ? clarification : [clarification];
  const questionCount = clarifications.length;

  // 'form' = answering all questions at once; 'review' = confirming before submit
  const [phase, setPhase] = useState('form');

  // Per-question state: selected options and free-form text
  const [answers, setAnswers] = useState(() =>
    savedAnswers && savedAnswers.length === clarifications.length
      ? savedAnswers
      : clarifications.map(() => ({ selected: [], otherText: '', dateValue: '', subjectValue: '' }))
  );

  const clarificationKey = clarifications.map(c => c.question).join('|||');

  useEffect(() => {
    if (!savedAnswers || savedAnswers.length !== clarifications.length) {
      setAnswers(clarifications.map(() => ({ selected: [], otherText: '', dateValue: '', subjectValue: '' })));
    }
    setPhase('form');
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
  function setDateValue(qIdx, dateValue) {
    updateAnswer(qIdx, cur => ({ ...cur, dateValue }));
  }
  function setSubjectValue(qIdx, subjectValue) {
    updateAnswer(qIdx, cur => ({ ...cur, subjectValue, otherText: subjectValue === 'other' ? cur.otherText : '' }));
  }

  function buildPayloads(answersArr) {
    return clarifications.map((c, i) => {
      const opts = Array.isArray(c?.options) ? c.options.map(normalizeOption) : [];
      return {
        selected: answersArr[i].selected,
        options: opts,
        otherText: answersArr[i].subjectValue === 'other'
          ? answersArr[i].otherText
          : (answersArr[i].subjectValue || answersArr[i].dateValue || answersArr[i].otherText),
        question: c?.question || '',
      };
    });
  }

  function getAnswerLabel(qIdx) {
    const a = answers[qIdx] || {};
    const c = clarifications[qIdx] || {};
    const opts = Array.isArray(c?.options) ? c.options.map(normalizeOption) : [];
    const selectedLabels = (a.selected || []).map(id => (opts.find(o => o.id === id) || {}).label).filter(Boolean);
    if (selectedLabels.length > 0) return selectedLabels.join(', ');
    if (a.subjectValue && a.subjectValue !== 'other') return a.subjectValue;
    if (a.dateValue) return a.dateValue;
    if (a.otherText && a.otherText.trim()) return a.otherText.trim();
    return null;
  }

  function isAnswered(qIdx) { return !!getAnswerLabel(qIdx); }

  const anyAnswered = answers.some((_, i) => isAnswered(i));
  const allAnswered = answers.every((_, i) => isAnswered(i));

  function handleProceed() {
    if (questionCount === 1) {
      onSubmit(buildPayloads(answers));
    } else {
      setPhase('review');
    }
  }

  function handleSubmitFinal() {
    onSubmit(buildPayloads(answers));
  }

  function handleClose() {
    if (onSkip) onSkip();
  }

  const subjectOptions = ['Mathematics', 'English', 'Biology', 'Chemistry', 'Physics', 'History', 'Language Arts', 'Spanish', 'French', 'Economics', 'Psychology', 'Government', 'Computer Science', 'Calculus', 'Literature', 'Physical Education', 'Other'];

  // ── Review phase ──────────────────────────────────────────────────────────
  if (phase === 'review') {
    return (
      <div className="sos-clarification-card" role="dialog" style={{
        background:'rgba(22,22,36,0.98)', border:'1px solid rgba(255,255,255,0.08)',
        borderRadius:18, padding:0, maxWidth:440, width:'100%',
        boxShadow:'0 8px 32px rgba(0,0,0,0.4)', overflow:'hidden',
      }}>
        <div style={{padding:'18px 20px 12px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontSize:'0.7rem', color:'var(--text-dim)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px'}}>Review your answers</div>
          <button onClick={handleClose} style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)', padding:'2px 6px', fontSize:'1.1rem', lineHeight:1}}>×</button>
        </div>
        <div style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          {clarifications.map((c, i) => {
            const label = getAnswerLabel(i);
            return (
              <div key={i} style={{padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)', display:'flex', alignItems:'flex-start', gap:12}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:'0.75rem', color:'var(--text-dim)', marginBottom:3}}>{c?.question}</div>
                  <div style={{fontSize:'0.9rem', color: label ? 'var(--text)' : 'rgba(255,255,255,0.25)', fontWeight: label ? 600 : 400}}>
                    {label || '(skipped)'}
                  </div>
                </div>
                <button onClick={() => setPhase('form')} style={{
                  background:'none', border:'none', cursor:'pointer',
                  fontSize:'0.72rem', color:'var(--accent)', fontWeight:600, padding:'2px 6px', flexShrink:0, marginTop:1,
                }}>Edit</button>
              </div>
            );
          })}
        </div>
        <div style={{padding:'12px 16px', display:'flex', gap:8}}>
          <button onClick={() => setPhase('form')} style={{
            background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'7px 14px', color:'var(--text-dim)',
            fontSize:'0.82rem', fontWeight:600, cursor:'pointer', flex:1,
          }}>← Back</button>
          <button onClick={handleSubmitFinal} disabled={!anyAnswered} style={{
            background: anyAnswered ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
            border: anyAnswered ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'7px 14px',
            color: anyAnswered ? '#fff' : 'rgba(255,255,255,0.25)',
            fontSize:'0.82rem', fontWeight:700, cursor: anyAnswered ? 'pointer' : 'default', flex:2,
            transition:'all .12s',
          }}>Submit all answers</button>
        </div>
      </div>
    );
  }

  // ── Form phase: all questions at once ────────────────────────────────────
  return (
    <div className="sos-clarification-card" role="dialog" aria-label="A few quick details" style={{
      background:'rgba(22,22,36,0.98)',
      border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:18,
      padding:0,
      maxWidth:440,
      width:'100%',
      boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
      overflow:'hidden',
    }}>
      {/* Header */}
      <div style={{padding:'18px 20px 12px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{fontSize:'1rem', fontWeight:700, color:'var(--text)'}}>
          {questionCount === 1 ? (clarifications[0]?.question || 'Can you clarify?') : 'A few quick details'}
        </div>
        <button onClick={handleClose} style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-dim)', padding:'2px 6px', fontSize:'1.1rem', lineHeight:1}}>×</button>
      </div>

      {/* All questions */}
      <div style={{borderTop:'1px solid rgba(255,255,255,0.06)', maxHeight:400, overflowY:'auto'}}>
        {clarifications.map((c, qIdx) => {
          const options = Array.isArray(c?.options) ? c.options : [];
          const multiSelect = !!c?.multiSelect || !!c?.multi_select;
          const inputType = (c?.inputType || c?.input_type || '').toLowerCase();
          const isDateInput = inputType === 'date' || /date|due|when/i.test(c?.question || '');
          const isSubjectInput = inputType === 'subject' || !!c?.subjectSelect || /subject|class/i.test(c?.question || '');
          const normalizedOpts = options.map(normalizeOption).filter(
            opt => !/^(other|something else|other\.\.\.|\.\.\.)$/i.test(opt.label.trim())
          );
          const answer = answers[qIdx] || { selected: [], otherText: '', dateValue: '', subjectValue: '' };
          const answered = isAnswered(qIdx);

          return (
            <div key={qIdx} style={{
              borderBottom: qIdx < questionCount - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              padding:'14px 20px',
            }}>
              {/* Question label (shown above for multi-question forms) */}
              {questionCount > 1 && (
                <div style={{
                  fontSize:'0.78rem', color: answered ? 'var(--teal)' : 'var(--text-dim)',
                  fontWeight:600, marginBottom:10, display:'flex', alignItems:'center', gap:6,
                }}>
                  {answered && <span style={{fontSize:'0.9rem'}}>✓</span>}
                  {c?.question || `Question ${qIdx + 1}`}
                </div>
              )}

              {/* Option chips */}
              {normalizedOpts.length > 0 && (
                <div style={{display:'flex', flexWrap:'wrap', gap:6, marginBottom: (isDateInput || isSubjectInput || c?.otherPlaceholder) ? 10 : 0}}>
                  {normalizedOpts.slice(0, 6).map(opt => {
                    const isSelected = answer.selected.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        onClick={() => toggleOption(qIdx, opt.id, multiSelect)}
                        style={{
                          background: isSelected ? 'rgba(43,203,186,0.15)' : 'rgba(255,255,255,0.06)',
                          border: isSelected ? '1px solid rgba(43,203,186,0.4)' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius:20, padding:'5px 12px',
                          fontSize:'0.82rem', fontWeight: isSelected ? 700 : 500,
                          color: isSelected ? 'var(--teal)' : 'var(--text-dim)',
                          cursor:'pointer', transition:'all .12s',
                        }}
                      >
                        {isSelected && '✓ '}{opt.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Text / date / subject input */}
              {isSubjectInput ? (
                <SubjectChipGroup
                  subjects={subjectOptions}
                  value={answer.subjectValue}
                  otherText={answer.otherText}
                  onPick={(v) => setSubjectValue(qIdx, v)}
                  onOtherText={(t) => setOtherText(qIdx, t)}
                />
              ) : (
                <input
                  type={isDateInput ? 'date' : 'text'}
                  value={isDateInput ? (answer.dateValue || '') : answer.otherText}
                  onChange={(e) => {
                    if (isDateInput) setDateValue(qIdx, e.target.value);
                    else setOtherText(qIdx, e.target.value);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && allAnswered) handleProceed(); }}
                  placeholder={isDateInput ? 'Select a date' : (c?.otherPlaceholder || (normalizedOpts.length > 0 ? 'Other…' : 'Type your answer…'))}
                  style={{
                    width:'100%', boxSizing:'border-box',
                    background:'rgba(255,255,255,0.04)',
                    border:'1px solid rgba(255,255,255,0.08)',
                    borderRadius:8, color:'var(--text-dim)',
                    fontSize:'0.84rem', outline:'none',
                    padding:'7px 10px', marginTop: normalizedOpts.length > 0 ? 0 : 0,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{padding:'10px 16px 12px', borderTop:'1px solid rgba(255,255,255,0.06)', display:'flex', gap:8}}>
        <button
          onClick={handleProceed}
          disabled={!anyAnswered}
          style={{
            background: anyAnswered ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
            border: anyAnswered ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'7px 16px',
            color: anyAnswered ? '#fff' : 'rgba(255,255,255,0.25)',
            fontSize:'0.82rem', fontWeight:700,
            cursor: anyAnswered ? 'pointer' : 'default',
            flex:2, transition:'all .12s',
          }}
        >
          {questionCount === 1 ? 'Submit' : (allAnswered ? 'Review answers →' : `Continue (${answers.filter((_,i) => isAnswered(i)).length}/${questionCount} answered)`)}
        </button>
        <button
          onClick={handleClose}
          style={{
            background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:8, padding:'7px 14px', color:'var(--text-dim)',
            fontSize:'0.82rem', fontWeight:600, cursor:'pointer', flex:1,
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
   PROPOSAL CARD
   Quick yes/no card surfaced when the conversational model calls propose_action.
   ═══════════════════════════════════════════════ */
function ProposalCard({ proposal, onApprove, onDismiss }) {
  const actionIcons = { add_event: '📅', add_task: '✅', add_block: '⏳', add_note: '📝' };
  const icon = actionIcons[proposal.action_type] || '✨';
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderLeft: '3px solid var(--accent)',
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '1.1rem' }}>{icon}</span>
        <span style={{ fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.4 }}>
          Want me to <strong style={{ color: 'var(--accent)' }}>{proposal.summary}</strong>?
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onApprove}
          style={{
            background: 'var(--accent)',
            color: '#000',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          Yes, do it
        </button>
        <button
          onClick={onDismiss}
          style={{
            background: 'rgba(255,255,255,0.07)',
            color: 'var(--text-dim)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'var(--text-dim)'; }}
        >
          Nah
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

/* ── SM-2 SRS helpers ──────────────────────────────────────────────── */
function srsCardKey(title, q) {
  return ('fc:' + (title || '') + ':' + (q || '')).slice(0, 120);
}
function srsLoad() {
  try { return JSON.parse(localStorage.getItem('sos-fc-schedule') || '{}'); } catch(_) { return {}; }
}
function srsSave(schedule) {
  try { localStorage.setItem('sos-fc-schedule', JSON.stringify(schedule)); } catch(_) {}
}
function srsDaysUntil(isoDate) {
  if (!isoDate) return null;
  const diff = new Date(isoDate) - new Date(new Date().toDateString());
  return Math.round(diff / 86400000);
}
function srsRate(cardKey, rating) {
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

function FlashcardDisplay({ data, onSave, onDismiss }) {
  const cards = data.cards || [];
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [lastInterval, setLastInterval] = useState(null);

  if (cards.length === 0) return <ContentCard icon={Icon.layers(16)} title={data.title||'Flashcards'} subject={data.subject} onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)"><div style={{color:'var(--text-dim)',fontSize:'0.85rem'}}>No cards yet — tell me what you're studying</div></ContentCard>;

  function goNext() { if (idx < cards.length - 1) { setFlipped(false); setLastInterval(null); setTimeout(() => setIdx(i => i + 1), 100); } }
  function goPrev() { if (idx > 0) { setFlipped(false); setLastInterval(null); setTimeout(() => setIdx(i => i - 1), 100); } }
  function rate(rating) {
    const key = srsCardKey(data.title, cards[idx]?.q);
    const interval = srsRate(key, rating);
    setLastInterval(interval);
    setTimeout(() => { setLastInterval(null); goNext(); }, 900);
  }

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
      {lastInterval !== null && (
        <div style={{textAlign:'center',fontSize:'0.76rem',color:'var(--teal)',animation:'fadeIn .2s ease',marginTop:4,fontStyle:'italic'}}>
          {lastInterval === 0 ? 'Back in the queue — you\'ll see this again today' : `Next review: in ${lastInterval} day${lastInterval===1?'':'s'}`}
        </div>
      )}
      <div className="fc-nav">
        <button className="fc-nav-btn" onClick={(e) => { e.stopPropagation(); goPrev(); }} disabled={idx === 0}>{Icon.chevronLeft(16)}</button>
        <span className="fc-counter">{idx + 1} / {cards.length}</span>
        <button className="fc-nav-btn" onClick={(e) => { e.stopPropagation(); goNext(); }} disabled={idx === cards.length - 1}>{Icon.chevronRight(16)}</button>
      </div>
      {flipped && lastInterval === null && (
        <div className="fc-chips">
          <button className="fc-chip chip-know" onClick={(e) => { e.stopPropagation(); rate('know'); }}>✓ Got it</button>
          <button className="fc-chip chip-unsure" onClick={(e) => { e.stopPropagation(); rate('unsure'); }}>~ Almost</button>
          <button className="fc-chip chip-nope" onClick={(e) => { e.stopPropagation(); rate('nope'); }}>✗ Nope</button>
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

function StudyPackCard({ data, onDismiss }) {
  const summary = data.summary || [];
  const concepts = data.key_concepts || [];
  const flashcards = data.flashcards || [];
  const quiz = data.quiz || [];
  const [tab, setTab] = useState('summary');
  const [fcIdx, setFcIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const ac = 'var(--teal)';

  const tabs = [
    { id:'summary',    label:'Summary' },
    { id:'flashcards', label:`Cards (${flashcards.length})` },
    { id:'quiz',       label:`Quiz (${quiz.length})` },
  ];
  const q = quiz[qIdx];

  return (
    <div className="content-card" style={{borderLeftColor:ac}}>
      <div className="content-card-header">
        <div className="content-card-hdr-icon" style={{background:`color-mix(in srgb, ${ac} 10%, transparent)`,borderColor:`color-mix(in srgb, ${ac} 20%, transparent)`,color:ac}}>{Icon.bookOpen(16)}</div>
        <div>
          <div className="content-card-title">{data.title || 'Study Pack'}</div>
          <div className="content-card-subject">{[data.subject, data.topic].filter(Boolean).join(' · ') || 'saved to your Library'}</div>
        </div>
      </div>
      <div style={{display:'flex',gap:4,padding:'0 14px 8px'}}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:'5px 8px',fontSize:'0.74rem',borderRadius:8,cursor:'pointer',border:`1px solid ${tab===t.id?ac:'transparent'}`,background:tab===t.id?`color-mix(in srgb, ${ac} 12%, transparent)`:'transparent',color:tab===t.id?ac:'var(--text-dim)'}}>{t.label}</button>
        ))}
      </div>
      <div className="content-card-body">
        {tab==='summary' && (
          <div style={{fontSize:'0.85rem',lineHeight:1.6,maxHeight:220,overflowY:'auto'}}>
            {summary.map((b,i)=>(<div key={i} style={{display:'flex',gap:8,padding:'3px 0'}}><span style={{width:5,height:5,borderRadius:'50%',background:ac,marginTop:7,flexShrink:0}}/>{b}</div>))}
            {concepts.length>0 && (
              <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:10}}>
                {concepts.map((c,i)=>(<span key={i} style={{fontSize:'0.72rem',padding:'2px 8px',borderRadius:'var(--radius-full,999px)',background:`color-mix(in srgb, ${ac} 10%, transparent)`,border:`1px solid color-mix(in srgb, ${ac} 22%, transparent)`,color:ac}}>{c}</span>))}
              </div>
            )}
          </div>
        )}
        {tab==='flashcards' && flashcards.length>0 && (
          <>
            <div className="fc-container" onClick={()=>setFlipped(f=>!f)}>
              <div className={'fc-inner'+(flipped?' flipped':'')}>
                <div className="fc-front"><div>{flashcards[fcIdx]?.q}</div></div>
                <div className="fc-back"><div>{flashcards[fcIdx]?.a}</div></div>
              </div>
            </div>
            <div className="fc-nav">
              <button className="fc-nav-btn" onClick={(e)=>{e.stopPropagation();if(fcIdx>0){setFlipped(false);setFcIdx(i=>i-1);}}} disabled={fcIdx===0}>{Icon.chevronLeft(16)}</button>
              <span className="fc-counter">{fcIdx+1} / {flashcards.length}</span>
              <button className="fc-nav-btn" onClick={(e)=>{e.stopPropagation();if(fcIdx<flashcards.length-1){setFlipped(false);setFcIdx(i=>i+1);}}} disabled={fcIdx===flashcards.length-1}>{Icon.chevronRight(16)}</button>
            </div>
            <div className="fc-hint">tap card to flip</div>
          </>
        )}
        {tab==='quiz' && q && (
          <div>
            <div className="quiz-question">{q.q}</div>
            <div className="quiz-choices">
              {(q.choices||[]).map((choice,i)=>{
                let cls='quiz-choice';
                if(revealed && choice===q.answer) cls+=' correct';
                else if(revealed && choice===selected && choice!==q.answer) cls+=' wrong';
                else if(!revealed && choice===selected) cls+=' selected';
                return <button key={i} className={cls} onClick={()=>{if(!revealed)setSelected(choice);}}>{choice}</button>;
              })}
            </div>
            {revealed && q.explanation && <div style={{fontSize:'0.78rem',color:'var(--text-dim)',marginTop:6}}>{q.explanation}</div>}
            <div style={{display:'flex',gap:8,alignItems:'center',marginTop:8}}>
              {!revealed && <button className="quiz-btn" disabled={!selected} onClick={()=>{setRevealed(true);if(selected===q.answer)setScore(s=>s+1);}}>Check Answer</button>}
              {revealed && qIdx<quiz.length-1 && <button className="quiz-btn" onClick={()=>{setQIdx(i=>i+1);setSelected(null);setRevealed(false);}}>Next</button>}
              <span style={{marginLeft:'auto',fontSize:'0.76rem',color:'var(--text-dim)'}}>{qIdx+1}/{quiz.length} · {score} correct</span>
            </div>
          </div>
        )}
      </div>
      <div className="content-card-actions">
        <button className="content-card-save" style={{background:`linear-gradient(135deg, ${ac}, color-mix(in srgb, ${ac} 70%, #000))`,boxShadow:`0 2px 12px color-mix(in srgb, ${ac} 25%, transparent)`}} onClick={()=>window.location.assign('/library')}>{Icon.bookOpen(14)} Open in Library</button>
        <button className="content-card-dismiss" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
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
  const [mode, setMode] = useState(data._propose_mode ? 'propose' : 'breakdown');
  const [editSteps, setEditSteps] = useState(() => (data.steps||[]).map(s => ({...s})));
  const [editingIdx, setEditingIdx] = useState(null);
  const [critiqueOpen, setCritiqueOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [docSyncing, setDocSyncing] = useState(false);
  const rawSteps = data.steps || [];
  const steps = mode === 'breakdown' && data._propose_mode ? editSteps : rawSteps;
  const toggle = i => setChecked(prev => prev.map((v,j) => j===i ? !v : v));
  const checkedCount = checked.filter(Boolean).length;

  function updateEditStep(idx, field, value) {
    setEditSteps(prev => prev.map((s, i) => i === idx ? {...s, [field]: value} : s));
  }

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

      {/* Propose mode: critique + accept/edit/reject */}
      {mode === 'propose' && (
        <>
          {data._critique && (
            <div style={{padding:'10px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
              <button onClick={() => setCritiqueOpen(o => !o)} style={{
                background:'none', border:'none', cursor:'pointer',
                fontSize:'0.72rem', fontWeight:700, color:'var(--text-dim)',
                display:'flex', alignItems:'center', gap:4, padding:0
              }}>
                {critiqueOpen ? Icon.arrowRight(10) : Icon.arrowRight(10)} AI review {critiqueOpen ? '▲' : '▼'}
              </button>
              {critiqueOpen && (
                <div style={{marginTop:6, fontSize:'0.78rem', color:'var(--text-dim)', lineHeight:1.5, fontStyle:'italic'}}>
                  {data._critique}
                </div>
              )}
            </div>
          )}
          <div style={{padding:'10px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)', display:'flex', gap:6}}>
            <button onClick={() => { onApply(rawSteps); onDismiss?.(); }} style={{
              flex:2, padding:'8px 12px', borderRadius:8, border:'none', fontSize:'0.82rem', fontWeight:700, cursor:'pointer',
              background:'rgba(43,203,186,0.15)', color:'var(--teal)', transition:'all .15s'
            }}>✓ Accept</button>
            <button onClick={() => { setMode('breakdown'); setEditSteps(rawSteps.map(s=>({...s}))); }} style={{
              flex:1, padding:'8px 12px', borderRadius:8, border:'none', fontSize:'0.82rem', fontWeight:700, cursor:'pointer',
              background:'rgba(108,99,255,0.12)', color:'var(--accent)', transition:'all .15s'
            }}>Edit</button>
            <button onClick={() => onDismiss?.()} style={{
              flex:1, padding:'8px 12px', borderRadius:8, border:'none', fontSize:'0.82rem', fontWeight:700, cursor:'pointer',
              background:'rgba(255,255,255,0.05)', color:'var(--text-dim)', transition:'all .15s'
            }}>✕</button>
          </div>
        </>
      )}

      {/* Mode Toggle (not shown in propose mode) */}
      {mode !== 'propose' && (
      <div style={{padding:'10px 20px', borderBottom:'1px solid rgba(255,255,255,0.04)', display:'flex', gap:6}}>
        {data._propose_mode && (
          <button onClick={() => { onApply(editSteps.filter((_,i) => checked[i])); onDismiss?.(); }} style={{
            flex:2, padding:'6px 12px', borderRadius:8, border:'none', fontSize:'0.78rem', fontWeight:700, cursor:'pointer',
            background:'rgba(43,203,186,0.15)', color:'var(--teal)', transition:'all .15s'
          }}>✓ Accept {checkedCount}</button>
        )}
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
      )}

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
              <div style={{flex:1}} onClick={mode === 'breakdown' && data._propose_mode ? (e) => { e.stopPropagation(); setEditingIdx(editingIdx === i ? null : i); } : undefined}>
                {mode === 'breakdown' && data._propose_mode && editingIdx === i ? (
                  <input
                    autoFocus
                    value={step.title}
                    onChange={e => updateEditStep(i, 'title', e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => setEditingIdx(null)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingIdx(null); }}
                    style={{
                      width:'100%', background:'rgba(108,99,255,0.08)', border:'1px solid rgba(108,99,255,0.3)',
                      borderRadius:6, padding:'3px 7px', fontSize:'0.84rem', color:'var(--text)', outline:'none'
                    }}
                  />
                ) : (
                  <div style={{fontSize:'0.84rem', color:'var(--text)', fontWeight: isActive ? 600 : 400, textDecoration: isChecked ? 'none' : 'line-through'}}>
                    {step.title}
                    {mode === 'breakdown' && data._propose_mode && <span style={{fontSize:'0.65rem', color:'rgba(108,99,255,0.5)', marginLeft:5}}>✎</span>}
                  </div>
                )}
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

function detectPlanConflicts(proposedBlocks, existingRecurring) {
  const dayIdx = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
  const toMins = hhmm => { const [h,m] = (hhmm||'00:00').split(':').map(Number); return h*60+m; };
  const overlaps = (as, ae, bs, be) => as < be && bs < ae;
  const conflicts = [];
  for (const proposed of proposedBlocks) {
    const propDays = new Set((proposed.days||[]).map(d => dayIdx[d]));
    const ps = toMins(proposed.start), pe = toMins(proposed.end);
    for (const existing of existingRecurring) {
      const existDays = new Set((existing.days||[]).map(d => (typeof d === 'number' ? d : dayIdx[d])));
      const es = toMins(existing.start), ee = toMins(existing.end);
      if ([...propDays].some(d => existDays.has(d)) && overlaps(ps, pe, es, ee)) {
        conflicts.push({ activity: proposed.activity, conflictsWith: existing.name, time: `${existing.start}–${existing.end}` });
        break;
      }
    }
  }
  return conflicts;
}

function IntentPlanCard({ data, onApply, onApplyWithoutConflicts, onDismiss, conflicts = [] }) {
  const blocks = data.recurring_blocks || [];
  const tasks = data.milestone_tasks || [];
  const reviewBlock = data.review_cadence?.review_block;
  const totalBlocks = blocks.length + (reviewBlock ? 1 : 0);
  const dayMap = { Monday:'M', Tuesday:'Tu', Wednesday:'W', Thursday:'Th', Friday:'F', Saturday:'Sa', Sunday:'Su' };
  const fmtDays = (days) => (days || []).map(d => dayMap[d] || d).join('/');
  const conflictSet = new Set(conflicts.map(c => c.activity));
  return (
    <div style={{background:'rgba(108,99,255,0.06)', border:'1px solid rgba(108,99,255,0.18)', borderRadius:14, overflow:'hidden', marginBottom:8}}>
      <div style={{padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
          <span style={{color:'var(--accent)', display:'flex'}}>{Icon.zap(14)}</span>
          <span style={{fontWeight:700, fontSize:'0.88rem', color:'var(--text)'}}>Study Plan</span>
          <span style={{fontSize:'0.72rem', color:'var(--text-dim)', marginLeft:'auto'}}>{totalBlocks} block{totalBlocks!==1?'s':''} · {tasks.length} task{tasks.length!==1?'s':''}</span>
        </div>
        {data.summary && <p style={{fontSize:'0.82rem', color:'var(--text-dim)', margin:0, lineHeight:1.5}}>{data.summary}</p>}
      </div>
      {blocks.length > 0 && (
        <div style={{padding:'8px 16px', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
          <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--accent)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em'}}>Recurring Blocks</div>
          {blocks.map((b, i) => (
            <div key={i} style={{display:'flex', gap:8, fontSize:'0.8rem', color: conflictSet.has(b.activity) ? 'var(--orange)' : 'var(--text)', padding:'3px 0', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
              <span style={{fontWeight:600, flex:1}}>{b.activity}{conflictSet.has(b.activity) ? ' ⚠' : ''}</span>
              <span style={{color:'var(--text-dim)'}}>{fmtDays(b.days)}</span>
              <span style={{color: conflictSet.has(b.activity) ? 'var(--orange)' : 'var(--teal)'}}>{b.start}–{b.end}</span>
            </div>
          ))}
          {reviewBlock && (
            <div style={{display:'flex', gap:8, fontSize:'0.8rem', color:'var(--text)', padding:'3px 0'}}>
              <span style={{fontWeight:600, flex:1}}>{reviewBlock.activity} (review)</span>
              <span style={{color:'var(--text-dim)'}}>{fmtDays(reviewBlock.days)}</span>
              <span style={{color:'var(--teal)'}}>{reviewBlock.start}–{reviewBlock.end}</span>
            </div>
          )}
        </div>
      )}
      {tasks.length > 0 && (
        <div style={{padding:'8px 16px', borderBottom:'1px solid rgba(255,255,255,0.04)', maxHeight:160, overflowY:'auto'}}>
          <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--teal)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em'}}>Milestones</div>
          {tasks.slice(0,10).map((t, i) => (
            <div key={i} style={{display:'flex', gap:8, fontSize:'0.8rem', color:'var(--text)', padding:'2px 0'}}>
              <span style={{flex:1}}>{t.task_name}</span>
              {t.due_date && <span style={{color:'var(--text-dim)', fontSize:'0.73rem'}}>{t.due_date}</span>}
            </div>
          ))}
          {tasks.length > 10 && <div style={{fontSize:'0.72rem', color:'var(--text-dim)', marginTop:2}}>+{tasks.length-10} more…</div>}
        </div>
      )}
      {conflicts.length > 0 && (
        <div style={{padding:'8px 16px', borderBottom:'1px solid rgba(255,255,255,0.04)', background:'rgba(255,140,0,0.06)'}}>
          <div style={{fontSize:'0.72rem', fontWeight:700, color:'var(--orange)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em'}}>
            {conflicts.length} scheduling conflict{conflicts.length!==1?'s':''} detected
          </div>
          {conflicts.map((c, i) => (
            <div key={i} style={{fontSize:'0.78rem', color:'var(--text-dim)', padding:'2px 0'}}>
              "{c.activity}" overlaps with "{c.conflictsWith}" ({c.time})
            </div>
          ))}
        </div>
      )}
      <div style={{display:'flex', gap:8, padding:'10px 16px', flexWrap:'wrap'}}>
        {conflicts.length === 0 ? (
          <button onClick={() => onApply(data)} style={{flex:1, background:'rgba(43,203,186,0.15)', border:'1px solid rgba(43,203,186,0.3)', color:'var(--teal)', borderRadius:8, padding:'8px 0', fontSize:'0.82rem', fontWeight:700, cursor:'pointer'}}>
            Apply Plan
          </button>
        ) : (
          <>
            <button onClick={() => onApply(data)} style={{flex:1, background:'rgba(43,203,186,0.12)', border:'1px solid rgba(43,203,186,0.25)', color:'var(--teal)', borderRadius:8, padding:'8px 0', fontSize:'0.82rem', fontWeight:600, cursor:'pointer'}}>
              Apply Anyway
            </button>
            <button onClick={() => onApplyWithoutConflicts(data)} style={{flex:1, background:'rgba(43,203,186,0.18)', border:'1px solid rgba(43,203,186,0.4)', color:'var(--teal)', borderRadius:8, padding:'8px 0', fontSize:'0.82rem', fontWeight:700, cursor:'pointer'}}>
              Skip Conflicts
            </button>
          </>
        )}
        <button onClick={onDismiss} style={{padding:'8px 14px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'var(--text-dim)', borderRadius:8, fontSize:'0.82rem', cursor:'pointer'}}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function MyPlansPanel({ plans, tasks, onClose, onRevise, onArchive }) {
  const [expandedId, setExpandedId] = useState(null);
  const activePlans = plans.filter(p => p.status === 'active');
  const archivedPlans = plans.filter(p => p.status === 'archived');
  const getPlanProgress = (plan) => {
    const planTasks = tasks.filter(t => t.study_plan_id === plan.id);
    const total = plan.total_tasks || planTasks.length;
    const completed = planTasks.filter(t => t.completedAt).length;
    return { total, completed };
  };
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
  const renderPlanCard = (plan) => {
    const { total, completed } = getPlanProgress(plan);
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const isExpanded = expandedId === plan.id;
    const planData = plan.plan_json || {};
    return (
      <div key={plan.id} style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:10, marginBottom:8, overflow:'hidden'}}>
        <div onClick={() => setExpandedId(isExpanded ? null : plan.id)} style={{padding:'10px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:10}}>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontWeight:600, fontSize:'0.85rem', color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{plan.title}</div>
            <div style={{fontSize:'0.73rem', color:'var(--text-dim)', marginTop:2}}>Applied {fmtDate(plan.applied_at)} · {completed}/{total} tasks done</div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:8, flexShrink:0}}>
            <div style={{fontSize:'0.75rem', fontWeight:700, color: pct === 100 ? 'var(--teal)' : 'var(--accent)'}}>{pct}%</div>
            <span style={{color:'var(--text-dim)', fontSize:'0.75rem'}}>{isExpanded ? '▲' : '▼'}</span>
          </div>
        </div>
        {total > 0 && (
          <div style={{height:3, background:'rgba(255,255,255,0.06)', margin:'0 14px 0'}}>
            <div style={{height:'100%', width:`${pct}%`, background: pct === 100 ? 'var(--teal)' : 'var(--accent)', borderRadius:2, transition:'width .3s ease'}}/>
          </div>
        )}
        {isExpanded && (
          <div style={{padding:'10px 14px', borderTop:'1px solid rgba(255,255,255,0.04)'}}>
            {planData.summary && <p style={{fontSize:'0.8rem', color:'var(--text-dim)', margin:'0 0 8px', lineHeight:1.5}}>{planData.summary}</p>}
            {(planData.recurring_blocks||[]).length > 0 && (
              <div style={{marginBottom:8}}>
                <div style={{fontSize:'0.7rem', fontWeight:700, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4}}>Blocks</div>
                {(planData.recurring_blocks||[]).map((b,i) => (
                  <div key={i} style={{fontSize:'0.78rem', color:'var(--text-dim)', padding:'1px 0'}}>{b.activity} — {(b.days||[]).join('/')} {b.start}–{b.end}</div>
                ))}
              </div>
            )}
            {(planData.milestone_tasks||[]).length > 0 && (
              <div style={{marginBottom:8}}>
                <div style={{fontSize:'0.7rem', fontWeight:700, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4}}>Milestones</div>
                {(planData.milestone_tasks||[]).slice(0,8).map((t,i) => {
                  const done = tasks.find(task => task.study_plan_id === plan.id && task.title === t.task_name && task.completedAt);
                  return (
                    <div key={i} style={{fontSize:'0.78rem', color: done ? 'var(--teal)' : 'var(--text-dim)', padding:'1px 0', textDecoration: done ? 'line-through' : 'none'}}>{t.task_name} — {t.due_date}</div>
                  );
                })}
                {(planData.milestone_tasks||[]).length > 8 && <div style={{fontSize:'0.72rem', color:'var(--text-dim)', marginTop:2}}>+{(planData.milestone_tasks||[]).length-8} more…</div>}
              </div>
            )}
            <div style={{display:'flex', gap:8, marginTop:8}}>
              <button onClick={() => onRevise(plan.id)} style={{flex:1, background:'rgba(108,99,255,0.12)', border:'1px solid rgba(108,99,255,0.25)', color:'var(--accent)', borderRadius:7, padding:'6px 0', fontSize:'0.78rem', fontWeight:600, cursor:'pointer'}}>
                Revise Plan
              </button>
              {plan.status === 'active' && (
                <button onClick={() => onArchive(plan.id)} style={{padding:'6px 12px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'var(--text-dim)', borderRadius:7, fontSize:'0.78rem', cursor:'pointer'}}>
                  Archive
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };
  return (
    <div style={{position:'fixed', inset:0, zIndex:200, display:'flex', alignItems:'flex-start', justifyContent:'flex-end'}} onClick={e => { if(e.target === e.currentTarget) onClose(); }}>
      <div style={{width:360, maxWidth:'95vw', height:'100vh', background:'var(--surface)', borderLeft:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', boxShadow:'-8px 0 32px rgba(0,0,0,0.4)'}}>
        <div style={{padding:'16px 16px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', gap:10}}>
          <span style={{color:'var(--accent)', display:'flex'}}>{Icon.zap(16)}</span>
          <span style={{fontWeight:700, fontSize:'0.95rem', color:'var(--text)', flex:1}}>My Study Plans</span>
          <button onClick={onClose} style={{background:'none', border:'none', color:'var(--text-dim)', cursor:'pointer', padding:4}}>{Icon.x(16)}</button>
        </div>
        <div style={{flex:1, overflowY:'auto', padding:12}}>
          {plans.length === 0 && (
            <div style={{textAlign:'center', padding:'40px 20px', color:'var(--text-dim)', fontSize:'0.85rem'}}>
              No study plans yet. Ask the AI to help you plan for a goal like "survive finals week" or "improve my GPA".
            </div>
          )}
          {activePlans.length > 0 && (
            <>
              <div style={{fontSize:'0.7rem', fontWeight:700, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8}}>Active</div>
              {activePlans.map(renderPlanCard)}
            </>
          )}
          {archivedPlans.length > 0 && (
            <>
              <div style={{fontSize:'0.7rem', fontWeight:700, color:'var(--text-dim)', textTransform:'uppercase', letterSpacing:'0.06em', margin:'16px 0 8px'}}>Archived</div>
              {archivedPlans.map(renderPlanCard)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ContentTypeRouter({ content, onSave, onDismiss, onApplyPlan, onApplyIntentPlan, onApplyIntentPlanSkipConflicts, onStartPlanTask, onExportGoogleDocs, googleConnected, existingRecurring }) {
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
    // create_study_plan removed — study plans now use the agentic planning pipeline (make_plan)
    case 'create_project_breakdown':
      return <GenericContentDisplay data={content} icon={Icon.hammer(16)} label="Project Breakdown" onSave={onSave} onDismiss={onDismiss} accentColor="var(--orange)" />;
    case 'make_intent_plan': {
      const conflicts = detectPlanConflicts(content.recurring_blocks || [], existingRecurring || []);
      return <IntentPlanCard data={content} onApply={onApplyIntentPlan} onApplyWithoutConflicts={onApplyIntentPlanSkipConflicts} onDismiss={onDismiss} conflicts={conflicts} />;
    }
    case 'make_study_pack':
      return <StudyPackCard data={content} onDismiss={onDismiss} />;
    default:
      return <GenericContentDisplay data={content} icon={Icon.zap(16)} label="Content" onSave={onSave} onDismiss={onDismiss} accentColor="var(--accent)" />;
  }
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
   GLOBAL SEARCH MODAL (Cmd+K)
   ═══════════════════════════════════════════════ */
function GlobalSearchModal({ query, onQueryChange, onClose, tasks, events, notes, savedChats = [], onSelectNote, onOpenSavedChat, onSendMessage }) {
  const inputRef = React.useRef(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const q = query.trim().toLowerCase();
  const results = React.useMemo(() => {
    if (!q) return [];
    const out = [];
    tasks.forEach(t => {
      if (t.title?.toLowerCase().includes(q) || t.subject?.toLowerCase().includes(q)) {
        out.push({ kind: 'task', id: t.id, label: t.title, sub: t.dueDate ? `Due ${t.dueDate}` : t.subject || 'Task', obj: t });
      }
    });
    events.forEach(ev => {
      if (ev.title?.toLowerCase().includes(q)) {
        out.push({ kind: 'event', id: ev.id, label: ev.title, sub: ev.date || 'Event', obj: ev });
      }
    });
    notes.forEach(n => {
      const plain = (n.content || '').replace(/<[^>]+>/g, '');
      if (n.name?.toLowerCase().includes(q) || plain.toLowerCase().includes(q)) {
        const idx = plain.toLowerCase().indexOf(q);
        const snippet = idx >= 0 ? '…' + plain.slice(Math.max(0, idx - 20), idx + 60) + '…' : plain.slice(0, 80);
        out.push({ kind: 'note', id: n.id, label: n.name || 'Untitled', sub: snippet, obj: n });
      }
    });
    savedChats.forEach(chat => {
      const haystack = [chat.title, ...(chat.messages || []).map(m => m.content)].join(' ').toLowerCase();
      if (haystack.includes(q)) {
        const msg = (chat.messages || []).find(m => (m.content || '').toLowerCase().includes(q));
        const sub = msg?.content ? 'Chat · ' + msg.content.slice(0, 80) : `Saved chat · ${chat.messageCount || 0} messages`;
        out.push({ kind: 'chat', id: chat.id, label: chat.title || 'Saved chat', sub, obj: chat });
      }
    });
    return out.slice(0, 12);
  }, [q, tasks, events, notes, savedChats]);

  React.useEffect(() => { setActiveIndex(0); }, [query]);

  const kindIcon = { task: '☑', event: '📅', note: '📝', chat: '💬' };

  function handleSelect(r) {
    if (!r) return;
    if (r.kind === 'note') onSelectNote(r.obj);
    else if (r.kind === 'chat') onOpenSavedChat?.(r.id);
    else onSendMessage(`Tell me about "${r.label}"`);
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    }
  }

  return (
    <div className="gsearch-overlay" onClick={onClose}>
      <div className="gsearch-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="gsearch-input-wrap">
          <span className="gsearch-icon">⌘K</span>
          <input
            ref={inputRef}
            className="gsearch-input"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Search tasks, events, notes, chats…"
            onKeyDown={handleSearchKeyDown}
          />
          {query && <button className="gsearch-clear" onClick={() => onQueryChange('')}>×</button>}
        </div>
        {results.length > 0 ? (
          <div className="gsearch-results">
            {results.map((r, index) => (
              <button key={r.kind + r.id} className={'gsearch-result' + (index === activeIndex ? ' active' : '')} onMouseEnter={() => setActiveIndex(index)} onClick={() => handleSelect(r)}>
                <span className="gsearch-kind">{kindIcon[r.kind]}</span>
                <span className="gsearch-result-label">{r.label}</span>
                <span className="gsearch-result-sub">{r.sub}</span>
              </button>
            ))}
          </div>
        ) : q ? (
          <div className="gsearch-empty">No matches for "{query}"</div>
        ) : (
          <div className="gsearch-empty">Start typing to search tasks, events, and notes</div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   NOTES PANEL (reference system + editing + fullscreen)
   ═══════════════════════════════════════════════ */
function NotesPanel({ notes, events = [], tasks = [], entityLinks = [], onClose, onDeleteNote, onUpdateNote, onCreateNote, onWikilinkClick, embedded = false }) {
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
    const plainText = (editorRef.current?.innerText || '').trim();
    const fallbackTitle = plainText ? plainText.split(/\s+/).slice(0, 6).join(' ') : `Note ${new Date().toLocaleDateString()}`;
    const title = newNoteName.trim() || fallbackTitle;
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
            <div ref={editorRef} className="notes-editor" contentEditable data-placeholder="What are you studying today?"
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
                      <>
                        <div
                          className="notes-item-content"
                          onClick={(e) => {
                            const a = e.target.closest && e.target.closest('a.wikilink');
                            if (!a) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const type = a.getAttribute('data-target-type');
                            const id = a.getAttribute('data-target-id');
                            if (type && id && onWikilinkClick) onWikilinkClick({ type, id });
                          }}
                          dangerouslySetInnerHTML={{__html: renderWikilinks(note.content || '', (name) => resolveLinkName(name, { notes, events, tasks }, normalize))}}
                        />
                        <BacklinksSection
                          entity={{ type: 'note', id: note.id }}
                          entityLinks={entityLinks}
                          notes={notes}
                          events={events}
                          tasks={tasks}
                          onWikilinkClick={onWikilinkClick}
                        />
                      </>
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
   BACKLINKS SECTION (used inside NotesPanel + event detail)
   ═══════════════════════════════════════════════ */
function BacklinksSection({ entity, entityLinks = [], notes = [], events = [], tasks = [], onWikilinkClick }) {
  const links = (entityLinks || []).filter(l => l.origin !== 'rejected' && (
    (l.source_type === entity.type && l.source_id === entity.id) ||
    (l.target_type === entity.type && l.target_id === entity.id)
  ));
  if (links.length === 0) return null;

  function resolve(type, id) {
    if (type === 'note') { const n = notes.find(x => x.id === id); return n ? { title: n.name, type, id } : null; }
    if (type === 'event') { const e = events.find(x => x.id === id); return e ? { title: e.title, type, id } : null; }
    if (type === 'task') { const t = tasks.find(x => x.id === id); return t ? { title: t.title, type, id } : null; }
    return null;
  }

  const others = links.map(l => {
    const isSource = l.source_type === entity.type && l.source_id === entity.id;
    const otherType = isSource ? l.target_type : l.source_type;
    const otherId = isSource ? l.target_id : l.source_id;
    return { ...resolve(otherType, otherId), origin: l.origin, linkId: l.id };
  }).filter(x => x && x.title);

  if (others.length === 0) return null;

  const TYPE_LABEL = { note: 'Note', event: 'Event', task: 'Task' };
  const TYPE_COLOR = { note: 'var(--teal)', event: 'var(--blue)', task: 'var(--accent)' };

  return (
    <div style={{marginTop:12,paddingTop:10,borderTop:'1px solid rgba(255,255,255,0.06)'}}>
      <div style={{fontSize:'0.7rem',color:'var(--text-dim)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6,display:'flex',alignItems:'center',gap:6}}>
        <span style={{display:'flex',color:'var(--teal)'}}>{Icon.link(11)}</span>
        Linked ({others.length})
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
        {others.map((o,i) => (
          <button
            key={(o.linkId || '') + ':' + i}
            onClick={(e) => { e.stopPropagation(); if (onWikilinkClick) onWikilinkClick({ type: o.type, id: o.id }); }}
            style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 8px',borderRadius:8,border:'1px solid rgba(255,255,255,0.08)',background:'var(--bg2)',color:'var(--text)',fontSize:'0.74rem',cursor:'pointer'}}
          >
            <span style={{fontSize:'0.62rem',color:TYPE_COLOR[o.type],fontWeight:700,textTransform:'uppercase'}}>{TYPE_LABEL[o.type]}</span>
            <span>{o.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════ */
function Toast({message,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,2400);return()=>clearTimeout(t)},[]);
  return(<div style={{position:'fixed',top:20,left:'50%',transform:'translateX(-50%)',zIndex:9999,padding:'10px 20px',borderRadius:14,background:'linear-gradient(135deg,var(--success),#1db954)',color:'#fff',fontWeight:600,fontSize:'0.88rem',boxShadow:'0 4px 24px rgba(46,213,115,0.4),0 0 40px rgba(46,213,115,0.1)',animation:'toastIn .3s cubic-bezier(0.16,1,0.3,1), toastOut .3s ease 2.1s forwards',backdropFilter:'blur(8px)'}}>{message}</div>);
}

function AppleSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={'apple-toggle' + (checked ? ' on' : '')}
    >
      <span className="apple-toggle-knob" />
    </button>
  );
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
  const withBreaks = escapeHtml(raw)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
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
    <div style={{background:'linear-gradient(135deg,rgba(26,26,46,0.95),rgba(15,15,26,0.95))',border:'1px solid rgba(108,99,255,0.12)',borderRadius:16,borderBottomLeftRadius:4,padding:'10px 18px',display:'inline-flex',flexDirection:'column',gap:8,minWidth:200,backdropFilter:'blur(8px)',animation:'borderGlow 2s ease-in-out infinite'}}>
      <span style={{fontSize:13,fontStyle:'italic',background:'linear-gradient(135deg, var(--accent), var(--teal))',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',animation:'textPulse 1.6s ease-in-out infinite'}}>{message}</span>
      <div className="sos-slider-track" style={{height:3,width:'100%'}}/>
    </div>
  </div>
);

const PIPELINE_STEP_LABELS = ['Analyzing', 'Drafting', 'Reviewing', 'Finalizing'];
function PipelineProgressIndicator({ progress }) {
  if (!progress) return null;
  const { step, totalSteps, label } = progress;
  return (
    <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
      <div style={{background:'linear-gradient(135deg,rgba(26,26,46,0.97),rgba(15,15,26,0.97))',border:'1px solid rgba(108,99,255,0.2)',borderRadius:16,borderBottomLeftRadius:4,padding:'12px 18px',minWidth:260,backdropFilter:'blur(8px)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
          <span style={{fontSize:12,fontStyle:'italic',background:'linear-gradient(135deg, var(--accent), var(--teal))',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',animation:'textPulse 1.6s ease-in-out infinite'}}>{label}</span>
          <span style={{fontSize:11,color:'var(--text-dim)',marginLeft:'auto'}}>{step}/{totalSteps}</span>
        </div>
        {/* Continuous slider — sweeps the whole time so the panel never looks
           frozen during the ~15s gaps between discrete progress events. */}
        <div className="sos-slider-track" style={{height:4,marginBottom:10}}/>
        <div style={{display:'flex',gap:4}}>
          {Array.from({length:totalSteps},(_,i)=>(
            <div key={i} style={{flex:1,height:3,borderRadius:2,background:i<step?'var(--accent)':'rgba(108,99,255,0.15)',transition:'background 0.4s ease'}}/>
          ))}
        </div>
        <div style={{display:'flex',gap:6,marginTop:10}}>
          {PIPELINE_STEP_LABELS.slice(0,totalSteps).map((lbl,i)=>(
            <span key={i} style={{flex:1,textAlign:'center',fontSize:9,color:i+1===step?'var(--accent)':i+1<step?'var(--teal)':'var(--text-dim)',fontWeight:i+1===step?700:400,textTransform:'uppercase',letterSpacing:'0.04em',transition:'color 0.3s ease'}}>{lbl}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

const AutoApproveIndicator = ({ status }) => {
  if (!status) return null;
  const done = status.state === 'done';
  return (
    <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
      <div className={'auto-approve-indicator' + (done ? ' done' : '')}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
          <span>{done ? 'Applied' : 'Applying'} {status.count} change{status.count === 1 ? '' : 's'}{status.label ? ` · ${status.label}` : ''}</span>
          <span style={{display:'inline-flex',alignItems:'center'}}>{done ? Icon.checkCircle(14) : Icon.circleDot(14)}</span>
        </div>
        <div className="auto-approve-track">
          <div className="auto-approve-fill" />
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════
   ACTIVE TIMER PILL — small floating chip rendered per active timer
   ═══════════════════════════════════════════════ */
function ActiveTimerPill({ timer, onDismiss }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, timer.fireAt - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.max(0, timer.fireAt - Date.now())), 1000);
    return () => clearInterval(id);
  }, [timer.fireAt]);
  const secs = Math.floor(remaining / 1000);
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  const display = mm > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : `${ss}s`;
  return (
    <button type="button" className="sos-active-timer" onClick={onDismiss} title="Dismiss timer">
      <span style={{fontSize:'0.85rem'}}>⏱</span>
      <span>{timer.label}</span>
      <span style={{opacity:0.8}}>{display}</span>
    </button>
  );
}

/* ═══════════════════════════════════════════════
   SOS MAIN APP
   ═══════════════════════════════════════════════ */
function App() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { agenticMode, setAgenticMode } = useAgenticMode();
  const [user, setUser] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState('login');
  const [authNudge, setAuthNudge] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // ── Data stores ──
  const [tasks, setTasks] = useState([]);
  const [blocks, setBlocks] = useState({ recurring: [], dates: {} });
  const [notes, setNotes] = useState([]);
  const [events, setEvents] = useState([]);
  const [studyPlans, setStudyPlans] = useState([]);
  const [flashcardDecks, setFlashcardDecks] = useState([]);
  const [grades, setGrades] = useState([]);
  const [showMyPlans, setShowMyPlans] = useState(false);
  const [pendingRevisionPlanId, setPendingRevisionPlanId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [dbMessageCount, setDbMessageCount] = useState(0); // P1.4: track DB-loaded message count
  const [weatherData, setWeatherData] = useState(null);
  const [weatherCoords, setWeatherCoords] = useState({ lat:42.33, lon:-71.21 });
  // Floating widgets summoned from chat ("set a timer", "what's my schedule").
  // null = hidden. Each widget renders only when explicitly invoked.
  const [activeWidgets, setActiveWidgets] = useState({ pomodoro: false, schedule: false });
  const [pomodoroSession, setPomodoroSession] = useState('pomodoro');
  const [sosNotif, setSosNotif] = useState(null);

  // ── UI state ──
  const [input, setInput] = useState('');
  const [pasteStudyPrompt, setPasteStudyPrompt] = useState(null); // holds pasted text when >500 chars
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("thinkisizing…");
  const [pipelineProgress, setPipelineProgress] = useState(null);
  const [previewPlanEntry, setPreviewPlanEntry] = useState(null);
  const [chatError, setChatError] = useState(null);
  const [autoApproveStatus, setAutoApproveStatus] = useState(null);
  const [contextTrimInfo, setContextTrimInfo] = useState(null); // { shown, total } when tasks trimmed
  const [recentlyCompleted, setRecentlyCompleted] = useState(new Set()); // task IDs completing right now
  // Unified AI-pending state — one object for everything the AI surfaces after a response.
  const PENDING_INITIAL = {
    actions: [],            // action cards awaiting user approval [{ action, timestamp }]
    content: [],            // studio content cards (flashcards, quiz, plan, etc.)
    templateSelector: null, // { context } when template picker is active
    clarification: null,    // active clarification question object
    clarificationAnswers: null, // cached partial answers to the clarification
    linkSuggestions: [],    // [{key,source,target,score}]
    proposal: null,         // plan proposal { summary, action_type, prefilled }
    queue: [],              // rate-limit execution queue [{ id, action, addedAt }]
  };
  const [pending, setPending] = useState(PENDING_INITIAL);
  const updatePending = (patch) =>
    setPending((prev) => ({
      ...prev,
      ...(typeof patch === "function" ? patch(prev) : patch),
    }));
  const clearPending = () => setPending(PENDING_INITIAL);
  const {
    actions: pendingActions,
    content: pendingContent,
    templateSelector: pendingTemplateSelector,
    clarification: pendingClarification,
    clarificationAnswers: pendingClarificationAnswers,
    linkSuggestions: pendingLinkSuggestions,
    proposal: pendingProposal,
    queue: pendingQueue,
  } = pending;
  // Bridge setters — preserve old call-site signatures; functional updates forwarded safely.
  const setPendingActions = (v) => updatePending(typeof v === "function" ? (p) => ({ actions: v(p.actions) }) : { actions: v });
  const setPendingContent = (v) => updatePending(typeof v === "function" ? (p) => ({ content: v(p.content) }) : { content: v });
  const setPendingTemplateSelector = (v) => updatePending(typeof v === "function" ? (p) => ({ templateSelector: v(p.templateSelector) }) : { templateSelector: v });
  const setPendingClarification = (v) => updatePending(typeof v === "function" ? (p) => ({ clarification: v(p.clarification) }) : { clarification: v });
  const setPendingClarificationAnswers = (v) => updatePending(typeof v === "function" ? (p) => ({ clarificationAnswers: v(p.clarificationAnswers) }) : { clarificationAnswers: v });
  const setPendingLinkSuggestions = (v) => updatePending(typeof v === "function" ? (p) => ({ linkSuggestions: v(p.linkSuggestions) }) : { linkSuggestions: v });
  const setPendingProposal = (v) => updatePending(typeof v === "function" ? (p) => ({ proposal: v(p.proposal) }) : { proposal: v });
  const setPendingQueue = (v) => updatePending(typeof v === "function" ? (p) => ({ queue: v(p.queue) }) : { queue: v });
  const [entityLinks, setEntityLinks] = useState([]); // [{id,source_type,source_id,target_type,target_id,origin,confirmed_at,created_at}]
  const linkSuggestTimerRef = useRef(null);
  const [aiAutoApprove, setAiAutoApprove] = useState(() => localStorage.getItem('sos_ai_auto_approve') === 'true');
  const [showPeek, setShowPeek] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [lofiNoteOpen, setLofiNoteOpen] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(() => localStorage.getItem('sos_show_analytics') === 'true');
  const [rpmSnapshot, setRpmSnapshot] = useState({ remaining: Infinity, limit: Infinity, resetAtMs: 0 });
  const [currentModel, setCurrentModel] = useState(null);
  const [modelFallbackUsed, setModelFallbackUsed] = useState(false);
  const [layoutMode, setLayoutMode] = useState('studio');
  const [notifPrefs, setNotifPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sos-notif-prefs') || '{"tasks":true,"exams":true,"daily":false}'); } catch(_) { return {tasks:true,exams:true,daily:false}; }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sos_sidebar_collapsed') === 'true');
  const [sidebarCompanionPanel, setSidebarCompanionPanel] = useState(() => localStorage.getItem('sos_sidebar_companion_panel') || 'notes');
  const [studioTheme, setStudioTheme] = useState(() => localStorage.getItem('sos_studio_theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', studioTheme);
    localStorage.setItem('sos_studio_theme', studioTheme);
  }, [studioTheme]);
  const [activePanel, setActivePanel] = useState('chat');
  const [companionCollapsed, setCompanionCollapsed] = useState(() => localStorage.getItem('sos_companion_collapsed') !== 'false');
  const [autoCollapseSidebarCompanion, setAutoCollapseSidebarCompanion] = useState(() => localStorage.getItem('sos_auto_collapse_sidebar_companion') !== 'false');
  const [compactCompanionToggle, setCompactCompanionToggle] = useState(() => localStorage.getItem('sos_companion_toggle_compact') !== 'false');
  const [responseStyle, setResponseStyle] = useState(() => localStorage.getItem('sos_response_style') || 'balanced');
  const [sfxEnabled, setSfxEnabled] = useState(() => sfx.isEnabled());
  const [showPerfIndicatorSidebar, setShowPerfIndicatorSidebar] = useState(() => localStorage.getItem('sos_perf_indicator_sidebar') !== 'false');
  const [showPerfIndicatorTopbar, setShowPerfIndicatorTopbar] = useState(() => localStorage.getItem('sos_perf_indicator_topbar') !== 'false');
  const showSidebarCompanion = layoutMode === 'sidebar' && activePanel === 'chat' && sidebarCompanionPanel === 'notes';
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
    return activePanel === 'chat' ? 'chat' : 'none';
  }, [sidebarCompanionPanel, layoutMode, activePanel, companionCollapsed, showNotes, showPeek]);
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
    return null;
  }, []);
  const [toastMsg, setToastMsg] = useState(null);
  useEffect(() => { if (toastMsg) sfx.chime(); }, [toastMsg]);
  const [syncStatus, setSyncStatus] = useState('saved'); // 'saving', 'saved', 'error'
  const [contentGenUsed, setContentGenUsed] = useState(0);
  const DAILY_CONTENT_LIMIT = 5;
  const rpmStateRef = useRef({ remaining: Infinity, resetAtMs: 0 });
  const recentlyExecutedActionsRef = useRef([]); // [{ type, summary, executedAt }]
  // Undo toast: shown for 8s after a destructive/mutating AI action
  const [undoToast, setUndoToast] = useState(null); // { label, snap: {tasks, events, notes, blocks} }
  const undoTimerRef = useRef(null);
  // AbortController for the in-flight chat request; aborted on new send, new chat, layout switch, or unmount
  const streamAbortRef = useRef(null);
  useEffect(() => () => { try { streamAbortRef.current?.abort(); } catch (_) {} }, []);

  // Drain the pending action queue when RPM frees up
  useEffect(() => {
    if (!pendingQueue.length) return;
    const interval = setInterval(() => {
      const r = rpmStateRef.current;
      const clear = r.remaining === Infinity || Date.now() > r.resetAtMs || r.remaining >= 5;
      if (clear && pendingQueue.length > 0) {
        const [next, ...rest] = pendingQueue;
        setPendingQueue(rest);
        executeAction(next.action);
      }
    }, 5000);
    return () => clearInterval(interval);
  // executeAction is stable (defined inside component); pendingQueue drives re-registration
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQueue]);

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
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showGooglePermSummary, setShowGooglePermSummary] = useState(false);
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
  const [savedChatUndo, setSavedChatUndo] = useState(null);
  const savedChatUndoTimerRef = useRef(null);
  useEffect(() => () => { if (savedChatUndoTimerRef.current) clearTimeout(savedChatUndoTimerRef.current); }, []);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
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

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const chatAreaRef = useRef(null);

  // Daily briefing card: AI-generated rollup of today's schedule + open tasks.
  // Auto-loads once per session-day (gate via localStorage) and on demand from
  // the chat header button. Schema mirrors the server briefing JSON.
  const [briefingData, setBriefingData] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const briefingFetchedRef = useRef(false);

  async function loadBriefing() {
    if (briefingLoading) return;
    setBriefingLoading(true);
    try {
      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const todayStr = new Date().toISOString().slice(0, 10);
      const clientTasksPayload = tasks
        .filter(t => t.status !== 'done')
        .slice(0, 50)
        .map(t => ({ id: t.id, title: t.title, subject: t.subject, dueDate: t.dueDate, estTime: t.estTime, status: t.status, createdAt: t.createdAt, postponeCount: t.postponeCount || 0 }));
      const todaysEvents = events.filter(ev => ev.date === todayStr).map(ev => `${ev.title}${ev.time ? ' @ ' + ev.time : ''}`);
      const unfinishedTitles = tasks.filter(t => t.status !== 'done' && t.dueDate <= todayStr).map(t => t.title);
      const dynamicContext = `TODAY: ${todayStr}\nTODAY'S EVENTS: ${todaysEvents.join('; ') || '(none)'}\nUNFINISHED TASKS DUE TODAY OR EARLIER: ${unfinishedTitles.join('; ') || '(none)'}`;
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY) },
        body: JSON.stringify({
          mode: 'briefing',
          systemPrompt: 'You are SOS, a student-focused planner. Tone: warm, concise, second person.',
          dynamicContext,
          messages: [{ role: 'user', content: "Give me today's briefing." }],
          workspaceContext: 'schedule',
          clientTasks: clientTasksPayload,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.briefing) {
          setBriefingData({ ...data.briefing, _fetchedAt: Date.now() });
          try { localStorage.setItem('sos-last-briefing', todayStr); } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('Briefing load failed:', err);
    } finally {
      setBriefingLoading(false);
    }
  }

  useEffect(() => {
    if (!user || briefingFetchedRef.current) return;
    let last = '';
    try { last = localStorage.getItem('sos-last-briefing') || ''; } catch (_) {}
    const todayStr = new Date().toISOString().slice(0, 10);
    if (last === todayStr) return;
    briefingFetchedRef.current = true;
    // Small delay so initial Supabase fetches (tasks, events) populate first.
    const t = setTimeout(() => { loadBriefing(); }, 1500);
    return () => clearTimeout(t);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wikilink autocomplete on the chat input — opens an entity picker when the
  // user types `[[`. Inserts `[[Selected Name]]` on commit; ↵/Tab to confirm,
  // Esc to dismiss, ↑/↓ to navigate.
  const wikilinkChatHook = useWikilinkAutocomplete({
    value: input,
    setValue: setInput,
    inputRef,
    notes,
    events,
    tasks,
  });

  // Resizable columns + lock toggle for the lofi 3-column layout.
  const columnLayout = useColumnLayout();
  const studyAppRef = useRef(null);

  // Opt-in customizable home screen. Default disabled. Persisted in localStorage
  // under `sos_home_*` keys. Re-read on mount and whenever settings flip it.
  const [homePrefs, setHomePrefs] = useState(() => getHomePrefs());
  function updateHomePref(key, value) {
    setHomePref(key, value);
    setHomePrefs(prev => ({ ...prev, [key]: value }));
  }

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
  async function handleAuth(authUser, showWelcome = false) {
    if (showWelcome) {
      const name = authUser?.user_metadata?.full_name?.split(' ')[0] || authUser?.email?.split('@')[0] || 'there';
      const greetings = [
        `welcome back, ${name} ✦`,
        `good to see you, ${name} ✦`,
        `hey ${name} — ready to focus? ✦`,
        `back at it, ${name} ✦`,
        `let's get things done, ${name} ✦`,
        `great to have you, ${name} ✦`,
      ];
      const g = greetings[Math.floor(Math.random() * greetings.length)];
      setTimeout(() => setToastMsg(g), 600);
    }
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
      setEntityLinks(data.entityLinks || []);
      setStudyPlans(data.studyPlans || []);
    }

    // Load flashcard decks for AI tool access (read_study_sets, delete_study_set, read_project)
    try {
      const { data: decks } = await sb.from('flashcard_decks').select('*').eq('user_id', authUser.id).order('created_at', { ascending: false }).limit(100);
      setFlashcardDecks(decks || []);
    } catch (e) { console.error('Failed to load flashcard decks:', e); }

    try {
        const { data: gradesData } = await sb.from('grades').select('*').eq('user_id', authUser.id).order('created_at', { ascending: false }).limit(500);
        setGrades(gradesData || []);
      } catch (e) { console.error('Failed to load grades:', e); }

    // Rehydrate active timers — re-schedule unfired rows; fire-immediately any
    // whose fire_at is already past (laptop slept, tab closed, etc.).
    try {
      const { data: timerRows } = await sb.from('timers').select('*').eq('user_id', authUser.id).eq('fired', false);
      const rows = timerRows || [];
      const restored = rows.map(r => ({ id: r.id, label: r.label, fireAt: new Date(r.fire_at).getTime(), startedAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(), userId: authUser.id }));
      setActiveTimers(restored);
      restored.forEach(t => scheduleTimerFire(t));
    } catch(e) { console.error('Failed to load timers:', e); }

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

  // ── Restore accent color from localStorage before first paint ──
  useEffect(() => {
    const savedAccent = localStorage.getItem('sos_accent');
    if (savedAccent && /^#[0-9A-Fa-f]{6}$/.test(savedAccent)) {
      document.documentElement.style.setProperty('--primary', savedAccent);
      document.documentElement.style.setProperty('--accent-new', savedAccent);
      document.documentElement.style.setProperty('--primary-glow', savedAccent + '26');
    }
  }, []);

  // ── Honor ?panel= / ?focus= so Landing "Learn more" cards can deep-link ──
  useEffect(() => {
    const panel = searchParams.get('panel');
    const focus = searchParams.get('focus');
    const target = panel || focus;
    if (!target) return;
    if (['chat', 'home', 'settings', 'proofread'].includes(target)) setActivePanel(target);
    else if (target === 'tasks' || target === 'calendar') setActivePanel('chat');
  }, [searchParams]);

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
        setEntityLinks([]); setPendingLinkSuggestions([]);
        setPendingClarification(null); setPendingClarificationAnswers(null);
      }
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user && !user) {
        handleAuth(session.user, event === 'SIGNED_IN');
        setShowAuthModal(false);
        trackEvent(session.user.id, 'session_started'); // P4.2
      }
    });
    return () => subscription.unsubscribe();
  }, [user]);

  // ── Realtime multi-device sync ──
  // When another device inserts/updates/deletes a task, event, or note the change
  // is pushed here via Supabase's postgres_changes channel so the UI stays in sync
  // without a manual reload.
  useEffect(() => {
    if (!user) return;
    const channel = sb.channel('sos-user-data-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${user.id}` }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const row = payload.new;
          const t = { id: row.id, title: row.title, subject: row.subject || '', dueDate: row.due_date || '', estTime: row.est_time || 30, status: row.status || 'not_started', focusMinutes: row.focus_minutes || 0, createdAt: row.created_at };
          setTasks(prev => { const idx = prev.findIndex(x => x.id === t.id); return idx >= 0 ? prev.map((x, i) => i === idx ? t : x) : [...prev, t]; });
        } else if (payload.eventType === 'DELETE') {
          setTasks(prev => prev.filter(x => x.id !== payload.old.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `user_id=eq.${user.id}` }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          // Use the shared event shape so time/description/location/priority make it
          // through to the calendar without needing a page refresh.
          const ev = dbEventToApp(payload.new);
          setEvents(prev => { const idx = prev.findIndex(x => x.id === ev.id); return idx >= 0 ? prev.map((x, i) => i === idx ? ev : x) : [...prev, ev]; });
        } else if (payload.eventType === 'DELETE') {
          setEvents(prev => prev.filter(x => x.id !== payload.old.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${user.id}` }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const n = dbNoteToApp(payload.new);
          setNotes(prev => { const idx = prev.findIndex(x => x.id === n.id); return idx >= 0 ? prev.map((x, i) => i === idx ? n : x) : [...prev, n]; });
        } else if (payload.eventType === 'DELETE') {
          setNotes(prev => prev.filter(x => x.id !== payload.old.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_blocks', filter: `user_id=eq.${user.id}` }, () => {
        // Recurring blocks change rarely; re-fetch the small set rather than reconcile.
        sb.from('recurring_blocks').select('*').eq('user_id', user.id).then(({ data }) => {
          if (!data) return;
          const recurring = data.map(rb => ({
            name: rb.name, category: rb.category,
            start: rb.start_time?.slice(0, 5), end: rb.end_time?.slice(0, 5),
            days: rb.days || [],
          }));
          setBlocks(prev => ({ ...prev, recurring }));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'date_blocks', filter: `user_id=eq.${user.id}` }, () => {
        sb.from('date_blocks').select('*').eq('user_id', user.id).then(({ data }) => {
          if (!data) return;
          const dates = {};
          data.forEach(db => {
            const d = db.block_date;
            if (!dates[d]) dates[d] = {};
            dates[d][db.time_slot?.slice(0, 5)] = db.cleared
              ? null
              : { name: db.name, category: db.category };
          });
          setBlocks(prev => ({ ...prev, dates }));
        });
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
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
              // Show permission summary once on first connection
              setShowGooglePermSummary(true);
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

  // ── Notification scheduling: re-run whenever tasks, events, or prefs change ──
  useEffect(() => {
    if (!dataLoaded) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const notifications = buildNotifications(tasks, events, notifPrefs);
    scheduleNotificationsToSW(notifications);
  }, [tasks, events, notifPrefs, dataLoaded]);

  function updateNotifPref(key, val) {
    const next = { ...notifPrefs, [key]: val };
    setNotifPrefs(next);
    try { localStorage.setItem('sos-notif-prefs', JSON.stringify(next)); } catch(_) {}
  }

  // ── Sync helper: wraps a DB write with sync status ──
  async function syncOp(fn, label = '') {
    setSyncStatus('saving');
    try {
      await fn();
      setSyncStatus('saved');
    } catch (e) {
      console.error('Sync error:', e);
      setSyncStatus('error');
      // Surface a single soft error in the chat so the student knows persistence failed.
      // We do not rollback the local state — a subsequent save attempt (or a reload
      // after reconnecting) will resync. Debouncing prevents a flood of toasts.
      const now = Date.now();
      if (!syncOp._lastErrorAt || now - syncOp._lastErrorAt > 8000) {
        syncOp._lastErrorAt = now;
        const suffix = label ? ` while saving ${label}` : '';
        setMessages(prev => {
          const n = [...prev, {
            role: 'assistant',
            content: `I ran into trouble syncing${suffix} — your changes are still on this device, and I'll retry when the connection settles.`,
            timestamp: now,
            system: true,
          }];
          while (n.length > CHAT_MAX_MESSAGES) n.shift();
          return n;
        });
      }
    }
  }

  // Posts an assistant-side system note into the chat (used when an action
  // can't complete and the student needs to know why).
  function postAssistantNote(text) {
    if (!text) return;
    setMessages(prev => {
      const n = [...prev, { role: 'assistant', content: text, timestamp: Date.now() }];
      while (n.length > CHAT_MAX_MESSAGES) n.shift();
      return n;
    });
  }

  function pushUndoToast(label, snap) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ label, snap });
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 8000);
  }

  function doUndo() {
    if (!undoToast) return;
    const { snap } = undoToast;
    setTasks(snap.tasks);
    setEvents(snap.events);
    setNotes(snap.notes);
    setBlocks(snap.blocks);
    if (snap.flashcardDecks) setFlashcardDecks(snap.flashcardDecks);
    if (snap.grades) setGrades(snap.grades);
    setUndoToast(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    postAssistantNote("Done — I've undone that action.");
  }

  // ── Confirm-delete modal for saved chats ──
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(null);

  // Counts consecutive AI-generated clarifications so we can break loops.
  // Reset to 0 on every new user message; incremented each time the AI
  // responds with ask_clarification while fromClarification=true.
  const clarificationRoundtripCount = useRef(0);

  // ── Timers (set_timer tool) ──
  // activeTimers mirrors public.timers rows that haven't fired yet. The
  // setTimeout handle for each lives in timerTimeoutsRef so we can clear it
  // on dismiss/undo. Persisted so timers survive a reload.
  const [activeTimers, setActiveTimers] = useState([]);
  const timerTimeoutsRef = useRef(new Map());

  const scheduleTimerFire = useCallback((timer) => {
    const existing = timerTimeoutsRef.current.get(timer.id);
    if (existing) clearTimeout(existing);
    const ms = Math.max(0, timer.fireAt - Date.now());
    const h = setTimeout(() => {
      try { sfx.chime(); } catch(_) {}
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Timer done', { body: timer.label, tag: `sos-timer-${timer.id}` }); } catch(_) {}
      }
      setSosNotif({ label: 'Timer done', body: timer.label, accent: 'var(--accent)', duration: 8000 });
      if (timer.userId) {
        syncOp(() => sb.from('timers').update({ fired: true, dismissed_at: new Date().toISOString() }).eq('id', timer.id));
      }
      setActiveTimers(prev => prev.filter(t => t.id !== timer.id));
      timerTimeoutsRef.current.delete(timer.id);
    }, ms);
    timerTimeoutsRef.current.set(timer.id, h);
  }, []);

  // Cleanup pending timeouts on unmount so HMR doesn't double-fire.
  useEffect(() => {
    return () => {
      for (const h of timerTimeoutsRef.current.values()) clearTimeout(h);
      timerTimeoutsRef.current.clear();
    };
  }, []);

  function dismissActiveTimer(id) {
    const h = timerTimeoutsRef.current.get(id);
    if (h) { clearTimeout(h); timerTimeoutsRef.current.delete(id); }
    setActiveTimers(prev => prev.filter(t => t.id !== id));
    if (user) syncOp(() => sb.from('timers').update({ fired: true, dismissed_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id));
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
    function recordExecution(type, summary) {
      const entry = { type, summary, executedAt: Date.now() };
      recentlyExecutedActionsRef.current = [
        ...recentlyExecutedActionsRef.current.filter(e => Date.now() - e.executedAt < 120000),
        entry,
      ].slice(-10);
    }

    // ── Confidence gate ──
    // Items the model marked tentative or low-confidence go to the review rail
    // instead of mutating state. Singletons with confidence >= 0.85 still
    // auto-apply (the cutoff is high enough that the rail catches anything
    // hedged). __confirmed bypasses the gate when the user has already approved
    // an item from the rail.
    const mutatingTypes = new Set([
      'add_task','add_event','add_block','add_recurring_event',
      'update_task','update_event','delete_task','delete_event','delete_block',
      'complete_task','convert_event_to_block','convert_block_to_event',
      'break_task','clear_all','delete_study_set',
      'update_block','postpone_task','bulk_complete',
      'rename_note','move_note','create_folder','log_grade','update_study_set',
    ]);
    if (mutatingTypes.has(action.type) && !action.__confirmed) {
      const conf = typeof action.confidence === 'number' ? action.confidence : null;
      const tentative = action.status === 'tentative' || action.commitment === 'tentative';
      const lowConf = conf != null && conf < 0.7;
      const autoConf = conf != null && conf >= 0.85;
      if ((lowConf || tentative) && !autoConf) {
        const reason = tentative && !lowConf ? 'tentative' : 'low_confidence';
        setPendingActions(prev => [...prev, { action, reason, confidence: conf }]);
        return;
      }
    }

    // Snapshot state before any mutation so the user can undo within 8 seconds
    const undoSnap = { tasks: tasks.slice(), events: events.slice(), notes: notes.slice(), blocks: JSON.parse(JSON.stringify(blocks)), flashcardDecks: flashcardDecks.slice(), grades: grades.slice() };
    try {
      switch (action.type) {
        case 'add_task': {
          const taskName = (action.task_name || action.title || '').trim();
          const rawDue = (action.due_date || action.due || '').trim();
          const titleValid = taskName && taskName.length >= 3;
          const dueValid = rawDue && /^\d{4}-\d{2}-\d{2}$/.test(rawDue);
          const normalized = { ...action, type: 'add_task', title: titleValid ? taskName : '', due_date: dueValid ? rawDue : '' };
          const { valid, missing_required } = validateActionSchema(normalized);
          if (!valid) {
            const known = {};
            if (titleValid) known.task_name = taskName;
            if (dueValid) known.due_date = rawDue;
            if (action.subject) known.subject = action.subject;
            if (action.estimated_minutes) known.estimated_minutes = action.estimated_minutes;
            const missing = missing_required.map(f => f === 'title' ? 'task_name' : f);
            setPendingClarification(buildLocalClarification({
              contextAction: 'add_task',
              knownFields: known,
              missingFields: missing,
              message: missing.length > 1 ? "I need a couple details for this task." : (missing[0] === 'task_name' ? "What should I call this task?" : "When is this task due?"),
              suggestedDefaults: { subject: action.subject || '', est_time: action.estimated_minutes || 30 },
            }));
            return;
          }
          // Detect unparseable dates ("next purple") up front so we can tell the user
          // what happened instead of silently pinning the task to today.
          let dateParsedOk = true;
          const normalizedDue = (() => {
            const d = new Date(rawDue + 'T12:00:00');
            if (isNaN(d.getTime())) { dateParsedOk = false; return today(); }
            try { return toDateStr(d); } catch (_) { dateParsedOk = false; return today(); }
          })();
          if (!dateParsedOk && rawDue) {
            setTimeout(() => postAssistantNote(`I couldn't read "${rawDue}" as a date, so I set the task for today — you can say "set the due date for ${taskName} to [date]" to change it.`), 400);
          }
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
            const correctedDayName = corrected.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            setTimeout(() => postAssistantNote(`heads up — I moved the due date to ${correctedDayName} since ${normalizedDue} was in the past. say "set the date to [actual date]" if you meant something else.`), 400);
          }
          const task = { id:uid(), title:taskName, subject:action.subject||'', dueDate:finalDue, estTime:action.estimated_minutes||30, status:(action.status && action.status !== 'tentative' && action.status !== 'confirmed') ? action.status : 'not_started', focusMinutes:0, createdAt:new Date().toISOString(), confidence: typeof action.confidence === 'number' ? action.confidence : null, commitment: action.commitment === 'tentative' ? 'tentative' : 'confirmed' };
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
          if (user) dbInsertTaskEvent({ taskId: task.id, eventType: 'create', toStatus: task.status, metadata: { title: task.title, subject: task.subject, due_date: task.dueDate } }, user.id);
          if (user) trackEvent(user.id, 'action_confirmed', { type: 'add_task' });
          recordExecution('add_task', `"${task.title}" due ${task.dueDate}`);
          pushUndoToast(`Undo: added "${task.title}"`, undoSnap);
          break;
        }
        case 'complete_task': {
          const target = action.task_id
            ? tasks.find(t => t.id === action.task_id)
            : (action.title ? resolveTask(action.title, tasks) : null);
          if (!target) {
            postAssistantNote("I couldn't find that task to mark complete — the name didn't match anything on your list. Want me to show what's there?");
            break;
          }
          const completedAt = new Date().toISOString();
          updateTask(target.id, { status:'done', completedAt });
          setRecentlyCompleted(prev => { const n = new Set(prev); n.add(target.id); return n; });
          setTimeout(() => setRecentlyCompleted(prev => { const n = new Set(prev); n.delete(target.id); return n; }), 900);
          if (user) dbInsertTaskEvent({ taskId: target.id, eventType: 'complete', fromStatus: target.status, toStatus: 'done', metadata: { title: target.title, subject: target.subject } }, user.id);
          if (user) trackEvent(user.id, 'action_confirmed', { type: 'complete_task' });
          recordExecution('complete_task', `"${target.title}"`);
          pushUndoToast(`Undo: completed "${target.title}"`, undoSnap);
          break;
        }
        case 'update_task': {
          const target = action.task_id
            ? tasks.find(t => t.id === action.task_id)
            : (action.title ? resolveTask(action.title, tasks) : null);
          if (!target) {
            postAssistantNote("I couldn't find that task to update — could you name it exactly as it appears on your list?");
            break;
          }
          const newTitleRaw = action.new_title;
          const newTitleClean = typeof newTitleRaw === 'string' ? newTitleRaw.trim() : '';
          if (newTitleRaw !== undefined && newTitleRaw !== null && (!newTitleClean || newTitleClean.length < 2)) {
            setPendingClarification({ question: "What should I rename this task to?", context_action: 'update_task', missing_fields: ['new_title'] });
            return;
          }
          const upd = {};
          if (newTitleClean) upd.title = newTitleClean;
          if (action.due) {
            const d = new Date(action.due + 'T12:00:00');
            if (isNaN(d.getTime())) {
              postAssistantNote(`I couldn't read "${action.due}" as a date, so I kept the current due date. Say something like "set the due date for ${target.title} to next Monday" to change it.`);
            } else {
              const newDue = toDateStr(d);
              upd.dueDate = newDue;
              // Emit postpone event when the new due date is later and task isn't done.
              if (user && target.status !== 'done' && newDue > target.dueDate) {
                const daysDiff = Math.round((d.getTime() - new Date(target.dueDate + 'T12:00:00').getTime()) / 86400000);
                upd.postponeCount = (target.postponeCount || 0) + 1;
                dbInsertTaskEvent({ taskId: target.id, eventType: 'postpone', fromStatus: target.status, toStatus: target.status, metadata: { title: target.title, subject: target.subject, from_due: target.dueDate, to_due: newDue, days_diff: daysDiff } }, user.id);
              }
            }
          }
          if (action.estimated_minutes) upd.estTime = action.estimated_minutes;
          if (Object.keys(upd).length > 0) updateTask(target.id, upd);
          break;
        }
        case 'add_block': {
          const activity = (action.activity || '').trim();
          if (!activity || activity.length < 2) {
            setPendingClarification({ question: "What should I call this block?", context_action: 'add_block', missing_fields: ['activity'] });
            return;
          }
          const date = (action.date || '').trim();
          if (!date) {
            setPendingClarification({ question: "What date is this block for?", context_action: 'add_block', missing_fields: ['date'] });
            return;
          }
          const hmOk = (t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(t || '').trim());
          if (!hmOk(action.start) || !hmOk(action.end)) {
            postAssistantNote(`I need a valid start and end time (like 15:00 to 17:00) to add that block — could you restate the times?`);
            break;
          }
          const [sh,sm] = action.start.split(':').map(Number);
          const [eh,em] = action.end.split(':').map(Number);
          if (eh < sh || (eh === sh && em <= sm)) {
            postAssistantNote(`The end time needs to be after the start time. Want to try again?`);
            break;
          }
          const slotOps = [];
          setBlocks(prev => {
            const newDates = { ...(prev.dates||{}) };
            const dayBlocks = { ...(newDates[date]||{}) };
            let ch=sh, cm=sm;
            while (ch<eh||(ch===eh&&cm<em)) {
              const key = String(ch).padStart(2,'0')+':'+String(cm).padStart(2,'0');
              const data = { name:activity, category:action.category||'school' };
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
          const evTitle = (action.title || '').trim();
          const rawEvDate = (action.date || '').trim();
          const titleValid = evTitle && evTitle.length >= 2;
          const dateValid = rawEvDate && /^\d{4}-\d{2}-\d{2}$/.test(rawEvDate);
          const normalized = { ...action, type: 'add_event', title: titleValid ? evTitle : '', date: dateValid ? rawEvDate : '' };
          const { valid, missing_required } = validateActionSchema(normalized);
          if (!valid) {
            const known = {};
            if (titleValid) known.title = evTitle;
            if (dateValid) known.date = rawEvDate;
            if (action.subject) known.subject = action.subject;
            if (action.event_type) known.event_type = action.event_type;
            if (action.time) known.time = action.time;
            if (action.endTime) known.endTime = action.endTime;
            if (action.location) known.location = action.location;
            if (action.description) known.description = action.description;
            setPendingClarification(buildLocalClarification({
              contextAction: 'add_event',
              knownFields: known,
              missingFields: missing_required,
              message: missing_required.length > 1 ? "I need a couple details for this event." : (missing_required[0] === 'title' ? "What should I call this event?" : "What date?"),
              suggestedDefaults: { event_type: action.event_type || 'other', subject: action.subject || '' },
            }));
            return;
          }
          const normalizedEvDate = (() => { try { return toDateStr(new Date(rawEvDate + 'T12:00:00')); } catch(_) { return today(); } })();
          const ev = { id:uid(), title:evTitle, type:action.event_type||'other', subject:action.subject||'', date:normalizedEvDate, time:action.time||null, end_time:action.endTime||action.end_time||null, description:action.description||'', location:action.location||'', priority:action.priority||'medium', recurring:'none', createdAt:new Date().toISOString(), source:'manual', googleId:null, confidence: typeof action.confidence === 'number' ? action.confidence : null, status: action.status === 'tentative' ? 'tentative' : 'confirmed' };
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
          if (user) {
            const eventEntity = { type: 'event', id: ev.id, title: ev.title };
            syncWikilinksForEntity(eventEntity, ev.description || '');
            maybeSuggestLink(eventEntity);
          }
          recordExecution('add_event', `"${ev.title}" on ${ev.date}`);
          window.dispatchEvent(new CustomEvent('sos:calendar:new-event', { detail: { id: ev.id } }));
          pushUndoToast(`Undo: added "${ev.title}"`, undoSnap);
          // Passive study generation: an exam/test/quiz auto-spawns a study pack
          // linked to the event so material is ready before the deadline.
          if (['test','exam','quiz'].includes(ev.type)) {
            generateStudyPackInBackground({ subject: ev.subject, topic: ev.title, linkedEventId: ev.id, sourceKind: 'event' });
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
        case 'add_note': {
          const tabName = (action.title || action.tab_name || '').trim();
          const subjectRaw = (action.subject || '').trim();
          // Tolerate either the enum value or the human label the clarification
          // card surfaces (e.g. "AI write" → "ai_generated").
          const sourceRaw = (action.source || '').toString().toLowerCase();
          const source = ['user','imported','ai_generated'].includes(sourceRaw)
            ? sourceRaw
            : sourceRaw.includes('ai') ? 'ai_generated'
            : sourceRaw.includes('paste') || sourceRaw.includes('import') ? 'imported'
            : sourceRaw.includes('write') || sourceRaw.includes('myself') ? 'user'
            : '';
          // Three-step clarification chain: subject → source → title.
          // Use buildLocalClarification so known fields ride along — otherwise
          // each step would round-trip through the AI and previously-extracted
          // fields could get dropped.
          const knownNoteFields = {};
          if (tabName) knownNoteFields.title = tabName;
          if (subjectRaw) knownNoteFields.subject = subjectRaw;
          if (source) knownNoteFields.source = source;
          if (action.content) knownNoteFields.content = action.content;
          if (!subjectRaw) {
            setPendingClarification(buildLocalClarification({
              contextAction: 'add_note',
              knownFields: knownNoteFields,
              missingFields: ['subject'],
              message: "Which subject is this note under?",
              optionsByField: { subject: SUBJECT_LIST.slice(0, 6) },
            }));
            return;
          }
          if (!source) {
            setPendingClarification(buildLocalClarification({
              contextAction: 'add_note',
              knownFields: knownNoteFields,
              missingFields: ['source'],
              message: "Should I write it, do you want to paste/import, or are you writing it yourself?",
              optionsByField: { source: ["I'll write it", "Paste/import", "AI write"] },
            }));
            return;
          }
          if (!tabName || tabName.length < 2) {
            setPendingClarification(buildLocalClarification({
              contextAction: 'add_note',
              knownFields: knownNoteFields,
              missingFields: ['title'],
              message: "What should I name this note?",
            }));
            return;
          }
          // Resolve/create the subject folder so this note lives under it.
          const folderName = normalize(subjectRaw); // canonical subject name
          let folderId = null;
          if (folderName) {
            const existingFolder = notes.find(n => n.is_folder && (n.name || '').toLowerCase() === folderName.toLowerCase());
            if (existingFolder) {
              folderId = existingFolder.id;
            } else {
              const folder = { id: uid(), name: folderName, content: '', updatedAt: new Date().toISOString(), is_folder: true, parent_id: null };
              setNotes(prev => [...prev, folder]);
              if (user) syncOp(() => dbUpsertNote(folder, user.id));
              folderId = folder.id;
            }
          }
          const content = action.content || '';
          let savedNote = null;
          setNotes(prev => {
            const existing = prev.findIndex(n => !n.is_folder && n.name.toLowerCase() === tabName.toLowerCase());
            if (existing >= 0) {
              const updated = prev.map((n,i) => i===existing ? { ...n, content:n.content+(n.content?'\n':'')+content, updatedAt:new Date().toISOString(), parent_id: folderId || n.parent_id } : n);
              if (user) syncOp(() => dbUpsertNote(updated[existing], user.id));
              savedNote = updated[existing];
              return updated;
            }
            const newNote = { id:uid(), name:tabName, content, updatedAt:new Date().toISOString(), is_folder: false, parent_id: folderId };
            if (user) syncOp(() => dbUpsertNote(newNote, user.id));
            savedNote = newNote;
            return [...prev, newNote];
          });
          if (user && savedNote) {
            const noteEntity = { type: 'note', id: savedNote.id, title: savedNote.name };
            syncWikilinksForEntity(noteEntity, savedNote.content || '');
            maybeSuggestLink(noteEntity);
          }
          if (user) trackEvent(user.id, 'action_confirmed', { type: 'add_note', source });
          recordExecution('add_note', `note "${tabName}"${folderName ? ` in ${folderName}` : ''}`);
          window.dispatchEvent(new CustomEvent('sos:notes:created', { detail: { name: tabName, subject: folderName } }));
          pushUndoToast(`Undo: created note "${tabName}"`, undoSnap);
          break;
        }
        case 'set_timer': {
          const PRESETS = { pomodoro: 25 * 60, short_break: 5 * 60, long_break: 15 * 60 };
          const label = (action.label || action.title || '').trim();
          // Accept either a number (1200) or a natural phrase ("20 min", "1 hour",
          // "25 min (pomodoro)") — the clarification chip values arrive as strings.
          const parseDurationToSeconds = (val) => {
            if (val === undefined || val === null || val === '') return 0;
            if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0, Math.floor(val));
            const s = String(val).toLowerCase().trim();
            if (/pomodoro/.test(s)) return PRESETS.pomodoro;
            if (/short[\s_-]?break/.test(s)) return PRESETS.short_break;
            if (/long[\s_-]?break/.test(s)) return PRESETS.long_break;
            const n = parseFloat(s);
            if (!Number.isFinite(n) || n <= 0) return 0;
            if (/sec/.test(s)) return Math.floor(n);
            if (/hour|hr\b/.test(s)) return Math.floor(n * 3600);
            if (/min/.test(s)) return Math.floor(n * 60);
            return Math.floor(n);
          };
          let durationSeconds = parseDurationToSeconds(action.duration_seconds);
          if (!durationSeconds && action.preset && PRESETS[action.preset]) durationSeconds = PRESETS[action.preset];
          const fireAt = action.fire_at
            ? new Date(action.fire_at).getTime()
            : (durationSeconds > 0 ? Date.now() + durationSeconds * 1000 : 0);
          const knownTimerFields = {};
          if (label) knownTimerFields.label = label;
          if (durationSeconds > 0) knownTimerFields.duration_seconds = durationSeconds;
          if (action.fire_at) knownTimerFields.fire_at = action.fire_at;
          if (action.preset) knownTimerFields.preset = action.preset;
          if (!label) {
            setPendingClarification(buildLocalClarification({
              contextAction: 'set_timer',
              knownFields: knownTimerFields,
              missingFields: ['label'],
              message: "What should I call this timer?",
            }));
            return;
          }
          if (!fireAt || isNaN(fireAt) || fireAt <= Date.now()) {
            setPendingClarification(buildLocalClarification({
              contextAction: 'set_timer',
              knownFields: knownTimerFields,
              missingFields: ['duration_seconds'],
              message: "How long should I run the timer?",
              optionsByField: { duration_seconds: ["5 min", "10 min", "20 min", "25 min (pomodoro)", "45 min", "1 hour"] },
            }));
            return;
          }
          if (fireAt - Date.now() > 86400 * 1000) {
            postAssistantNote("That's more than 24 hours away — try adding it as an event instead.");
            return;
          }
          // Request notification permission lazily on first timer (best effort).
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
            try { Notification.requestPermission(); } catch(_) {}
          }
          const timer = { id: uid(), label, fireAt, startedAt: Date.now(), userId: user?.id };
          setActiveTimers(prev => [...prev, timer]);
          scheduleTimerFire(timer);
          // Auto-open the timer widget so the user sees the countdown ring
          setActiveWidgets(w => ({ ...w, pomodoro: true }));
          if (user) syncOp(() => sb.from('timers').insert({ id: timer.id, user_id: user.id, label, fire_at: new Date(fireAt).toISOString() }));
          if (user) trackEvent(user.id, 'action_confirmed', { type: 'set_timer' });
          const remaining = Math.round((fireAt - Date.now()) / 1000);
          const human = remaining >= 60 ? `${Math.round(remaining/60)} min` : `${remaining}s`;
          recordExecution('set_timer', `timer "${label}" for ${human}`);
          setSosNotif({ label: 'Timer started', body: `${label} · ${human}`, accent: 'var(--accent)', duration: 3000 });
          pushUndoToast(`Undo: started "${label}" timer`, undoSnap);
          break;
        }
        case 'cancel_timer': {
          const raw = (action.label || '').trim().toLowerCase();
          if (!raw) { postAssistantNote("Which timer should I cancel?"); return; }
          // Find best match: exact → startsWith → includes (case-insensitive)
          const snapshot = activeTimers;
          const exact   = snapshot.find(t => t.label.toLowerCase() === raw);
          const starts  = snapshot.find(t => t.label.toLowerCase().startsWith(raw));
          const includes = snapshot.find(t => t.label.toLowerCase().includes(raw));
          const match = exact || starts || includes;
          if (!match) {
            const running = snapshot.length > 0
              ? `Running timers: ${snapshot.map(t => `"${t.label}"`).join(', ')}.`
              : 'No timers are currently running.';
            postAssistantNote(`Couldn't find a timer matching "${action.label}". ${running}`);
            return;
          }
          dismissActiveTimer(match.id);
          if (user) trackEvent(user.id, 'action_confirmed', { type: 'cancel_timer' });
          recordExecution('cancel_timer', `cancelled "${match.label}"`);
          setSosNotif({ label: 'Timer cancelled', body: match.label, accent: 'var(--accent)', duration: 3000 });
          break;
        }
        case 'edit_note': {
          const noteId = action.note_id;
          const newContent = action.new_content || '';
          setNotes(prev => {
            const updated = prev.map(n => n.id === noteId ? { ...n, content: newContent, updatedAt: new Date().toISOString() } : n);
            const note = updated.find(n => n.id === noteId);
            if (note && user) {
              syncOp(() => dbUpsertNote(note, user.id));
              const noteEntity = { type: 'note', id: note.id, title: note.name };
              syncWikilinksForEntity(noteEntity, note.content || '');
              maybeSuggestLink(noteEntity);
            }
            return updated;
          });
          break;
        }
        case 'delete_note': {
          const noteId = action.note_id;
          setNotes(prev => prev.filter(n => n.id !== noteId));
          if (user) {
            syncOp(() => sb.from('notes').delete().eq('id', noteId).eq('user_id', user.id));
            const orphaned = entityLinks.filter(l =>
              (l.source_type === 'note' && l.source_id === noteId) ||
              (l.target_type === 'note' && l.target_id === noteId));
            orphaned.forEach(l => syncOp(() => dbDeleteEntityLink(l.id, user.id)));
            setEntityLinks(prev => prev.filter(l => !orphaned.find(o => o.id === l.id)));
          }
          break;
        }
        case 'break_task': {
          const validSubtasks = (action.subtasks || [])
            .map(st => ({ ...st, _title: typeof st.title === 'string' ? st.title.trim() : '' }))
            .filter(st => st._title.length >= 2);
          if (validSubtasks.length === 0) {
            setPendingClarification({ question: "What parts should I break this task into?", context_action: 'break_task', missing_fields: ['subtasks'] });
            return;
          }
          const newTasks = validSubtasks.map(st => ({
            id:uid(), title:st._title, subject:action.parent_title||'', dueDate:st.due||today(), estTime:st.estimated_minutes||20, status:'not_started', focusMinutes:0, createdAt:new Date().toISOString()
          }));
          setTasks(prev => [...prev, ...newTasks]);
          if (user && newTasks.length > 0) syncOp(() => Promise.all(newTasks.map(t => dbUpsertTask(t, user.id))));
          break;
        }
        case 'delete_task': {
          const match = resolveTask(action.title || action.task_id, tasks);
          if (!match) {
            postAssistantNote(`I couldn't find a task called "${action.title || action.task_id || 'that'}" to delete. It may already be gone.`);
            break;
          }
          setTasks(prev => prev.filter(t => t.id !== match.id));
          if (user) syncOp(() => dbDeleteTask(match.id, user.id), 'the task');
          if (user) {
            const orphaned = entityLinks.filter(l =>
              (l.source_type === 'task' && l.source_id === match.id) ||
              (l.target_type === 'task' && l.target_id === match.id));
            orphaned.forEach(l => syncOp(() => dbDeleteEntityLink(l.id, user.id)));
            setEntityLinks(prev => prev.filter(l => !orphaned.find(o => o.id === l.id)));
          }
          if (user && match.status !== 'done') {
            const ageDays = match.createdAt ? Math.round((Date.now() - new Date(match.createdAt).getTime()) / 86400000) : 0;
            dbInsertTaskEvent({ taskId: match.id, eventType: 'abandon', fromStatus: match.status, metadata: { title: match.title, subject: match.subject, age_days: ageDays, prior_postpones: match.postponeCount || 0 } }, user.id);
          }
          if (user) trackEvent(user.id, 'action_confirmed', { type: 'delete_task' });
          recordExecution('delete_task', `"${match.title}"`);
          pushUndoToast(`Undo: deleted "${match.title}"`, undoSnap);
          break;
        }
        case 'delete_event': {
          const match = resolveEvent(action.title || action.event_id, events);
          if (!match) {
            postAssistantNote(`I couldn't find an event called "${action.title || action.event_id || 'that'}" to remove.`);
            break;
          }
          setEvents(prev => prev.filter(ev => ev.id !== match.id));
          if (user) syncOp(() => dbDeleteEvent(match.id, user.id), 'the event');
          if (user) {
            const orphaned = entityLinks.filter(l =>
              (l.source_type === 'event' && l.source_id === match.id) ||
              (l.target_type === 'event' && l.target_id === match.id));
            orphaned.forEach(l => syncOp(() => dbDeleteEntityLink(l.id, user.id)));
            setEntityLinks(prev => prev.filter(l => !orphaned.find(o => o.id === l.id)));
          }
          if (match.googleId && isGoogleConnected() && calSyncEnabled) {
            deleteEventFromGoogle(match.googleId, googleToken);
          }
          recordExecution('delete_event', `"${match.title}"`);
          pushUndoToast(`Undo: removed "${match.title}"`, undoSnap);
          break;
        }
        case 'update_event': {
          const match = resolveEvent(action.title || action.event_id, events);
          if (!match) {
            postAssistantNote(`I couldn't find "${action.title || action.event_id || 'that event'}" to update. Could you tell me the exact title?`);
            break;
          }
          const newTitleClean = typeof action.new_title === 'string' ? action.new_title.trim() : '';
          if (action.new_title !== undefined && (!newTitleClean || newTitleClean.length < 2)) {
            setPendingClarification({ question: "What should I rename this event to?", context_action: 'update_event', missing_fields: ['new_title'] });
            return;
          }
          const eventDateChanged = action.date && action.date !== match.date;
          setEvents(prev => {
            const next = prev.map(ev => ev.id === match.id ? {
              ...ev,
              ...(newTitleClean && { title: newTitleClean }),
              ...(action.date && { date: action.date }),
              ...(action.event_type && { type: action.event_type }),
              ...(action.subject !== undefined && { subject: action.subject }),
              ...(action.description !== undefined && { description: action.description })
            } : ev);
            const updated = next.find(ev => ev.id === match.id);
            if (updated && user) syncOp(() => dbUpsertEvent(updated, user.id), 'the event');
            if (updated && updated.googleId && isGoogleConnected() && calSyncEnabled) {
              pushEventToGoogle(updated, googleToken);
            }
            if (updated && user && action.description !== undefined) {
              const eventEntity = { type: 'event', id: updated.id, title: updated.title };
              syncWikilinksForEntity(eventEntity, updated.description || '');
              maybeSuggestLink(eventEntity);
            }
            return next;
          });
          if (user && eventDateChanged) {
            dbInsertTaskEvent({ eventId: match.id, eventType: 'postpone', metadata: { title: match.title, from_date: match.date, to_date: action.date } }, user.id);
          }
          recordExecution('update_event', `"${match.title}"`);
          pushUndoToast(`Undo: updated "${match.title}"`, undoSnap);
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
        case 'view_schedule':
          break;
        case 'read_calendar': {
          const startD = action.start_date || today();
          const endD = action.end_date || (() => { const d = new Date(startD + 'T12:00:00'); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })();
          const isSingleDay = startD === endD;
          const isMonthRange = !isSingleDay && (() => {
            const diffDays = Math.round((new Date(endD + 'T00:00:00') - new Date(startD + 'T00:00:00')) / 86400000);
            return diffDays >= 20;
          })();
          const lines = [];

          // ── Helper: build merged block map for a given date ──
          function buildBlocksForDate(ds) {
            const dow = new Date(ds + 'T12:00:00').getDay();
            const slots = {};
            (blocks.recurring || []).forEach(rb => {
              if (rb.days.includes(dow)) {
                const [sh, sm] = rb.start.split(':').map(Number);
                const [eh, em] = rb.end.split(':').map(Number);
                let ch = sh, cm = sm;
                while (ch < eh || (ch === eh && cm < em)) {
                  slots[String(ch).padStart(2,'0') + ':' + String(cm).padStart(2,'0')] = { name: rb.name, category: rb.category };
                  cm += 30; if (cm >= 60) { ch++; cm = 0; }
                }
              }
            });
            Object.entries(blocks.dates?.[ds] || {}).forEach(([k, v]) => {
              if (v === null) delete slots[k]; else slots[k] = v;
            });
            return slots;
          }

          if (isSingleDay) {
            // ── Single-day view: full schedule with blocks ──
            const dow = new Date(startD + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
            lines.push(`**Schedule for ${dow}, ${fmtFull(startD)}**`);

            const daySlots = buildBlocksForDate(startD);
            const blockRanges = summarizeBlockSlots(daySlots);

            const dayEvents = events
              .filter(e => e.date === startD)
              .sort((a, b) => (a.time || a.start_time || '23:59').localeCompare(b.time || b.start_time || '23:59'));
            const dayTasks = tasks.filter(t => t.dueDate === startD && t.status !== 'done');

            if (blockRanges.length === 0 && dayEvents.length === 0 && dayTasks.length === 0) {
              lines.push('Nothing scheduled — free day.');
            } else {
              if (blockRanges.length > 0) {
                lines.push('\n**Time blocks:**');
                blockRanges.forEach(b => lines.push(`- ${b}`));
              }
              if (dayEvents.length > 0) {
                lines.push('\n**Events:**');
                dayEvents.forEach(e => {
                  const timeStr = e.time || e.start_time ? ` at ${e.time || e.start_time}` : '';
                  const typeStr = e.event_type && e.event_type !== 'event' ? ` [${e.event_type}]` : '';
                  lines.push(`- ${e.title}${timeStr}${typeStr}`);
                });
              }
              if (dayTasks.length > 0) {
                lines.push('\n**Tasks due today:**');
                dayTasks.forEach(t => {
                  const sub = t.subject ? ` (${t.subject})` : '';
                  lines.push(`- ${t.title}${sub}`);
                });
              }
            }
          } else {
            // ── Multi-day / month view ──
            const rangeLabel = `${fmt(startD)} – ${fmt(endD)}`;
            lines.push(`**Calendar: ${rangeLabel}**`);

            // Important events: tests, exams, quizzes, high-priority, or sport events
            const importantTypes = new Set(['test','exam','quiz','game','match','meet','tournament']);
            const rangeEvents = events
              .filter(e => e.date >= startD && e.date <= endD)
              .sort((a, b) => a.date.localeCompare(b.date));
            const importantEvents = rangeEvents.filter(e =>
              importantTypes.has(e.event_type) || e.priority === 'high'
            );
            const otherEvents = rangeEvents.filter(e =>
              !importantTypes.has(e.event_type) && e.priority !== 'high'
            );

            const rangeTasks = tasks
              .filter(t => t.dueDate >= startD && t.dueDate <= endD && t.status !== 'done')
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

            if (rangeEvents.length === 0 && rangeTasks.length === 0) {
              lines.push(`Nothing scheduled in this period.`);
            } else {
              if (importantEvents.length > 0) {
                lines.push('\n**Important events:**');
                importantEvents.forEach(e => {
                  const dStr = fmtFull(e.date);
                  const typeStr = e.event_type ? ` [${e.event_type}]` : '';
                  const sub = e.subject ? ` — ${e.subject}` : '';
                  lines.push(`- ${e.title}${typeStr} · ${dStr}${sub}`);
                });
              }
              if (otherEvents.length > 0) {
                lines.push('\n**Other events:**');
                otherEvents.forEach(e => {
                  const dStr = fmt(e.date);
                  const timeStr = e.time || e.start_time ? ` at ${e.time || e.start_time}` : '';
                  lines.push(`- ${e.title} · ${dStr}${timeStr}`);
                });
              }
              if (rangeTasks.length > 0) {
                lines.push('\n**Tasks due:**');
                rangeTasks.forEach(t => {
                  const sub = t.subject ? ` (${t.subject})` : '';
                  const d = daysUntil(t.dueDate);
                  const urgency = d < 0 ? ' ⚠️ overdue' : d === 0 ? ' — today' : d === 1 ? ' — tomorrow' : '';
                  lines.push(`- ${t.title}${sub} · due ${fmt(t.dueDate)}${urgency}`);
                });
              }

              // Monthly digest: count by type
              if (isMonthRange && (importantEvents.length > 0 || rangeEvents.length > 3)) {
                const typeCounts = {};
                rangeEvents.forEach(e => {
                  const k = e.event_type || 'event';
                  typeCounts[k] = (typeCounts[k] || 0) + 1;
                });
                const summary = Object.entries(typeCounts).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ');
                lines.push(`\n_Summary: ${summary}; ${rangeTasks.length} task${rangeTasks.length !== 1 ? 's' : ''} due_`);
              }
            }
          }

          const calContent = lines.join('\n');
          const calMsg = { role: 'assistant', content: calContent, timestamp: Date.now() };
          setMessages(prev => { const n = [...prev, calMsg]; while (n.length > CHAT_MAX_MESSAGES) n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', calContent, user.id);
          break;
        }
        case 'clear_all':
          // Defensive guard: clear_all is destructive. We require an explicit confirm=true
          // from the model AND route through a proposal card so the student gets one more chance.
          if (action.confirm !== true) {
            postAssistantNote("To wipe everything I'll need you to say it plainly — e.g. 'yes, clear all my tasks, events, and blocks'.");
            break;
          }
          setTasks([]);
          setEvents([]);
          setBlocks({ dates:{} });
          if (user) {
            syncOp(() => Promise.all([
              sb.from('tasks').delete().eq('user_id', user.id),
              sb.from('events').delete().eq('user_id', user.id),
              sb.from('date_blocks').delete().eq('user_id', user.id)
            ]), 'your cleared data');
          }
          recordExecution('clear_all', 'all data wiped');
          pushUndoToast('Undo: clear all data', undoSnap);
          break;
        case 'prioritize_tasks': {
          const horizonDays = Number(action.horizon_days) || 7;
          const limit = Number(action.limit) || 5;
          const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + horizonDays);
          const cutoffStr = cutoff.toISOString().slice(0, 10);
          const active = tasks
            .filter(t => t.status !== 'done' && t.dueDate <= cutoffStr)
            .slice(0, 50);
          if (active.length === 0) {
            postAssistantNote(`No tasks due in the next ${horizonDays} days — you're clear!`);
            break;
          }
          const density = buildCalendarDensity(active, blocks.dates || {});
          const ranked = rankTasks(active, new Date(), density, undefined, limit);
          const taskById = Object.fromEntries(active.map(t => [t.id, t]));
          const lines = ranked.map((r, i) => {
            const t = taskById[r.taskId];
            if (!t) return null;
            const isPast = t.dueDate < today();
            const dayLabel = isPast ? `(overdue — was due ${t.dueDate})` : `due ${t.dueDate}`;
            return `${i + 1}. **${t.title}** ${dayLabel}${t.subject ? ' · ' + t.subject : ''} — ${r.explanation}`;
          }).filter(Boolean);
          const msg = `here's what matters most right now:\n\n${lines.join('\n')}`;
          postAssistantNote(msg);
          recordExecution('prioritize_tasks', `top ${ranked.length} tasks`);
          break;
        }
        case 'delete_study_set': {
          const titleSearch = (action.title || '').toLowerCase().trim();
          const match = flashcardDecks.find(d =>
            d.title.toLowerCase().includes(titleSearch) ||
            titleSearch.includes(d.title.toLowerCase())
          );
          if (!match) {
            postAssistantNote(`I couldn't find a flashcard deck called "${action.title}" to delete.`);
            break;
          }
          setFlashcardDecks(prev => prev.filter(d => d.id !== match.id));
          if (user) syncOp(() => sb.from('flashcard_decks').delete().eq('id', match.id).eq('user_id', user.id));
          recordExecution('delete_study_set', `"${match.title}"`);
          pushUndoToast(`Undo: deleted study set "${match.title}"`, undoSnap);
          break;
        }
        case 'read_notes': {
          const subjectFilter = (action.subject || '').trim();
          const searchFilter = (action.search || '').trim();
          let filteredNotes = notes;
          if (subjectFilter) {
            const sl = subjectFilter.toLowerCase();
            filteredNotes = filteredNotes.filter(n => (n.subject || n.tab_name || '').toLowerCase() === sl);
          }
          if (searchFilter) {
            const ql = searchFilter.toLowerCase();
            filteredNotes = filteredNotes.filter(n =>
              n.name?.toLowerCase().includes(ql) ||
              (n.content || '').replace(/<[^>]+>/g, '').toLowerCase().includes(ql)
            );
          }
          if (filteredNotes.length === 0) {
            postAssistantNote(`No notes found${subjectFilter ? ' for ' + subjectFilter : ''}${searchFilter ? ' matching "' + searchFilter + '"' : ''}.`);
            break;
          }
          const noteLines = [`**Notes${subjectFilter ? ' — ' + subjectFilter : ''}** (${filteredNotes.length}):\n`];
          filteredNotes.slice(0, 15).forEach(n => {
            const dateStr = n.updatedAt ? ` · ${new Date(n.updatedAt).toLocaleDateString()}` : (n.updated_at ? ` · ${new Date(n.updated_at).toLocaleDateString()}` : '');
            noteLines.push(`- **${n.name || 'Untitled'}**${dateStr}`);
          });
          if (filteredNotes.length > 15) noteLines.push(`\n_…and ${filteredNotes.length - 15} more_`);
          postAssistantNote(noteLines.join('\n'));
          break;
        }
        case 'read_study_sets': {
          if (flashcardDecks.length === 0) {
            postAssistantNote('No flashcard decks found. Create one by asking me to "make flashcards on [topic]".');
            break;
          }
          const deckLines = [`**Flashcard Decks** (${flashcardDecks.length}):\n`];
          flashcardDecks.forEach(d => {
            const cc = d.card_count || (d.cards || []).length;
            const src = d.source === 'ai' ? ' · AI-generated' : ' · manual';
            deckLines.push(`- **${d.title}**${src} · ${cc} card${cc !== 1 ? 's' : ''}`);
          });
          postAssistantNote(deckLines.join('\n'));
          break;
        }
        case 'read_project': {
          const projSubject = (action.subject || '').trim();
          if (!projSubject) {
            postAssistantNote('Specify a subject/project name.');
            break;
          }
          const psl = projSubject.toLowerCase();
          const projTasks = tasks.filter(t => (t.subject || '').toLowerCase() === psl && t.status !== 'done');
          const projEvents = events.filter(e => (e.subject || '').toLowerCase() === psl);
          const projNotes = notes.filter(n => (n.subject || n.tab_name || '').toLowerCase() === psl);
          const projDecks = flashcardDecks.filter(d => d.title.toLowerCase().includes(psl));
          const total = projTasks.length + projEvents.length + projNotes.length + projDecks.length;
          if (total === 0) {
            postAssistantNote(`No content found for "${projSubject}". Check the subject name — it must match exactly.`);
            break;
          }
          const projLines = [`**Project: ${projSubject}** (${total} items)\n`];
          if (projTasks.length > 0) {
            projLines.push(`\n**Tasks (${projTasks.length}):**`);
            projTasks.forEach(t => {
              const d = daysUntil(t.dueDate);
              const urgency = d < 0 ? ' ⚠️ overdue' : d === 0 ? ' — due today' : '';
              projLines.push(`- ${t.title} · due ${t.dueDate}${urgency}`);
            });
          }
          if (projEvents.length > 0) {
            projLines.push(`\n**Events (${projEvents.length}):**`);
            projEvents.forEach(e => projLines.push(`- ${e.title} · ${e.date}${e.type && e.type !== 'event' ? ' [' + e.type + ']' : ''}`));
          }
          if (projNotes.length > 0) {
            projLines.push(`\n**Notes (${projNotes.length}):**`);
            projNotes.forEach(n => projLines.push(`- ${n.name || 'Untitled'}`));
          }
          if (projDecks.length > 0) {
            projLines.push(`\n**Study Sets (${projDecks.length}):**`);
            projDecks.forEach(d => {
              const cc = d.card_count || (d.cards || []).length;
              projLines.push(`- ${d.title} · ${cc} cards`);
            });
          }
          postAssistantNote(projLines.join('\n'));
          break;
        }
        case 'read_tasks': {
          const subj = (action.subject || '').trim().toLowerCase();
          const statusFilter = action.status;
          let filtered = statusFilter ? tasks.filter(t => t.status === statusFilter) : tasks.filter(t => t.status !== 'done');
          if (subj) filtered = filtered.filter(t => (t.subject || '').toLowerCase().includes(subj));
          if (action.due_within_days) {
            const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + action.due_within_days);
            const cutoffStr = cutoff.toISOString().slice(0, 10);
            filtered = filtered.filter(t => t.dueDate <= cutoffStr);
          }
          if (filtered.length === 0) {
            postAssistantNote(`No tasks found${action.subject ? ' for ' + action.subject : ''}${statusFilter ? ' with status ' + statusFilter : ''}.`);
            break;
          }
          const lines = [`**Tasks** (${filtered.length}):\n`];
          filtered.slice(0, 20).forEach(t => {
            const statusEmoji = t.status === 'done' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
            const overdue = t.dueDate < today() && t.status !== 'done' ? ' ⚠️ overdue' : '';
            lines.push(`${statusEmoji} **${t.title}** · due ${t.dueDate}${t.subject ? ' · ' + t.subject : ''}${overdue}`);
          });
          if (filtered.length > 20) lines.push(`\n_…and ${filtered.length - 20} more_`);
          postAssistantNote(lines.join('\n'));
          recordExecution('read_tasks', `${filtered.length} tasks`);
          break;
        }
        case 'update_block': {
          const range = resolveBlockRange(action, blocks);
          if (!range) {
            postAssistantNote(`I couldn't find a block at ${action.start || action.activity} on ${action.date} to update.`);
            break;
          }
          const newActivity = (action.new_activity || '').trim() || range.name;
          const newCategory = action.new_category || range.category || 'school';
          const newStart = action.new_start || range.start;
          const newEnd = action.new_end || range.end;
          const hmOk = (t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(t || '').trim());
          if (!hmOk(newStart) || !hmOk(newEnd)) {
            postAssistantNote(`I need valid start and end times to update this block.`);
            break;
          }
          const [osh, osm] = range.start.split(':').map(Number);
          const [oeh, oem] = range.end.split(':').map(Number);
          const [nsh, nsm] = newStart.split(':').map(Number);
          const [neh, nem] = newEnd.split(':').map(Number);
          const deleteOps = [];
          const addOps = [];
          setBlocks(prev => {
            const newDates = { ...(prev.dates || {}) };
            const dayBlocks = { ...(newDates[range.date] || {}) };
            let dch = osh, dcm = osm;
            while (dch < oeh || (dch === oeh && dcm < oem)) {
              const key = String(dch).padStart(2,'0') + ':' + String(dcm).padStart(2,'0');
              deleteOps.push(key);
              delete dayBlocks[key];
              dcm += 30; if (dcm >= 60) { dch++; dcm = 0; }
            }
            let nch = nsh, ncm = nsm;
            while (nch < neh || (nch === neh && ncm < nem)) {
              const key = String(nch).padStart(2,'0') + ':' + String(ncm).padStart(2,'0');
              const data = { name: newActivity, category: newCategory };
              dayBlocks[key] = data;
              addOps.push({ date: range.date, key, data });
              ncm += 30; if (ncm >= 60) { nch++; ncm = 0; }
            }
            newDates[range.date] = dayBlocks;
            return { ...prev, dates: newDates };
          });
          if (user) syncOp(() => Promise.all([
            ...deleteOps.map(key => dbUpsertDateBlock(range.date, key, null, user.id)),
            ...addOps.map(s => dbUpsertDateBlock(s.date, s.key, s.data, user.id)),
          ]));
          pushUndoToast(`Undo: updated block "${range.name}"`, undoSnap);
          break;
        }
        case 'postpone_task': {
          const target = resolveTask(action.title, tasks);
          if (!target) {
            postAssistantNote(`I couldn't find a task called "${action.title}" to postpone.`);
            break;
          }
          const rawDate = (action.new_due_date || '').trim();
          if (!rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
            postAssistantNote(`I need a valid new due date to postpone this task.`);
            break;
          }
          const newPostponeCount = (target.postponeCount || 0) + 1;
          updateTask(target.id, { dueDate: rawDate, postponeCount: newPostponeCount });
          const daysDiff = Math.round((new Date(rawDate + 'T12:00:00').getTime() - new Date((target.dueDate || today()) + 'T12:00:00').getTime()) / 86400000);
          if (user) dbInsertTaskEvent({ taskId: target.id, eventType: 'postpone', fromStatus: target.status, toStatus: target.status, metadata: { title: target.title, subject: target.subject, from_due: target.dueDate, to_due: rawDate, days_diff: daysDiff } }, user.id);
          postAssistantNote(`Postponed **${target.title}** to ${rawDate}.`);
          pushUndoToast(`Undo: postponed "${target.title}"`, undoSnap);
          break;
        }
        case 'bulk_complete': {
          const bcSubj = (action.subject || '').trim().toLowerCase();
          const titleList = (action.titles || []).map(t => t.trim().toLowerCase()).filter(Boolean);
          if (!bcSubj && titleList.length === 0) {
            postAssistantNote(`Tell me which tasks to complete — by subject or list the titles.`);
            break;
          }
          let targets = tasks.filter(t => t.status !== 'done');
          if (bcSubj) targets = targets.filter(t => (t.subject || '').toLowerCase() === bcSubj);
          if (titleList.length > 0) targets = targets.filter(t => titleList.some(tl => matchScore(tl, t.title) >= 30));
          if (targets.length === 0) {
            postAssistantNote(`No active tasks found${action.subject ? ' for ' + action.subject : ''} to mark complete.`);
            break;
          }
          const completedAt = new Date().toISOString();
          targets.forEach(t => {
            updateTask(t.id, { status: 'done', completedAt });
            setRecentlyCompleted(prev => { const n = new Set(prev); n.add(t.id); return n; });
            setTimeout(() => setRecentlyCompleted(prev => { const n = new Set(prev); n.delete(t.id); return n; }), 900);
            if (user) dbInsertTaskEvent({ taskId: t.id, eventType: 'complete', fromStatus: t.status, toStatus: 'done', metadata: { title: t.title, subject: t.subject } }, user.id);
          });
          postAssistantNote(`Marked ${targets.length} task${targets.length !== 1 ? 's' : ''} as done.`);
          pushUndoToast(`Undo: completed ${targets.length} task${targets.length !== 1 ? 's' : ''}`, undoSnap);
          break;
        }
        case 'rename_note': {
          const rnSearch = (action.title || '').trim().toLowerCase();
          const rnMatch = notes.find(n => !n.is_folder && (n.name || '').toLowerCase().includes(rnSearch));
          if (!rnMatch) {
            postAssistantNote(`I couldn't find a note called "${action.title}" to rename.`);
            break;
          }
          const rnNew = (action.new_title || '').trim();
          if (!rnNew || rnNew.length < 2) {
            postAssistantNote(`Please provide a new name for the note.`);
            break;
          }
          const rnUpdated = { ...rnMatch, name: rnNew, updatedAt: new Date().toISOString() };
          setNotes(prev => prev.map(n => n.id === rnMatch.id ? rnUpdated : n));
          if (user) syncOp(() => dbUpsertNote(rnUpdated, user.id));
          postAssistantNote(`Renamed **${rnMatch.name}** to **${rnNew}**.`);
          pushUndoToast(`Undo: renamed note "${rnMatch.name}"`, undoSnap);
          break;
        }
        case 'move_note': {
          const mnSearch = (action.title || '').trim().toLowerCase();
          const mnMatch = notes.find(n => !n.is_folder && (n.name || '').toLowerCase().includes(mnSearch));
          if (!mnMatch) {
            postAssistantNote(`I couldn't find a note called "${action.title}" to move.`);
            break;
          }
          let mnParentId = null;
          if (action.folder) {
            const fs = action.folder.trim().toLowerCase();
            const mnFolder = notes.find(n => n.is_folder && (n.name || '').toLowerCase().includes(fs));
            if (!mnFolder) {
              postAssistantNote(`I couldn't find a folder called "${action.folder}". Create it first with "create a ${action.folder} folder".`);
              break;
            }
            mnParentId = mnFolder.id;
          }
          const mnUpdated = { ...mnMatch, parent_id: mnParentId, updatedAt: new Date().toISOString() };
          setNotes(prev => prev.map(n => n.id === mnMatch.id ? mnUpdated : n));
          if (user) syncOp(() => dbUpsertNote(mnUpdated, user.id));
          const mnDest = action.folder ? `**${action.folder}**` : 'the root folder';
          postAssistantNote(`Moved **${mnMatch.name}** to ${mnDest}.`);
          pushUndoToast(`Undo: moved note "${mnMatch.name}"`, undoSnap);
          break;
        }
        case 'create_folder': {
          const cfName = (action.name || '').trim();
          if (!cfName || cfName.length < 2) {
            postAssistantNote(`Please provide a name for the folder.`);
            break;
          }
          const cfExisting = notes.find(n => n.is_folder && (n.name || '').toLowerCase() === cfName.toLowerCase());
          if (cfExisting) {
            postAssistantNote(`A folder called **${cfName}** already exists.`);
            break;
          }
          let cfParentId = null;
          if (action.parent_folder) {
            const pfs = action.parent_folder.trim().toLowerCase();
            const cfParent = notes.find(n => n.is_folder && (n.name || '').toLowerCase().includes(pfs));
            if (cfParent) cfParentId = cfParent.id;
          }
          const cfFolder = { id: uid(), name: cfName, content: '', updatedAt: new Date().toISOString(), is_folder: true, parent_id: cfParentId };
          setNotes(prev => [...prev, cfFolder]);
          if (user) syncOp(() => dbUpsertNote(cfFolder, user.id));
          postAssistantNote(`Created folder **${cfName}**.`);
          pushUndoToast(`Undo: created folder "${cfName}"`, undoSnap);
          break;
        }
        case 'log_grade': {
          const lgSubject = (action.subject || '').trim();
          const lgAssignment = (action.assignment || '').trim();
          const lgGrade = typeof action.grade === 'number' ? action.grade : parseFloat(action.grade);
          if (!lgSubject || !lgAssignment || isNaN(lgGrade)) {
            postAssistantNote(`I need subject, assignment name, and grade to log this.`);
            break;
          }
          const gradeRecord = { id: uid(), subject: lgSubject, assignment: lgAssignment, grade: lgGrade, grade_type: action.grade_type || 'other', created_at: new Date().toISOString() };
          setGrades(prev => [gradeRecord, ...prev]);
          if (user) syncOp(() => sb.from('grades').insert({ id: gradeRecord.id, user_id: user.id, subject: lgSubject, assignment: lgAssignment, grade: lgGrade, grade_type: gradeRecord.grade_type }));
          const subjectGrades = [...grades, gradeRecord].filter(g => (g.subject || '').toLowerCase() === lgSubject.toLowerCase());
          const avg = subjectGrades.reduce((s, g) => s + Number(g.grade), 0) / subjectGrades.length;
          postAssistantNote(`Logged **${lgGrade}%** on **${lgAssignment}** (${lgSubject}).\n\nYour ${lgSubject} average is now **${avg.toFixed(1)}%** across ${subjectGrades.length} grade${subjectGrades.length !== 1 ? 's' : ''}.`);
          recordExecution('log_grade', `${lgGrade}% on "${lgAssignment}" (${lgSubject})`);
          break;
        }
        case 'update_study_set': {
          const usSearch = (action.title || '').trim().toLowerCase();
          const usMatch = flashcardDecks.find(d =>
            d.title.toLowerCase().includes(usSearch) || usSearch.includes(d.title.toLowerCase())
          );
          if (!usMatch) {
            postAssistantNote(`I couldn't find a flashcard deck called "${action.title}" to update.`);
            break;
          }
          let updatedCards = [...(usMatch.cards || [])];
          if (action.cards_to_remove && action.cards_to_remove.length > 0) {
            const removeSet = action.cards_to_remove.map(q => q.trim().toLowerCase());
            updatedCards = updatedCards.filter(c => !removeSet.some(rq => (c.q || '').toLowerCase().includes(rq)));
          }
          if (action.cards_to_add && action.cards_to_add.length > 0) {
            updatedCards = [...updatedCards, ...action.cards_to_add];
          }
          const usNewTitle = (action.new_title || '').trim() || usMatch.title;
          const usUpdated = { ...usMatch, title: usNewTitle, cards: updatedCards, card_count: updatedCards.length };
          setFlashcardDecks(prev => prev.map(d => d.id === usMatch.id ? usUpdated : d));
          if (user) syncOp(() => sb.from('flashcard_decks').update({ title: usNewTitle, cards: updatedCards, card_count: updatedCards.length }).eq('id', usMatch.id).eq('user_id', user.id));
          const usChanges = [];
          if (usNewTitle !== usMatch.title) usChanges.push(`renamed to "${usNewTitle}"`);
          if (action.cards_to_add?.length) usChanges.push(`added ${action.cards_to_add.length} card${action.cards_to_add.length !== 1 ? 's' : ''}`);
          if (action.cards_to_remove?.length) usChanges.push(`removed ${action.cards_to_remove.length} card${action.cards_to_remove.length !== 1 ? 's' : ''}`);
          postAssistantNote(`Updated **${usMatch.title}**: ${usChanges.join(', ') || 'no changes'}. Now has ${updatedCards.length} card${updatedCards.length !== 1 ? 's' : ''}.`);
          pushUndoToast(`Undo: updated deck "${usMatch.title}"`, undoSnap);
          break;
        }
        case 'plan_intent': {
          const goal = String(action.goal || '').trim();
          if (!goal) {
            setPendingClarification({ question: "What's the goal you want to plan for?", context_action: 'plan_intent', missing_fields: ['goal'] });
            return;
          }
          recordExecution('plan_intent', `"${goal}"`);
          // Trigger the intent_plan pipeline asynchronously; postAssistantNote on completion.
          (async () => {
            try {
              const session2 = await sb.auth.getSession();
              const token2 = session2?.data?.session?.access_token;
              const promptPayload2 = buildSystemPrompt(tasks, blocks, events, notes, 2, { workspaceContext: 'schedule', intentType: 'action', recentlyExecutedActions: recentlyExecutedActionsRef.current, responseStyle, entityLinks, activeTimers });
              const activeTasks = tasks.filter(t => t.status !== 'done' && t.dueDate >= today()).slice(0, 50);
              const activeTasksMapped = activeTasks.map(t => ({ id: t.id, title: t.title, subject: t.subject, dueDate: t.dueDate, estTime: t.estTime, status: t.status, priority: t.priority, createdAt: t.createdAt, postponeCount: t.postponeCount || 0 }));
              const intentData = await streamChat({
                url: EDGE_FN_URL,
                body: {
                  mode: 'intent_plan',
                  systemPrompt: promptPayload2.prompt,
                  staticSystemPrompt: promptPayload2.stablePrompt,
                  dynamicContext: promptPayload2.dynamicContext,
                  messages: [{ role: 'user', content: `Goal: ${goal}${action.horizon ? ` (horizon: ${action.horizon})` : ''}${action.subject ? `, subject: ${action.subject}` : ''}${action.deadline ? `, deadline: ${action.deadline}` : ''}` }],
                  maxTokens: 3000,
                  workspaceContext: 'schedule',
                  clientTasks: activeTasksMapped,
                  clientCalendarDensity: buildCalendarDensity(activeTasksMapped, blocks.dates || {}),
                },
                token: token2 || SUPABASE_ANON_KEY,
              });
              const proposal = intentData?.actions?.[0];
              if (proposal && proposal.type === 'make_intent_plan') {
                const critique = typeof intentData.intent_plan_critique === 'string' ? intentData.intent_plan_critique : '';
                postAssistantNote(`here's a plan for "${goal}" — review it and hit Apply to add the blocks and tasks, or Dismiss to skip:`);
                setPendingContent(prev => [...prev, { ...proposal, _propose_mode: true, _intent_plan: true, _critique: critique, _goal: goal }]);
              } else {
                postAssistantNote(`I had trouble building a plan for "${goal}" — try again or phrase it differently.`);
              }
            } catch (err) {
              postAssistantNote(`Couldn't build the plan right now — ${err?.message || 'try again in a moment'}.`);
            }
          })();
          break;
        }
        case 'revise_plan': {
          const planId = String(action.plan_id || '').trim();
          const instructions = String(action.instructions || '').trim();
          if (!planId) {
            setPendingClarification({ question: "Which plan should I revise? Open My Plans and click Revise on the one you want.", context_action: 'revise_plan', missing_fields: ['plan_id'] });
            return;
          }
          if (!instructions) {
            setPendingClarification({ question: "What changes should I make to the plan?", context_action: 'revise_plan', missing_fields: ['instructions'] });
            return;
          }
          const existingPlan = studyPlans.find(p => p.id === planId);
          if (!existingPlan) {
            postAssistantNote(`I couldn't find that plan. Try opening My Plans and clicking Revise on the one you want to change.`);
            break;
          }
          recordExecution('revise_plan', `"${existingPlan.title}" — ${instructions}`);
          (async () => {
            try {
              const session2 = await sb.auth.getSession();
              const token2 = session2?.data?.session?.access_token;
              const promptPayload2 = buildSystemPrompt(tasks, blocks, events, notes, 2, { workspaceContext: 'schedule', intentType: 'action', recentlyExecutedActions: recentlyExecutedActionsRef.current, responseStyle, entityLinks, activeTimers });
              const existingPlanSummary = JSON.stringify(existingPlan.plan_json, null, 2);
              const intentData = await streamChat({
                url: EDGE_FN_URL,
                body: {
                  mode: 'intent_plan',
                  systemPrompt: promptPayload2.prompt,
                  staticSystemPrompt: promptPayload2.stablePrompt,
                  dynamicContext: promptPayload2.dynamicContext,
                  messages: [{ role: 'user', content: `EXISTING PLAN:\n${existingPlanSummary}\n\nREVISION INSTRUCTIONS: ${instructions}\n\nProduce a revised version of this plan incorporating the instructions above.` }],
                  maxTokens: 3000,
                  workspaceContext: 'schedule',
                },
                token: token2 || SUPABASE_ANON_KEY,
              });
              const proposal = intentData?.actions?.[0];
              if (proposal && proposal.type === 'make_intent_plan') {
                postAssistantNote(`here's a revised plan — review it and hit Apply to replace the old version:`);
                setPendingContent(prev => [...prev, { ...proposal, _propose_mode: true, _intent_plan: true, _revision_of_plan_id: planId }]);
              } else {
                postAssistantNote(`Couldn't revise the plan right now — try again or rephrase your instructions.`);
              }
            } catch (err) {
              postAssistantNote(`Couldn't revise the plan — ${err?.message || 'try again in a moment'}.`);
            }
          })();
          break;
        }
        default: console.warn('Unknown action type:', action.type);
      }
    } catch(e) { console.error('Failed to execute action:', action, e); setToastMsg('❌ Couldn\'t complete that — try again'); }
  }

  // ── Confirmation handlers ──
  function handleConfirmAction(idx, action) {
    // Last-resort guard for direct-dispatch paths (Google import, proposal cards, etc.)
    // that bypass chat-core validation. Mirrors chat-core's MIN_TITLE_LENGTH of 3.
    if (action.type === 'add_event' || action.type === 'add_task' || action.type === 'add_block') {
      const titleField = action.type === 'add_task' ? 'task_name' : action.type === 'add_block' ? 'activity' : 'title';
      const dateField  = action.type === 'add_task' ? 'due_date' : 'date';
      const titleVal   = (action.title || action.task_name || action.activity || '').trim();
      const dateVal    = (action.date || action.due_date || action.due || '').trim();
      const titleQ     = action.type === 'add_task' ? "What should I name this task?" : action.type === 'add_block' ? "What should I call this block?" : "What should I call this event?";
      const dateQ      = action.type === 'add_task' ? "When is this task due?" : action.type === 'add_block' ? "What date is this block for?" : "What date is this event? (e.g. 2026-05-10)";
      if (!titleVal || titleVal.length < 3) {
        setPendingClarification({ question: titleQ, context_action: action.type, missing_fields: [titleField] });
        setPendingActions(prev => prev.filter((_,i)=>i!==idx));
        return;
      }
      if (!dateVal || (action.type !== 'add_block' && !/^\d{4}-\d{2}-\d{2}$/.test(dateVal))) {
        setPendingClarification({ question: dateQ, context_action: action.type, missing_fields: [dateField] });
        setPendingActions(prev => prev.filter((_,i)=>i!==idx));
        return;
      }
    }
    sfx.confirm();
    // Mark as confirmed so the confidence gate doesn't bounce the item back to
    // the rail. The user reviewed it and is committing.
    const pa = pendingActions[idx];
    const confirmedAction = { ...action, __confirmed: true, commitment: 'confirmed', status: action.type === 'add_event' || action.type === 'update_event' ? 'confirmed' : action.status };
    executeAction(confirmedAction);
    setPendingActions(prev => prev.filter((_,i)=>i!==idx));
    if (user) {
      try {
        trackEvent(user.id, 'ai_action_confirmed', { action_type: action.type, reason: pa?.reason || null, confidence: pa?.confidence ?? null });
      } catch (_) {}
    }
    const name = action.title||action.activity||'Action';
    const verb = action.type?.startsWith('delete') ? 'removed' : action.type === 'update_event' ? 'updated' : action.type === 'complete_task' ? 'completed' : 'added';
    setToastMsg('✓ ' + name + ' ' + verb);
    // Landing-style "saved to Calc" notification when the action carries a subject.
    const subj = action.subject || action.tab_name;
    if (verb === 'added' && subj) {
      const bodyByType = {
        add_event: 'Event saved to',
        add_task:  'Task saved to',
        add_block: 'Block added to',
        add_note:  'Note saved to',
      };
      const body = bodyByType[action.type] || `${name} saved to`;
      setSosNotif({ label: 'just now', body, accent: subj });
    }
    const calendarActionTypes = ['add_event','add_block','add_task','delete_event','delete_task','delete_block','update_event','convert_event_to_block','convert_block_to_event'];
    if (calendarActionTypes.includes(action.type)) {
      if (layoutMode === 'sidebar') {
        openCompanionPanel('notes');
      }
    }
  }
  function handleCancelAction(idx) {
    sfx.dismiss();
    const pa = pendingActions[idx];
    if (user && pa) {
      try {
        trackEvent(user.id, 'ai_action_rejected', { action_type: pa.action?.type, reason: pa.reason || null, confidence: pa.confidence ?? null });
      } catch (_) {}
    }
    setPendingActions(prev => prev.filter((_,i)=>i!==idx));
  }

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
        case 'create_quiz':
          return (c.questions||[]).map((q,i) => 'Q' + (i+1) + ': ' + q.q + '\nChoices: ' + (q.choices||[]).join(' | ') + '\nAnswer: ' + q.answer).join('\n\n');
        case 'create_project_breakdown':
          return (c.phases||[]).map(p => '## ' + p.phase + (p.deadline ? ' (due ' + p.deadline + ')' : '') + '\n' + (p.tasks||[]).map(t => '- [ ] ' + t).join('\n')).join('\n\n');
        case 'make_plan':
          return '# ' + (c.title||'Plan') + '\n\n' + (c.summary ? c.summary + '\n\n' : '') + (c.steps||[]).map((s,i) => '- [ ] ' + s.title + (s.date ? ' (' + s.date + ')' : '') + (s.time ? ' ' + s.time : '') + (s.estimated_minutes ? ' ~' + s.estimated_minutes + 'min' : '')).join('\n');
        case 'make_intent_plan': {
          const blocks = (c.recurring_blocks||[]).map(b => `- ${b.activity} (${(b.days||[]).join('/')} ${b.start}–${b.end})`).join('\n');
          const tasks2 = (c.milestone_tasks||[]).map(t => `- [ ] ${t.task_name}${t.due_date?' ('+t.due_date+')':''}`).join('\n');
          return '# Intent Plan\n\n' + (c.summary||'') + '\n\n## Recurring Blocks\n' + (blocks||'(none)') + '\n\n## Milestones\n' + (tasks2||'(none)');
        }
        default: return JSON.stringify(c, null, 2);
      }
    } catch(e) { return JSON.stringify(c, null, 2); }
  }
  async function handleSaveContent(idx) {
    const c = pendingContent[idx];
    if (!c) return;
    if (c.type === 'create_flashcards' && user) {
      const deckId = await dbSaveFlashcardDeck({ title: c.title, summary: c.summary, cards: c.cards, source: 'ai' }, user.id);
      setPendingContent(prev => prev.filter((_,i) => i !== idx));
      setToastMsg('Saved "' + (c.title || 'Flashcard Deck') + '" to Library');
      if (deckId) {
        console.log('[sos] flashcard deck saved:', deckId);
        setFlashcardDecks(prev => [{ id: deckId, title: c.title, summary: c.summary || null, cards: c.cards || [], source: 'ai', card_count: (c.cards || []).length, created_at: new Date().toISOString() }, ...prev]);
      }
      return;
    }
    const formatted = formatContentForNote(c);
    executeAction({ type:'add_note', tab_name: c.title || 'Study Material', content: formatted });
    setPendingContent(prev => prev.filter((_,i) => i !== idx));
    setToastMsg('Saved "' + (c.title || 'content') + '" to notes');
  }
  function handleDismissContent(idx) { setPendingContent(prev => prev.filter((_,i) => i !== idx)); }
  function handleApplyPlan(idx, steps) {
    steps.forEach(step => {
      executeAction({ type:'add_task', task_name:step.title, subject:step.subject||'', due_date:step.date||today(), estimated_minutes:step.estimated_minutes||30 });
    });
    setPendingContent(prev => prev.filter((_,i) => i !== idx));
    setToastMsg('Added ' + steps.length + ' tasks from plan');
  }

  async function handleApplyIntentPlan(idx, plan, skipConflicts = false) {
    const undoSnap = { tasks: tasks.slice(), events: events.slice(), notes: notes.slice(), blocks: JSON.parse(JSON.stringify(blocks)), flashcardDecks: flashcardDecks.slice(), grades: grades.slice() };
    let taskCount = 0, blockCount = 0;
    const createdTaskIds = [];

    const conflictSet = skipConflicts
      ? new Set(detectPlanConflicts(plan.recurring_blocks || [], blocks.recurring || []).map(c => c.activity))
      : new Set();

    (plan.recurring_blocks || []).forEach(b => {
      if (skipConflicts && conflictSet.has(b.activity)) return;
      executeAction({ type:'add_recurring_event', title:b.activity, event_type:'other', subject:b.category||'school', days:b.days, start_date:b.start_date, end_date:b.end_date });
      blockCount++;
    });
    if (plan.review_cadence?.review_block) {
      const rb = plan.review_cadence.review_block;
      executeAction({ type:'add_recurring_event', title:rb.activity, event_type:'other', subject:rb.category||'school', days:rb.days, start_date:rb.start_date, end_date:rb.end_date });
      blockCount++;
    }
    (plan.milestone_tasks || []).forEach(t => {
      const taskId = uid();
      const task = { id:taskId, title:t.task_name, subject:t.subject||'', dueDate:t.due_date, estTime:t.estimated_minutes||30, status:'not_started', focusMinutes:0, createdAt:new Date().toISOString() };
      setTasks(prev => [...prev, task]);
      if (user) syncOp(() => dbUpsertTask(task, user.id));
      createdTaskIds.push(taskId);
      taskCount++;
    });

    setPendingContent(prev => prev.filter((_,i) => i !== idx));
    pushUndoToast(`Undo: applied study plan (${taskCount} tasks, ${blockCount} blocks)`, undoSnap);
    setToastMsg(`Applied plan — added ${taskCount} tasks and ${blockCount} recurring blocks`);

    if (user) {
      const isRevision = !!plan._revision_of_plan_id;
      if (isRevision) {
        const patch = { plan_json: plan, applied_at: new Date().toISOString(), total_tasks: (plan.milestone_tasks||[]).length };
        syncOp(() => dbUpdateStudyPlan(plan._revision_of_plan_id, patch, user.id));
        setStudyPlans(prev => prev.map(p => p.id === plan._revision_of_plan_id ? { ...p, ...patch } : p));
        if (createdTaskIds.length > 0) {
          await sb.from('tasks').update({ study_plan_id: plan._revision_of_plan_id }).in('id', createdTaskIds).eq('user_id', user.id);
        }
      } else {
        const planId = await dbSaveStudyPlan(plan, user.id);
        if (planId) {
          if (createdTaskIds.length > 0) {
            await sb.from('tasks').update({ study_plan_id: planId }).in('id', createdTaskIds).eq('user_id', user.id);
          }
          const newPlan = {
            id: planId, title: (plan.summary||'').slice(0,120)||'Study Plan',
            created_at: new Date().toISOString(), applied_at: new Date().toISOString(),
            status: 'active', plan_json: plan,
            total_tasks: (plan.milestone_tasks||[]).length,
            review_cadence_days: plan.review_cadence?.every_n_days || null,
          };
          setStudyPlans(prev => [newPlan, ...prev]);
        }
      }
    }
  }

  function handleApplyIntentPlanSkipConflicts(idx, plan) {
    return handleApplyIntentPlan(idx, plan, true);
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

  // Background study-pack generation. Fires on file imports and on
  // test/exam/quiz calendar events — no user request needed (passive study).
  async function generateStudyPackInBackground({ subject, topic, sourceText, linkedEventId, sourceKind }) {
    if (!user) return;
    try {
      setToastMsg(`Building a study pack for ${topic || subject || 'your material'}…`);
      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;
      const userMsg = sourceText
        ? `Create a study pack${subject ? ' for ' + subject : ''}${topic ? ' on "' + topic + '"' : ''} from this material:\n\n${String(sourceText).slice(0, 12000)}`
        : `Create a study pack${subject ? ' for ' + subject : ''}${topic ? ' on the topic "' + topic + '"' : ''}.`;
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY) },
        body: JSON.stringify({ mode: 'study_pack', messages: [{ role: 'user', content: userMsg }], maxTokens: 8000 }),
      });
      if (!res.ok) { console.error('study pack background gen failed:', res.status); return; }
      const data = await res.json();
      const proposal = data?.actions?.[0];
      if (!proposal || proposal.type !== 'make_study_pack') return;
      const packId = await dbSaveStudyPack(proposal, user.id, { linkedEventId: linkedEventId || null, sourceKind: sourceKind || 'manual' });
      if (packId) setToastMsg(`Study pack ready: ${proposal.title} — open it in your Library 📚`);
    } catch (e) {
      console.error('study pack background gen error:', e);
    }
  }

  function handleImportGoogleDoc(title, text) {
    const note = { id: uid(), name: title, content: text, updatedAt: new Date().toISOString(), source: 'google_docs' };
    setNotes(prev => [...prev, note]);
    if (user) syncOp(() => dbUpsertNote(note, user.id));
    setShowGoogleModal(false);
    setToastMsg('Imported "' + title + '" to notes 📄');
    generateStudyPackInBackground({ topic: title, sourceText: text, sourceKind: 'import' });
  }

  function handleImportPdf(title, text) {
    const note = { id: uid(), name: title, content: text, updatedAt: new Date().toISOString(), source: 'pdf' };
    setNotes(prev => [...prev, note]);
    if (user) syncOp(() => dbUpsertNote(note, user.id));
    setShowGoogleModal(false);
    setToastMsg('Imported PDF "' + title + '" to notes 📑');
    generateStudyPackInBackground({ topic: title, sourceText: text, sourceKind: 'import' });
  }

  // ── Entity-link CRUD + wikilink sync ──
  function _normalizeEntity(entity) {
    if (!entity) return null;
    if (entity.type && entity.id) return entity;
    if (entity.name && !entity.title) return { type: 'note', id: entity.id, title: entity.name };
    if (entity.title) return { type: entity.type || 'event', id: entity.id, title: entity.title };
    return null;
  }
  function _resolverFor() {
    return (name) => resolveLinkName(name, { notes, events, tasks }, normalize);
  }
  async function createEntityLink({ source, target, origin = 'manual' }) {
    const s = _normalizeEntity(source); const t = _normalizeEntity(target);
    if (!s || !t || !user) return null;
    if (s.type === t.type && s.id === t.id) return null;
    const exists = entityLinks.find(l =>
      l.source_type === s.type && l.source_id === s.id &&
      l.target_type === t.type && l.target_id === t.id);
    if (exists && exists.origin !== 'rejected' && origin !== 'rejected') return exists;
    const row = await dbInsertEntityLink({
      source_type: s.type, source_id: s.id,
      target_type: t.type, target_id: t.id,
      origin,
    }, user.id);
    if (row) {
      setEntityLinks(prev => {
        const idx = prev.findIndex(l => l.id === row.id);
        return idx >= 0 ? prev.map((l,i) => i===idx ? row : l) : [...prev, row];
      });
    }
    return row;
  }
  async function deleteEntityLinkRow(link) {
    if (!user || !link) return;
    if (link.id) {
      await dbDeleteEntityLink(link.id, user.id);
    } else {
      await dbDeleteEntityLinkByPair(link, user.id);
    }
    setEntityLinks(prev => prev.filter(l => link.id ? l.id !== link.id :
      !(l.source_type===link.source_type && l.source_id===link.source_id &&
        l.target_type===link.target_type && l.target_id===link.target_id)));
  }
  // Reconcile [[wikilinks]] inside an HTML body against existing wikilink-origin
  // rows for that source. Inserts new ones, removes ones the user took out.
  async function syncWikilinksForEntity(source, html) {
    const s = _normalizeEntity(source); if (!s || !user) return;
    const found = extractWikilinks(html || '');
    const resolver = _resolverFor();
    const resolved = found
      .map(f => resolver(f.name))
      .filter(t => t && !(t.type === s.type && t.id === s.id));
    const wantKeys = new Set(resolved.map(t => `${t.type}:${t.id}`));
    const existingWiki = entityLinks.filter(l =>
      l.origin === 'wikilink' && l.source_type === s.type && l.source_id === s.id);
    // Insert missing
    for (const t of resolved) {
      const has = existingWiki.find(l => l.target_type === t.type && l.target_id === t.id);
      if (!has) await createEntityLink({ source: s, target: t, origin: 'wikilink' });
    }
    // Delete removed
    for (const l of existingWiki) {
      const key = `${l.target_type}:${l.target_id}`;
      if (!wantKeys.has(key)) await deleteEntityLinkRow(l);
    }
  }
  // Debounced auto-suggestion: 2s after a save, scan for the best heuristic
  // candidate and surface it for user approval.
  function maybeSuggestLink(changedEntity) {
    const s = _normalizeEntity(changedEntity); if (!s) return;
    if (linkSuggestTimerRef.current) clearTimeout(linkSuggestTimerRef.current);
    linkSuggestTimerRef.current = setTimeout(() => {
      try {
        const all = flattenEntities({ notes, events, tasks });
        const changedFull = all.find(e => e.type === s.type && e.id === s.id) || s;
        const suggestion = bestSuggestion(changedFull, all, {
          threshold: 80,
          links: entityLinks,
          deriveSubject: inferSubjectFromTitle,
        });
        if (!suggestion) return;
        const key = [suggestion.source.type, suggestion.source.id, suggestion.target.type, suggestion.target.id].join('|');
        setPendingLinkSuggestions(prev => prev.find(p => p.key === key) ? prev : [...prev, { ...suggestion, key }]);
      } catch (e) { console.warn('link suggestion failed:', e); }
    }, 2000);
  }
  async function confirmLinkSuggestion(item) {
    if (!item) return;
    await createEntityLink({ source: item.source, target: item.target, origin: 'heuristic' });
    setPendingLinkSuggestions(prev => prev.filter(p => p.key !== item.key));
    setToastMsg('Linked');
  }
  async function rejectLinkSuggestion(item) {
    if (!item) return;
    await createEntityLink({ source: item.source, target: item.target, origin: 'rejected' });
    setPendingLinkSuggestions(prev => prev.filter(p => p.key !== item.key));
  }
  function dismissLinkSuggestion(item) {
    if (!item) return;
    setPendingLinkSuggestions(prev => prev.filter(p => p.key !== item.key));
  }
  // Click handler for rendered <a class="wikilink"> spans inside notes/event descriptions.
  function handleWikilinkClick(target) {
    if (!target) return;
    if (target.type === 'event') {
      window.dispatchEvent(new CustomEvent('sos:calendar:focus-event', { detail: { id: target.id } }));
      setShowNotes(false);
      setLofiNoteOpen(false);
    } else if (target.type === 'task') {
      setActivePanel('tasks');
      window.dispatchEvent(new CustomEvent('sos:tasks:focus', { detail: { id: target.id } }));
    } else if (target.type === 'note') {
      window.dispatchEvent(new CustomEvent('sos:notes:focus', { detail: { id: target.id } }));
    }
  }

  function handleDeleteNote(noteId) {
    setNotes(prev => prev.filter(n => n.id !== noteId));
    if (user) {
      syncOp(() => sb.from('notes').delete().eq('id', noteId).eq('user_id', user.id));
      // Remove links referencing this note (either side).
      const orphaned = entityLinks.filter(l =>
        (l.source_type === 'note' && l.source_id === noteId) ||
        (l.target_type === 'note' && l.target_id === noteId));
      orphaned.forEach(l => syncOp(() => dbDeleteEntityLink(l.id, user.id)));
      setEntityLinks(prev => prev.filter(l => !orphaned.find(o => o.id === l.id)));
    }
    setToastMsg('Note deleted');
  }

  function handleUpdateNote(updated) {
    setNotes(prev => prev.map(n => n.id === updated.id ? { ...n, ...updated } : n));
    if (user) syncOp(() => dbUpsertNote(updated, user.id));
    if (user) {
      const entity = { type: 'note', id: updated.id, title: updated.name };
      syncWikilinksForEntity(entity, updated.content || '');
      maybeSuggestLink(entity);
    }
    setToastMsg('Note saved');
  }

  function handleCreateNote(noteData) {
    const note = { id: uid(), ...noteData, updatedAt: new Date().toISOString() };
    setNotes(prev => [...prev, note]);
    if (user) syncOp(() => dbUpsertNote(note, user.id));
    if (user) {
      const entity = { type: 'note', id: note.id, title: note.name };
      syncWikilinksForEntity(entity, note.content || '');
      maybeSuggestLink(entity);
    }
    setToastMsg('Note created');
  }

  // ── Save / Load / Delete chat conversations ──
  function makeSavedChatNote(chat) {
    const title = chat.title || 'Saved chat';
    const savedAt = chat.savedAt || new Date().toISOString();
    const chatData = {
      title,
      messages: chat.messages || [],
      savedAt,
      messageCount: chat.messageCount || (chat.messages || []).length,
    };
    return { id: chat.id, name: CHAT_SAVE_PREFIX + title, content: JSON.stringify(chatData), updatedAt: savedAt };
  }

  function autoSaveCurrentChat() {
    if (messages.length === 0) return null;
    if (viewingSavedChatId) return null;
    const firstUserMsg = messages.find(m => m.role === 'user');
    const title = firstUserMsg ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? '...' : '') : 'Chat ' + new Date().toLocaleDateString();
    const chatId = uid();
    const savedAt = new Date().toISOString();
    const chatData = { id: chatId, title, messages: messages.slice(), savedAt, messageCount: messages.length };
    if (user) syncOp(() => dbUpsertNote(makeSavedChatNote(chatData), user.id));
    setSavedChats(prev => [chatData, ...prev]);
    return chatData;
  }

  function loadSavedChat(chatId) {
    const chat = savedChats.find(c => c.id === chatId);
    if (!chat) return;
    setViewingSavedChatId(chatId);
    setMessages(chat.messages || []);
    setShowChatSidebar(false);
    setShowGlobalSearch(false);
  }

  function renameSavedChat(chatId) {
    const chat = savedChats.find(c => c.id === chatId);
    if (!chat) return;
    const nextTitle = window.prompt('Rename saved chat', chat.title || 'Saved chat')?.trim();
    if (!nextTitle || nextTitle === chat.title) return;
    const updated = { ...chat, title: nextTitle, savedAt: chat.savedAt || new Date().toISOString() };
    setSavedChats(prev => prev.map(c => c.id === chatId ? updated : c));
    if (user) syncOp(() => dbUpsertNote(makeSavedChatNote(updated), user.id));
    setToastMsg('Conversation renamed');
  }

  function restoreDeletedSavedChat() {
    if (!savedChatUndo) return;
    const { chat, wasViewing } = savedChatUndo;
    setSavedChats(prev => prev.some(c => c.id === chat.id) ? prev : [chat, ...prev]);
    if (user) syncOp(() => dbUpsertNote(makeSavedChatNote(chat), user.id));
    if (wasViewing) {
      setViewingSavedChatId(chat.id);
      setMessages(chat.messages || []);
    }
    setSavedChatUndo(null);
    if (savedChatUndoTimerRef.current) clearTimeout(savedChatUndoTimerRef.current);
    setToastMsg('Conversation restored');
  }

  function deleteSavedChat(chatId) {
    const chat = savedChats.find(c => c.id === chatId);
    if (!chat) return;
    const wasViewing = viewingSavedChatId === chatId;
    setSavedChats(prev => prev.filter(c => c.id !== chatId));
    if (user) syncOp(() => sb.from('notes').delete().eq('id', chatId).eq('user_id', user.id));
    if (wasViewing) { setViewingSavedChatId(null); setMessages([]); }
    if (savedChatUndoTimerRef.current) clearTimeout(savedChatUndoTimerRef.current);
    setSavedChatUndo({ chat, wasViewing });
    savedChatUndoTimerRef.current = setTimeout(() => setSavedChatUndo(null), 8000);
  }

  function autoConfirmPending() {
    // A new free-form message means the student moved on — treat any open
    // clarification card as skipped instead of letting it lock new actions
    // out of execution downstream. Mirrors what the card's own Skip button does.
    if (pendingClarification) {
      setPendingClarification(null);
      setPendingClarificationAnswers(null);
    }
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
    if (!fromClarification) {
      autoConfirmPending();
      setPendingProposal(null);
      clarificationRoundtripCount.current = 0; // fresh user message resets the loop guard
    }
    setChatError(null);
    // Abort any in-flight request before starting a new one so the old stream
    // can't keep writing into messages state after we've moved on.
    try { streamAbortRef.current?.abort(); } catch (_) {}
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    const abortSignal = abortController.signal;
    if (user) trackEvent(user.id, 'message_sent'); // P4.2

    const msgContent = text?.trim() || '';

    // Intercept revision instructions when the user just responded to a "Revise Plan" prompt
    if (pendingRevisionPlanId && msgContent && !fromClarification) {
      const capturedPlanId = pendingRevisionPlanId;
      setPendingRevisionPlanId(null);
      const userMsg = { role:'user', content:msgContent, timestamp:Date.now() };
      setMessages(prev => { const n=[...prev,userMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
      setInput('');
      if (user) dbInsertChatMsg('user', msgContent, user.id);
      executeAction({ type:'revise_plan', plan_id: capturedPlanId, instructions: msgContent });
      return;
    }

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
    // Summon floating widgets from chat keywords. Mirrors the landing
    // page: "set a timer" pops the Pomodoro, "what's my schedule" pops
    // the day timeline. Widgets render only when explicitly invoked.
    const lower = msgContent.toLowerCase();
    if (/(\b|^)(start|set|run|begin)\s+(a\s+)?(pomodoro|timer|focus)\b|\bpomodoro\b|\bfocus session\b/.test(lower)) {
      setActiveWidgets(w => ({ ...w, pomodoro: true }));
    }
    if (/(my\s+)?schedule\b|today'?s\s+(schedule|agenda|calendar)|what'?s\s+on\s+(my|the)\s+(schedule|agenda|calendar|day)|show\s+(me\s+)?(my\s+)?(schedule|agenda|calendar)|look\s+at\s+(my\s+)?(schedule|agenda|calendar)|agenda\b/.test(lower)) {
      setActiveWidgets(w => ({ ...w, schedule: true }));
    }
    const requestedCompanion = detectCompanionIntent(msgContent);
    if (requestedCompanion && layoutMode === 'sidebar') {
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

    // Request notification permission once after first message (non-intrusive)
    if ('Notification' in window && Notification.permission === 'default' && !sessionStorage.getItem('sos-notif-asked')) {
      sessionStorage.setItem('sos-notif-asked', '1');
      setTimeout(() => Notification.requestPermission(), 2000);
    }

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

    // Auto-route planning requests directly (3-pass planning pipeline)
    if (PLANNING_REGEX.test(text || '')) {
      // Fall through to the normal chat path — sendMessage will use mode: "planning"
      // (handled in the chatBody block below)
    } else if (CONTENT_GEN_REGEX.test(text || '')) {
      // Content-gen requests fall through to the studio pipeline below.
    }

    try {
      // For image requests: send only last 2 messages to keep payload small for vision model.
      const rawHistory = updated.slice(photo ? -2 : -12).map(m => ({
        role: m.role,
        content: m.content || '',
      }));
      const historyForApi = rawHistory.filter(m => m.content && m.content.trim());
      const negationPattern = /\b(don'?t|do\s+not|never|no(?:\s+longer|t)\b)\s+(have|need|got|gotta|want)\b/i;
      const imperativeSignals = /\b(add|create|schedule|delete|remove|cancel|mark|done|complete|update|move|reschedule|block|note|save|remind|break|clear|convert|set|plan|put|log|track|book|enter|register)\b/i;
      const itemSignals = /\b(task|assignment|deadline|calendar|event|homework|quiz|exam|test|midterm|final|essay|project|paper|presentation|deck|slides|writeup|outline|draft|chapter|chapters|reading|worksheet|lab|report|pset|problem\s+set|recital|concert|interview|workshop|seminar|orientation|appointment|meeting|class|practice|game|match|tournament|tryout)\b/i;
      const statementSignals = /\b(i\s+have|i've\s+got|ive\s+got|there'?s\s+a|i\s+just\s+(?:got|found\s+out)|i\s+need\s+to|i\s+gotta|i'?m\s+supposed\s+to|got\s+to|due\s+\w+)\b/i;
      const dateSignals = /\b(today|tonight|tomorrow|tmrw|tmw|2morrow|2day|next\s+\w+|this\s+\w+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|\d{1,2}\/\d{1,2})\b/i;
      const looksLikeNegation = negationPattern.test(msgContent);
      const likelyActionIntent = !looksLikeNegation && (
        imperativeSignals.test(msgContent)
        || itemSignals.test(msgContent)
        || (statementSignals.test(msgContent) && (itemSignals.test(msgContent) || dateSignals.test(msgContent)))
      );
      const inferredIntentType = likelyActionIntent ? 'action' : 'chat';
      const isStudyPackRequest = STUDY_PACK_REGEX.test(text || '');
      const isPlanningRequest = !isStudyPackRequest && PLANNING_REGEX.test(text || '');
      const isIntentPlanRequest = !isStudyPackRequest && !isPlanningRequest && INTENT_PLAN_REGEX.test(text || '');
      const promptPayload = buildSystemPrompt(tasks, blocks, events, notes, 2, {
        workspaceContext: effectiveWorkspaceContext,
        intentType: inferredIntentType,
        recentlyExecutedActions: recentlyExecutedActionsRef.current,
        responseStyle,
        entityLinks,
        activeTimers,
      });
      setContextTrimInfo(promptPayload.trimInfo || null);

      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;

      // Build LINKED CONTEXT for any [[wikilinks]] or fuzzy entity mentions in the
      // user's message. Pulls 1-hop neighbors so the model can reason about the
      // mentioned project's surrounding work. Empty string when nothing matches.
      const linkedContextBlock = buildLinkedContextBlock({
        message: msgContent,
        notes, events, tasks,
        entityLinks,
        normalizeFn: normalize,
      });
      // For planning requests, the same block doubles as Pass 0 grounding —
      // the planning pipeline forwards dynamicContext through draft/critique/refine.
      const groundedDynamic = linkedContextBlock
        ? `${promptPayload.dynamicContext || ''}${promptPayload.dynamicContext ? '\n\n' : ''}${isPlanningRequest ? 'GROUNDED SOURCES (use these as the basis for the plan; do not invent material outside them):\n' : ''}${linkedContextBlock}`
        : promptPayload.dynamicContext;

      // Build clientTasks payload for priority engine (non-done, due within 30 days).
      const thirtyDaysOut = new Date(); thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
      const thirtyDaysStr = thirtyDaysOut.toISOString().slice(0, 10);
      const clientTasksPayload = tasks
        .filter(t => t.status !== 'done' && t.dueDate <= thirtyDaysStr)
        .slice(0, 50)
        .map(t => ({ id: t.id, title: t.title, subject: t.subject, dueDate: t.dueDate, estTime: t.estTime, status: t.status, priority: t.priority, createdAt: t.createdAt, postponeCount: t.postponeCount || 0 }));
      const clientCalendarDensityPayload = buildCalendarDensity(clientTasksPayload, blocks.dates || {});

      const chatBody = {
        systemPrompt: promptPayload.prompt,
        // Split static/dynamic for Groq prompt caching (static policy is identical across all users)
        staticSystemPrompt: promptPayload.stablePrompt,
        dynamicContext: groundedDynamic,
        messages: historyForApi,
        maxTokens: isStudyPackRequest ? 8000 : (isPlanningRequest || isIntentPlanRequest) ? 3000 : 1024,
        workspaceContext: effectiveWorkspaceContext,
        prompt_version: promptPayload.promptVersion,
        context_chars: promptPayload.contextChars,
        input_tokens_est: promptPayload.estimatedInputTokens,
        clientTasks: clientTasksPayload,
        clientCalendarDensity: clientCalendarDensityPayload,
        ...(isPlanningRequest ? { mode: 'planning' } : {}),
        ...(isIntentPlanRequest ? { mode: 'intent_plan' } : {}),
        ...(isStudyPackRequest ? { mode: 'study_pack' } : {}),
        // Caller-supplied mode override (e.g. brain_dump from voice transcripts).
        // Wins over the heuristics above.
        ...(opts.mode ? { mode: opts.mode } : {}),
      };
      if (photo) {
        chatBody.imageBase64 = photo.base64;
        chatBody.imageMimeType = photo.mimeType;
      }

      // Streaming chat path: SSE for the default chat mode, JSON for planning/studio
      // (server returns plain JSON for non-chat modes; streamChat detects content-type
      // and falls back transparently). The final payload arrives via the `done` frame.
      let chatData;
      try {
        chatData = await streamChat({
          url: EDGE_FN_URL,
          body: chatBody,
          token: token || SUPABASE_ANON_KEY,
          signal: abortSignal,
          onProgress: (ev) => {
            setPipelineProgress(ev);
            if (ev.draft) {
              setPreviewPlanEntry(ev.draft);
            }
          },
        });
      } catch (err) {
        if (err?.status === 429 && err?.payload?.rpmExhausted) {
          // Per-minute AI quota tripped. Push the current snapshot into
          // state so the analytics indicator + queueOrExecute see the binding
          // limit immediately, then surface a friendly retry message.
          if (err.payload.rpm) {
            rpmStateRef.current = err.payload.rpm;
            setRpmSnapshot(err.payload.rpm);
          }
          const resetMs = Number(err.payload.resetAtMs || 0);
          const waitSec = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
          const limitMsg = `traffic's heavy right now — give it about ${waitSec}s and try again. (the AI's per-minute quota refilled.)`;
          const assistantMsg = { role:'assistant', content:limitMsg, timestamp:Date.now() };
          setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', limitMsg, user.id);
          setIsLoading(false);
          return;
        }
        if (err?.status === 429 && err?.payload?.rateLimited) {
          const limitMsg = "hey, you've used all 5 content generations for today — this resets at midnight EST. regular chat still works though, ask me anything else!";
          const assistantMsg = { role:'assistant', content:limitMsg, timestamp:Date.now() };
          setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', limitMsg, user.id);
          setContentGenUsed(err.payload.used || DAILY_CONTENT_LIMIT);
          setIsLoading(false);
          return;
        }
        setPipelineProgress(null);
        setPreviewPlanEntry(null);
        throw err;
      }
      setPipelineProgress(null);
      setPreviewPlanEntry(null);

      if (chatData?.rpm) { rpmStateRef.current = chatData.rpm; setRpmSnapshot(chatData.rpm); }
      if (chatData?.model_used) {
        setCurrentModel(prev => {
          if (prev && prev !== chatData.model_used) {
            // model switched mid-session — flag it
            setModelFallbackUsed(true);
          }
          return chatData.model_used;
        });
      }
      if (typeof chatData?.fallback_used === 'boolean') setModelFallbackUsed(chatData.fallback_used);

      // ── Planning pipeline response: show proposed plan in propose mode ──
      if (chatData?.orchestration?.mode === 'planning') {
        const proposal = chatData.actions?.[0];
        if (proposal && proposal.type === 'make_plan') {
          const critiqueText = typeof chatData.planning_critique === 'string' ? chatData.planning_critique : '';
          const planMsg = { role: 'assistant', content: "here's a plan i put together — review it and hit Accept to add the steps to your calendar, or Edit to adjust:", timestamp: Date.now() };
          sfx.arrive();
          setMessages(prev => { const n=[...prev,planMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', planMsg.content, user.id);
          setPendingContent(prev => [...prev, { ...proposal, _propose_mode: true, _critique: critiqueText }]);
          return;
        }
      }

      // ── Brain-dump pipeline response: extracted actions go to the review rail ──
      if (chatData?.orchestration?.mode === 'brain_dump') {
        const dumpActions = Array.isArray(chatData.actions) ? chatData.actions : [];
        const summaryText = typeof chatData.content === 'string' && chatData.content.trim()
          ? chatData.content.trim()
          : (dumpActions.length === 0
            ? "I didn't catch anything actionable in that — try saying it again with a date or a name?"
            : `Pulled out ${dumpActions.length} item${dumpActions.length === 1 ? '' : 's'} — review below.`);
        const assistantMsg = { role:'assistant', content:summaryText, timestamp:Date.now() };
        sfx.arrive();
        setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
        if (user) dbInsertChatMsg('assistant', summaryText, user.id);
        if (dumpActions.length > 0) {
          const rows = dumpActions.map(a => {
            const conf = typeof a.confidence === 'number' ? a.confidence : null;
            const tentative = a.status === 'tentative' || a.commitment === 'tentative';
            const lowConf = conf != null && conf < 0.7;
            const reason = tentative && !lowConf ? 'tentative' : (lowConf ? 'low_confidence' : 'review');
            return { action: a, reason, confidence: conf };
          });
          setPendingActions(prev => [...prev, ...rows]);
        }
        return;
      }

      // ── Intent-plan pipeline response: show proposed routine in propose mode ──
      if (chatData?.orchestration?.mode === 'intent_plan') {
        const proposal = chatData.actions?.[0];
        if (proposal && proposal.type === 'make_intent_plan') {
          const critiqueText = typeof chatData.intent_plan_critique === 'string' ? chatData.intent_plan_critique : '';
          const blockCount = (proposal.recurring_blocks?.length || 0) + (proposal.review_cadence?.review_block ? 1 : 0);
          const taskCount = proposal.milestone_tasks?.length || 0;
          const introMsg = { role: 'assistant', content: `here's a structured plan — ${blockCount} recurring block${blockCount !== 1 ? 's' : ''}, ${taskCount} milestone task${taskCount !== 1 ? 's' : ''}. hit Apply to add everything, or Dismiss to skip:`, timestamp: Date.now() };
          sfx.arrive();
          setMessages(prev => { const n=[...prev,introMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', introMsg.content, user.id);
          setPendingContent(prev => [...prev, { ...proposal, _propose_mode: true, _intent_plan: true, _critique: critiqueText }]);
          return;
        }
      }

      // ── Study-pack response: persist to Library, show interactive card ──
      if (chatData?.orchestration?.mode === 'study_pack') {
        const proposal = chatData.actions?.[0];
        if (proposal && proposal.type === 'make_study_pack') {
          let packId = null;
          if (user) packId = await dbSaveStudyPack(proposal, user.id, { sourceKind: 'manual' });
          const cardCount = (proposal.flashcards || []).length;
          const quizCount = (proposal.quiz || []).length;
          const introMsg = { role: 'assistant', content: `here's your study pack for ${proposal.topic || proposal.title} — ${cardCount} flashcard${cardCount !== 1 ? 's' : ''}, a ${quizCount}-question quiz, and an exam summary. it's saved to your Library.`, timestamp: Date.now() };
          sfx.arrive();
          setMessages(prev => { const n=[...prev,introMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', introMsg.content, user.id);
          setPendingContent(prev => [...prev, { ...proposal, _study_pack_id: packId }]);
          return;
        }
      }

      let actions = Array.isArray(chatData?.actions) ? chatData.actions : [];

      // Support multiple clarifications (array) or single (object)
      const clarificationsArr = Array.isArray(chatData?.clarifications) && chatData.clarifications.length > 0
        ? chatData.clarifications
        : (chatData?.clarification && typeof chatData.clarification === 'object' && chatData.clarification.question
          ? [chatData.clarification]
          : (chatData?.clarification_payload && typeof chatData.clarification_payload === 'object' && chatData.clarification_payload.question
            ? [chatData.clarification_payload]
            : []));

      // Accept clarification prompts even when the model provides no quick-pick options.
      // Some valid asks come back as free-text-only follow-ups (question + reason, options=[]).
      // Previously these were dropped, which could lead to the generic "no response" fallback.
      const validClarifications = clarificationsArr
        .filter(c => c?.question && typeof c.question === 'string' && c.question.trim().length > 0)
        .map(c => ({
          ...c,
          options: Array.isArray(c?.options) ? c.options : [],
        }));

      if (validClarifications.length > 0) {
        // Loop-break guard: if the AI keeps asking while we're replying from
        // a clarification answer, we're in an infinite loop — abort after 3
        // consecutive roundtrips so the student isn't stuck forever.
        if (fromClarification) {
          clarificationRoundtripCount.current += 1;
          if (clarificationRoundtripCount.current >= 3) {
            clarificationRoundtripCount.current = 0;
            setPendingClarification(null);
            setPendingClarificationAnswers(null);
            setChatError("I seem to be going in circles — please try rephrasing or give me all the details in one message.");
            setTimeout(() => setChatError(null), 6000);
            return;
          }
        }

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

        // Carry context_action, missing_fields, and known_fields through so
        // the UI can use the direct-merge (multi-field) path instead of
        // sending the answer back to the AI for another roundtrip.
        // Previously these fields were silently dropped here, which forced
        // every AI-generated clarification through the legacy ClarificationCard
        // → sendMessage path, causing repeat-question loops.
        const mapped = validClarifications.map(c => ({
          reason: c.reason || null,
          question: c.question,
          options: c.options,
          multiSelect: !!c.multiSelect || !!c.multi_select,
          metadata: c.metadata || c.context || null,
          allowOther: true,
          otherPlaceholder: c.otherPlaceholder,
          suggested_defaults: c.suggested_defaults || null,
          context_action: c.context_action || null,
          missing_fields: Array.isArray(c.missing_fields) ? c.missing_fields : [],
          known_fields: (c.known_fields && typeof c.known_fields === 'object') ? c.known_fields : {},
        }));
        setPendingClarification(mapped.length === 1 ? mapped[0] : mapped);
        return;
      }

      // Recovery fallback: if the model returned plain text with neither an
      // action nor a clarification, but the student's message clearly intends
      // an action, run the deterministic regex parser so the request doesn't
      // dead-end at the "I didn't get a response" message. We never auto-fire
      // the destructive clear_all from this path — that always needs an
      // explicit tool call.
      if (actions.length === 0 && validClarifications.length === 0
          && likelyActionIntent && msgContent && !photo && !fromClarification) {
        const inferred = inferActionFromMessage(msgContent);
        if (inferred && inferred.type && inferred.type !== 'clear_all') {
          actions = [inferred];
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
      const hasClarificationPrompt = clarificationsArr.some(c => c?.question && String(c.question).trim().length > 0);
      const displayContent = rawContent
        ? rawContent
        : actions.length > 0
          ? (aiAutoApprove ? '' : (actionAckByType[actions[0]?.type] || 'got it — I can do that.'))
          : hasClarificationPrompt
            ? "i need one quick detail before i can do that."
          : "hmm, I didn't get a response from the AI. the service may be briefly unavailable — please try again in a moment.";

      if (displayContent) {
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
      // resolveWithCandidates returns { match, candidates, ambiguous } where ambiguous=true when
      // the top match is weak (<60) or two candidates are within 10 points.
      function resolveWithCandidates(query, list, titleKey = 'title') {
        if (!query || !list?.length) return { match: null, candidates: [], ambiguous: false };
        const byId = list.find(item => item.id === query);
        if (byId) return { match: byId, candidates: [], ambiguous: false };
        const scored = list
          .map(item => ({ item, score: matchScore(query, item[titleKey] || '') }))
          .filter(v => v.score >= 30)
          .sort((a, b) => b.score - a.score);
        if (scored.length === 0) return { match: null, candidates: [], ambiguous: false };
        const top = scored[0];
        const second = scored[1];
        const ambiguous = top.score < 60 || (second && top.score - second.score < 10);
        return { match: ambiguous ? null : top.item, candidates: scored.slice(0, 4).map(v => v.item), ambiguous };
      }

      const resolved = [];
      const resolutionFailures = [];
      for (const a of actions) {
        if (a.type === 'delete_event' || a.type === 'update_event' || a.type === 'convert_event_to_block') {
          const query = (a.title || a.event_id || '').trim();
          const { match, candidates, ambiguous } = resolveWithCandidates(query, events);
          if (match) {
            resolved.push({ ...a, event_id: match.id, title: match.title, date: a.date || match.date });
          } else if (ambiguous && candidates.length > 0) {
            // Surface as a clarification instead of silently failing
            const clarification = {
              reason: `Multiple events match "${query}" — which one?`,
              question: `Which event did you mean?`,
              options: candidates.map(ev => ({ label: `${ev.title}${ev.date ? ' (' + ev.date + ')' : ''}`, value: ev.id })),
              multi_select: false,
              context_action: a.type,
              missing_fields: ['event_id'],
            };
            setPendingClarification(clarification);
            return;
          } else {
            resolutionFailures.push(buildResolutionFailure(a.type, `Unable to resolve event "${query}".`, candidates.map(c => c.title)));
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
          const query = (a.title || a.task_id || '').trim();
          const { match, candidates, ambiguous } = resolveWithCandidates(query, tasks);
          if (match) {
            resolved.push({ ...a, task_id: match.id, title: match.title });
          } else if (ambiguous && candidates.length > 0) {
            const clarification = {
              reason: `Multiple tasks match "${query}" — which one?`,
              question: `Which task did you mean?`,
              options: candidates.map(t => ({ label: `${t.title}${t.dueDate ? ' (due ' + t.dueDate + ')' : ''}`, value: t.id })),
              multi_select: false,
              context_action: a.type,
              missing_fields: ['task_id'],
            };
            setPendingClarification(clarification);
            return;
          } else {
            resolutionFailures.push(buildResolutionFailure(a.type, `Unable to resolve task "${query}".`, candidates.map(c => c.title)));
          }
          continue;
        }
        if (a.type === 'complete_task') {
          const query = (a.title || a.task_id || '').trim();
          const { match, candidates, ambiguous } = resolveWithCandidates(query, tasks);
          if (match) {
            resolved.push({ ...a, task_id: match.id, title: match.title });
          } else if (ambiguous && candidates.length > 0) {
            const clarification = {
              reason: `Multiple tasks match "${query}" — which one?`,
              question: `Which task did you mean?`,
              options: candidates.map(t => ({ label: `${t.title}${t.dueDate ? ' (due ' + t.dueDate + ')' : ''}`, value: t.id })),
              multi_select: false,
              context_action: a.type,
              missing_fields: ['task_id'],
            };
            setPendingClarification(clarification);
            return;
          } else {
            resolutionFailures.push(buildResolutionFailure(a.type, `Unable to resolve task "${query}".`, candidates.map(c => c.title)));
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
          // Including time in the dedupe key so that two events legitimately scheduled
          // on the same day at different times (e.g. two study sessions) can both exist.
          // A truly-duplicate add (same title, same date, same time — or both all-day) is still filtered.
          const dupTime = a.time ? String(a.time).trim() : '';
          if (events.some(ev => ev.title.toLowerCase() === dupTitle
              && ev.date === dupDate
              && String(ev.time || '').trim() === dupTime)) continue;
        }
        resolved.push(a);
      }
      actions = resolved;

      if (resolutionFailures.length > 0) {
        const fallbackMsg = { role:'assistant', content:"I couldn't match part of that action — can you share the exact item name and date/time?", timestamp:Date.now() };
        setMessages(prev => { const n=[...prev,fallbackMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
        if (user) dbInsertChatMsg('assistant', fallbackMsg.content, user.id);
      }

      if (actions.length > 0) {
        const confirmTypes = ['add_task','add_event','add_block','break_task','delete_task','delete_event','delete_block','update_event','convert_event_to_block','convert_block_to_event','add_recurring_event','clear_all','edit_note','delete_note'];
        // No more blockExecution gate: a fresh user message has already cleared
        // any stale pendingClarification via autoConfirmPending(), and a freshly
        // produced clarification short-circuits earlier in this function.
        const autoExec = actions.filter(a => !confirmTypes.includes(a.type));
        autoExec.forEach(queueOrExecute);
        const needsConfirm = actions.filter(a => confirmTypes.includes(a.type));
        if (needsConfirm.length > 0) {
          if (aiAutoApprove) {
            const editingActionTypes = ['update_event','convert_event_to_block','convert_block_to_event','edit_note'];
            const hasEditingAction = needsConfirm.some(a => editingActionTypes.includes(a.type));
            setAutoApproveStatus({
              state: 'running',
              count: needsConfirm.length,
              label: hasEditingAction ? 'editing notes / schedule' : 'auto-approve mode'
            });
            needsConfirm.forEach(queueOrExecute);
            setTimeout(() => {
              setAutoApproveStatus({
                state: 'done',
                count: needsConfirm.length,
                label: hasEditingAction ? 'edits applied' : 'all set'
              });
            }, 450);
            setTimeout(() => setAutoApproveStatus(null), 2200);
          } else {
            // Schema gate: bounce add_event/add_task with missing required fields back to clarification
            // instead of confirmation so the user fills the gaps before the ConfirmationCard renders.
            const gated = [];
            let bounced = false;
            for (const a of needsConfirm) {
              if (a.type === 'add_event' || a.type === 'add_task') {
                const norm = { ...a, due_date: a.due_date || a.due };
                const { valid, missing_required } = validateActionSchema(norm);
                if (!valid && !bounced) {
                  const known = {};
                  for (const k of Object.keys(a)) {
                    if (a[k] !== undefined && a[k] !== null && String(a[k]).trim() !== '' && k !== 'type') known[k] = a[k];
                  }
                  setPendingClarification(buildLocalClarification({
                    contextAction: a.type,
                    knownFields: known,
                    missingFields: missing_required,
                    message: `I need ${missing_required.length > 1 ? 'a couple more details' : (missing_required[0] === 'title' ? 'a title' : missing_required[0] === 'date' ? 'a date' : missing_required[0] === 'due_date' ? 'a due date' : 'one more detail')} for this ${a.type === 'add_event' ? 'event' : 'task'}.`,
                    suggestedDefaults: { event_type: a.event_type, subject: a.subject, est_time: a.estimated_minutes },
                  }));
                  bounced = true;
                  continue;
                }
              }
              gated.push(a);
            }
            if (gated.length > 0) {
              setPendingActions(prev => [...prev, ...gated.map(a => ({ action:a, timestamp:Date.now() }))]);
            }
          }
        }
      }

      // We intentionally keep the initial conversational reply above even if action resolution fails.
      // Resolution errors are surfaced as follow-up assistant messages.
    } catch(err) {
      // User-initiated cancel (new chat, layout switch, unmount, subsequent send): silent.
      if (err?.name === 'AbortError' || abortSignal.aborted) {
        return;
      }
      console.error('Chat error:', err);
      const raw = err.message || '';
      let friendlyMsg;
      // Cause-coded errors from the AI layer come through with structured fields
      // attached to the Error object. Prefer those over string matching.
      if (raw.includes('PlanningPipelineError') || raw.includes('Planning pipeline failed')) {
        const stageMatch = raw.match(/at (draft|critique|refine)/);
        const stage = stageMatch ? stageMatch[1] : 'planning';
        if (raw.includes('both_models_failed')) {
          friendlyMsg = `I tried both models for your study plan but neither came back — try again in a minute, or simplify the request.`;
        } else {
          friendlyMsg = `I couldn't ${stage === 'draft' ? 'draft' : 'finalize'} your study plan. Try a smaller scope or rephrase the request.`;
        }
      } else if (raw.includes('Both models failed') || raw.includes('both_models_failed')) {
        friendlyMsg = "the AI is having trouble on both models right now — try again in a minute.";
      } else if (raw.includes('budget exhausted') || raw.includes('timed out within budget')) {
        friendlyMsg = "the request took too long — try again, or try a smaller request.";
      } else if (raw.includes('500') || raw.includes('Internal')) {
        friendlyMsg = "the AI service is temporarily unavailable — please try again in a moment.";
      } else if (raw.includes('429') || raw.includes('rate limit')) {
        friendlyMsg = "we're moving fast — give me a few seconds and try again.";
      } else if (raw.includes('503') || raw.includes('overloaded')) {
        friendlyMsg = "the AI is a bit overloaded right now — wait a few seconds and try again.";
      } else if (raw.includes('401') || raw.includes('403')) {
        friendlyMsg = "authentication error — please refresh the page and try again.";
      } else if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('network')) {
        friendlyMsg = "couldn't reach the server — check your connection and try again.";
      } else {
        // Never leak raw provider JSON / stack traces to the student. If the message
        // looks structured (JSON-ish, very long, or obviously a provider error) suppress it.
        const looksLikeProviderError = raw.length > 120 || /[{}\[\]"]/.test(raw) || /Groq|Gemini|openai|tool_use_failed/i.test(raw);
        friendlyMsg = looksLikeProviderError ? "hmm, something hiccuped — want to try again?" : (raw || "hmm, that hiccuped — want to try again?");
      }
      setChatError(friendlyMsg);
    } finally { setIsLoading(false); }
  }

  function handleClarificationSubmit(payload) {
    if (!pendingClarification) return;
    // Structured submission from MultiFieldClarificationCard — merge known + answers
    // and queue the action directly. Skips the AI roundtrip so previously-extracted
    // fields can't get dropped in re-routing.
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.multi_field && payload.context_action) {
      const { context_action, known_fields = {}, field_values = {} } = payload;
      // Normalize: task_name → title for schema check
      const merged = { type: context_action, ...known_fields, ...field_values };
      if (merged.task_name && !merged.title) merged.title = merged.task_name;
      // Apply soft defaults for any missing recommended fields so we don't ask twice.
      const defaults = defaultsForAction(context_action);
      for (const [k, v] of Object.entries(defaults)) {
        if (merged[k] === undefined || merged[k] === null || merged[k] === '') merged[k] = v;
      }
      const { valid, missing_required } = validateActionSchema(merged);
      if (!valid) {
        // Re-ask only the still-missing required fields. Preserve everything we have.
        const known = { ...known_fields, ...field_values };
        delete known.endTime; // endTime is internal to the wizard, not a known field
        // Carry forward per-field options from the prior clarification's checklist
        // so the next step still shows chips (e.g. source: ["I'll write it", ...]).
        const priorChecklist = Array.isArray(pendingClarification?.checklist) ? pendingClarification.checklist : [];
        const carriedOptions = {};
        for (const f of missing_required) {
          const opts = priorChecklist.find(c => c.field === f)?.options;
          if (Array.isArray(opts) && opts.length > 0) carriedOptions[f] = opts;
        }
        // Source-specific defaults so add_note's source step always shows options.
        if (context_action === 'add_note' && missing_required.includes('source') && !carriedOptions.source) {
          carriedOptions.source = ["I'll write it", "Paste/import", "AI write"];
        }
        setPendingClarification(buildLocalClarification({
          contextAction: context_action,
          knownFields: known,
          missingFields: missing_required,
          message: 'Just one more thing —',
          suggestedDefaults: pendingClarification?.suggested_defaults || {},
          optionsByField: carriedOptions,
        }));
        setPendingClarificationAnswers(null);
        return;
      }
      setPendingClarification(null);
      setPendingClarificationAnswers(null);
      setPendingActions(prev => [...prev, { action: merged, timestamp: Date.now() }]);
      return;
    }
    // payload is either a single object { selected, options, otherText } or an array of them
    const payloads = Array.isArray(payload) ? payload : [payload];
    const perAnswer = payloads.map(p => {
      const selectedOptions = (p?.selected || []).map(id => (p?.options || []).find(o => o.id === id)).filter(Boolean);
      const selectedLabels = selectedOptions.map(o => o.label);
      const otherTxt = p?.otherText?.trim() || '';
      const parts = [];
      if (selectedLabels.length > 0) parts.push(selectedLabels.join(', '));
      if (otherTxt) parts.push(otherTxt);
      return { question: p?.question || '', answer: parts.join(' — ') };
    });
    // Submitting with every answer blank would previously send the literal
    // string "No selection", which the AI misread as a real answer. Block it.
    const hasAny = perAnswer.some(a => a.answer.length > 0);
    if (!hasAny) {
      setChatError("Please answer at least one question before submitting.");
      setTimeout(() => setChatError(null), 4000);
      return;
    }
    const responseParts = perAnswer
      .filter(a => a.answer.length > 0)
      .map(a => (perAnswer.length > 1 && a.question) ? `${a.question}: ${a.answer}` : a.answer);
    const readableResponse = responseParts.join('\n');
    setPendingClarification(null);
    setPendingClarificationAnswers(null);
    sendMessage(readableResponse, { fromClarification: true });
  }

  // Required fields per propose_action action_type
  const PROPOSAL_REQUIRED = { add_event: ['title', 'date'], add_task: ['title'], add_block: ['activity', 'date', 'start', 'end'], add_note: ['name'] };

  function handleProposalApprove() {
    if (!pendingProposal) return;
    const { summary, action_type, prefilled = {} } = pendingProposal;
    const required = PROPOSAL_REQUIRED[action_type] || [];
    const hasAllRequired = required.every(f => prefilled[f] !== undefined && prefilled[f] !== null && prefilled[f] !== '');
    setPendingProposal(null);
    if (hasAllRequired) {
      const action = { type: action_type, ...prefilled };
      const instantApprove = aiAutoApprove || action_type === 'add_task';
      if (instantApprove) {
        const editingActionTypes = ['update_event', 'convert_event_to_block', 'convert_block_to_event', 'edit_note'];
        const isEditing = editingActionTypes.includes(action_type);
        setAutoApproveStatus({ state: 'running', count: 1, label: isEditing ? 'editing notes / schedule' : 'auto-approve mode' });
        executeAction(action);
        setTimeout(() => setAutoApproveStatus({ state: 'done', count: 1, label: isEditing ? 'edits applied' : 'all set' }), 450);
        setTimeout(() => setAutoApproveStatus(null), 2200);
      } else {
        setPendingActions(prev => [...prev, { action, timestamp: Date.now() }]);
      }
    } else {
      // Missing required fields — route back through tool-heavy model to fill them in
      sendMessage('yes, ' + summary);
    }
  }

  function handleProposalDismiss() {
    setPendingProposal(null);
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
  async function handleAttachmentSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      await handlePhotoSelect(e);
      return;
    }
    await handleUploadStudy(e);
  }
  // ── PDF / text upload → instant study materials ──
  async function handleUploadStudy(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    let text = '';
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        const pages = [];
        for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pages.push(content.items.map(item => item.str).join(' '));
        }
        text = pages.join('\n\n');
      } else {
        text = await file.text();
      }
    } catch(err) {
      setToastMsg("Couldn't read that file — try a PDF or plain text file.");
      return;
    }
    if (!text.trim()) { setToastMsg('That file appears to be empty.'); return; }
    const truncated = text.slice(0, 4000);
    const msg = `I uploaded "${file.name}". Based on this content, please: 1) create a set of flashcards, 2) write a short quiz, and 3) give me a quick summary.\n\nContent:\n${truncated}`;
    if (!user) { if (guestMsgCount >= GUEST_DEMO_LIMIT) { setShowAuthModal(true); return; } incrementGuestCount(); }
    setInput('');
    sendMessage(msg);
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
    } catch (sttErr) {
      console.warn('Server transcription failed, checking browser fallback:', sttErr);
    }

    // Fallback: use browser SpeechRecognition transcript collected during recording
    if (!transcript) {
      transcript = (speechTranscriptRef.current || '').trim();
      if (transcript && import.meta.env.DEV) console.log('Using browser SpeechRecognition fallback');
    }
    speechTranscriptRef.current = '';

    if (transcript) {
      // Voice → brain_dump pipeline: extract structured tasks/events with
      // confidence scoring. Tentative items land in the review rail rather
      // than mutating state immediately.
      sendMessage(transcript, { mode: 'brain_dump' });
    } else {
      const hasBrowserSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      setToastMsg(hasBrowserSR
        ? "Couldn't catch that — try speaking louder or closer"
        : "Voice isn't available right now — try typing instead");
    }
    setIsTranscribing(false);
  }


  function clearChat() {
    // Cancel any in-flight AI request so its response can't land in the cleared chat.
    try { streamAbortRef.current?.abort(); } catch (_) {}
    setIsLoading(false);
    setMessages([]); setPendingActions([]); setPendingClarification(null); setPendingClarificationAnswers(null); setChatError(null);
    setPendingProposal(null);
    setViewingSavedChatId(null);
    // Recently-executed actions are part of the prior conversation's context.
    // Leaving them pinned would confuse the AI in a fresh chat (it would think
    // actions "just happened" when the user has started over).
    recentlyExecutedActionsRef.current = [];
    if (user) dbClearChat(user.id);
  }

  function isRpmNearLimit() {
    const r = rpmStateRef.current;
    if (r.remaining === Infinity) return false;
    if (Date.now() > r.resetAtMs) return false;
    return r.remaining < 5;
  }

  function queueOrExecute(action) {
    if (isRpmNearLimit()) {
      const qid = Math.random().toString(36).slice(2);
      setPendingQueue(prev => [...prev, { id: qid, action, addedAt: Date.now() }]);
      const label = action.type?.replace(/_/g, ' ') || 'request';
      const queueMsg = { role: 'assistant', content: `creating your ${label} — one moment while the request queue clears.`, timestamp: Date.now() };
      setMessages(prev => { const n = [...prev, queueMsg]; while (n.length > CHAT_MAX_MESSAGES) n.shift(); return n; });
    } else {
      executeAction(action);
    }
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
      // Cmd+K / Ctrl+K — global search (works even inside inputs)
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){
        e.preventDefault();
        setGlobalSearchQuery('');
        setShowGlobalSearch(p=>!p);
        return;
      }
      const tag=document.activeElement?.tagName?.toLowerCase();
      if(tag==='input'||tag==='textarea'||tag==='select')return;
      const key=e.key.toLowerCase();
      if(key==='/'){e.preventDefault();inputRef.current?.focus()}
      else if(key==='s'){
        e.preventDefault();
        setActivePanel(prev => prev === 'settings' ? 'chat' : 'settings');
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
      else if(key==='escape'){if(showGlobalSearch){setShowGlobalSearch(false);return;}if(showChatSidebar)setShowChatSidebar(false);if(showPeek)setShowPeek(false);if(showNotes)setShowNotes(false);if(activePanel==='settings')setActivePanel('chat')}
    }
    window.addEventListener('keydown',handleKey);return()=>window.removeEventListener('keydown',handleKey);
  },[showPeek,showNotes,showChatSidebar,showGlobalSearch,activePanel,layoutMode,openCompanionPanel]);

  const activeTaskCount = tasks.filter(t=>t.status!=='done').length;
  const overdueCount = tasks.filter(t=>t.status!=='done'&&daysUntil(t.dueDate)<0).length;
  // layoutMode is fixed to 'lofi' — no persistence needed
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
    <div
      ref={layoutMode === 'lofi' ? studyAppRef : undefined}
      className={
        layoutMode === 'lofi' ? 'study-app'
        : layoutMode === 'studio' ? 'studio'
        : 'sos-app'
      }
      style={
        layoutMode === 'lofi'
          ? { gridTemplateColumns: columnLayout.gridTemplateColumns }
          : layoutMode === 'studio'
            ? {}
            : { flexDirection: layoutMode === 'topbar' ? 'column' : 'row' }
      }
    >
      {/* SOS logo SVG symbol — defined once, used via <use href="#sos-bulb"> everywhere */}
      <svg width="0" height="0" style={{position:'absolute',overflow:'hidden'}} aria-hidden="true">
        <defs>
          <symbol id="sos-bulb" viewBox="0 0 60 86">
            <path d="M 30 2 C 13.5 2, 4 16, 4 32 C 4 44.5, 11.5 53.5, 18 60 C 20 62, 21 63, 21 65.5 L 21 68 L 39 68 L 39 65.5 C 39 63, 40 62, 42 60 C 48.5 53.5, 56 44.5, 56 32 C 56 16, 46.5 2, 30 2 Z" fill="currentColor"/>
            <rect x="21" y="71" width="18" height="3.6" rx="1" fill="currentColor"/>
            <rect x="21" y="76" width="18" height="3.6" rx="1" fill="currentColor"/>
            <rect x="25" y="81" width="10" height="4" rx="1.4" fill="currentColor"/>
          </symbol>
        </defs>
      </svg>
      {layoutMode === 'lofi' && <ColumnResizeHandles layout={columnLayout} containerRef={studyAppRef} />}
      {layoutMode === 'lofi' && <ColumnLockToggle layout={columnLayout} />}
      {/* Neon Lofi — corner targeting reticles (decorative) */}
      {(layoutMode === 'sidebar' || layoutMode === 'topbar') && <>
        <span className="corner-bracket corner-bracket-tl" aria-hidden="true" />
        <span className="corner-bracket corner-bracket-tr" aria-hidden="true" />
        <span className="corner-bracket corner-bracket-bl" aria-hidden="true" />
        <span className="corner-bracket corner-bracket-br" aria-hidden="true" />
      </>}
      {/* Loading scan line */}
      {isLoading && <div className="sos-loading-scan" aria-hidden="true" />}
      {layoutMode === 'sidebar' && <aside className={'sos-sidebar'+(sidebarCollapsed?' collapsed':'')}>
        <div className="sos-sidebar-head">
          <div className="sos-sidebar-head-left">
            <div className="sos-sidebar-brand">
              <span className="sos-brand-mark" style={{ borderRadius: 7, padding: sidebarCollapsed ? 3 : 4 }}>
                <span className="sos-mark" style={{ fontSize: sidebarCollapsed ? 18 : 22 }}>
                  <span className="sos-mark-s">S</span>
                  <span className="sos-mark-bulb"><svg><use href="#sos-bulb"/></svg></span>
                  <span className="sos-mark-s">S</span>
                </span>
              </span>
            </div>
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
          <button className="sos-side-btn" data-module="tasks" onClick={()=>{ sfx.nav(); startNewChat(); }} title="New chat">{Icon.plus(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>New chat</span></button>
          <button className="sos-side-btn" data-module="notes" onClick={()=>{ sfx.nav(); if(sidebarCompanionPanel==='notes'&&!companionCollapsed){setCompanionCollapsed(true);}else{openCompanionPanel('notes');} }} title="Notes + chat">{Icon.fileText(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Notes + chat</span></button>
          {user && <button className="sos-side-btn" onClick={()=>{ sfx.nav(); setShowMyPlans(true); }} title="My Study Plans">{Icon.zap(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>My Plans{studyPlans.filter(p=>p.status==='active').length > 0 ? ` (${studyPlans.filter(p=>p.status==='active').length})` : ''}</span></button>}
          <button className="sos-side-btn" data-module="import" onClick={()=>{ sfx.nav(); setShowGoogleModal(true); }} title="Import">{Icon.link(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Import</span></button>
          <button className="sos-side-btn" onClick={()=>{ sfx.nav(); setActivePanel('settings'); }} title="Settings">{Icon.gear(14)} <span className="sos-side-label" style={{flex:1,textAlign:'left'}}>Settings</span></button>
        </div>
        <div className="sos-side-meta">
          <span>{activeTaskCount} task{activeTaskCount!==1?'s':''}{overdueCount>0?` • ${overdueCount} overdue`:''}</span>
          <span style={{color:contentGenUsed>=DAILY_CONTENT_LIMIT?'var(--danger)':'var(--text-dim)'}}>{Math.max(0, DAILY_CONTENT_LIMIT - contentGenUsed)}/{DAILY_CONTENT_LIMIT}</span>
        </div>
        {showPerfIndicatorSidebar && (
          <div className="sos-side-indicators sos-side-meta">
            <PerfPill />
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
                      <button className="chat-sidebar-item-rename" onClick={e => { e.stopPropagation(); renameSavedChat(chat.id); }}>Rename</button>
                      <button className="chat-sidebar-item-delete" onClick={e => { e.stopPropagation(); setConfirmDeleteChat(chat); }}>Delete</button>
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

      {layoutMode === 'studio' && (
        <StudyTopBar
          user={user}
          syncStatus={syncStatus}
          theme={studioTheme}
          onTheme={setStudioTheme}
          onSettings={() => setActivePanel('settings')}
          onHome={() => navigate('/')}
          queueCount={pendingQueue ? pendingQueue.length : 0}
        />
      )}
      {layoutMode === 'lofi' && <LofiLeftPanel
        events={events}
        blocks={blocks}
        tasks={tasks}
        entityLinks={entityLinks}
        userId={user?.id}
        onEventUpdate={(updated) => setEvents(prev => prev.map(e => e.id === updated.id ? updated : e))}
        notes={notes}
        onCreateNote={handleCreateNote}
        onUpdateNote={handleUpdateNote}
        onDeleteNote={handleDeleteNote}
        onImportClick={() => setShowGoogleModal(true)}
        aiThinking={isLoading}
      />}
      {layoutMode === 'studio' && (
        <div className="studio-sidebar-col">
          <StudioSidebar
            user={user}
            savedChats={savedChats}
            viewingSavedChatId={viewingSavedChatId}
            onPick={loadSavedChat}
            onNew={startNewChat}
            onDelete={(chat) => setConfirmDeleteChat(chat)}
            onAuthAction={user ? handleLogout : () => setShowAuthModal(true)}
            onProofread={() => setActivePanel('proofread')}
            aiThinking={isLoading}
            syncStatus={syncStatus}
            tasks={tasks}
            events={events}
            notes={notes}
          />
        </div>
      )}
      <div className={
        layoutMode === 'lofi' ? 'study-center study-glass'
        : layoutMode === 'studio' ? 'studio-center-col studio-glass-card'
        : 'sos-main'
      }>
      {layoutMode === 'lofi' && (
        <StudyTopBar
          user={user}
          syncStatus={syncStatus}
          onNewChat={startNewChat}
          onImport={() => setShowGoogleModal(true)}
          onSettings={() => setActivePanel('settings')}
          onAuthAction={user ? handleLogout : () => setShowAuthModal(true)}
          onSwitchLayout={() => setLayoutMode('sidebar')}
          onHome={() => navigate('/')}
          onChat={() => {
            setActivePanel('chat');
            if (typeof window !== 'undefined' && window.location.hash) {
              history.replaceState(null, '', window.location.pathname + window.location.search);
            }
          }}
          onProofread={() => setActivePanel('proofread')}
          homeEnabled={true}
          queueCount={pendingQueue ? pendingQueue.length : 0}
          theme={studioTheme}
          onTheme={setStudioTheme}
        />
      )}
      {layoutMode === 'topbar' && <div className="sos-header">
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>setLayoutMode('sidebar')} className="topbar-sidebar-btn" title="Sidebar mode" aria-label="Sidebar mode">{Icon.panel(16)}</button>
          <div className="sos-sidebar-brand" style={{width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <span className="sos-mark" style={{fontSize:20}}>
              <span className="sos-mark-s">S</span>
              <span className="sos-mark-bulb"><svg><use href="#sos-bulb"/></svg></span>
              <span className="sos-mark-s">S</span>
            </span>
          </div>
          {user && <div style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:4}}>
            <span className={'sync-dot '+(syncStatus==='saving'?'sync-saving':syncStatus==='error'?'sync-error':'sync-saved')}/>
            {syncStatus==='saving'?'Saving...':syncStatus==='error'?'Sync error':'Synced'}
          </div>}
        </div>
        <div className="topbar-actions" style={{display:'flex',alignItems:'center',gap:12}}>
          {showPerfIndicatorTopbar && <PerfPill />}
          <button onClick={()=>{ openCompanionPanel('notes'); if(!user){setAuthNudge(true);setTimeout(()=>setAuthNudge(false),5000);} }} className="g-hdr-btn topbar-priority-btn">{Icon.fileText(14)} <span>Notes + chat</span></button>
          <button onClick={()=>window.location.assign('/library')} className="g-hdr-btn" title="Library">{Icon.bookOpen(14)} <span>Library</span></button>
          <button onClick={()=>setShowChatSidebar(true)} className="g-hdr-btn">{Icon.messageCircle(14)} <span>Saved</span></button>
          <button onClick={()=>setActivePanel('proofread')} className="g-hdr-btn">{Icon.fileText(14)} <span>Proofread</span></button>
          <button onClick={()=>setActivePanel('settings')} className="g-hdr-btn">{Icon.gear(14)} <span>Settings</span></button>
        </div>
      </div>}

      {(layoutMode === 'lofi' || layoutMode === 'studio') && activePanel === 'chat' && (activeWidgets.pomodoro || activeTimers.length > 0) && (
        <PomodoroTimer
          sessionType={pomodoroSession}
          onSessionType={setPomodoroSession}
          aiTimers={activeTimers}
          onDismissAiTimer={dismissActiveTimer}
          onClose={() => setActiveWidgets(w => ({ ...w, pomodoro: false }))}
        />
      )}
      {(layoutMode === 'lofi' || layoutMode === 'studio') && activePanel === 'chat' && activeWidgets.schedule && (
        <ScheduleWidget
          events={events}
          blocks={blocks}
          solo={!activeWidgets.pomodoro}
          onClose={() => setActiveWidgets(w => ({ ...w, schedule: false }))}
        />
      )}
      {sosNotif && (
        <SosNotification
          label={sosNotif.label}
          body={sosNotif.body}
          accent={sosNotif.accent}
          duration={sosNotif.duration}
          onDismiss={() => setSosNotif(null)}
        />
      )}

      {confirmDeleteChat && (
        <div className="g-confirm-overlay" onClick={() => setConfirmDeleteChat(null)}>
          <div className="g-confirm-card" onClick={e => e.stopPropagation()}>
            <h3>Delete saved chat?</h3>
            <p>"{confirmDeleteChat.title}" will be removed. You'll have 8 seconds to undo.</p>
            <div className="g-confirm-actions">
              <button className="g-confirm-btn" onClick={() => setConfirmDeleteChat(null)}>Cancel</button>
              <button className="g-confirm-btn danger" onClick={() => { deleteSavedChat(confirmDeleteChat.id); setConfirmDeleteChat(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}


      {activePanel === 'home' ? (
        <HomeScreen
          tasks={tasks}
          events={events}
          prefs={homePrefs}
          onOpenChat={() => setActivePanel('chat')}
        />
      ) : activePanel === 'settings' ? (
        <div className="settings-fullscreen">
          <div className="settings-fullscreen-inner">
            <div className="settings-fullscreen-header">
              <div>
                <div className="settings-title">Settings</div>
                <div className="settings-sub">Customize Charles, notifications, and appearance.</div>
              </div>
              <button className="settings-toggle settings-toggle-active" onClick={()=>setActivePanel('chat')}>{Icon.x(14)} Close</button>
            </div>

            {/* ── AI Assistant ── */}
            <div className="settings-card settings-fullscreen-card">
              <div className="settings-row" style={{paddingBottom:6}}>
                <div style={{fontWeight:700,fontSize:'0.88rem',color:'var(--teal)'}}>Charles AI</div>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Auto-approve actions</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Execute adds instantly without a confirmation popup. Deletes still require confirm.</div>
                </div>
                <button className={'settings-toggle'+(aiAutoApprove?' settings-toggle-active':'')} onClick={()=>{ const next = !aiAutoApprove; setAiAutoApprove(next); localStorage.setItem('sos_ai_auto_approve', next ? 'true' : 'false'); }}>{aiAutoApprove ? 'On' : 'Off'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Agentic mode</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Let Charles break complex requests into parallel steps automatically.</div>
                </div>
                <button className={'settings-toggle'+(agenticMode?' settings-toggle-active':'')} onClick={()=>setAgenticMode(!agenticMode)}>{agenticMode ? 'On' : 'Off'}</button>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Response style</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>How detailed Charles should be in replies.</div>
                </div>
                <div style={{display:'flex',gap:6}}>
                  {['concise','balanced','detailed'].map(style => (
                    <button
                      key={style}
                      className={'settings-toggle'+(responseStyle===style?' settings-toggle-active':'')}
                      onClick={()=>{ setResponseStyle(style); localStorage.setItem('sos_response_style', style); }}
                      style={{textTransform:'capitalize'}}
                    >{style}</button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Clear chat history</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Wipe the current conversation. Your tasks, events, and notes stay.</div>
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}>
                  <button className="settings-toggle" onClick={()=>{ const saved = autoSaveCurrentChat(); clearChat(); setToastMsg(saved ? 'Chat saved and cleared' : 'Chat cleared'); }}>Save & clear</button>
                  <button className="settings-toggle" onClick={()=>{ clearChat(); setToastMsg('Chat cleared'); }}>Clear</button>
                </div>
              </div>
              {currentModel && (
                <div className="settings-row" style={{opacity:0.7}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:'0.88rem'}}>Active model</div>
                    <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>The AI model currently powering Charles.</div>
                  </div>
                  <span style={{fontSize:'0.78rem',color:'var(--teal)',fontFamily:'var(--font-mono, monospace)',letterSpacing:'0.02em'}}>{currentModel.split('/').pop()}</span>
                </div>
              )}
            </div>

            {/* ── Home screen (opt-in) ── */}
            <div className="settings-card settings-fullscreen-card">
              <div className="settings-row" style={{paddingBottom:6}}>
                <div style={{fontWeight:700,fontSize:'0.88rem',color:'var(--teal)'}}>Home screen</div>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Enable home screen</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Adds a calm landing surface inside the studio. Shows the time, today's date, and one focus element you pick.</div>
                </div>
                <button className={'settings-toggle'+(homePrefs.enabled?' settings-toggle-active':'')} onClick={()=>updateHomePref('enabled', !homePrefs.enabled)}>{homePrefs.enabled ? 'On' : 'Off'}</button>
              </div>
              {homePrefs.enabled && (
                <>
                  <div className="settings-row">
                    <div>
                      <div style={{fontWeight:600,fontSize:'0.88rem'}}>Background</div>
                      <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Pick a curated gradient.</div>
                    </div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
                      {HOME_BACKGROUNDS.map(b => (
                        <button
                          key={b.id}
                          className={'settings-toggle'+(homePrefs.background===b.id?' settings-toggle-active':'')}
                          onClick={()=>updateHomePref('background', b.id)}
                          title={b.label}
                          style={{minWidth:62}}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-row">
                    <div>
                      <div style={{fontWeight:600,fontSize:'0.88rem'}}>Focus element</div>
                      <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>What sits below the time and date.</div>
                    </div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
                      {HOME_FOCUS_OPTIONS.map(opt => (
                        <button
                          key={opt.id}
                          className={'settings-toggle'+(homePrefs.focus===opt.id?' settings-toggle-active':'')}
                          onClick={()=>updateHomePref('focus', opt.id)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {homePrefs.focus === 'message' && (
                    <div className="settings-row">
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600,fontSize:'0.88rem'}}>Custom message</div>
                        <div style={{fontSize:'0.78rem',color:'var(--text-dim)',marginBottom:6}}>Shown below the clock when "Custom message" is the focus.</div>
                        <input
                          type="text"
                          value={homePrefs.message}
                          onChange={e=>updateHomePref('message', e.target.value)}
                          placeholder="Stay focused. The next hour belongs to you."
                          style={{width:'100%',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'6px 10px',color:'var(--text)',fontSize:'0.85rem',outline:'none',boxSizing:'border-box'}}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Interface ── */}
            <div className="settings-card settings-fullscreen-card">
              <div className="settings-row" style={{paddingBottom:6}}>
                <div style={{fontWeight:700,fontSize:'0.88rem',color:'var(--teal)'}}>Interface</div>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Sound effects</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Lofi UI sounds for actions, navigation, and responses.</div>
                </div>
                <AppleSwitch checked={sfxEnabled} onChange={()=>{ const next = sfx.toggle(); setSfxEnabled(next); }} label="Sound effects" />
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Usage analytics</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Show RPM usage and active AI model in the top bar.</div>
                </div>
                <AppleSwitch checked={showAnalytics} onChange={() => { const n = !showAnalytics; setShowAnalytics(n); localStorage.setItem('sos_show_analytics', n ? 'true' : 'false'); }} label="Usage analytics" />
              </div>
            </div>

            {/* ── Notifications ── */}
            <div className="settings-card settings-fullscreen-card">
              <div className="settings-row" style={{paddingBottom:6}}>
                <div>
                  <div style={{fontWeight:700,fontSize:'0.88rem',color:'var(--teal)'}}>Notifications</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>{'Notification' in window && Notification.permission === 'denied' ? '⚠ Blocked — check your browser settings' : 'Browser reminders for tasks, exams, and your daily plan.'}</div>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Task due-date reminders</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Alert 1 day before and day-of when a task is due.</div>
                </div>
                <AppleSwitch checked={!!notifPrefs.tasks} onChange={()=>updateNotifPref('tasks',!notifPrefs.tasks)} label="Task reminders" />
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Exam countdown alerts</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>3 days before and day-before reminders for exams/tests.</div>
                </div>
                <AppleSwitch checked={!!notifPrefs.exams} onChange={()=>updateNotifPref('exams',!notifPrefs.exams)} label="Exam alerts" />
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Daily plan reminder</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Morning nudge at 8am with your active task count.</div>
                </div>
                <AppleSwitch checked={!!notifPrefs.daily} onChange={()=>updateNotifPref('daily',!notifPrefs.daily)} label="Daily reminder" />
              </div>
              {'Notification' in window && Notification.permission !== 'denied' && (
                <div className="settings-row">
                  <div>
                    <div style={{fontWeight:600,fontSize:'0.88rem'}}>Send test notification</div>
                    <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Fire a test browser notification to confirm everything is working.</div>
                  </div>
                  <button className="settings-toggle" onClick={async () => {
                    if (Notification.permission !== 'granted') {
                      const perm = await Notification.requestPermission();
                      if (perm !== 'granted') return;
                    }
                    scheduleNotificationsToSW([{ title: '✅ SOS Notifications', body: 'Reminders are working!', fireAt: Date.now() + 1000, tag: 'sos-test' }]);
                    setToastMsg('Test notification sent — check your browser');
                  }}>Test</button>
                </div>
              )}
            </div>

            {/* ── Data ── */}
            <div className="settings-card settings-fullscreen-card">
              <div className="settings-row" style={{paddingBottom:6}}>
                <div style={{fontWeight:700,fontSize:'0.88rem',color:'var(--teal)'}}>Data</div>
              </div>
              <div className="settings-row">
                <div>
                  <div style={{fontWeight:600,fontSize:'0.88rem'}}>Export data</div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Download all your tasks, events, and notes as a JSON file.</div>
                </div>
                <button className="settings-toggle" onClick={() => {
                  const payload = { exportedAt: new Date().toISOString(), tasks, events, notes };
                  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `sos-export-${new Date().toISOString().slice(0,10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}>Export</button>
              </div>
            </div>

            <AppearanceSettings user={user} />
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:16,padding:'12px 0',fontSize:'0.78rem'}}>
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{color:'var(--text-dim)',textDecoration:'none',transition:'color .15s'}}>Privacy Policy</a>
              <span style={{color:'var(--border)'}}>|</span>
              <a href="/terms" target="_blank" rel="noopener noreferrer" style={{color:'var(--text-dim)',textDecoration:'none',transition:'color .15s'}}>Terms of Service</a>
            </div>
          </div>
        </div>
      ) : activePanel === 'proofread' ? (
        <div className="settings-fullscreen">
          <div className="settings-fullscreen-inner">
            <div className="settings-fullscreen-header">
              <div>
                <div className="settings-title">Proofread</div>
                <div className="settings-sub">Drop an essay, math worksheet, or PDF. The AI flags issues and suggests fixes.</div>
              </div>
              <button className="settings-toggle settings-toggle-active" onClick={()=>setActivePanel('chat')}>{Icon.x(14)} Close</button>
            </div>
            <ProofreadPanel />
          </div>
        </div>
      ) : (
      <>
      <div className={'sos-chat-shell' + (showSidebarCompanion ? ' companion-open' : '') + (showSidebarCompanion && companionCollapsed ? ' companion-collapsed' : '')}>
      <div className="sos-chat-column">
      {/* ── Chat Area ── */}
      <ErrorBoundary>
      <div className={"sos-chat-area" + (activeWidgets.schedule ? ' widget-wide' : activeWidgets.pomodoro ? ' widget-narrow' : '')} ref={chatAreaRef} style={{animation:'fadeIn .22s ease'}}>
          {messages.length === 0 && !pendingClarification && !pendingProposal && !isLoading && (
            <div className="sos-chat-empty">
              <div className="sos-chat-empty-stamp-wrap">
                <div className="sos-stamp">
                  <span className="sos-stamp-corner tl"/><span className="sos-stamp-corner tr"/>
                  <span className="sos-stamp-corner bl"/><span className="sos-stamp-corner br"/>
                  <div className="sos-stamp-strip sos-stamp-strip-top">
                    <span>student</span><span className="sos-stamp-dot"/><span>operating</span><span className="sos-stamp-dot"/><span>system</span>
                  </div>
                  <span className="sos-mark" style={{fontSize:88}}>
                    <span className="sos-mark-s">S</span>
                    <span className="sos-mark-bulb"><svg><use href="#sos-bulb"/></svg></span>
                    <span className="sos-mark-s">S</span>
                  </span>
                  <div className="sos-stamp-strip sos-stamp-strip-bot">
                    <span>est · 2025</span><span className="sos-stamp-dot"/><span>ver · 2.0</span><span className="sos-stamp-dot"/><span>notebook OS</span>
                  </div>
                </div>
              </div>
              {user ? (
                <div className="sos-chat-empty-welcome">
                  <div className="sos-chat-empty-welcome-line">
                    {(() => {
                      const h = new Date().getHours();
                      const name = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';
                      if (h < 5)  return `burning the midnight oil, ${name}`;
                      if (h < 12) return `good morning, ${name}`;
                      if (h < 17) return `good afternoon, ${name}`;
                      if (h < 21) return `good evening, ${name}`;
                      return `late night session, ${name}`;
                    })()}
                  </div>
                  <div className="sos-chat-empty-welcome-sub">
                    {(() => {
                      const subs = [
                        "what's on your mind today?",
                        "what do you need help with?",
                        "what are we working on?",
                        "ready when you are.",
                        "let's get something done.",
                      ];
                      return subs[Math.floor(Date.now() / 60000) % subs.length];
                    })()}
                  </div>
                </div>
              ) : (
                <div className="sos-chat-empty-suggestions" role="group" aria-label="Try one of these">
                  <div className="sos-chat-empty-suggestions-label">try one of these</div>
                  <div className="sos-chat-empty-grid">
                    {[
                      'Add a task: physics problem set due Friday',
                      "What's on my schedule this week?",
                      'Make a new note for history lecture',
                      'Block 3-5pm tomorrow for studying',
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className="sos-chat-empty-pill"
                        onClick={() => sendMessage(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {briefingData && (
            <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
              <div style={{borderLeft:'3px solid var(--accent)',background:'rgba(108,99,255,0.05)',borderRadius:12,padding:'12px 14px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <strong style={{fontSize:'0.92rem'}}>Today's briefing</strong>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={loadBriefing} disabled={briefingLoading} title="Refresh"
                      style={{background:'transparent',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-dim)',fontSize:'0.72rem',padding:'3px 8px',cursor:'pointer'}}>
                      {briefingLoading ? '…' : '↻'}
                    </button>
                    <button onClick={()=>setBriefingData(null)} title="Dismiss"
                      style={{background:'transparent',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-dim)',fontSize:'0.72rem',padding:'3px 8px',cursor:'pointer'}}>×</button>
                  </div>
                </div>
                {briefingData.summary && (
                  <div style={{fontSize:'0.86rem',color:'var(--text)',marginBottom:10,lineHeight:1.4}}>{briefingData.summary}</div>
                )}
                {Array.isArray(briefingData.events_today) && briefingData.events_today.length > 0 && (
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:'0.7rem',color:'var(--text-dim)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Schedule</div>
                    {briefingData.events_today.map((ev,j)=>(<div key={'be'+j} style={{fontSize:'0.84rem',padding:'2px 0'}}>· {ev}</div>))}
                  </div>
                )}
                {Array.isArray(briefingData.unfinished_tasks) && briefingData.unfinished_tasks.length > 0 && (
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:'0.7rem',color:'var(--text-dim)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Unfinished</div>
                    {briefingData.unfinished_tasks.map((t,j)=>(<div key={'bt'+j} style={{fontSize:'0.84rem',padding:'2px 0'}}>· {t}</div>))}
                  </div>
                )}
                {Array.isArray(briefingData.prep_gaps) && briefingData.prep_gaps.length > 0 && (
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:'0.7rem',color:'var(--warning)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Prep gaps</div>
                    {briefingData.prep_gaps.map((g,j)=>(<div key={'bg'+j} style={{fontSize:'0.84rem',padding:'2px 0'}}>· {g}</div>))}
                  </div>
                )}
                {Array.isArray(briefingData.missing) && briefingData.missing.length > 0 && (
                  <div>
                    <div style={{fontSize:'0.7rem',color:'var(--warning)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Anything missing?</div>
                    {briefingData.missing.map((m,j)=>(<div key={'bm'+j} style={{fontSize:'0.84rem',padding:'2px 0'}}>· {m}</div>))}
                  </div>
                )}
              </div>
            </div>
          )}
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
        {pendingProposal && (
          <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
            <ProposalCard proposal={pendingProposal} onApprove={handleProposalApprove} onDismiss={handleProposalDismiss} />
          </div>
        )}
        {pendingClarification && (() => {
          // Structured (context_action + missing_fields) → direct-merge multi-field card.
          // Falls back to legacy ClarificationCard for vague/options-based AI clarifications.
          const c = Array.isArray(pendingClarification) ? pendingClarification[0] : pendingClarification;
          const useMulti = c && c.context_action && Array.isArray(c.missing_fields) && c.missing_fields.length > 0
            && (c.multi_field || (!c.options || c.options.length === 0));
          return (
            <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px', flexDirection:'column'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,fontSize:'0.72rem',color:'var(--text-dim)',fontWeight:600,letterSpacing:'0.02em'}}>
                <span style={{display:'flex',color:'var(--accent)'}}>{Icon.clipboard(12)}</span>
                <span style={{textTransform:'uppercase',letterSpacing:'0.5px'}}>Collecting details to complete action</span>
              </div>
              {useMulti
                ? <MultiFieldClarificationCard clarification={{...c, multi_field: true}} onSubmit={handleClarificationSubmit} onSkip={() => { setPendingClarification(null); setPendingClarificationAnswers(null); }} savedAnswers={pendingClarificationAnswers && typeof pendingClarificationAnswers === 'object' && !Array.isArray(pendingClarificationAnswers) ? pendingClarificationAnswers : null} onAnswersChange={setPendingClarificationAnswers}/>
                : <ClarificationCard clarification={pendingClarification} onSubmit={handleClarificationSubmit} onSkip={() => { setPendingClarification(null); setPendingClarificationAnswers(null); }} savedAnswers={pendingClarificationAnswers} onAnswersChange={setPendingClarificationAnswers} />}
            </div>
          );
        })()}
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
                        executeAction({type:'add_event',title:pa.action.title,date:ds,event_type:pa.action.event_type||'event',subject:pa.action.subject||'',__confirmed:true});
                        count++;
                      }
                      cursor.setDate(cursor.getDate()+1);
                    }
                  } else {
                    executeAction({ ...pa.action, __confirmed: true, commitment: 'confirmed', status: (pa.action.type === 'add_event' || pa.action.type === 'update_event') ? 'confirmed' : pa.action.status });
                    if (user) { try { trackEvent(user.id, 'ai_action_confirmed', { action_type: pa.action?.type, reason: pa.reason || null, confidence: pa.confidence ?? null, bulk: true }); } catch (_) {} }
                  }
                });
                setPendingActions(prev=>prev.filter((_,i)=>!checkedArr[i]));
                if(toExec.length>0){
                  setToastMsg('Added '+toExec.length+' items');
                  const calTypes=['add_event','add_block','add_task','delete_event','delete_task','delete_block','update_event','convert_event_to_block','convert_block_to_event','add_recurring_event'];
                  if(toExec.some(pa=>calTypes.includes(pa.action.type))){
                    if(layoutMode==='sidebar'){openCompanionPanel('notes');}
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
                  checkedEvents.forEach(ev=>executeAction({type:'add_event',title:ev.title,date:ev.date,event_type:ev.event_type,subject:ev.subject,__confirmed:true}));
                  setPendingActions(prev=>prev.filter((_,i)=>i!==idx));
                  setToastMsg('Added '+checkedEvents.length+' recurring events');
                }}
                onCancel={()=>handleCancelAction(idx)}
              />
            ) : (
              <>
                {(pa.reason === 'tentative' || pa.reason === 'low_confidence') && (
                  <div style={{marginBottom:4,display:'flex',alignItems:'center',gap:6,fontSize:'0.7rem',color:'var(--warning)',textTransform:'uppercase',letterSpacing:'0.5px'}}>
                    <span style={{padding:'2px 8px',borderRadius:8,background:'rgba(255,165,2,0.1)',border:'1px solid rgba(255,165,2,0.25)'}}>
                      {pa.reason === 'tentative' ? 'tentative' : 'low confidence'}
                      {typeof pa.confidence === 'number' ? ` · ${Math.round(pa.confidence * 100)}%` : ''}
                    </span>
                  </div>
                )}
                <ConfirmationCard action={pa.action} onConfirm={(action)=>handleConfirmAction(idx,action)} onCancel={()=>handleCancelAction(idx)} isFallback={pa.isFallback}/>
              </>
            )}
          </div>
        ))}
        {pendingContent.map((pc,idx)=>(
          <div key={'pc-'+idx} className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
            <ContentTypeRouter content={pc} onSave={()=>handleSaveContent(idx)} onDismiss={()=>handleDismissContent(idx)} onApplyPlan={(steps)=>handleApplyPlan(idx,steps)} onApplyIntentPlan={(plan)=>handleApplyIntentPlan(idx,plan)} onApplyIntentPlanSkipConflicts={(plan)=>handleApplyIntentPlanSkipConflicts(idx,plan)} onStartPlanTask={(step)=>handleStartPlanTask(step)} onExportGoogleDocs={(planData)=>handleExportPlanToGoogleDocs(idx,planData)} googleConnected={isGoogleConnected()} existingRecurring={blocks.recurring}/>
          </div>
        ))}
        {pendingLinkSuggestions.map((sug)=>(
          <div key={'pls-'+sug.key} className="sos-msg sos-msg-ai" style={{padding:'6px 16px'}}>
            <LinkSuggestionCard
              suggestion={sug}
              onApprove={confirmLinkSuggestion}
              onReject={rejectLinkSuggestion}
              onDismiss={dismissLinkSuggestion}
            />
          </div>
        ))}
        {isLoading&&(pipelineProgress
          ? <PipelineProgressIndicator progress={pipelineProgress}/>
          : <ThinkingIndicator message={loadingMessage}/>
        )}
        {previewPlanEntry&&(()=>{
          const planData=previewPlanEntry;
          const isIntentPlan=planData.recurring_blocks||planData.milestone_tasks;
          if(!isIntentPlan)return null;
          const conflicts=detectPlanConflicts(planData.recurring_blocks||[],blocks.recurring||[]);
          return(
            <div className="sos-msg sos-msg-ai" style={{padding:'6px 16px',opacity:0.82}}>
              <div style={{fontSize:'0.72rem',color:'var(--accent)',marginBottom:4,paddingLeft:2,fontStyle:'italic',animation:'textPulse 1.6s ease-in-out infinite'}}>preview · refining…</div>
              <IntentPlanCard data={planData} conflicts={conflicts} onApply={()=>{}} onApplyWithoutConflicts={()=>{}} onDismiss={()=>setPreviewPlanEntry(null)}/>
            </div>
          );
        })()}
        {autoApproveStatus && <AutoApproveIndicator status={autoApproveStatus} />}
        {chatError&&<div style={{padding:'8px 16px'}}><div style={{padding:'10px 14px',borderRadius:16,background:'rgba(255,71,87,0.08)',border:'1px solid rgba(255,71,87,0.25)',fontSize:'0.84rem',color:'var(--danger)',maxWidth:'80%'}}>{chatError}</div></div>}
        <div ref={messagesEndRef} style={{height:1}}/>
      </div>

      </ErrorBoundary>
      {/* ── Guest Demo Banner — only when ≤5 messages remain ── */}
      {!user && (GUEST_DEMO_LIMIT - guestMsgCount) <= 5 && (
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
      <div className={"sos-input-area" + (activeWidgets.schedule ? ' widget-wide' : activeWidgets.pomodoro ? ' widget-narrow' : '')}>
        {contextTrimInfo&&(
          <div style={{fontSize:'0.72rem',color:'var(--text-dim)',marginBottom:6,paddingLeft:4,opacity:0.7}}>
            showing {contextTrimInfo.shown} of {contextTrimInfo.total} tasks in AI context
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
            {undoToast && (
              <div className="sos-undo-toast">
                <span>{undoToast.label}</span>
                <button onClick={doUndo}>Undo</button>
                <button onClick={() => { setUndoToast(null); if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }} aria-label="Dismiss">×</button>
              </div>
            )}
            {pasteStudyPrompt && (
              <div style={{marginBottom:8,padding:'8px 12px',background:'rgba(134,239,172,0.07)',border:'1px solid rgba(134,239,172,0.2)',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,animation:'fadeIn .2s ease',fontSize:'0.80rem',color:'var(--text-dim)'}}>
                <span>Looks like you pasted a lot of text — want me to make study materials?</span>
                <div style={{display:'flex',gap:6,flexShrink:0}}>
                  <button onClick={()=>{ const t=pasteStudyPrompt; setPasteStudyPrompt(null); sendMessage(`Based on this content, please: 1) create flashcards, 2) write a short quiz, and 3) give a brief summary.\n\nContent:\n${t.slice(0,4000)}`); }} style={{background:'rgba(134,239,172,0.15)',border:'1px solid rgba(134,239,172,0.3)',borderRadius:8,color:'#86efac',fontSize:'0.76rem',fontWeight:600,padding:'4px 10px',cursor:'pointer'}}>Yes, do it</button>
                  <button onClick={()=>setPasteStudyPrompt(null)} style={{background:'transparent',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-dim)',fontSize:'0.76rem',padding:'4px 10px',cursor:'pointer'}}>No thanks</button>
                </div>
              </div>
            )}
            <div style={{position:'relative'}}>
            <form className="sos-chat-form" onSubmit={handleSubmit} style={{display:'flex',gap:8,alignItems:'center'}}>
              <input ref={photoInputRef} type="file" accept="image/*,.pdf,.txt,text/plain,application/pdf" style={{display:'none'}} onChange={handleAttachmentSelect}/>
              <button type="button" className="sos-input-icon-btn" onClick={()=>setShowAttachMenu(p=>!p)} disabled={isLoading} title="Attach or import"
                style={{width:40,height:40,borderRadius:'50%',background:'transparent',border:'1px solid '+(pendingPhoto||showAttachMenu?'var(--accent)':'var(--border)'),color:pendingPhoto||showAttachMenu?'var(--accent)':'var(--text-dim)',cursor:isLoading?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .2s',opacity:isLoading?0.5:1}}>
                {Icon.plus(18)}
              </button>
              {showAttachMenu && (
                <>
                  <div style={{position:'fixed',inset:0,zIndex:199}} onClick={()=>setShowAttachMenu(false)}/>
                  <div className="sos-attach-menu">
                    <button type="button" onClick={()=>{photoInputRef.current?.click();setShowAttachMenu(false);}}>📎 File</button>
                    <button type="button" onClick={()=>{setShowGoogleModal(true);setShowAttachMenu(false);}}>🔗 Google</button>
                  </div>
                </>
              )}
              <button type="button" className="sos-input-icon-btn" onClick={startRecording} disabled={isLoading}
                style={{width:40,height:40,borderRadius:'50%',background:'transparent',border:'1px solid var(--border)',color:'var(--text-dim)',cursor:isLoading?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .2s',opacity:isLoading?0.5:1}}>
                {Icon.mic(18)}
              </button>
              <div style={{position:'relative',flex:1}}>
              <input className="sos-chat-input" ref={inputRef} value={input}
                onPaste={e=>{
                  const text = e.clipboardData?.getData('text') || '';
                  if (text.length > 500) {
                    setTimeout(()=>setPasteStudyPrompt(text), 50);
                  }
                }}
                onChange={wikilinkChatHook.inputProps.onChange}
                placeholder={pendingPhoto?"add a message or just send the photo...":messages.length===0?["What's on your plate today?","What do you need help with?","Tell me about your classes...","What's coming up this week?","Anything on your mind?"][welcomeIdx]:"Ask anything"}
                disabled={isLoading}
                style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:24,padding:'12px 20px',fontSize:'0.92rem',outline:'none',opacity:isLoading?0.5:1,transition:'all .25s cubic-bezier(0.16,1,0.3,1)'}}
                onKeyDown={e=>{
                  // Wikilink autocomplete intercepts ↑↓/Enter/Tab/Esc when its popover is open.
                  if (wikilinkChatHook.isOpen) {
                    wikilinkChatHook.inputProps.onKeyDown(e);
                    if (e.defaultPrevented) return;
                  }
                  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSubmit();}
                }}
              />
              {wikilinkChatHook.popover}
              </div>
              <button type="submit" className="sos-send-btn neon-primary" disabled={isLoading||(!input.trim()&&!pendingPhoto)} style={{width:44,height:44,borderRadius:14,color:'#fff',border:'none',cursor:(isLoading||(!input.trim()&&!pendingPhoto))?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all .15s',flexShrink:0,opacity:(isLoading||(!input.trim()&&!pendingPhoto))?0.3:1}}>{Icon.send(18)}</button>
            </form>
            {input.length > 0 && !isLoading && (
              <div className="sos-enter-hint">Enter to send · Shift+Enter for new line</div>
            )}
            </div>
          </>
        )}
        <div style={{marginTop:8,padding:'8px 10px',border:'1px solid var(--border)',borderRadius:10,background:'rgba(255,255,255,0.03)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
          <span style={{fontSize:'0.74rem',color:'var(--text-dim)'}}>Your data controls and policy details are always available.</span>
          <a href="privacy.html" style={{fontSize:'0.74rem',color:'var(--accent)',fontWeight:600,textDecoration:'none'}}>Privacy Policy</a>
        </div>
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
          {!companionCollapsed && sidebarCompanionPanel === 'notes' && (
            <div style={{padding:'6px 10px 0'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <div style={{fontSize:'0.76rem',fontWeight:700,color:'var(--text-dim)',letterSpacing:'0.02em',textTransform:'uppercase'}}>
                  Notes workflows
                </div>
                <button className="settings-toggle" onClick={closeSidebarCompanion} style={{padding:'4px 8px',fontSize:'0.68rem'}}>Close panel</button>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
                {['Summarize note','Make flashcards','Quiz me'].map((chip) => (
                  <button key={chip} className="sos-chip" onClick={()=>sendChip(chip)}>{chip}</button>
                ))}
              </div>
            </div>
          )}
          {!companionCollapsed && sidebarCompanionPanel === 'notes' && (
            <NotesPanel notes={notes} events={events} tasks={tasks} entityLinks={entityLinks} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} onCreateNote={handleCreateNote} onWikilinkClick={handleWikilinkClick} embedded/>
          )}
        </div>
      )}
      </div>
      </>
      )}
      {layoutMode === 'lofi' && (
        <StudyBottomBar
          tasks={tasks}
          recentlyCompleted={tasks.filter(t => t.status === 'done')}
          analyticsInfo={showAnalytics && (rpmSnapshot.remaining !== Infinity || currentModel)
            ? `${rpmSnapshot.remaining !== Infinity ? `${rpmSnapshot.remaining}/${rpmSnapshot.limit} RPM · ` : ''}${currentModel ? currentModel.split('/').pop() : ''}${modelFallbackUsed ? ' ↩' : ''}`
            : null}
        />
      )}
      </div>

      {layoutMode === 'lofi' && <LofiRightPanel
        weatherData={weatherData}
        savedChats={savedChats}
        onOpenSavedChat={loadSavedChat}
        onDeleteSavedChat={deleteSavedChat}
        onRenameSavedChat={renameSavedChat}
      />}
      {showNotes&&<NotesPanel notes={notes} events={events} tasks={tasks} entityLinks={entityLinks} onClose={()=>setShowNotes(false)} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} onCreateNote={handleCreateNote} onWikilinkClick={handleWikilinkClick}/>}
      {showMyPlans && user && <MyPlansPanel plans={studyPlans} tasks={tasks} onClose={()=>setShowMyPlans(false)} onRevise={(planId)=>{ const plan = studyPlans.find(p=>p.id===planId); setShowMyPlans(false); setPendingRevisionPlanId(planId); postAssistantNote(`What changes should I make to "${plan?.title||'your plan'}"? (e.g. "make the schedule lighter", "add 2 more study sessions per week")`); }} onArchive={(planId)=>{ syncOp(()=>dbUpdateStudyPlan(planId,{status:'archived'},user.id)); setStudyPlans(prev=>prev.map(p=>p.id===planId?{...p,status:'archived'}:p)); }}/>}
      {layoutMode === 'lofi' && lofiNoteOpen && <NotesPanel notes={notes} events={events} tasks={tasks} entityLinks={entityLinks} onClose={()=>setLofiNoteOpen(false)} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} onCreateNote={handleCreateNote} onWikilinkClick={handleWikilinkClick}/>}
      {showGlobalSearch && <GlobalSearchModal
        query={globalSearchQuery}
        onQueryChange={setGlobalSearchQuery}
        onClose={() => setShowGlobalSearch(false)}
        tasks={tasks}
        events={events}
        notes={notes}
        savedChats={savedChats}
        onSelectNote={note => { setShowGlobalSearch(false); setShowNotes(true); }}
        onOpenSavedChat={loadSavedChat}
        onSendMessage={q => { setShowGlobalSearch(false); sendMessage(q); }}
      />}
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
                        <button className="chat-sidebar-item-rename" onClick={e => { e.stopPropagation(); renameSavedChat(chat.id); }}>Rename</button>
                        <button className="chat-sidebar-item-delete" onClick={e => { e.stopPropagation(); setConfirmDeleteChat(chat); }}>Delete</button>
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
      {showAuthModal && <AuthModal onAuth={(u)=>{handleAuth(u);setShowAuthModal(false);setAuthModalInitialMode('login');}} onClose={()=>{setShowAuthModal(false);setAuthModalInitialMode('login');}} initialMode={authModalInitialMode} />}
      {savedChatUndo&&(
        <div className="sos-saved-chat-undo" role="status">
          <span>Deleted “{savedChatUndo.chat.title || 'Saved chat'}”</span>
          <button onClick={restoreDeletedSavedChat}>Undo</button>
          <button onClick={() => { setSavedChatUndo(null); if (savedChatUndoTimerRef.current) clearTimeout(savedChatUndoTimerRef.current); }} aria-label="Dismiss saved chat undo">×</button>
        </div>
      )}
      {toastMsg&&<Toast message={toastMsg} onDone={()=>setToastMsg(null)}/>}
      <GooglePermissionSummary show={showGooglePermSummary} onDismiss={()=>setShowGooglePermSummary(false)} />
      <RateLimitBanner />

      {lightboxUrl&&(
        <div onClick={()=>setLightboxUrl(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',animation:'overlayIn .2s ease'}}>
          <img src={lightboxUrl} alt="full size" style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:12,objectFit:'contain'}}/>
        </div>
      )}
    </div>
  );
}


export default App;
