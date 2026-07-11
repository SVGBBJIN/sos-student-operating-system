import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { sb, SUPABASE_ANON_KEY, EDGE_FN_URL, CHAT_MAX_MESSAGES, queueEmbedSync } from './lib/supabase';
import { streamChat } from './lib/streamChat';
import { extractPdfText } from './lib/pdf';
import { classifyPlanShape } from './lib/planShape';
import { plainTextFromHtml } from './lib/text';
import Icon from './lib/icons';
import { trackEvent } from './lib/analytics';
import { dbInsertTaskEvent } from './lib/dataHandlers';
import ErrorBoundary from './components/ErrorBoundary';
import Onboarding from './components/Onboarding';

import * as sfx from './lib/sfx';
import StudyTopBar from './components/StudyTopBar';
import { estimateInputTokens, truncateWithEllipsis, capLines, capLinesInfo, dedupeRepeatedLines } from './lib/textUtils';
import { fmt, fmtFull, toDateStr, today, daysUntil, fmtTime, getPriority } from './lib/dateUtils';
import { normalize, matchScore, resolveEvent, resolveTask } from './lib/matching';
import PomodoroTimer from './components/PomodoroTimer';
import ScheduleWidget from './components/ScheduleWidget';
import StartWidget from './components/StartWidget';
import SosNotification from './components/SosNotification';
import StudioSidebar from './components/StudioSidebar';
import StudioDashboard from './components/StudioDashboard';
import ProjectPanel from './components/ProjectPanel.jsx';
import RateLimitBanner from './components/RateLimitBanner';
import GooglePermissionSummary from './components/GooglePermissionSummary';
import { useAgenticMode } from './hooks/useSettings';
import AppearanceSettings from './components/AppearanceSettings';
import ConnectorsSettings from './components/ConnectorsSettings';
import { dbEventToApp as dbEventToAppShared, appEventToDb as appEventToDbShared } from './lib/eventShape.js';
import { mapGoogleCalItems } from './lib/googleImport.js';
import { SUBJECT_LIST } from '../shared/subjects.js';
import { SCHEMA_VERSIONS } from '../shared/ai/schemas/versions.ts';
import { rankTasks, rankForQuickStart, buildCalendarDensity } from '../shared/scheduling/priority.ts';
import { GATE_TASK_QUOTA, computeTrajectoryChip, currentCommitment } from '../shared/scheduling/gate.ts';
import { classifyContentType } from '../shared/coaching/workcheck.ts';
import {
  START_LATENCY_EXPERIMENT_KEY,
  assignArm,
  isValidArm,
  getMechanism,
  getActiveArms,
  computeStartLatencyMs,
} from '../shared/experiments/start-latency.ts';
import { adaptiveAssign } from '../shared/experiments/allocation.ts';
import HomeScreen, { HOME_BACKGROUNDS, HOME_FOCUS_OPTIONS, getHomePrefs, setHomePref } from './components/HomeScreen';
import HomeDecisionGate from './components/HomeDecisionGate';
import DecisionRollup from './components/DecisionRollup';
import FocusLauncher from './components/FocusLauncher';
import FocusSession from './components/FocusSession';
import {
  buildSessionQueue,
  activeAndOnDeck,
  remainingCount,
  sprintShouldClose,
  isGoalMet,
  decideBreak,
  breakOfferLine,
  computeFadeHour,
  gapsFromTimestamps,
  summaryLine,
  DEFAULT_BREAK_MS,
} from '../shared/scheduling/focus.ts';
import AuthModal from './components/AuthModal';
import { ConfirmationCard, BulkConfirmationCard } from './components/ConfirmationCards';
import { validateActionSchema, defaultsForAction, buildLocalClarification } from './lib/actionSchemaHelpers';
import { MultiFieldClarificationCard, ClarificationCard } from './components/ClarificationCard';
import ProposalCard from './components/ProposalCard';
import RecurringEventPopup from './components/RecurringEventPopup';
import { PlanTemplateSelector, detectPlanConflicts, IntentPlanCard } from './components/PlanCards';
import MyPlansPanel from './components/MyPlansPanel';
import DeadlinesPanel from './components/DeadlinesPanel';
import ContentTypeRouter from './components/ContentTypeRouter';
import GoogleImportModal from './components/GoogleImportModal';
import LmsSetupModal from './components/LmsSetupModal';
import GlobalSearchModal from './components/GlobalSearchModal';
import NotesPanel from './components/NotesPanel';
import { Toast, LmsPendingToast, AppleSwitch } from './components/Toast';
import { formatAssistantMessage, getLoadingMessage, CONTENT_GEN_REGEX } from './lib/formatting';
import { ThinkingIndicator, PipelineProgressIndicator, AutoApproveIndicator } from './components/PipelineProgressIndicator';

const ONBOARDING_ESTABLISHED_PREFIX = 'sos_onboarding_established_';

function isOnboardingEstablished(userId) {
  if (!userId) return false;
  try {
    return localStorage.getItem(ONBOARDING_ESTABLISHED_PREFIX + userId) === '1'
      || localStorage.getItem('sos_onboarded_' + userId) === '1';
  } catch (_) { return false; }
}

function setOnboardingEstablished(userId) {
  if (!userId) return;
  try {
    localStorage.setItem(ONBOARDING_ESTABLISHED_PREFIX + userId, '1');
    // Keep the legacy one-shot key in sync for older clients that still read it.
    localStorage.setItem('sos_onboarded_' + userId, '1');
  } catch (_) {}
}


/* ─── Date helpers ─── */
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
    const todayStr = today();
    const fireAt = atDate(todayStr, dailyHour);
    if (fireAt > now) {
      notes.push({ title: '📋 Good morning — here\'s your plan', body: `You have ${tasks.filter(t=>t.status!=='done').length} active tasks today.`, fireAt, tag: 'daily-plan' });
    }
  }
  // Proactive next-block nudge: 5 minutes before a timed event/block starts,
  // so the student gets a "you're up next" push instead of drifting past it.
  if (prefs.tasks !== false) {
    const todayStr = today();
    const parseHM = (s) => {
      const m = (s || '').match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      const h = +m[1], mm = +m[2];
      return h > 23 || mm > 59 ? null : h * 60 + mm;
    };
    const dayStart = new Date(todayStr + 'T00:00:00').getTime();
    events.filter(ev => ev && ev.date === todayStr && ev.status !== 'cancelled').forEach(ev => {
      const startMin = parseHM(ev.start_time || ev.startTime || ev.time);
      if (startMin == null) return;
      const fireAt = dayStart + (startMin - 5) * 60000;
      if (fireAt > now) notes.push({ title: '⏭️ Up next in 5 min', body: ev.title || 'your next block', fireAt, tag: 'next-' + ev.id });
    });
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


function addDaysISO(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  // Local-timezone formatting — toISOString() would shift the day across the
  // UTC boundary for some timezones.
  return toDateStr(d);
}

function buildBlocksForDate(blocks, dateStr) {
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  const slots = {};
  (blocks?.recurring || []).forEach(rb => {
    if (!Array.isArray(rb?.days) || !rb.days.includes(dow)) return;
    const [sh, sm] = (rb.start || '00:00').split(':').map(Number);
    const [eh, em] = (rb.end || '00:00').split(':').map(Number);
    let ch = sh, cm = sm;
    while (ch < eh || (ch === eh && cm < em)) {
      slots[String(ch).padStart(2, '0') + ':' + String(cm).padStart(2, '0')] = { name: rb.name, category: rb.category };
      cm += 30; if (cm >= 60) { ch++; cm = 0; }
    }
  });
  Object.entries(blocks?.dates?.[dateStr] || {}).forEach(([key, value]) => {
    if (value === null) delete slots[key];
    else slots[key] = value;
  });
  return slots;
}

function scheduleShortcutTarget(message) {
  const lower = (message || '').toLowerCase().trim();
  if (!lower) return null;
  const writeIntent = /\b(add|create|book|put|move|reschedule|cancel|delete|remove|set)\b.*\b(event|meeting|appointment|practice|block|task|timer)\b/i.test(lower)
    || /^schedule\s+(a|an|my)?\s*(event|meeting|appointment|practice|block|task)\b/i.test(lower);
  if (writeIntent) return null;
  const readIntent = /(what'?s|what is|show|view|open|pull up|see|look at|tell me|check|anything).*(schedule|agenda|calendar|day)\b/i.test(lower)
    || /\b(my|today'?s|tomorrow'?s|this week'?s)\s+(schedule|agenda|calendar)\b/i.test(lower)
    || /^agenda\b/i.test(lower);
  if (!readIntent) return null;
  if (/\b(this|my)\s+week\b|\bweekly\b|\bnext\s+7\s+days\b/i.test(lower)) return 'week';
  if (/\btomorrow\b|\btmrw\b|\btmw\b|\b2morrow\b/i.test(lower)) return 'tomorrow';
  return 'today';
}

function buildScheduleShortcutReply(message, tasks, events, blocks) {
  const target = scheduleShortcutTarget(message);
  if (!target) return null;

  const describeDate = (dateStr, label) => {
    const blockItems = summarizeBlockSlots(buildBlocksForDate(blocks, dateStr));
    const eventItems = (events || [])
      .filter(e => e.date === dateStr)
      .sort((a, b) => (a.time || a.start_time || '23:59').localeCompare(b.time || b.start_time || '23:59'))
      .map(e => `${e.time || e.start_time ? fmtTime(e.time || e.start_time) + ' ' : ''}${e.title || 'event'}`);
    const taskItems = (tasks || [])
      .filter(t => t.dueDate === dateStr && t.status !== 'done')
      .map(t => `due: ${t.title}`);
    const items = [...blockItems, ...eventItems, ...taskItems];
    if (items.length === 0) return `${label}: clear`;
    const visible = items.slice(0, 4).join('; ');
    const overflow = items.length > 4 ? `; +${items.length - 4} more` : '';
    return `${label}: ${visible}${overflow}`;
  };

  if (target === 'week') {
    const start = today();
    const days = Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));
    const summaries = days
      .map((dateStr, i) => describeDate(dateStr, i === 0 ? 'today' : fmt(dateStr)))
      .filter(line => !line.endsWith(': clear'))
      .slice(0, 4);
    return summaries.length > 0
      ? `opened your schedule widget. this week: ${summaries.join(' · ')}.`
      : `opened your schedule widget. this week looks clear.`;
  }

  const dateStr = target === 'tomorrow' ? addDaysISO(today(), 1) : today();
  const label = target === 'tomorrow' ? 'tomorrow' : 'today';
  const summary = describeDate(dateStr, label);
  return `opened your schedule widget. ${summary}.`;
}

/* ── "Just start me" deterministic procrastination path ──────────────
   A student mid-spiral doesn't want a plan — they want one task and a push.
   We detect paralysis / "I don't wanna" language and skip the model entirely:
   name the single top task, hand over a trivially-startable first step, and
   auto-start a labeled focus timer. Procrastination is about starting, not
   planning — so this path never asks a question and never replies "got it." */
const JUST_START_REGEX = new RegExp([
  "i\\s*(?:do\\s*n'?t|don'?t|dont)\\s*(?:even\\s*)?(?:wanna|want\\s*to|feel\\s*like)",
  "(?:where|how|what)\\s*(?:do|should|the\\s*hell\\s*do|tf\\s*do)?\\s*i\\s*(?:even\\s*)?(?:start|begin)",
  "i\\s*(?:do\\s*n'?t|don'?t|dont)\\s*(?:even\\s*)?know\\s*(?:where|what|how)\\s*to\\s*(?:start|begin|do)",
  "idk\\s*(?:where|what|how)?\\s*(?:to\\s*)?(?:start|begin|do|even)",
  "i\\s*(?:do\\s*n'?t|don'?t|dont)\\s*(?:even\\s*)?(?:wanna|want\\s*to)\\s*do\\s*(?:any|anything|this|it|my|the)",
  "i\\s*(?:'?m|\\s*am)?\\s*(?:so\\s*|really\\s*)?(?:overwhelmed|paralyzed|drowning|burnt?\\s*out|so\\s+behind)",
  "(?:too\\s*much|so\\s*much)\\s*(?:to\\s*do|work|going\\s*on|stuff)",
  "i\\s*can'?t\\s*(?:do\\s*this|focus|deal|get\\s*started)",
  "just\\s*(?:start|make)\\s*me",
  "make\\s*me\\s*(?:start|do)",
  "help\\s*me\\s*(?:start|focus|get\\s*started)",
  "i\\s*(?:'?m|\\s*am)\\s*procrastinat",
].join("|"), "i");

function detectJustStart(message) {
  const m = (message || "").trim();
  if (!m) return false;
  if (m.length > 160) return false; // long messages are usually a real request
  return JUST_START_REGEX.test(m.toLowerCase());
}

// The "2-minute version": one trivially-startable physical first action for the
// top task, chosen by keyword. The goal is to make starting frictionless.
function smallestNextStep(task) {
  const s = `${task?.title || ''} ${task?.subject || ''}`.toLowerCase();
  if (/essay|paper|\bwrit|report|reflection|response|discussion\s*post|cover\s*letter|journal/.test(s))
    return "open a blank doc and just type the title and one messy sentence — that's it.";
  if (/read|chapter|textbook|article|\bpages?\b|annotat/.test(s))
    return "open the reading and get through just the first page.";
  if (/pset|problem\s*set|\bmath\b|calc|algebra|physics|chem|homework|worksheet|exercises?/.test(s))
    return "open it and do only the first problem.";
  if (/slides?|presentation|deck|powerpoint|keynote|poster/.test(s))
    return "open the deck and make just the title slide.";
  if (/\blab\b|\bcode\b|coding|program|debug|leetcode/.test(s))
    return "open the file and get the first line down.";
  if (/study|review|exam|test|quiz|midterm|final|flashcard|memoriz|vocab/.test(s))
    return "pull up your notes and read the first section out loud.";
  if (/project|build|design|create|\bmake\b/.test(s))
    return "open a doc and jot the first 3 bullets of what it needs.";
  return "open whatever you need for it and poke at it for 2 minutes — no pressure to finish.";
}

// CHAT_MAX_MESSAGES imported from ./lib/supabase
const GUEST_DEMO_LIMIT = 15;

// Schema-version guard. The server stamps every response with the action-tool
// schema version it was built against. We compare the MAJOR token ("v7" in
// "v7-2026-05"): a major mismatch means a breaking shape change this client
// can't read safely (e.g. a renamed field), so we refuse to execute its actions
// and tell the student to refresh. Date-only differences are non-breaking.
const EXPECTED_ACTION_SCHEMA = SCHEMA_VERSIONS.action_tools;
const schemaMajor = (v) => String(v || '').split('-')[0];

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
    const { error } = await sb.storage.from('chat-photos').upload(path, blob, { contentType: 'image/jpeg' });
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
    // Browser-extension submission tracking (see shared/lms/ingest.ts).
    completionSource: row.completion_source || null,
    completionConfidence: row.completion_confidence == null ? null : Number(row.completion_confidence),
    startSource: row.start_source || null,
    startedAt: row.started_at || null,
    pledgedStartAt: row.pledged_start_at || null,
    lmsAssignmentRef: row.lms_assignment_ref || null,
    lmsPendingClose: row.lms_pending_close || false,
    lmsPendingCloseAt: row.lms_pending_close_at || null,
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
    completion_source: t.completionSource || null,
    completion_confidence: typeof t.completionConfidence === 'number' ? t.completionConfidence : null,
    start_source: t.startSource || null,
    started_at: t.startedAt || null,
    pledged_start_at: t.pledgedStartAt || null,
    lms_assignment_ref: t.lmsAssignmentRef || null,
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
    type: row.type || 'note',
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
    type: n.type || 'note',
  };
}

/* Full load from Supabase */
async function loadAllFromSupabase(userId) {
  try {
    const [tasksRes, eventsRes, notesRes, chatRes, recurringRes, dateBlocksRes, profileRes, studyPlansRes] = await Promise.all([
      sb.from('tasks').select('*').eq('user_id', userId),
      sb.from('events').select('*').eq('user_id', userId),
      sb.from('notes').select('*').eq('user_id', userId),
      sb.from('chat_messages').select('*').eq('user_id', userId).order('created_at', { ascending: true }).limit(CHAT_MAX_MESSAGES),
      sb.from('recurring_blocks').select('*').eq('user_id', userId),
      sb.from('date_blocks').select('*').eq('user_id', userId),
      sb.from('profiles').select('*').eq('id', userId).single(),
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

    const studyPlans = studyPlansRes.error ? [] : (studyPlansRes.data || []);
    // `onboarding_completed` may be absent on older DBs; treat missing as false.
    const onboardingCompleted = !!(profileRes.data && profileRes.data.onboarding_completed);

    // Supabase resolves per-query errors into `.error` rather than throwing, so a
    // single failed table would otherwise load as an empty array — making real
    // data look gone and inviting the student to "re-add" or overwrite it. Flag
    // any core-table failure so the caller can warn instead of showing a false
    // empty state. (profile/study_plans are non-core and tolerate absence.)
    const loadIncomplete = !!(tasksRes.error || eventsRes.error || notesRes.error || recurringRes.error || dateBlocksRes.error);
    if (loadIncomplete) {
      console.error('Partial Supabase load:', {
        tasks: tasksRes.error, events: eventsRes.error, notes: notesRes.error,
        recurring: recurringRes.error, dateBlocks: dateBlocksRes.error,
      });
    }

    return { tasks, events, notes, messages, blocks, studyPlans, onboardingCompleted, loadIncomplete };
  } catch (e) {
    console.error('Failed to load from Supabase:', e);
    return null;
  }
}

/* ── Name resolver: translates fuzzy AI names → real objects with IDs ── */
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
// Best-effort: index saved work into the RAG store so it becomes retrievable
// via semantic search. Fire-and-forget — never awaited by callers.
async function syncEmbed(items) {
  try {
    const session = await sb.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) return;
    await queueEmbedSync(items, token);
  } catch (_) { /* best-effort */ }
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

    localStorage.setItem('sos_migrated_' + userId, 'true');
    // Clear the guest cache now that it's in the account — prevents this work
    // from re-importing into a different account on a later guest→signup.
    ['cc_tasks', 'cc_events', 'cc_notes', 'cc_blocks', 'cc_chat'].forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
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
  clarification: "Missing-field handling: just attempt the matching action with your BEST GUESS — prefer a sensible default over a question. The app automatically asks the student for any required field you leave out, so you almost never need ask_clarification. A tired or lazy student won't fill out a form, so default rather than interrogate. Reserve ask_clarification for genuinely AMBIGUOUS requests (not merely incomplete ones) where no reasonable default exists — keep its question one short plain sentence. NEVER invent or guess start/end times for time blocks; leave them out and let the app ask. NEVER call ask_clarification for flashcards, quizzes, summaries, outlines, or other study content — generate those right away from the topic in the message or the student's notes. If the student says 'just do it', 'don't ask', 'your call', 'you decide', 'whatever', or similar, proceed with reasonable defaults and do not ask. Never invent specific titles/names — use the student's wording. For greetings or small talk, reply naturally with no tool call.",
  overwhelm: "When the student is overwhelmed, paralyzed, procrastinating, or asks things like 'what do I do right now', 'where do I start', 'I don't even know what to do', or 'I don't wanna' — NEVER reply with a bare acknowledgement like 'got it'. FIRST call prioritize_tasks (or read_tasks) to pull their real workload, then pick ONE task to start — not necessarily the highest-priority one, but the most STARTABLE task that still matters (short, concrete, low-effort), since the goal is breaking the freeze, not optimizing the schedule. LEAD with a trivially-startable 2-minute first step ('open the doc and write the title', 'do just the first problem') before you even name the task. Procrastination is about starting, not planning. Start a 25-minute focus timer labeled with that task (set_timer preset='pomodoro', label = the task title) rather than asking how long. Be warm and encouraging — one concrete next step, never a lecture, never a bare unlabeled timer. Do NOT use points, streaks, XP, or other gamification.",
  destructive: "Destructive requests ('delete everything', 'wipe it all', 'clear everything', 'start over', 'nuke my schedule') MUST call clear_all with confirm=true so the student gets a confirmation card — never silently refuse or deflect to opening a widget. To remove a single item, use the matching delete/manage verb.",
  action_tools: "When details are explicit, call the matching action tool — even when the student STATES rather than COMMANDS. \"I have a chem test Friday\", \"There's a paper due Monday\", \"I just got assigned a 5-page essay\", \"got a calc midterm next week\" are all implicit create-action requests, not casual chat. Treat them like \"add a chem test for Friday\". Pick add_event for tests/exams/quizzes/games/practices/meetings/appointments; pick add_task for homework/essays/projects/papers/assignments. If title or date is fully missing or ambiguous, use ask_clarification — but if the message names BOTH (even informally), execute. Use specific student-provided titles only — never make up names.",
  planning_guardrails: 'Protect sleep (avoid work past 10pm), rebalance overloaded days, and handle overdue work without guilt.',
  corrections: '"actually / wait / I meant / oops" updates the latest related item.',
  conversational_capabilities: 'You\'re backed by a system that can: add events/deadlines to the calendar, create and prioritize tasks, schedule study blocks, break big projects into steps, and generate flashcards, quizzes, or full study plans in Studio. When the student signals stress, a crunch, or an upcoming deadline — even just venting — acknowledge it AND name the specific thing you can do to help. Don\'t just sympathize and move on.',
  date_resolution: 'Resolve every weekday, "today", "tomorrow", and "next week" by reading the DATE MAP in context — never compute a date yourself. Weekday references mean the current or next upcoming occurrence, never a past date. When the student asks about "this week", cover through the coming weekend.',
  vision: 'For image input, describe what is visible first, then extract actionable details.',
  timers: "For timer requests: use set_timer with `label` (the student's wording) and EXACTLY ONE of duration_seconds (1..86400), fire_at (ISO 8601 with timezone), or preset (pomodoro|short_break|long_break). Convert phrases — \"20 minutes\" → duration_seconds=1200, \"1 hour\" → 3600, \"half hour\" → 1800. NEVER guess a duration. If the student says \"set a timer\" with no length, ask how long in one short question. Anything longer than 24h belongs as an event, not a timer. To stop/cancel a running timer use cancel_timer with the label shown in ACTIVE TIMERS. If no timers are running and the student asks to cancel, say so — don't call cancel_timer.",
  notes_flow: "For add_note (create a note): always set `subject` (it becomes the folder). Source values: 'user' = student writes it, 'imported' = pasting external content, 'ai_generated' = you draft it. If subject/source/title are missing the app will ask — just attempt the note.",
};


function buildSystemPrompt(tasks, blocks, events, notes, tier = 2, options = {}) {
  const workspaceContext = options.workspaceContext || 'chat';
  const intentType = options.intentType || 'chat';
  const actionFocusedPrompt = intentType === 'action';
  const todayStr = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  const todayKey = today();
  const currentHour = new Date().getHours();

  // Explicit weekday → date lookup for the next 10 days, computed in the
  // student's LOCAL timezone. The model must never do weekday arithmetic itself
  // (that caused "Friday" → wrong date off-by-one bugs) — it reads the map.
  const dateMapLines = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const rel = i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : '';
    dateMapLines.push(d.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' }) + ' = ' + toDateStr(d) + rel);
  }
  const dateMap = dateMapLines.join('\n');

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
    'DATE MAP (resolve weekdays/"tomorrow" by reading this — never compute dates yourself):',
    dateMap,
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
DATE MAP (resolve weekdays/"tomorrow" by reading this — never compute dates yourself):
${dateMap}
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
    POLICY_MODULES.overwhelm,
    POLICY_MODULES.destructive,
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

/* ─── Multi-model message classifier ─── */
const STUDY_PACK_REGEX = /\bstudy\s?packs?\b|\bstudy\s?sets?\b/i;
const PLANNING_REGEX = /\b(study\s*plan|study\s*guide|plan\s+(?!(?:my\s+)?(?:week|month|semester)\b)(my|for|out|this)|exam\s+prep|prep\s+for|plan\s+to\s+study|make\s+(?:me\s+)?a\s+plan|create\s+(?:a\s+)?(?:study\s+)?plan)\b/i;
// Hint & Work-Check surfaces. The clue is the forward "I'm stuck, get me
// started" ask; the work-check is the backward "look at what I produced" ask.
const WORK_CHECK_REGEX = /\b(check\s+my\s+(?:work|essay|answer|proof|solution|draft|paper|homework)|review\s+my\s+(?:work|essay|answer|proof|solution|draft|paper)|is\s+this\s+(?:right|correct|good)|did\s+i\s+(?:do|get)\s+this\s+right|proof\s?read|look\s+over\s+my|how'?s?\s+my\s+(?:essay|draft|answer|work|proof)|find\s+(?:the\s+)?(?:gaps?|mistakes?|errors?|weak\s+spots?)|where\s+(?:does|do)\s+(?:this|my\s+\w+)\s+(?:break|go\s+wrong)|grade\s+my)\b/i;
const CLUE_REGEX = /\b(give\s+me\s+a\s+(?:hint|clue)|need\s+a\s+(?:hint|clue)|(?:a\s+)?hint\s+for|stuck\s+on|i'?m\s+stuck|im\s+stuck|where\s+do\s+i\s+(?:start|begin)|how\s+do\s+i\s+(?:start|begin|approach)|help\s+me\s+(?:start|begin|get\s+started)|don'?t\s+know\s+(?:how\s+to\s+start|where\s+to\s+start|how\s+to\s+begin))\b/i;
// Proofread cap: 2 rounds per assignment, the window resets every 2 hours.
// State lives client-side (no server session store) keyed by a coarse
// assignment key; the server derives the round + terminal flag from the count
// we pass. Mirrors shared/coaching/workcheck.ts proofreadState.
const PROOFREAD_WINDOW_MS = 2 * 60 * 60 * 1000;
const PROOFREAD_STORE_KEY = 'sos_proofread_hist';
function loadProofreadHistory() {
  try { return JSON.parse(localStorage.getItem(PROOFREAD_STORE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function saveProofreadHistory(hist) {
  try { localStorage.setItem(PROOFREAD_STORE_KEY, JSON.stringify(hist)); } catch (_) {}
}
// Count rounds already used in the current window for a key, pruning stale ones.
function proofreadRoundsUsedFor(hist, key) {
  const now = Date.now();
  const arr = (hist[key] || []).filter(t => typeof t === 'number' && now - t < PROOFREAD_WINDOW_MS);
  hist[key] = arr;
  return arr.length;
}

const INTENT_PLAN_REGEX = /\b(survive\s+finals|finals\s+week|help\s+me\s+(survive|balance|prepare|get\s+through)|improve\s+(my\s+)?(?:chinese|mandarin|spanish|french|korean|japanese|german|language|speaking|math|coding|programming)|build\s+a\s+routine|create\s+a\s+routine|set\s+up\s+(?:a\s+)?routine|balance\s+(?:my\s+)?(?:life|school|work|coding)|plan\s+(?:my\s+)?(?:week|month|semester)|semester\s+plan|weekly\s+(?:routine|schedule|plan))\b/i;

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
   SOS MAIN APP
   ═══════════════════════════════════════════════ */
function App() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { agenticMode, setAgenticMode } = useAgenticMode();
  const [user, setUser] = useState(null);
  // Start-latency experiment: which intervention arm this user is pinned to.
  // null until resolved from experiment_assignments (see ensureExperimentArm).
  const [experimentArm, setExperimentArm] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState('login');
  const [authNudge, setAuthNudge] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingName, setOnboardingName] = useState('');

  // ── Data stores ──
  const [tasks, setTasks] = useState([]);
  const [blocks, setBlocks] = useState({ recurring: [], dates: {} });
  const [notes, setNotes] = useState([]);
  const [events, setEvents] = useState([]);
  const [studyPlans, setStudyPlans] = useState([]);
  const [flashcardDecks, setFlashcardDecks] = useState([]);
  const [grades, setGrades] = useState([]);
  const [showMyPlans, setShowMyPlans] = useState(false);
  const [showDeadlines, setShowDeadlines] = useState(false);
  const [pendingRevisionPlanId, setPendingRevisionPlanId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [dbMessageCount, setDbMessageCount] = useState(0); // P1.4: track DB-loaded message count
  // Floating widgets summoned from chat ("set a timer", "what's my schedule").
  // null = hidden. Each widget renders only when explicitly invoked.
  const [activeWidgets, setActiveWidgets] = useState({ pomodoro: false, schedule: false, start: false });
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
  // Unified AI-pending state — one object for everything the AI surfaces after a response.
  const PENDING_INITIAL = {
    actions: [],            // action cards awaiting user approval [{ action, timestamp }]
    content: [],            // studio content cards (flashcards, quiz, plan, etc.)
    templateSelector: null, // { context } when template picker is active
    clarification: null,    // active clarification question object
    clarificationAnswers: null, // cached partial answers to the clarification
    proposal: null,         // plan proposal { summary, action_type, prefilled }
    queue: [],              // rate-limit execution queue [{ id, action, addedAt }]
  };
  const [pending, setPending] = useState(PENDING_INITIAL);
  const updatePending = (patch) =>
    setPending((prev) => ({
      ...prev,
      ...(typeof patch === "function" ? patch(prev) : patch),
    }));
  const {
    actions: pendingActions,
    content: pendingContent,
    templateSelector: pendingTemplateSelector,
    clarification: pendingClarification,
    clarificationAnswers: pendingClarificationAnswers,
    proposal: pendingProposal,
    queue: pendingQueue,
  } = pending;
  // Bridge setters — preserve old call-site signatures; functional updates forwarded safely.
  const setPendingActions = (v) => updatePending(typeof v === "function" ? (p) => ({ actions: v(p.actions) }) : { actions: v });
  const setPendingContent = (v) => updatePending(typeof v === "function" ? (p) => ({ content: v(p.content) }) : { content: v });
  const setPendingTemplateSelector = (v) => updatePending(typeof v === "function" ? (p) => ({ templateSelector: v(p.templateSelector) }) : { templateSelector: v });
  const setPendingClarification = (v) => updatePending(typeof v === "function" ? (p) => ({ clarification: v(p.clarification) }) : { clarification: v });
  const setPendingClarificationAnswers = (v) => updatePending(typeof v === "function" ? (p) => ({ clarificationAnswers: v(p.clarificationAnswers) }) : { clarificationAnswers: v });
  const setPendingProposal = (v) => updatePending(typeof v === "function" ? (p) => ({ proposal: v(p.proposal) }) : { proposal: v });
  const setPendingQueue = (v) => updatePending(typeof v === "function" ? (p) => ({ queue: v(p.queue) }) : { queue: v });
  const [aiAutoApprove, setAiAutoApprove] = useState(() => localStorage.getItem('sos_ai_auto_approve') === 'true');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showNotes, setShowNotes] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(() => localStorage.getItem('sos_show_analytics') === 'true');
  const [, setRpmSnapshot] = useState({ remaining: Infinity, limit: Infinity, resetAtMs: 0 });
  const [currentModel, setCurrentModel] = useState(null);
  const [, setModelFallbackUsed] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sos-notif-prefs') || '{"tasks":true,"exams":true,"daily":false}'); } catch(_) { return {tasks:true,exams:true,daily:false}; }
  });
  const [studioTheme, setStudioTheme] = useState(() => localStorage.getItem('sos_studio_theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', studioTheme);
    localStorage.setItem('sos_studio_theme', studioTheme);
  }, [studioTheme]);
  const [activePanel, setActivePanel] = useState('dashboard');
  const [chatOpen, setChatOpen] = useState(false);
  const [responseStyle, setResponseStyle] = useState(() => localStorage.getItem('sos_response_style') || 'balanced');
  const [sfxEnabled, setSfxEnabled] = useState(() => sfx.isEnabled());
  const getWorkspaceContext = useCallback(() => {
    return chatOpen ? 'chat' : 'none';
  }, [chatOpen]);
  const [toastMsg, setToastMsg] = useState(null);
  const [lmsPendingConfirm, setLmsPendingConfirm] = useState(null); // {taskId, taskTitle, lmsName}
  useEffect(() => { if (toastMsg) sfx.chime(); }, [toastMsg]);
  const [syncStatus, setSyncStatus] = useState('saved'); // 'saving', 'saved', 'error'
  const [, setContentGenUsed] = useState(0);
  const DAILY_CONTENT_LIMIT = 5;
  const rpmStateRef = useRef({ remaining: Infinity, resetAtMs: 0 });
  const recentlyExecutedActionsRef = useRef([]); // [{ type, summary, executedAt }]
  const proofreadHistoryRef = useRef(loadProofreadHistory()); // { [assignmentKey]: number[] }
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
  const [showLmsModal, setShowLmsModal] = useState(false);
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
  const [semanticSearchResults, setSemanticSearchResults] = useState([]);
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
      const todayStr = today();
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
    const todayStr = today();
    if (last === todayStr) return;
    briefingFetchedRef.current = true;
    // Small delay so initial Supabase fetches (tasks, events) populate first.
    const t = setTimeout(() => { loadBriefing(); }, 1500);
    return () => clearTimeout(t);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps


  // Opt-in customizable home screen. Default disabled. Persisted in localStorage
  // under `sos_home_*` keys. Re-read on mount and whenever settings flip it.
  const [homePrefs, setHomePrefs] = useState(() => getHomePrefs());
  function updateHomePref(key, value) {
    setHomePref(key, value);
    setHomePrefs(prev => ({ ...prev, [key]: value }));
  }

  const welcomeIdx = 0; // Pinned to first placeholder variant for a stable, consistent first impression

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
        if (n.type === 'saved_chat' || (n.name && n.name.startsWith('[chat-save]'))) {
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
      setStudyPlans(data.studyPlans || []);
      if (data.loadIncomplete) {
        // Some of your real data failed to load — warn loudly so an accidental
        // empty view isn't mistaken for "nothing here" and overwritten.
        setToastMsg('⚠️ Some of your data didn\'t load — refresh before adding or editing to avoid losing anything.');
      }
    } else {
      setToastMsg('⚠️ Couldn\'t load your data right now — please refresh. Avoid adding anything until it loads.');
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

    // Resolve the user's start-latency experiment arm: read the pinned
    // assignment, or seed one deterministically on first load. Best-effort —
    // a failure just leaves the arm at control behavior (no mechanism fires).
    ensureExperimentArm(authUser.id);

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

    // ── Onboarding configuration gate ──
    // Prompt any account that has not completed onboarding yet, even if it
    // already has tasks/events/blocks from migration or manual setup. The
    // profile flag is the durable source of truth so accounts that are still
    // unconfigured get the weekly skeleton flow instead of being disqualified
    // just because they have existing data.
    try {
      const onboardingEstablished = isOnboardingEstablished(authUser.id);
      const onboardingConfigured = !!(data && data.onboardingCompleted) || onboardingEstablished;
      if (data && !onboardingConfigured) {
        const fn = authUser?.user_metadata?.full_name?.split(' ')[0]
          || authUser?.email?.split('@')[0] || '';
        setOnboardingName(fn);
        setShowOnboarding(true);
      }
    } catch (_) { /* gate is best-effort; never block load */ }
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
    if (['home', 'settings'].includes(target)) setActivePanel(target);
    else if (target === 'chat' || target === 'tasks' || target === 'calendar') { setActivePanel('dashboard'); setChatOpen(true); }
  }, [searchParams]);

  // Guests have no DB, so their work lives only in React state — which an OAuth
  // redirect or a reload wipes before they ever sign up. Persist it to the same
  // cc_* localStorage keys migrateLocalStorage() already imports on first login,
  // so guest work survives the round-trip and gets migrated into the new account.
  const guestHydratedRef = useRef(false);
  function hydrateGuestData() {
    try {
      const t = JSON.parse(localStorage.getItem('cc_tasks') || '[]');
      const e = JSON.parse(localStorage.getItem('cc_events') || '[]');
      const n = JSON.parse(localStorage.getItem('cc_notes') || '[]');
      const b = JSON.parse(localStorage.getItem('cc_blocks') || '{"recurring":[],"dates":{}}');
      if (Array.isArray(t) && t.length) setTasks(t);
      if (Array.isArray(e) && e.length) setEvents(e);
      if (Array.isArray(n) && n.length) setNotes(n);
      if (b && (b.recurring?.length || Object.keys(b.dates || {}).length)) setBlocks(b);
    } catch (_) { /* corrupt cache — ignore */ }
    guestHydratedRef.current = true;
  }

  // ── Check for existing session on mount ──
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) handleAuth(session.user);
      else hydrateGuestData(); // no session — restore any in-progress guest work
      setAuthChecked(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist guest work to localStorage as it changes (only once hydrated, and
  // never while authed — authed writes go straight to Supabase via syncOp).
  useEffect(() => {
    if (user || !authChecked || !guestHydratedRef.current) return;
    try {
      localStorage.setItem('cc_tasks', JSON.stringify(tasks));
      localStorage.setItem('cc_events', JSON.stringify(events));
      localStorage.setItem('cc_notes', JSON.stringify(notes));
      localStorage.setItem('cc_blocks', JSON.stringify(blocks));
    } catch (_) { /* quota / disabled storage — best effort */ }
  }, [user, authChecked, tasks, events, notes, blocks]);

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
          const t = dbTaskToApp(payload.new);
          if (payload.eventType === 'UPDATE') {
            const lmsName = t.lmsAssignmentRef?.lms === 'canvas' ? 'Canvas'
              : t.lmsAssignmentRef?.lms === 'schoology' ? 'Schoology'
              : t.lmsAssignmentRef?.lms === 'custom' ? (t.lmsAssignmentRef.custom_host || 'your LMS')
              : 'Google Classroom';
            // Single-signal path: ask the student before closing.
            if (t.lmsPendingClose && !payload.old?.lms_pending_close) {
              setLmsPendingConfirm({ taskId: t.id, taskTitle: t.title, lmsName });
            }
            // Corroborated auto-close or student confirmed: celebrate with a toast.
            if (
              t.completionSource === 'lms'
              && t.status === 'done'
              && (payload.old?.status !== 'done' || payload.old?.completion_source !== 'lms')
              && !t.lmsPendingClose
            ) {
              setLmsPendingConfirm(null);
              setToastMsg(`✓ "${t.title}" marked done from ${lmsName}`);
            }
            // Student rejected pending close — clear confirmation card if still showing.
            if (!t.lmsPendingClose && payload.old?.lms_pending_close && t.status !== 'done') {
              setLmsPendingConfirm(null);
            }
          }
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
          // Saved chats live in the `notes` table too (type: 'saved_chat') but
          // must never leak into the regular Notes panel — mirrors the split
          // already done at initial load (loadAllFromSupabase).
          if (n.type === 'saved_chat' || (n.name && n.name.startsWith('[chat-save]'))) {
            try {
              const parsed = JSON.parse(n.content);
              const chatEntry = { id: n.id, title: parsed.title || 'Untitled Chat', messages: parsed.messages || [], savedAt: parsed.savedAt || n.updatedAt, messageCount: parsed.messageCount || 0 };
              setSavedChats(prev => { const idx = prev.findIndex(c => c.id === chatEntry.id); return idx >= 0 ? prev.map((c, i) => i === idx ? chatEntry : c) : [chatEntry, ...prev]; });
            } catch (_) { /* malformed saved-chat payload — drop it, don't leak into notes */ }
            return;
          }
          setNotes(prev => { const idx = prev.findIndex(x => x.id === n.id); return idx >= 0 ? prev.map((x, i) => i === idx ? n : x) : [...prev, n]; });
        } else if (payload.eventType === 'DELETE') {
          setNotes(prev => prev.filter(x => x.id !== payload.old.id));
          setSavedChats(prev => prev.filter(c => c.id !== payload.old.id));
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

  // ── Notification scheduling: re-run whenever tasks, events, or prefs change ──
  // While a focus session is running the home goes quiet — no scheduled
  // notifications. The suppression is scoped to the session: it never touches
  // notifPrefs, it just posts an empty schedule to the SW (clearing pending
  // timers), and the moment the session ends this effect re-runs and the normal
  // schedule is restored. Nothing persistent is mutated.
  const focusSuppressing = !!focusRun && focusRun.status !== 'ended';
  useEffect(() => {
    if (!dataLoaded) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (focusSuppressing) { scheduleNotificationsToSW([]); return; }
    const notifications = buildNotifications(tasks, events, notifPrefs);
    scheduleNotificationsToSW(notifications);
  }, [tasks, events, notifPrefs, dataLoaded, focusSuppressing]);

  function updateNotifPref(key, val) {
    const next = { ...notifPrefs, [key]: val };
    setNotifPrefs(next);
    try { localStorage.setItem('sos-notif-prefs', JSON.stringify(next)); } catch(_) {}
  }

  // After a failed write, converge the client back to DB truth so optimistic
  // state can't keep showing changes that never persisted. Read-only (no writes,
  // so it can't loop), single-flight, debounced, and skipped while offline (the
  // soft message already covers that case and a reload would just fail too).
  function reconcileAfterSyncFailure() {
    if (!user) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (reconcileAfterSyncFailure._timer) clearTimeout(reconcileAfterSyncFailure._timer);
    reconcileAfterSyncFailure._timer = setTimeout(async () => {
      if (reconcileAfterSyncFailure._running) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      reconcileAfterSyncFailure._running = true;
      try {
        const data = await loadAllFromSupabase(user.id);
        if (data && !data.loadIncomplete) {
          setTasks(data.tasks);
          setEvents(data.events);
          setBlocks(data.blocks);
          const isSavedChatNote = n => n.type === 'saved_chat' || (n.name && n.name.startsWith('[chat-save]'));
          setNotes((data.notes || []).filter(n => !isSavedChatNote(n)));
          const reconciledChats = (data.notes || []).filter(isSavedChatNote).map(n => {
            try {
              const parsed = JSON.parse(n.content);
              return { id: n.id, title: parsed.title || 'Untitled Chat', messages: parsed.messages || [], savedAt: parsed.savedAt || n.updatedAt, messageCount: parsed.messageCount || 0 };
            } catch (_) { return null; }
          }).filter(Boolean);
          setSavedChats(reconciledChats);
          setSyncStatus('saved');
        }
      } catch (_) { /* still offline / failing — leave the soft message in place */ }
      finally { reconcileAfterSyncFailure._running = false; }
    }, 4000);
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
      // Surface a single soft error in the chat so the student knows persistence
      // failed, then reconcile to DB truth so we don't keep showing unsaved data.
      // Debouncing prevents a flood of toasts.
      reconcileAfterSyncFailure();
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

  // Make an undo durable: reconcile the DB back to `snap` so the restore
  // survives a reload / realtime echo (previously undo only touched React state,
  // so any undo silently reverted on the next sync). Diff-based and scoped: we
  // upsert every snapshot row (restores deletes + edits) and delete only the IDs
  // that exist now but weren't in the snapshot (removes creates). Blocks are
  // only touched when they actually changed.
  async function persistSnapshotToDb(snap, cur) {
    if (!user) return; // guests have no DB rows to reconcile
    const ops = [];
    const diffTable = (table, snapRows, curRows, toDb) => {
      const snapIds = new Set((snapRows || []).map(r => r.id));
      const created = (curRows || []).map(r => r.id).filter(id => !snapIds.has(id));
      if (created.length) ops.push(sb.from(table).delete().eq('user_id', user.id).in('id', created));
      if ((snapRows || []).length) ops.push(sb.from(table).upsert((snapRows).map(toDb), { onConflict: 'id' }));
    };
    diffTable('tasks', snap.tasks, cur.tasks, t => appTaskToDb(t, user.id));
    diffTable('events', snap.events, cur.events, e => appEventToDb(e, user.id));
    diffTable('notes', snap.notes, cur.notes, n => appNoteToDb(n, user.id));
    if (snap.grades) diffTable('grades', snap.grades, cur.grades, g => ({ ...g, user_id: user.id }));
    if (snap.flashcardDecks) diffTable('flashcard_decks', snap.flashcardDecks, cur.flashcardDecks, d => ({ ...d, user_id: user.id }));

    // Blocks: only reconcile when they actually differ (most undos don't touch them).
    if (JSON.stringify(snap.blocks) !== JSON.stringify(cur.blocks)) {
      const snapRec = snap.blocks?.recurring || [];
      const curRec = cur.blocks?.recurring || [];
      const snapRecIds = new Set(snapRec.map(r => r.id));
      const recDeletes = curRec.map(r => r.id).filter(id => !snapRecIds.has(id));
      if (recDeletes.length) ops.push(sb.from('recurring_blocks').delete().eq('user_id', user.id).in('id', recDeletes));
      if (snapRec.length) ops.push(sb.from('recurring_blocks').upsert(
        snapRec.map(rb => ({ id: rb.id, user_id: user.id, name: rb.name, category: rb.category || 'school', start_time: rb.start || '00:00', end_time: rb.end || '01:00', days: rb.days || [] })),
        { onConflict: 'id' }
      ));
      // Date overrides: upsert every snapshot slot; null out slots that exist now but not in the snapshot.
      const snapDates = snap.blocks?.dates || {};
      const curDates = cur.blocks?.dates || {};
      Object.entries(snapDates).forEach(([date, slots]) => {
        Object.entries(slots || {}).forEach(([slot, data]) => {
          ops.push(dbUpsertDateBlock(date, slot, data, user.id));
        });
      });
      Object.entries(curDates).forEach(([date, slots]) => {
        Object.entries(slots || {}).forEach(([slot]) => {
          if (!(snapDates[date] && slot in snapDates[date])) ops.push(dbUpsertDateBlock(date, slot, null, user.id));
        });
      });
    }
    await Promise.all(ops);
  }

  function doUndo() {
    if (!undoToast) return;
    const { snap } = undoToast;
    // Capture current state BEFORE the setters so the DB reconcile can diff
    // against what's actually live right now.
    const cur = { tasks, events, notes, blocks, grades, flashcardDecks };
    setTasks(snap.tasks);
    setEvents(snap.events);
    setNotes(snap.notes);
    setBlocks(snap.blocks);
    if (snap.flashcardDecks) setFlashcardDecks(snap.flashcardDecks);
    if (snap.grades) setGrades(snap.grades);
    setUndoToast(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (user) syncOp(() => persistSnapshotToDb(snap, cur), 'the undo');
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

  // ── Focus session (Start primitive) ──
  // A single non-committal 10-minute "just looking at it" session, surfaced
  // in the DynamicIsland ambient tier. Distinct from set_timer so its expiry
  // can offer continue/stop instead of a generic chime.
  const [focusSession, setFocusSession] = useState(null); // { taskId, title, startedAt, endsAt, status }
  const focusTimeoutRef = useRef(null);

  // ── Focus Sessions (Sprint & Marathon) ──
  // A head-down session the student starts with one tap. Sprint is bound by the
  // clock; Marathon is bound by a goal and loops sprints with breaks in the
  // seams. Both share one engine (shared/scheduling/focus.ts). The run lives in
  // memory only — ephemeral, reverts on reload, persists nothing but the task
  // completions it drives. focusRun === null means no session.
  const [focusLauncherOpen, setFocusLauncherOpen] = useState(false);
  const [focusRun, setFocusRun] = useState(null);
  // Soft-exit clock (sprint) and break auto-ignite (marathon) timers.
  const sprintClockRef = useRef(null);
  const breakTimeoutRef = useRef(null);

  // ── Commitment-lock countdown (start-latency experiment arm) ──
  // Set when a commitment_lock user pledges a start time. Shown as a live
  // "starts in X min" banner on the home screen until the time passes or they
  // actually start the task. Cleared on task start or manual dismiss.
  const [pledgeCountdown, setPledgeCountdown] = useState(null); // { taskId, title, pledgedAt }
  // Tick the countdown label each second; clear when past.
  const pledgeCountdownRef = useRef(null);
  useEffect(() => {
    if (!pledgeCountdown) return;
    const tick = () => {
      const ms = new Date(pledgeCountdown.pledgedAt).getTime() - Date.now();
      if (ms < -60_000) setPledgeCountdown(null); // auto-clear >1 min past
    };
    tick();
    pledgeCountdownRef.current = setInterval(tick, 1000);
    return () => clearInterval(pledgeCountdownRef.current);
  }, [pledgeCountdown]);

  // ── Home Decision Gate ──
  // Shown once on the first open of the day: at most two tasks, each with
  // start/swap/defer plus a footer escape, never forced work. The ranked
  // candidate list is frozen at open time (ids), so the surfaced pair stays
  // stable within a glance — swap/defer advance a cursor, nothing reshuffles.
  const [gateOpen, setGateOpen] = useState(false);
  const [gateRanked, setGateRanked] = useState([]);    // frozen ranked task ids
  const [gateSurfaced, setGateSurfaced] = useState([]); // indices into gateRanked currently shown
  const [gateCursor, setGateCursor] = useState(0);      // next unshown candidate index
  const gateCheckedRef = useRef(false);

  // ── End-of-Day Decision Rollup ──
  // Sub-threshold AI items accumulate silently here instead of a standing
  // review rail; auto-applied (>=0.85) items are mirrored so they surface as
  // "already done · undo". Shown once daily (evening) as one batched pass.
  const [rollupItems, setRollupItems] = useState([]); // [{ action, reason, confidence }]
  const [rollupAuto, setRollupAuto] = useState([]);   // [{ action, summary, snap }]
  const [rollupOpen, setRollupOpen] = useState(false);
  const rollupShownRef = useRef(null);

  // ── Open the Home Decision Gate on the first open of the day ──
  // Once per calendar day, after data is loaded and not mid-onboarding. The
  // gate reads live tasks so a momentary pre-load render never shows a stale
  // "clear board". Skips if already shown today. Yields entirely during a
  // committed block (school / sleep / lockdown / testing) — going dark for this
  // load rather than threading the needle; a later open (after the block) can
  // still surface it, since last-shown is only stamped once it actually opens.
  useEffect(() => {
    if (gateCheckedRef.current) return;
    if (!dataLoaded || !user || showOnboarding) return;
    gateCheckedRef.current = true;
    let last = null;
    try { last = localStorage.getItem('sos_gate_last_shown'); } catch (_) {}
    if (last === today()) return;
    // Go dark inside committed time — no gate, no nag.
    if (currentCommitment(buildBlocksForDate(blocks, today()), new Date())) return;
    const ranked = gateRankedTasks();
    setGateRanked(ranked.map(t => t.id));
    const initial = ranked.slice(0, GATE_TASK_QUOTA).map((_, i) => i);
    setGateSurfaced(initial);
    setGateCursor(initial.length);
    setGateOpen(true);
    try { localStorage.setItem('sos_gate_last_shown', today()); } catch (_) {}
  }, [dataLoaded, user, showOnboarding]);

  // ── Surface the End-of-Day Decision Rollup once daily (evening) ──
  // Fires only when there is something to review and never mid-day, so the
  // day stays quiet. Skipped items simply carry over to the next evening.
  useEffect(() => {
    if (!dataLoaded || !user) return;
    if (rollupOpen || gateOpen || showOnboarding) return;
    const t = today();
    if (rollupShownRef.current === t) return;
    if ((rollupItems.length + rollupAuto.length) === 0) return;
    let last = null;
    try { last = localStorage.getItem('sos_rollup_last_shown'); } catch (_) {}
    if (last === t) { rollupShownRef.current = t; return; }
    if (new Date().getHours() >= 18) {
      setRollupOpen(true);
      rollupShownRef.current = t;
      try { localStorage.setItem('sos_rollup_last_shown', t); } catch (_) {}
    }
  }, [dataLoaded, user, gateOpen, showOnboarding, rollupOpen, rollupItems, rollupAuto]);

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
      if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
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

  // ── Start-latency experiment (adaptive) ──
  // Pin the user to one intervention arm and keep it stable across sessions.
  // Existing assignments are honored as-is (stability). New users are routed by
  // the adaptive allocator: it reads aggregate per-arm performance and shifts
  // traffic toward whatever's cutting the pledge→start gap, while keeping an
  // exploration floor so the experiment keeps learning. Falls back to uniform
  // assignment whenever the signal isn't available yet.
  async function resolveAdaptiveArm(userId) {
    const activeArms = getActiveArms();
    try {
      // Graduation short-circuit: once a winner is declared, route new users to
      // it directly (existing users keep their arm).
      const { data: exp } = await sb.from('experiments')
        .select('started_at,status,graduated_arm')
        .eq('key', START_LATENCY_EXPERIMENT_KEY)
        .maybeSingle();
      if (exp?.status === 'graduated' && isValidArm(exp.graduated_arm)) {
        return exp.graduated_arm;
      }
      const daysSinceStart = exp?.started_at
        ? (Date.now() - new Date(exp.started_at).getTime()) / 86_400_000
        : 0;
      // Aggregate-only RPC (SECURITY DEFINER) — safe to call from the client.
      const { data: stats } = await sb.rpc('experiment_arm_performance', {
        p_experiment_key: START_LATENCY_EXPERIMENT_KEY,
        p_window_days: 14,
      });
      const normalized = (stats || [])
        .filter(s => isValidArm(s.arm))
        .map(s => ({
          arm: s.arm,
          pledges: Number(s.pledges) || 0,
          starts: Number(s.starts) || 0,
          medianLatencyMin: s.median_latency_min == null ? null : Number(s.median_latency_min),
        }));
      const { arm } = adaptiveAssign(userId, normalized, { daysSinceStart }, activeArms);
      return isValidArm(arm) ? arm : assignArm(userId, activeArms);
    } catch (e) {
      console.warn('[experiment] adaptive resolve failed, using uniform:', e);
      return assignArm(userId, activeArms);
    }
  }

  async function ensureExperimentArm(userId) {
    if (!userId) return;
    try {
      const { data } = await sb.from('experiment_assignments')
        .select('arm')
        .eq('user_id', userId)
        .eq('experiment_key', START_LATENCY_EXPERIMENT_KEY)
        .maybeSingle();
      if (data && isValidArm(data.arm)) { setExperimentArm(data.arm); return; }
      // No assignment yet — let the adaptive allocator pick, then persist. On a
      // unique-constraint race the local value still applies the right mechanism.
      const arm = await resolveAdaptiveArm(userId);
      await sb.from('experiment_assignments').insert({
        user_id: userId,
        experiment_key: START_LATENCY_EXPERIMENT_KEY,
        arm,
      });
      setExperimentArm(arm);
    } catch (e) {
      console.warn('[experiment] arm resolve failed, using uniform seed:', e);
      setExperimentArm(assignArm(userId, getActiveArms()));
    }
  }

  // ── Start primitive ──
  // One invocable launcher (gate today, other surfaces later). Non-committal:
  // gather any linked materials, surface them, run a 10-minute ambient timer,
  // log a start event. Degrades silently — no materials still starts the clock,
  // no estimate still flips the task to in_progress. Source mirrors
  // completion_source (manual | gate | ai).
  const FOCUS_SESSION_MS = 10 * 60 * 1000;
  function armFocusExpiry(taskId, title) {
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    focusTimeoutRef.current = setTimeout(() => {
      setFocusSession(prev => (prev && prev.taskId === taskId) ? { ...prev, status: 'expired' } : prev);
      // Silent ambient offer — keep going or stop. No interrupt, no praise.
      setSosNotif({ label: '10 min up', body: `${title} — keep going or stop.`, accent: 'var(--text-dim)', duration: 9000 });
    }, FOCUS_SESSION_MS);
  }
  async function startTask(task, source = 'manual', opts = {}) {
    if (!task) return;
    // `ambient` arms the non-committal 10-minute "just looking at it" clock and
    // its sosNotif. A focus session (Sprint/Marathon) drives ignition itself and
    // owns its own clock, so it fires the Start primitive with ambient:false —
    // materials still open, status still flips, the start event still logs.
    const ambient = opts.ambient !== false;
    const startedAt = Date.now();
    const endsAt = startedAt + FOCUS_SESSION_MS;
    // Clear commitment-lock countdown for this task once they actually start.
    setPledgeCountdown(prev => (prev && prev.taskId === task.id) ? null : prev);

    // Flip to in_progress + stamp provenance. Undoable via the next mutation's
    // snapshot is not applicable here (no destructive change), but the status
    // flip is trivially reversible by completing/leaving the task.
    updateTask(task.id, {
      status: task.status === 'done' ? task.status : 'in_progress',
      startSource: source,
      startedAt: new Date(startedAt).toISOString(),
    });

    // Behavioral telemetry — feeds plans-created vs started-within-24h, and the
    // start-latency experiment: if the student had pledged a start time, log the
    // gap (intention → action) and their arm so start_latency_by_arm() can rank
    // which mechanism cut the delay most.
    const startLatencyMs = computeStartLatencyMs(task.pledgedStartAt, new Date(startedAt).toISOString());
    if (user) dbInsertTaskEvent({
      taskId: task.id, eventType: 'start', fromStatus: task.status, toStatus: 'in_progress',
      metadata: {
        title: task.title, subject: task.subject, source,
        study_plan_id: task.study_plan_id || null,
        ...(task.pledgedStartAt ? { pledged_start_at: task.pledgedStartAt } : {}),
        ...(startLatencyMs != null ? { start_latency_ms: startLatencyMs } : {}),
        ...(experimentArm ? { experiment_arm: experimentArm } : {}),
      },
    }, user.id);

    // Gather linked materials (best-effort, bounded). No links → skip silently.
    let materials = [];
    if (user) {
      try {
        const { data } = await sb.from('entity_links')
          .select('source_type,source_id,target_type,target_id')
          .eq('user_id', user.id)
          .or(`and(source_type.eq.task,source_id.eq.${task.id}),and(target_type.eq.task,target_id.eq.${task.id})`);
        const keys = new Set();
        (data || []).forEach(l => {
          if (l.source_type === 'task' && l.source_id === task.id) keys.add(l.target_type + ':' + l.target_id);
          else if (l.target_type === 'task' && l.target_id === task.id) keys.add(l.source_type + ':' + l.source_id);
        });
        materials = [...keys].map(k => {
          const [kind, id] = k.split(':');
          if (kind === 'note') { const n = notes.find(x => x.id === id); return n ? { kind, id, title: n.title || 'note' } : null; }
          if (kind === 'event') { const e = events.find(x => x.id === id); return e ? { kind, id, title: e.title || 'event' } : null; }
          return null;
        }).filter(Boolean);
      } catch (_) { /* materials are a bonus, never a blocker */ }
    }

    // Surface materials in chat (terse, clickable later); degrade to nothing.
    if (materials.length) {
      const list = materials.map(m => `• ${m.title}`).join('\n');
      postAssistantNote(`Pulled up for "${task.title}":\n${list}`);
    }
    if (ambient) {
      const matLine = materials.length ? ` ${materials.length} linked.` : '';
      setSosNotif({ label: 'Just looking at it', body: `${task.title} · 10 min.${matLine}`, accent: 'var(--accent)', duration: 4000 });

      // Ambient countdown in the DynamicIsland focus tier.
      setFocusSession({ taskId: task.id, title: task.title, startedAt, endsAt, status: 'running' });
      armFocusExpiry(task.id, task.title);
    }
  }
  function continueFocusSession() {
    const fs = focusSession;
    if (!fs) return;
    const startedAt = Date.now();
    setFocusSession({ ...fs, startedAt, endsAt: startedAt + FOCUS_SESSION_MS, status: 'running' });
    armFocusExpiry(fs.taskId, fs.title);
  }
  function stopFocusSession() {
    if (focusTimeoutRef.current) { clearTimeout(focusTimeoutRef.current); focusTimeoutRef.current = null; }
    setFocusSession(null);
  }

  // ── Home Decision Gate helpers ──
  // "On the board" = active + due within the 30-day priority horizon (the
  // convention used elsewhere). Empty → genuinely clear board.
  function gateRankedTasks() {
    const horizon = new Date(); horizon.setDate(horizon.getDate() + 30);
    const horizonStr = toDateStr(horizon);
    const active = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate <= horizonStr);
    if (active.length === 0) return [];
    const density = buildCalendarDensity(active, blocks.dates || {});
    const ranked = rankTasks(active, new Date(), density, undefined);
    const byId = Object.fromEntries(active.map(t => [t.id, t]));
    return ranked.map(r => byId[r.taskId]).filter(Boolean);
  }
  // The up-to-two task objects currently surfaced, resolved live from the frozen
  // ranked id list. Filtered against current tasks so a task completed elsewhere
  // can't linger on the gate.
  function gateSurfacedTasks() {
    return gateSurfaced
      .map(i => tasks.find(t => t.id === gateRanked[i]))
      .filter(t => t && t.status !== 'done');
  }
  // True allocator chips for the surfaced pair — same density the priority
  // engine sees. No client behavioral signals are loaded, so probabilityPct
  // stays null (we never fabricate a percentage).
  function gateChips(surfaced) {
    const active = tasks.filter(t => t.status !== 'done' && t.dueDate);
    const density = buildCalendarDensity(active, blocks.dates || {});
    const now = new Date();
    return surfaced.map(t => computeTrajectoryChip(t, now, density, undefined));
  }
  // Replace the task in one slot with the next unshown candidate, keeping the
  // other slot put. Returns true if a replacement was available.
  function gateAdvanceSlot(slotIndex) {
    let advanced = false;
    setGateSurfaced(prev => {
      if (gateCursor >= gateRanked.length) return prev;
      const next = [...prev];
      next[slotIndex] = gateCursor;
      advanced = true;
      return next;
    });
    if (gateCursor < gateRanked.length) setGateCursor(c => c + 1);
    return advanced;
  }
  // Drop a slot entirely (no candidate left to fill it). Closes the gate once
  // nothing is left to show — a defer never traps the student on an empty gate.
  function gateDropSlot(slotIndex, slotPos) {
    setGateSurfaced(prev => {
      const next = prev.filter((_, p) => p !== slotPos);
      if (next.length === 0) setGateOpen(false);
      return next;
    });
  }
  function handleGateStart(task) {
    setGateOpen(false);
    startTask(task, 'gate');
  }
  function handleGateSwap(task, slotPos) {
    // A soft skip — looked, wanted something else. Logged as a light postpone.
    if (user && task) dbInsertTaskEvent({
      taskId: task.id, eventType: 'postpone', fromStatus: task.status, toStatus: task.status,
      metadata: { title: task.title, subject: task.subject, source: 'gate', gate_action: 'swap' },
    }, user.id);
    gateAdvanceSlot(gateSurfaced[slotPos]);
  }
  function handleGateDefer(task, slotPos) {
    // Defer-for-now → a postpone signal. Refill the slot from the next
    // candidate if one exists, else collapse it.
    if (user && task) dbInsertTaskEvent({
      taskId: task.id, eventType: 'postpone', fromStatus: task.status, toStatus: task.status,
      metadata: { title: task.title, subject: task.subject, source: 'gate', gate_action: 'defer' },
    }, user.id);
    if (gateCursor < gateRanked.length) gateAdvanceSlot(gateSurfaced[slotPos]);
    else gateDropSlot(gateSurfaced[slotPos], slotPos);
  }
  function handleGateEscape() {
    // The student already did meaningful work of their own choosing. Credit it
    // as a self-directed signal and pass — never force-complete a surfaced task.
    setGateOpen(false);
    if (user) trackEvent(user.id, 'gate_self_directed', { source: 'gate' });
    postAssistantNote('Counted that.');
  }
  function handleGateDismiss() {
    setGateOpen(false);
  }
  function handleGateAddEvent() {
    setInput('Add event: ');
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  // ── Start Widget data ──
  // Up to four startable tasks for the always-summonable widget. Uses the same
  // quick-start ranking as the "just start me" chat path (priority + startability)
  // so the easiest worthwhile on-ramps lead. Trajectory chips come from the same
  // pure allocator the gate uses; no client signals loaded, so no fabricated %.
  function startWidgetData() {
    const horizon = new Date(); horizon.setDate(horizon.getDate() + 30);
    const horizonStr = toDateStr(horizon);
    const pool = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate <= horizonStr);
    if (pool.length === 0) return { tasks: [], chips: [] };
    const density = buildCalendarDensity(pool, blocks.dates || {});
    const now = new Date();
    const ranked = rankForQuickStart(pool, now, density, undefined, 4);
    const byId = Object.fromEntries(pool.map(t => [t.id, t]));
    const picked = ranked.map(r => byId[r.taskId]).filter(Boolean);
    return {
      tasks: picked,
      chips: picked.map(t => computeTrajectoryChip(t, now, density, undefined)),
    };
  }
  function handleStartWidgetStart(task) {
    startTask(task, 'widget');
  }

  // ── Deadlines panel: "ongoing" tab ranking ──
  function deadlinesOngoingData() {
    const horizonStr = addDaysISO(today(), 30);
    const pool = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate <= horizonStr);
    if (pool.length === 0) return [];
    const density = buildCalendarDensity(pool, blocks.dates || {});
    const ranked = rankTasks(pool, new Date(), density, undefined, 20);
    const byId = Object.fromEntries(pool.map(t => [t.id, t]));
    return ranked.map(r => ({ ...r, title: byId[r.taskId]?.title || '(untitled)' })).filter(r => byId[r.taskId]);
  }

  function handleBreakTaskFromDeadlines(task) {
    setShowDeadlines(false);
    setChatOpen(true);
    sendMessage(`Break down "${task.title}" (due ${task.dueDate}) into a day-by-day plan.`);
  }

  // ── Focus Sessions (Sprint & Marathon) ──
  // Refs mirror the live run + task list so timer callbacks (sprint soft-exit,
  // break auto-ignite) read current state, not their stale capture.
  const focusRunRef = useRef(null);
  const focusTasksRef = useRef(tasks);
  useEffect(() => { focusRunRef.current = focusRun; }, [focusRun]);
  useEffect(() => { focusTasksRef.current = tasks; }, [tasks]);
  // Clear focus timers on unmount.
  useEffect(() => () => {
    if (sprintClockRef.current) clearTimeout(sprintClockRef.current);
    if (breakTimeoutRef.current) clearTimeout(breakTimeoutRef.current);
  }, []);

  // The candidate pool for a session: active tasks inside the 30-day priority
  // horizon (the convention the gate/widget use), in priority order.
  function focusPool() {
    const horizon = new Date(); horizon.setDate(horizon.getDate() + 30);
    const horizonStr = toDateStr(horizon);
    const pool = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate <= horizonStr);
    if (pool.length === 0) return [];
    const density = buildCalendarDensity(pool, blocks.dates || {});
    const order = buildSessionQueue(pool, new Date(), density, undefined);
    const byId = Object.fromEntries(pool.map(t => [t.id, t]));
    return order.map(id => byId[id]).filter(Boolean);
  }

  // Active + on-deck task objects for a run. tasks-status acts as a backstop so
  // a task completed elsewhere can't linger as active.
  function resolveFocusTasks(run) {
    if (!run) return { activeTask: null, onDeckTask: null };
    const list = focusTasksRef.current;
    const byId = id => { const t = list.find(x => x.id === id); return t && t.status !== 'done' ? t : null; };
    const { activeId, onDeckId } = activeAndOnDeck(run.queue, run.completedIds, run.skippedIds);
    return { activeTask: byId(activeId), onDeckTask: byId(onDeckId) };
  }

  // Fire the Start primitive on the run's current active task — ignition without
  // the ambient 10-min clock, since the session owns its own timing. No gap: the
  // status flip is synchronous.
  function igniteFocusRun(run) {
    const { activeTask } = resolveFocusTasks(run);
    if (activeTask) startTask(activeTask, run.mode, { ambient: false });
    return activeTask;
  }

  // Best-effort fade hour from the student's own completion history. Cold start
  // (no history) → stays null and the floor + in-session signals run alone.
  async function loadFocusFadeHour(userId) {
    try {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data } = await sb.from('task_events')
        .select('occurred_at')
        .eq('user_id', userId)
        .eq('event_type', 'complete')
        .gte('occurred_at', since);
      const hist = Array(24).fill(0);
      (data || []).forEach(r => { const h = new Date(r.occurred_at).getHours(); if (h >= 0 && h < 24) hist[h] += 1; });
      const fade = computeFadeHour(hist);
      if (fade != null) setFocusRun(prev => prev ? { ...prev, fadeHour: fade } : prev);
    } catch (_) { /* fade hour is a bonus, never a blocker */ }
  }

  function openFocusLauncher() { setFocusLauncherOpen(true); }

  function launchFocusSession({ mode, durationMs, goal }) {
    let order = focusPool().map(t => t.id);
    // Selection Marathon: keep priority order but restrict to the tapped tasks —
    // those alone define "done". Sprint and count-Marathon never hand-pick.
    if (mode === 'marathon' && goal && goal.kind === 'selection') {
      const sel = new Set(goal.taskIds);
      order = order.filter(id => sel.has(id));
    }
    if (order.length === 0) { setFocusLauncherOpen(false); return; }

    const startedAt = Date.now();
    const run = {
      mode,
      status: 'running',
      queue: order,
      completedIds: [],
      skippedIds: [],
      startedAt,
      durationMs: mode === 'sprint' ? durationMs : null,
      clockExpired: false,
      goal: mode === 'marathon' ? goal : null,
      sprintsCompleted: 0,
      completionTimes: [],
      frictionCount: 0,
      fadeHour: null,
      breakOffer: null,
      breakEndsAt: null,
      lastDecisionAt: null,
      summary: '',
    };
    focusRunRef.current = run;
    setFocusRun(run);
    setFocusLauncherOpen(false);
    igniteFocusRun(run);
    if (user) trackEvent(user.id, 'focus_session_start', { mode, ...(mode === 'sprint' ? { duration_ms: durationMs } : { goal: goal?.kind }) });

    // Sprint clock: arm the soft-exit. Expiry only flags — the bell never cuts a
    // task; the session closes at the first completion after this fires.
    if (mode === 'sprint') {
      if (sprintClockRef.current) clearTimeout(sprintClockRef.current);
      sprintClockRef.current = setTimeout(() => {
        setFocusRun(prev => (prev && prev.status !== 'ended') ? { ...prev, clockExpired: true } : prev);
      }, durationMs);
    }
    if (mode === 'marathon' && user) loadFocusFadeHour(user.id);
  }

  // The seam: complete the active task, then drive to the next with no gap.
  function focusComplete(task) {
    const run = focusRunRef.current;
    if (!run || run.status !== 'running' || run.breakOffer) return;
    const { activeTask } = resolveFocusTasks(run);
    if (!activeTask || (task && task.id !== activeTask.id)) return;
    const now = Date.now();

    // Mark done — emits the normal task_events so the priority engine stays fed.
    updateTask(activeTask.id, { status: 'done', completedAt: new Date(now).toISOString() });
    if (user) dbInsertTaskEvent({ taskId: activeTask.id, eventType: 'complete', fromStatus: activeTask.status, toStatus: 'done', metadata: { title: activeTask.title, subject: activeTask.subject, source: run.mode } }, user.id);

    const completedIds = [...run.completedIds, activeTask.id];
    const completionTimes = [...run.completionTimes, now];
    const next = { ...run, completedIds, completionTimes, sprintsCompleted: run.sprintsCompleted + 1 };

    if (run.mode === 'sprint') {
      // Soft exit: clock up → close at THIS completion; else next task, no gap.
      if (sprintShouldClose(run.startedAt, run.durationMs, now) ||
          remainingCount(next.queue, completedIds, next.skippedIds) === 0) {
        endFocusSession(next); return;
      }
      focusRunRef.current = next;
      setFocusRun(next);
      igniteFocusRun(next);
      return;
    }

    // Marathon: goal met or queue dry → stop offering sprints.
    if (isGoalMet(run.goal, next.queue, completedIds) ||
        remainingCount(next.queue, completedIds, next.skippedIds) === 0) {
      endFocusSession(next); return;
    }

    // Break decision lives only in the seam — signal-driven off the floor.
    const decision = decideBreak({
      sprintsCompleted: next.sprintsCompleted,
      sessionElapsedMs: now - run.startedAt,
      completionGapsMs: gapsFromTimestamps(completionTimes),
      frictionCount: run.frictionCount,
      currentHour: new Date(now).getHours(),
      fadeHour: run.fadeHour,
      msSinceLastDecision: run.lastDecisionAt != null ? now - run.lastDecisionAt : null,
    });
    if (decision.offer) {
      const offered = { ...next, breakOffer: { line: breakOfferLine(decision.reason), reason: decision.reason } };
      focusRunRef.current = offered;
      setFocusRun(offered);
      return;
    }
    // No break — next sprint ignites immediately.
    focusRunRef.current = next;
    setFocusRun(next);
    igniteFocusRun(next);
  }

  // Skip the active task — a soft postpone signal, never a reschedule. The task
  // keeps its normal behavioral signal and due date; the student blows past.
  function focusSkip(task) {
    const run = focusRunRef.current;
    if (!run || run.status !== 'running' || run.breakOffer) return;
    const { activeTask } = resolveFocusTasks(run);
    if (!activeTask || (task && task.id !== activeTask.id)) return;
    if (user) dbInsertTaskEvent({ taskId: activeTask.id, eventType: 'postpone', fromStatus: activeTask.status, toStatus: activeTask.status, metadata: { title: activeTask.title, subject: activeTask.subject, source: run.mode, action: 'skip' } }, user.id);
    const skippedIds = [...run.skippedIds, activeTask.id];
    const next = { ...run, skippedIds, frictionCount: run.frictionCount + 1 };
    if (remainingCount(next.queue, next.completedIds, skippedIds) === 0) { endFocusSession(next); return; }
    focusRunRef.current = next;
    setFocusRun(next);
    igniteFocusRun(next);
  }

  function focusTakeBreak() {
    const run = focusRunRef.current;
    if (!run || !run.breakOffer) return;
    const now = Date.now();
    // Reset in-session fatigue counters so the NEXT offer needs fresh fatigue.
    const next = { ...run, status: 'break', breakOffer: null, breakEndsAt: now + DEFAULT_BREAK_MS, lastDecisionAt: now, completionTimes: [now], frictionCount: 0 };
    focusRunRef.current = next;
    setFocusRun(next);
    if (breakTimeoutRef.current) clearTimeout(breakTimeoutRef.current);
    breakTimeoutRef.current = setTimeout(() => focusResumeNow(), DEFAULT_BREAK_MS);
  }

  function focusSkipBreak() {
    // Declining is the zero-friction default — the next sprint ignites at once.
    const run = focusRunRef.current;
    if (!run || !run.breakOffer) return;
    const now = Date.now();
    const next = { ...run, breakOffer: null, lastDecisionAt: now, completionTimes: [now], frictionCount: 0 };
    focusRunRef.current = next;
    setFocusRun(next);
    igniteFocusRun(next);
  }

  function focusResumeNow() {
    if (breakTimeoutRef.current) { clearTimeout(breakTimeoutRef.current); breakTimeoutRef.current = null; }
    const run = focusRunRef.current;
    if (!run || run.status !== 'break') return;
    const next = { ...run, status: 'running', breakEndsAt: null };
    focusRunRef.current = next;
    setFocusRun(next);
    igniteFocusRun(next);
  }

  // End with the single factual line. Manual "End session" routes here too, so
  // ending always yields the same dry summary — no score, no streak, no praise.
  function endFocusSession(run) {
    const r = run || focusRunRef.current;
    if (sprintClockRef.current) { clearTimeout(sprintClockRef.current); sprintClockRef.current = null; }
    if (breakTimeoutRef.current) { clearTimeout(breakTimeoutRef.current); breakTimeoutRef.current = null; }
    if (!r) { setFocusRun(null); return; }
    const elapsed = Date.now() - r.startedAt;
    const cleared = r.completedIds.length;
    const ended = { ...r, status: 'ended', breakOffer: null, breakEndsAt: null, summary: summaryLine(cleared, elapsed) };
    focusRunRef.current = ended;
    setFocusRun(ended);
    if (user) trackEvent(user.id, 'focus_session_end', { mode: r.mode, cleared, elapsed_ms: elapsed });
  }

  // Dismiss the ended summary — closes the surface, restores notifications.
  function closeFocusSession() {
    if (sprintClockRef.current) { clearTimeout(sprintClockRef.current); sprintClockRef.current = null; }
    if (breakTimeoutRef.current) { clearTimeout(breakTimeoutRef.current); breakTimeoutRef.current = null; }
    focusRunRef.current = null;
    setFocusRun(null);
  }

  // ── Time payout on completion ──
  // Information, not celebration. Computes when today goes clear from the
  // remaining scheduled obligations. Degrades: no estimate → no time line.
  function payoutLine(task) {
    const parseHM = (s) => {
      if (!s || typeof s !== 'string') return null;
      const m = s.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      const h = +m[1], mm = +m[2];
      if (h > 23 || mm > 59) return null;
      return h * 60 + mm;
    };
    const minToTime = (mins) => {
      const h = Math.floor(mins / 60) % 24, m = mins % 60;
      const hr = h % 12 === 0 ? 12 : h % 12;
      return `${hr}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    };
    // No estimate → omit the time line entirely (hard rule).
    if (!(typeof task.estTime === 'number' && task.estTime > 0)) return 'Done.';

    const t = today();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const ends = [];
    events.filter(e => e && e.date === t && e.status !== 'cancelled').forEach(e => {
      const m = parseHM(e.end_time || e.endTime || e.time);
      if (m != null) ends.push(m);
    });
    const dow = now.toLocaleDateString('en-US', { weekday: 'long' });
    (blocks.recurring || []).forEach(b => {
      if ((b.days || []).includes(dow)) { const m = parseHM(b.end); if (m != null) ends.push(m); }
    });
    const dateSlots = (blocks.dates && blocks.dates[t]) || {};
    Object.keys(dateSlots).forEach(slot => {
      if (dateSlots[slot]) { const m = parseHM(slot); if (m != null) ends.push(m + 30); }
    });

    const futureEnds = ends.filter(m => m > nowMin);
    const clearFrom = futureEnds.length ? Math.max(...futureEnds) : nowMin;
    // Only surface the clear-from time when there's still evening to recover.
    if (clearFrom >= 23 * 60) return 'Done.';
    return `Done. Evening clear from ${minToTime(clearFrom)}.`;
  }

  // ── 24-Hour Plan Rule helpers ──
  // Find the first concrete occurrence of any plan block (or, blockless, the
  // earliest milestone task) within the next week.
  function computeFirstPlanBlock(plan) {
    const blocksList = [...((plan && plan.recurring_blocks) || [])];
    if (plan && plan.review_cadence?.review_block) blocksList.push(plan.review_cadence.review_block);
    if (!blocksList.length) {
      const tasks0 = ((plan && plan.milestone_tasks) || []).filter(t => t.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
      if (!tasks0.length) return null;
      return { activity: tasks0[0].task_name || 'first task', date: tasks0[0].due_date, daysAway: daysUntil(tasks0[0].due_date), kind: 'task' };
    }
    const now = new Date();
    for (let i = 0; i <= 7; i++) {
      const d = new Date(now); d.setDate(now.getDate() + i);
      const ds = toDateStr(d);
      const wd = d.toLocaleDateString('en-US', { weekday: 'long' });
      for (const b of blocksList) {
        const days = b.days || [];
        if (!(days.includes(wd) || days.includes(wd.slice(0, 3)))) continue;
        if (b.start_date && ds < b.start_date) continue;
        if (b.end_date && ds > b.end_date) continue;
        return { activity: b.activity, date: ds, daysAway: i, kind: 'block' };
      }
    }
    return null;
  }
  function whenLabel(daysAway, date) {
    if (daysAway <= 0) return 'today';
    if (daysAway === 1) return 'tomorrow';
    return `in ${daysAway} days (${date})`;
  }

  // ── Decision Rollup handlers ──
  function actionSummary(action) {
    const name = action.task_name || action.title || action.name || action.event_name || '';
    const verb = (action.type || 'action').replace(/_/g, ' ');
    return name ? `${verb} — ${name}` : verb;
  }
  function applyRollup(acceptedActions) {
    setRollupOpen(false);
    setRollupItems([]); // every item was decided this pass
    if (!acceptedActions || !acceptedActions.length) return;
    // Whole batch is one undoable snapshot.
    const batchSnap = { tasks: tasks.slice(), events: events.slice(), notes: notes.slice(), blocks: JSON.parse(JSON.stringify(blocks)), flashcardDecks: flashcardDecks.slice(), grades: grades.slice() };
    acceptedActions.forEach(a => executeAction({ ...a, __confirmed: true, commitment: 'confirmed' }));
    pushUndoToast(`Undo: applied ${acceptedActions.length} batched item${acceptedActions.length !== 1 ? 's' : ''}`, batchSnap);
  }
  function dismissRollup() {
    // Skipped — items roll into the next day's batch. Never nag.
    setRollupOpen(false);
  }
  function undoRollupAuto(autoItem) {
    const snap = autoItem.snap;
    const cur = { tasks, events, notes, blocks, grades, flashcardDecks };
    setTasks(snap.tasks); setEvents(snap.events); setNotes(snap.notes); setBlocks(snap.blocks);
    if (snap.flashcardDecks) setFlashcardDecks(snap.flashcardDecks);
    if (snap.grades) setGrades(snap.grades);
    setRollupAuto(prev => prev.filter(x => x !== autoItem));
    if (user) syncOp(() => persistSnapshotToDb(snap, cur), 'the undo');
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
        // Sub-threshold: accumulate silently for the End-of-Day Rollup instead
        // of a standing review rail. Never surfaces mid-day.
        const reason = tentative && !lowConf ? 'tentative' : 'low_confidence';
        setRollupItems(prev => [...prev, { action, reason, confidence: conf }]);
        return;
      }
      if (autoConf) {
        // Auto-applied today — mirror into the rollup as "already done · undo".
        const autoSnap = { tasks: tasks.slice(), events: events.slice(), notes: notes.slice(), blocks: JSON.parse(JSON.stringify(blocks)), flashcardDecks: flashcardDecks.slice(), grades: grades.slice() };
        setRollupAuto(prev => [...prev, { action, summary: actionSummary(action), snap: autoSnap }]);
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
          if (user) dbInsertTaskEvent({ taskId: target.id, eventType: 'complete', fromStatus: target.status, toStatus: 'done', metadata: { title: target.title, subject: target.subject } }, user.id);
          if (user) trackEvent(user.id, 'action_confirmed', { type: 'complete_task' });
          recordExecution('complete_task', `"${target.title}"`);
          // Time payout — recovered time as information, not celebration.
          postAssistantNote(payoutLine(target));
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
          setNotes(prev => {
            const existing = prev.findIndex(n => !n.is_folder && n.name.toLowerCase() === tabName.toLowerCase());
            if (existing >= 0) {
              const updated = prev.map((n,i) => i===existing ? { ...n, content:n.content+(n.content?'\n':'')+content, updatedAt:new Date().toISOString(), parent_id: folderId || n.parent_id } : n);
              if (user) syncOp(() => dbUpsertNote(updated[existing], user.id));
              syncEmbed([{ source: 'note', source_id: updated[existing].id, text: tabName + '\n' + plainTextFromHtml(updated[existing].content), metadata: { note_type: 'note' } }]);
              return updated;
            }
            const newNote = { id:uid(), name:tabName, content, updatedAt:new Date().toISOString(), is_folder: false, parent_id: folderId };
            if (user) syncOp(() => dbUpsertNote(newNote, user.id));
            syncEmbed([{ source: 'note', source_id: newNote.id, text: tabName + '\n' + plainTextFromHtml(content), metadata: { note_type: 'note' } }]);
            return [...prev, newNote];
          });
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
            }
            return updated;
          });
          pushUndoToast('Undo: edited note', undoSnap);
          break;
        }
        case 'delete_note': {
          const noteId = action.note_id;
          setNotes(prev => prev.filter(n => n.id !== noteId));
          if (user) {
            syncOp(() => sb.from('notes').delete().eq('id', noteId).eq('user_id', user.id));
          }
          pushUndoToast('Undo: deleted note', undoSnap);
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
            id:uid(), title:st._title, subject:action.parent_title||'',
            dueDate: st.due || (typeof st.day_offset === 'number' ? addDaysISO(today(), st.day_offset) : today()),
            estTime:st.estimated_minutes||20, status:'not_started', focusMinutes:0, createdAt:new Date().toISOString()
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
          // Default to a two-week window so "this week" read-backs always reach
          // through the weekend instead of stopping mid-week.
          const endD = action.end_date || addDaysISO(startD, 13);
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
          const cutoffStr = addDaysISO(today(), horizonDays);
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
          const topTask = ranked.length ? taskById[ranked[0].taskId] : null;
          const focusLine = topTask
            ? `\n\n👉 Don't overthink it — just start **${topTask.title}** and give it 25 focused minutes. That's the whole job right now. Want me to start a timer?`
            : '';
          const msg = `here's what matters most right now:\n\n${lines.join('\n')}${focusLine}`;
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
            const cutoffStr = addDaysISO(today(), action.due_within_days);
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
        case 'pledge_start': {
          const target = resolveTask(action.title, tasks);
          if (!target) {
            postAssistantNote(`I couldn't find a task called "${action.title}" to pledge a start time for.`);
            break;
          }
          const pledgeAt = (action.start_at || '').trim();
          const parsed = pledgeAt ? new Date(pledgeAt) : null;
          if (!parsed || Number.isNaN(parsed.getTime())) {
            postAssistantNote(`I need a valid start time to lock that in.`);
            break;
          }
          const pledgedIso = parsed.toISOString();
          updateTask(target.id, { pledgedStartAt: pledgedIso });
          if (user) dbInsertTaskEvent({
            taskId: target.id, eventType: 'pledge', fromStatus: target.status, toStatus: target.status,
            metadata: { title: target.title, subject: target.subject, pledged_start_at: pledgedIso, experiment_arm: experimentArm || null },
          }, user.id);

          const mech = getMechanism(experimentArm || 'control');
          const when = parsed.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

          // ── Per-arm mechanisms ──
          if (!mech.active) {
            // Inactive arms (timed_nudge) fall back to a simple confirmation.
            postAssistantNote(`Locked in — you'll start **${target.title}** ${when}.`);
          } else if (mech.arm === 'commitment_lock') {
            // Show a visible home-screen countdown banner. No chat copy — the
            // visual commitment surface is the mechanism.
            setPledgeCountdown({ taskId: target.id, title: target.title, pledgedAt: pledgedIso });
            postAssistantNote(`Locked in — your countdown to **${target.title}** is up on the home screen.`);
          } else if (mech.arm === 'micro_deadline') {
            // Schedule a real timer at the pledged start time using the existing
            // timer infra so the chime fires exactly when they said they'd start.
            const msUntil = parsed.getTime() - Date.now();
            if (msUntil > 0 && msUntil <= 86400 * 1000) {
              const timerId = uid();
              const timerLabel = `Start ${target.title}`;
              const timerObj = { id: timerId, label: timerLabel, fireAt: parsed.getTime(), startedAt: Date.now(), userId: user?.id };
              setActiveTimers(prev => [...prev, timerObj]);
              scheduleTimerFire(timerObj);
              setActiveWidgets(w => ({ ...w, pomodoro: true }));
              if (user) syncOp(() => sb.from('timers').insert({ id: timerId, user_id: user.id, label: timerLabel, fire_at: pledgedIso }));
            }
            postAssistantNote(mech.pledgePrompt(target.title));
          } else if (mech.pledgePrompt) {
            // implementation_intention, two_minute_starter, temptation_bundle.
            postAssistantNote(mech.pledgePrompt(target.title));
          } else {
            postAssistantNote(`Locked in — you'll start **${target.title}** ${when}.`);
          }
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
              const promptPayload2 = buildSystemPrompt(tasks, blocks, events, notes, 2, { workspaceContext: 'schedule', intentType: 'action', recentlyExecutedActions: recentlyExecutedActionsRef.current, responseStyle, activeTimers });
              const activeTasks = tasks.filter(t => t.status !== 'done' && t.dueDate >= today()).slice(0, 50);
              const activeTasksMapped = activeTasks.map(t => ({ id: t.id, title: t.title, subject: t.subject, dueDate: t.dueDate, estTime: t.estTime, status: t.status, priority: t.priority, createdAt: t.createdAt, postponeCount: t.postponeCount || 0 }));
              const intentData = await streamChat({
                url: EDGE_FN_URL,
                body: {
                  mode: 'plan',
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
              if (proposal && classifyPlanShape(proposal) === 'routine') {
                const critique = typeof intentData.plan_critique === 'string' ? intentData.plan_critique : '';
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
              const promptPayload2 = buildSystemPrompt(tasks, blocks, events, notes, 2, { workspaceContext: 'schedule', intentType: 'action', recentlyExecutedActions: recentlyExecutedActionsRef.current, responseStyle, activeTimers });
              const existingPlanSummary = JSON.stringify(existingPlan.plan_json, null, 2);
              const intentData = await streamChat({
                url: EDGE_FN_URL,
                body: {
                  mode: 'plan',
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
              if (proposal && classifyPlanShape(proposal) === 'routine') {
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
        default:
          // Never silently swallow an action — an unhandled type means the model
          // produced something the client can't run, and the student must know it
          // didn't happen rather than seeing a phantom success.
          console.warn('Unknown action type:', action.type);
          setToastMsg("⚠️ I couldn't run that one — it's not something I can do yet.");
          if (user) { try { trackEvent(user.id, 'action_unhandled', { action_type: action?.type || 'unknown' }); } catch (_) {} }
          break;
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
        case 'make_plan': {
          if (classifyPlanShape(c) === 'routine') {
            const blocks = (c.recurring_blocks||[]).map(b => `- ${b.activity} (${(b.days||[]).join('/')} ${b.start}–${b.end})`).join('\n');
            const tasks2 = (c.milestone_tasks||[]).map(t => `- [ ] ${t.task_name}${t.due_date?' ('+t.due_date+')':''}`).join('\n');
            return '# Intent Plan\n\n' + (c.summary||'') + '\n\n## Recurring Blocks\n' + (blocks||'(none)') + '\n\n## Milestones\n' + (tasks2||'(none)');
          }
          return '# ' + (c.title||'Plan') + '\n\n' + (c.summary ? c.summary + '\n\n' : '') + (c.steps||[]).map((s,i) => '- [ ] ' + s.title + (s.date ? ' (' + s.date + ')' : '') + (s.time ? ' ' + s.time : '') + (s.estimated_minutes ? ' ~' + s.estimated_minutes + 'min' : '')).join('\n');
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
        const cardText = (c.cards || []).map(card => `${card.q} — ${card.a}`).join('\n');
        syncEmbed([{ source: 'flashcard_deck', source_id: deckId, text: (c.title || 'Flashcard Deck') + '\n' + (c.summary || '') + '\n' + cardText, metadata: { card_count: (c.cards || []).length } }]);
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
    // Two calendar categories: a step is a BLOCK (visible time commitment on the
    // calendar) when it carries a start time or is tagged kind='block'; otherwise
    // it's a DEADLINE (a due-dated task). This is what makes the plan's study
    // sessions, breaks, and timed exams actually appear on the calendar instead
    // of flattening into a pile of "due:" items.
    const addMinutesToHM = (hm, mins) => {
      const [h, m] = String(hm).split(':').map(Number);
      const total = Math.min(24 * 60 - 1, (h * 60 + (m || 0)) + mins);
      return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    };
    let blockCount = 0, taskCount = 0;
    steps.forEach(step => {
      const stepDate = step.date || today();
      const isBlock = step.kind === 'block' || (!!step.time && step.kind !== 'deadline');
      if (isBlock && step.time) {
        const end = step.end_time || addMinutesToHM(step.time, step.estimated_minutes || 60);
        executeAction({ type:'add_block', date:stepDate, start:step.time, end, activity:step.title, category:'school' });
        blockCount++;
      } else {
        executeAction({ type:'add_task', task_name:step.title, subject:step.subject||'', due_date:stepDate, estimated_minutes:step.estimated_minutes||30 });
        taskCount++;
      }
    });
    setPendingContent(prev => prev.filter((_,i) => i !== idx));
    // 24-hour plan rule: point at the first thing, not a confirmation toast.
    const dated = steps
      .map(s => ({ title: s.title, date: s.date || today(), time: s.time || '' }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const first = dated[0];
    if (first) {
      const da = daysUntil(first.date);
      const when = first.time ? `${whenLabel(da, first.date)} at ${first.time}` : whenLabel(da, first.date);
      if (da <= 1) postAssistantNote(`Plan's live — ${blockCount} block${blockCount !== 1 ? 's' : ''} on your calendar, ${taskCount} deadline${taskCount !== 1 ? 's' : ''} tracked. First up: "${first.title}", ${when}.`);
      else postAssistantNote(`Plan's live, but the first item isn't for ${da} days (${first.date}) — slow start.`);
    } else {
      setToastMsg('Added ' + steps.length + ' items from plan');
    }
  }

  async function handleApplyIntentPlan(idx, plan, skipConflicts = false) {
    const undoSnap = { tasks: tasks.slice(), events: events.slice(), notes: notes.slice(), blocks: JSON.parse(JSON.stringify(blocks)), flashcardDecks: flashcardDecks.slice(), grades: grades.slice() };
    let taskCount = 0, blockCount = 0;
    const createdTaskIds = [];

    const conflictSet = skipConflicts
      ? new Set(detectPlanConflicts(plan.recurring_blocks || [], blocks.recurring || []).map(c => c.activity))
      : new Set();

    // Recurring blocks: expand each spec into concrete, visible time blocks on
    // every matching weekday within its window. (executeAction has no
    // 'add_recurring_event' case — calling it directly would silently no-op, so
    // the whole plan's schedule vanished. add_block is handled and renders on
    // the calendar, matching the Block category.)
    const dayNameToIndex = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
    const applyRecurringBlock = (spec) => {
      const dayIdx = (spec.days || []).map(d => dayNameToIndex[d]).filter(d => d !== undefined);
      if (!dayIdx.length || !spec.start || !spec.end) return 0;
      const endDefault = new Date(); endDefault.setMonth(endDefault.getMonth() + 1);
      const cursor = new Date((spec.start_date || today()) + 'T12:00:00');
      const end = new Date((spec.end_date || toDateStr(endDefault)) + 'T12:00:00');
      let made = 0;
      while (cursor <= end && made < 120) {
        if (dayIdx.includes(cursor.getDay())) {
          executeAction({ type:'add_block', date:toDateStr(cursor), start:spec.start, end:spec.end, activity:spec.activity, category:spec.category || 'school' });
          made++;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      return made;
    };

    (plan.recurring_blocks || []).forEach(b => {
      if (skipConflicts && conflictSet.has(b.activity)) return;
      if (applyRecurringBlock(b) > 0) blockCount++;
    });
    if (plan.review_cadence?.review_block) {
      if (applyRecurringBlock(plan.review_cadence.review_block) > 0) blockCount++;
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

    // ── 24-Hour Plan Rule ──
    // The flow ends by pointing at the first block, not a confirmation toast.
    // If nothing lands within 24h the plan opens degraded — no silent survival.
    const first = computeFirstPlanBlock(plan);
    const within24h = !!first && first.daysAway <= 1;
    const appliedStatus = within24h ? 'active' : 'slipping';
    if (first && within24h) {
      postAssistantNote(`Plan's live. First block — ${first.activity}, ${whenLabel(first.daysAway, first.date)}.`);
    } else if (first) {
      postAssistantNote(`Plan's live, but the first block (${first.activity}) isn't for ${first.daysAway} days — it's slipping out of the gate.`);
    } else {
      postAssistantNote(`Plan's live — nothing scheduled within 24 hours, so it's already slipping.`);
    }

    if (user) {
      const isRevision = !!plan._revision_of_plan_id;
      let resolvedPlanId = null;
      if (isRevision) {
        resolvedPlanId = plan._revision_of_plan_id;
        const patch = { plan_json: plan, applied_at: new Date().toISOString(), total_tasks: (plan.milestone_tasks||[]).length, status: appliedStatus };
        syncOp(() => dbUpdateStudyPlan(plan._revision_of_plan_id, patch, user.id));
        setStudyPlans(prev => prev.map(p => p.id === plan._revision_of_plan_id ? { ...p, ...patch } : p));
        if (createdTaskIds.length > 0) {
          await sb.from('tasks').update({ study_plan_id: plan._revision_of_plan_id }).in('id', createdTaskIds).eq('user_id', user.id);
        }
      } else {
        const planId = await dbSaveStudyPlan(plan, user.id);
        if (planId) {
          resolvedPlanId = planId;
          if (createdTaskIds.length > 0) {
            await sb.from('tasks').update({ study_plan_id: planId }).in('id', createdTaskIds).eq('user_id', user.id);
          }
          if (!within24h) syncOp(() => dbUpdateStudyPlan(planId, { status: 'slipping' }, user.id));
          const newPlan = {
            id: planId, title: (plan.summary||'').slice(0,120)||'Study Plan',
            created_at: new Date().toISOString(), applied_at: new Date().toISOString(),
            status: appliedStatus, plan_json: plan,
            total_tasks: (plan.milestone_tasks||[]).length,
            review_cadence_days: plan.review_cadence?.every_n_days || null,
          };
          setStudyPlans(prev => [newPlan, ...prev]);
        }
      }
      if (resolvedPlanId) {
        const blockText = (plan.recurring_blocks || []).map(b => `${b.activity} (${(b.days||[]).join('/')} ${b.start}-${b.end})`).join('\n');
        const taskText = (plan.milestone_tasks || []).map(t => `${t.task_name} due ${t.due_date}`).join('\n');
        syncEmbed([{ source: 'study_plan', source_id: resolvedPlanId, text: (plan.summary || 'Study Plan') + '\n' + blockText + '\n' + taskText, metadata: {} }]);
      }

      // Instrument plans-created vs started-within-24h. Tied to the first
      // milestone task (task_events requires a task or event reference).
      if (createdTaskIds.length > 0) {
        dbInsertTaskEvent({
          taskId: createdTaskIds[0], eventType: 'plan_applied', toStatus: appliedStatus,
          metadata: {
            plan_id: resolvedPlanId,
            first_block: first ? { activity: first.activity, date: first.date, kind: first.kind } : null,
            within_24h: within24h,
            task_count: taskCount, block_count: blockCount,
          },
        }, user.id);
      }
    }
  }

  function handleApplyIntentPlanSkipConflicts(idx, plan) {
    return handleApplyIntentPlan(idx, plan, true);
  }

  // ── Onboarding: seed the calibrated weekly skeleton ──
  // Committed time (school + the student's stated commitments) lands confirmed /
  // high-confidence; the drafted focus/break blocks land tentative / low-
  // confidence — reusing the same gate as tasks/events so the proactive layer
  // never banks a speculative block as fact.
  function markOnboardingDone() {
    if (user) {
      setOnboardingEstablished(user.id);
      // Best-effort; column may not exist on older DBs.
      sb.from('profiles').update({ onboarding_completed: true }).eq('id', user.id).then(() => {}, () => {});
    }
    setShowOnboarding(false);
  }

  async function handleOnboardingComplete(payload) {
    const rows = payload?.rows || [];
    markOnboardingDone();

    if (user) {
      try { trackEvent(user.id, 'onboarding_completed', {
        commitment_count: payload.count,
        commitment_duration: payload.durationId,
        days_adjusted: (payload.signals || []).filter(s => !s.approvedClean).length,
        q3_given: !!payload.q3,
        blocks: rows.length,
      }); } catch (_) {}
    }

    if (rows.length === 0) { setToastMsg("Week's set."); return; }

    const baseRows = rows.map(r => ({
      user_id: user?.id, name: r.name, category: r.category,
      start_time: r.start, end_time: r.end, days: r.days,
    }));
    const fullRows = rows.map((r, i) => ({ ...baseRows[i], confidence: r.confidence, commitment: r.commitment }));

    let inserted = null;
    if (user) {
      let res = await sb.from('recurring_blocks').insert(fullRows).select('*');
      if (res.error) {
        // Older DB without confidence/commitment columns — retry without them so
        // the week still gets seeded.
        res = await sb.from('recurring_blocks').insert(baseRows).select('*');
      }
      if (!res.error) inserted = res.data;
      else console.error('Onboarding block seed failed:', res.error);
    }

    const clientRecurring = (inserted && inserted.length)
      ? inserted.map(rb => ({ id: rb.id, name: rb.name, category: rb.category, start: rb.start_time?.slice(0, 5) || rb.start_time, end: rb.end_time?.slice(0, 5) || rb.end_time, days: rb.days || [] }))
      : rows.map(r => ({ id: uid(), name: r.name, category: r.category, start: r.start, end: r.end, days: r.days }));

    setBlocks(prev => ({ ...prev, recurring: [...(prev.recurring || []), ...clientRecurring] }));
    setToastMsg(`Week's set — ${clientRecurring.length} recurring block${clientRecurring.length !== 1 ? 's' : ''} added.`);
  }

  function handleOnboardingSkip() {
    markOnboardingDone();
    if (user) { try { trackEvent(user.id, 'onboarding_skipped', {}); } catch (_) {} }
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
    syncEmbed([{ source: 'note', source_id: note.id, text: title + '\n' + plainTextFromHtml(text), metadata: { note_type: 'note' } }]);
    setShowGoogleModal(false);
    setToastMsg('Imported "' + title + '" to notes 📄');
    generateStudyPackInBackground({ topic: title, sourceText: text, sourceKind: 'import' });
  }

  function handleImportPdf(title, text) {
    const note = { id: uid(), name: title, content: text, updatedAt: new Date().toISOString(), source: 'pdf' };
    setNotes(prev => [...prev, note]);
    if (user) syncOp(() => dbUpsertNote(note, user.id));
    syncEmbed([{ source: 'note', source_id: note.id, text: title + '\n' + plainTextFromHtml(text), metadata: { note_type: 'note' } }]);
    setShowGoogleModal(false);
    setToastMsg('Imported PDF "' + title + '" to notes 📑');
    generateStudyPackInBackground({ topic: title, sourceText: text, sourceKind: 'import' });
  }

  function handleDeleteNote(noteId) {
    setNotes(prev => prev.filter(n => n.id !== noteId));
    if (user) {
      syncOp(() => sb.from('notes').delete().eq('id', noteId).eq('user_id', user.id));
      // memory_embeddings has no delete API here on purpose — a stale, never-
      // retrieved chunk is harmless, and match_memories always filters by the
      // owner's user_id, so nothing leaks. Cron-based pruning is a future add.
    }
    setToastMsg('Note deleted');
  }

  function handleUpdateNote(updated) {
    setNotes(prev => prev.map(n => n.id === updated.id ? { ...n, ...updated } : n));
    if (user) syncOp(() => dbUpsertNote(updated, user.id));
    syncEmbed([{ source: 'note', source_id: updated.id, text: (updated.name || '') + '\n' + plainTextFromHtml(updated.content), metadata: { note_type: updated.type || 'note' } }]);
    setToastMsg('Note saved');
  }

  function handleCreateNote(noteData) {
    const note = { id: uid(), ...noteData, updatedAt: new Date().toISOString() };
    setNotes(prev => [...prev, note]);
    if (user) syncOp(() => dbUpsertNote(note, user.id));
    syncEmbed([{ source: 'note', source_id: note.id, text: (note.name || '') + '\n' + plainTextFromHtml(note.content), metadata: { note_type: note.type || 'note' } }]);
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
    return { id: chat.id, name: CHAT_SAVE_PREFIX + title, content: JSON.stringify(chatData), updatedAt: savedAt, type: 'saved_chat' };
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
    syncEmbed([{ source: 'note', source_id: chatId, text: title + '\n' + messages.map(m => m.content).join('\n').slice(0, 6000), metadata: { note_type: 'saved_chat' } }]);
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
    setChatOpen(true);
  }

  function renameSavedChat(chatId) {
    const chat = savedChats.find(c => c.id === chatId);
    if (!chat) return;
    const nextTitle = window.prompt('Rename saved chat', chat.title || 'Saved chat')?.trim();
    if (!nextTitle || nextTitle === chat.title) return;
    const updated = { ...chat, title: nextTitle, savedAt: chat.savedAt || new Date().toISOString() };
    setSavedChats(prev => prev.map(c => c.id === chatId ? updated : c));
    if (user) syncOp(() => dbUpsertNote(makeSavedChatNote(updated), user.id));
    syncEmbed([{ source: 'note', source_id: chatId, text: nextTitle + '\n' + (updated.messages || []).map(m => m.content).join('\n').slice(0, 6000), metadata: { note_type: 'saved_chat' } }]);
    setToastMsg('Conversation renamed');
  }

  function restoreDeletedSavedChat() {
    if (!savedChatUndo) return;
    const { chat, wasViewing } = savedChatUndo;
    setSavedChats(prev => prev.some(c => c.id === chat.id) ? prev : [chat, ...prev]);
    if (user) syncOp(() => dbUpsertNote(makeSavedChatNote(chat), user.id));
    syncEmbed([{ source: 'note', source_id: chat.id, text: (chat.title || 'Saved chat') + '\n' + (chat.messages || []).map(m => m.content).join('\n').slice(0, 6000), metadata: { note_type: 'saved_chat' } }]);
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
    setChatOpen(true);
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
    // Simple read-only schedule asks do not need a model roundtrip. Open the
    // widget and use a deterministic prewritten response so we save tokens for
    // actual planning/action work.
    const scheduleShortcutReply = !fromClarification && !photo
      ? buildScheduleShortcutReply(msgContent, tasks, events, blocks)
      : null;
    if (scheduleShortcutReply) {
      setActiveWidgets(w => ({ ...w, schedule: true }));
      const userMsg = { role:'user', content:msgContent, timestamp:Date.now() };
      setMessages(prev => { const n=[...prev,userMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
      setInput('');
      if (user) {
        dbInsertChatMsg('user', msgContent, user.id);
      } else if (msgContent) {
        try {
          const demoChat = JSON.parse(localStorage.getItem('cc_chat') || '[]');
          demoChat.push({ role: 'user', content: msgContent });
          localStorage.setItem('cc_chat', JSON.stringify(demoChat));
        } catch {}
      }
      const assistantMsg = { role:'assistant', content:scheduleShortcutReply, timestamp:Date.now() };
      sfx.arrive();
      setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
      if (user) {
        dbInsertChatMsg('assistant', scheduleShortcutReply, user.id);
      } else {
        try {
          const demoChat = JSON.parse(localStorage.getItem('cc_chat') || '[]');
          demoChat.push({ role: 'assistant', content: scheduleShortcutReply });
          localStorage.setItem('cc_chat', JSON.stringify(demoChat));
        } catch {}
      }
      return;
    }

    // ── Deterministic "just start me" path ──
    // Paralysis / "I don't wanna" language never goes to the model. We name the
    // single most-startable task, lead with a 2-minute first step, and
    // auto-start a labeled timer (best-guess, no form). Never a bare "got it."
    if (!fromClarification && !photo && detectJustStart(msgContent)) {
      const userMsg = { role:'user', content:msgContent, timestamp:Date.now() };
      setMessages(prev => { const n=[...prev,userMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
      setInput('');
      if (user) dbInsertChatMsg('user', msgContent, user.id);
      else { try { const dc = JSON.parse(localStorage.getItem('cc_chat') || '[]'); dc.push({ role:'user', content:msgContent }); localStorage.setItem('cc_chat', JSON.stringify(dc)); } catch {} }

      const cutoff = addDaysISO(today(), 14);
      const dueSoon = tasks.filter(t => t.status !== 'done' && (!t.dueDate || t.dueDate <= cutoff));
      const pool = dueSoon.length ? dueSoon : tasks.filter(t => t.status !== 'done');

      let reply;
      if (pool.length === 0) {
        // Nothing on the board — reassure, don't invent work.
        reply = "Your board's actually clear right now — nothing's hanging over you. If something's looming, just tell me what it is and I'll get it down so it's off your head.";
      } else {
        // Pick the optimum of two dimensions — priority AND startability — not
        // the single highest-priority task. The most important thing is usually
        // the most daunting; the on-ramp is the easiest-to-start task that still
        // matters, so momentum can carry the student into the bigger work.
        const density = buildCalendarDensity(pool, blocks.dates || {});
        const ranked = rankForQuickStart(pool, new Date(), density, undefined, 1);
        const top = pool.find(t => t.id === ranked[0]?.taskId) || pool[0];
        const step = smallestNextStep(top);
        // Auto-start a 25-min focus timer labeled with the task. No clarification —
        // a procrastinating student won't fill a form, so we just pick 25 min.
        executeAction({ type:'set_timer', label: top.title, duration_seconds: 25 * 60, __confirmed:true });
        setActiveWidgets(w => ({ ...w, pomodoro: true }));
        // Lead with the two-minute task — the on-ramp comes first, the task name
        // second. Starting is the whole job; the rest can wait.
        reply = `▶ **Start here (2 min):** ${step}\n\nThat's the on-ramp for **${top.title}** — ignore everything else for now. Started a 25-min timer; when it chimes you can stop guilt-free.`;
        if (user) trackEvent(user.id, 'just_start', { task: top.title });
      }

      const assistantMsg = { role:'assistant', content: reply, timestamp:Date.now() };
      sfx.arrive();
      setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
      if (user) dbInsertChatMsg('assistant', reply, user.id);
      else { try { const dc = JSON.parse(localStorage.getItem('cc_chat') || '[]'); dc.push({ role:'assistant', content:reply }); localStorage.setItem('cc_chat', JSON.stringify(dc)); } catch {} }
      return;
    }

    // Summon floating widgets from chat keywords. Mirrors the landing
    // page: "set a timer" pops the Pomodoro, "what's my schedule" pops
    // the day timeline. Widgets render only when explicitly invoked.
    const lower = msgContent.toLowerCase();
    // Focus session (Sprint/Marathon) — one tap into head-down work. Opens the
    // launcher and short-circuits the AI: the session surface is the response.
    if (!focusRun && /\b(sprint|marathon|head\s*down|lock\s*in|deep\s*work|grind\s*session|focus\s*sprint)\b/.test(lower)) {
      const uMsg = { role: 'user', content: msgContent, timestamp: Date.now() };
      setMessages(prev => { const n = [...prev, uMsg]; while (n.length > CHAT_MAX_MESSAGES) n.shift(); return n; });
      if (user) dbInsertChatMsg('user', msgContent, user.id);
      setInput('');
      openFocusLauncher();
      return;
    }
    if (/(\b|^)(start|set|run|begin)\s+(a\s+)?(pomodoro|timer|focus)\b|\bpomodoro\b|\bfocus session\b/.test(lower)) {
      setActiveWidgets(w => ({ ...w, pomodoro: true }));
    }
    if (/(my\s+)?schedule\b|today'?s\s+(schedule|agenda|calendar)|what'?s\s+on\s+(my|the)\s+(schedule|agenda|calendar|day)|show\s+(me\s+)?(my\s+)?(schedule|agenda|calendar)|look\s+at\s+(my\s+)?(schedule|agenda|calendar)|agenda\b/.test(lower)) {
      setActiveWidgets(w => ({ ...w, schedule: true }));
    }
    // "what should I work on" / "what can I start" / "show me tasks" pops the
    // Start widget — the always-summonable list of up to four startable tasks.
    if (/what\s+(should|can|could)\s+i\s+(work\s+on|do\s+next|tackle)|what'?s\s+next|tasks?\s+to\s+(start|do|work\s+on)|show\s+(me\s+)?(my\s+)?tasks?|what\s+can\s+i\s+start/.test(lower)) {
      setActiveWidgets(w => ({ ...w, start: true }));
    }
    const effectiveWorkspaceContext = getWorkspaceContext();
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
      // Hint & Work-Check: the check wins over the clue when both could match
      // (a "check my work" is a backward ask even if it mentions being stuck).
      const isWorkCheckRequest = !isStudyPackRequest && !isPlanningRequest && !isIntentPlanRequest && WORK_CHECK_REGEX.test(text || '');
      const isClueRequest = !isStudyPackRequest && !isPlanningRequest && !isIntentPlanRequest && !isWorkCheckRequest && CLUE_REGEX.test(text || '');
      const coachingContentType = (isWorkCheckRequest || isClueRequest) ? classifyContentType({ text: msgContent }) : null;
      const workCheckKey = `wc:${effectiveWorkspaceContext || 'global'}`;
      const proofreadUsed = isWorkCheckRequest ? proofreadRoundsUsedFor(proofreadHistoryRef.current, workCheckKey) : 0;
      const workCheckHasRubric = isWorkCheckRequest && /\b(rubric|grading\s+criteria|requirements?:|criteria:|prompt:)\b/i.test(msgContent);
      const promptPayload = buildSystemPrompt(tasks, blocks, events, notes, 2, {
        workspaceContext: effectiveWorkspaceContext,
        intentType: inferredIntentType,
        recentlyExecutedActions: recentlyExecutedActionsRef.current,
        responseStyle,
        activeTimers,
      });
      setContextTrimInfo(promptPayload.trimInfo || null);

      const session = await sb.auth.getSession();
      const token = session?.data?.session?.access_token;

      // Build clientTasks payload for priority engine (non-done, due within 30 days).
      const thirtyDaysStr = addDaysISO(today(), 30);
      const clientTasksPayload = tasks
        .filter(t => t.status !== 'done' && t.dueDate <= thirtyDaysStr)
        .slice(0, 50)
        .map(t => ({ id: t.id, title: t.title, subject: t.subject, dueDate: t.dueDate, estTime: t.estTime, status: t.status, priority: t.priority, createdAt: t.createdAt, postponeCount: t.postponeCount || 0 }));
      const clientCalendarDensityPayload = buildCalendarDensity(clientTasksPayload, blocks.dates || {});

      const chatBody = {
        systemPrompt: promptPayload.prompt,
        // Split static/dynamic for Groq prompt caching (static policy is identical across all users)
        staticSystemPrompt: promptPayload.stablePrompt,
        dynamicContext: promptPayload.dynamicContext,
        messages: historyForApi,
        maxTokens: isStudyPackRequest ? 8000 : (isPlanningRequest || isIntentPlanRequest) ? 3000 : isWorkCheckRequest ? 2500 : isClueRequest ? 900 : 1024,
        workspaceContext: effectiveWorkspaceContext,
        prompt_version: promptPayload.promptVersion,
        context_chars: promptPayload.contextChars,
        input_tokens_est: promptPayload.estimatedInputTokens,
        clientTasks: clientTasksPayload,
        clientCalendarDensity: clientCalendarDensityPayload,
        intentType: inferredIntentType,
        ...((isPlanningRequest || isIntentPlanRequest) ? { mode: 'plan' } : {}),
        ...(isStudyPackRequest ? { mode: 'study_pack' } : {}),
        ...(isClueRequest ? { mode: 'clue', contentType: coachingContentType } : {}),
        ...(isWorkCheckRequest ? { mode: 'work_check', contentType: coachingContentType, proofreadRoundsUsed: proofreadUsed, hasRubric: workCheckHasRubric } : {}),
        // Caller-supplied mode override (e.g. brain_dump from voice transcripts).
        // Wins over the heuristics above.
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.planKind ? { planKind: opts.planKind } : {}),
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

      // ── Schema-version guard ──
      // On a breaking (major) mismatch, neutralize actions/clarifications so we
      // never misread a renamed field, but keep the assistant's text. The student
      // gets a clear "refresh" nudge instead of silent data corruption.
      if (chatData?.schema_version && schemaMajor(chatData.schema_version) !== schemaMajor(EXPECTED_ACTION_SCHEMA)) {
        console.warn('Schema version mismatch — server:', chatData.schema_version, 'client:', EXPECTED_ACTION_SCHEMA);
        setToastMsg('⚠️ The app just updated — refresh the page so I can run actions correctly (your data is safe).');
        chatData = { ...chatData, actions: [], clarification: null, clarifications: [] };
      }

      // ── Unified plan pipeline response ──
      // make_plan is now a superset: an explicit-request plan (steps) shows
      // as a propose-mode plan card; a goal-shaped plan (recurring_blocks /
      // milestone_tasks) shows as a propose-mode routine card; a brain-dump-
      // shaped plan (batch_actions) routes straight into the action review
      // rail, same as the old dedicated brain_dump mode did.
      if (chatData?.orchestration?.mode === 'plan') {
        const proposal = chatData.actions?.[0];
        const critiqueText = typeof chatData.plan_critique === 'string' ? chatData.plan_critique : '';
        const shape = classifyPlanShape(proposal);

        if (shape === 'batch') {
          const batchActions = proposal.batch_actions;
          const summaryText = typeof chatData.content === 'string' && chatData.content.trim()
            ? chatData.content.trim()
            : `Pulled out ${batchActions.length} item${batchActions.length === 1 ? '' : 's'} — review below.`;
          const assistantMsg = { role:'assistant', content:summaryText, timestamp:Date.now() };
          sfx.arrive();
          setMessages(prev => { const n=[...prev,assistantMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', summaryText, user.id);
          const rows = batchActions.map(a => {
            const conf = typeof a.confidence === 'number' ? a.confidence : null;
            const tentative = a.status === 'tentative' || a.commitment === 'tentative';
            const lowConf = conf != null && conf < 0.7;
            const reason = tentative && !lowConf ? 'tentative' : (lowConf ? 'low_confidence' : 'review');
            return { action: a, reason, confidence: conf };
          });
          setPendingActions(prev => [...prev, ...rows]);
          return;
        }

        if (shape === 'routine') {
          const blockCount = (proposal.recurring_blocks?.length || 0) + (proposal.review_cadence?.review_block ? 1 : 0);
          const taskCount = proposal.milestone_tasks?.length || 0;
          const introMsg = { role: 'assistant', content: `here's a structured plan — ${blockCount} recurring block${blockCount !== 1 ? 's' : ''}, ${taskCount} milestone task${taskCount !== 1 ? 's' : ''}. hit Apply to add everything, or Dismiss to skip:`, timestamp: Date.now() };
          sfx.arrive();
          setMessages(prev => { const n=[...prev,introMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', introMsg.content, user.id);
          setPendingContent(prev => [...prev, { ...proposal, _propose_mode: true, _intent_plan: true, _critique: critiqueText }]);
          return;
        }

        if (shape === 'steps') {
          const planMsg = { role: 'assistant', content: "here's a plan i put together — review it and hit Accept to add the steps to your calendar, or Edit to adjust:", timestamp: Date.now() };
          sfx.arrive();
          setMessages(prev => { const n=[...prev,planMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', planMsg.content, user.id);
          setPendingContent(prev => [...prev, { ...proposal, _propose_mode: true, _critique: critiqueText }]);
          return;
        }

        // Empty draft: legitimately nothing extracted (e.g. chit-chat).
        const emptyText = typeof chatData.content === 'string' && chatData.content.trim()
          ? chatData.content.trim()
          : "I didn't catch anything actionable in that — try again with a bit more detail?";
        const emptyMsg = { role: 'assistant', content: emptyText, timestamp: Date.now() };
        sfx.arrive();
        setMessages(prev => { const n=[...prev,emptyMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
        if (user) dbInsertChatMsg('assistant', emptyText, user.id);
        return;
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

      // ── Clue response: show the forward hint card ──
      if (chatData?.orchestration?.mode === 'clue') {
        const proposal = chatData.actions?.[0];
        if (proposal && proposal.type === 'make_clue') {
          const introMsg = { role: 'assistant', content: "here's a clue to get you moving — try it, then paste your attempt and i'll show you where it breaks:", timestamp: Date.now() };
          sfx.arrive();
          setMessages(prev => { const n=[...prev,introMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', introMsg.content, user.id);
          setPendingContent(prev => [...prev, { ...proposal }]);
          return;
        }
      }

      // ── Work-check response: surface gaps, record the proofread round ──
      if (chatData?.orchestration?.mode === 'work_check') {
        const proposal = chatData.actions?.[0];
        if (proposal && proposal.type === 'make_work_check') {
          // Record this round against the 2h proofread window for this assignment.
          const arr = proofreadHistoryRef.current[workCheckKey] || [];
          arr.push(Date.now());
          proofreadHistoryRef.current[workCheckKey] = arr;
          saveProofreadHistory(proofreadHistoryRef.current);
          const terminal = proposal.proofread?.terminal;
          const introMsg = { role: 'assistant', content: terminal
            ? "last check for this one — here's where it stands, then it's back to you:"
            : "here's where your work stands — strengths first, then the spots worth another look:", timestamp: Date.now() };
          sfx.arrive();
          setMessages(prev => { const n=[...prev,introMsg]; while(n.length>CHAT_MAX_MESSAGES)n.shift(); return n; });
          if (user) dbInsertChatMsg('assistant', introMsg.content, user.id);
          setPendingContent(prev => [...prev, { ...proposal }]);
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
      if (raw.includes('PlanPipelineError') || raw.includes('Plan pipeline failed')) {
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
        const looksLikeProviderError = raw.length > 120 || /[{}[\]"]/.test(raw) || /Groq|Gemini|openai|tool_use_failed/i.test(raw);
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
        text = await extractPdfText(file, { maxPages: 20 });
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
      // Voice → unified plan pipeline (brain-dump shaped): extract structured
      // tasks/events with confidence scoring. Tentative items land in the
      // review rail rather than mutating state immediately.
      sendMessage(transcript, { mode: 'plan', planKind: 'brain_dump' });
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
    setChatOpen(true);
    clearChat();
  }

  async function handleLogout() {
    await sb.auth.signOut();
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
        setActivePanel(prev => prev === 'settings' ? 'dashboard' : 'settings');
      }
      else if(key==='n'){
        e.preventDefault();
        setShowNotes(p=>!p);
      }
      else if(key==='h'){e.preventDefault();setShowChatSidebar(p=>!p)}
      else if(key==='d'){e.preventDefault();setShowDeadlines(p=>!p)}
      else if(key==='escape'){if(showGlobalSearch){setShowGlobalSearch(false);return;}if(showChatSidebar)setShowChatSidebar(false);if(showNotes)setShowNotes(false);if(showDeadlines)setShowDeadlines(false);if(chatOpen){setChatOpen(false);return;}if(activePanel==='settings')setActivePanel('dashboard')}
    }
    window.addEventListener('keydown',handleKey);return()=>window.removeEventListener('keydown',handleKey);
  },[showNotes,showChatSidebar,showGlobalSearch,showDeadlines,activePanel]);

  // ── Global search: semantic backend augments the instant local filter ──
  // Debounced so we don't fire an embed+RPC round-trip on every keystroke.
  useEffect(() => {
    if (!showGlobalSearch || !user || globalSearchQuery.trim().length < 3) {
      setSemanticSearchResults([]);
      return;
    }
    let cancelled = false;
    const q = globalSearchQuery.trim();
    const timer = setTimeout(async () => {
      try {
        const session = await sb.auth.getSession();
        const token = session?.data?.session?.access_token;
        if (!token || cancelled) return;
        const res = await fetch(EDGE_FN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ mode: 'search', searchQuery: q, searchSources: ['note', 'flashcard_deck', 'study_plan'], searchLimit: 8 }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setSemanticSearchResults(Array.isArray(data?.results) ? data.results : []);
      } catch (_) { if (!cancelled) setSemanticSearchResults([]); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [showGlobalSearch, globalSearchQuery, user]);

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
      className="studio"
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
      {/* Loading scan line */}
      {isLoading && <div className="sos-loading-scan" aria-hidden="true" />}
      <StudyTopBar
        user={user}
        syncStatus={syncStatus}
        theme={studioTheme}
        onTheme={setStudioTheme}
        onSettings={() => setActivePanel('settings')}
        onHome={() => navigate('/')}
        onDashboard={() => setActivePanel('dashboard')}
        activePanel={activePanel}
        queueCount={pendingQueue ? pendingQueue.length : 0}
      />
      <div className="studio-sidebar-col">
          <StudioSidebar
            user={user}
            savedChats={savedChats}
            viewingSavedChatId={viewingSavedChatId}
            onPick={loadSavedChat}
            onNew={startNewChat}
            onDelete={(chat) => setConfirmDeleteChat(chat)}
            onAuthAction={user ? handleLogout : () => setShowAuthModal(true)}
            aiThinking={isLoading}
            syncStatus={syncStatus}
            focusSession={focusSession}
            onFocusContinue={continueFocusSession}
            onFocusStop={stopFocusSession}
            tasks={tasks}
            events={events}
            notes={notes}
            selectedProject={selectedProject}
            onSelectProject={(name) => {
              if (selectedProject === name) {
                setSelectedProject(null);
              } else {
                setSelectedProject(name);
                setChatOpen(true);
              }
            }}
            onDashboard={() => { setActivePanel('dashboard'); setChatOpen(false); }}
            activePanel={activePanel}
            onOpenDeadlines={() => setShowDeadlines(true)}
          />
        </div>
      <div className="studio-center-col studio-glass-card">
      {chatOpen && (activeWidgets.pomodoro || activeTimers.length > 0) && (
        <PomodoroTimer
          sessionType={pomodoroSession}
          onSessionType={setPomodoroSession}
          aiTimers={activeTimers}
          onDismissAiTimer={dismissActiveTimer}
          onClose={() => setActiveWidgets(w => ({ ...w, pomodoro: false }))}
        />
      )}
      {chatOpen && activeWidgets.schedule && (
        <ScheduleWidget
          events={events}
          blocks={blocks}
          solo={!activeWidgets.pomodoro}
          onClose={() => setActiveWidgets(w => ({ ...w, schedule: false }))}
        />
      )}
      {chatOpen && activeWidgets.start && (() => {
        const sw = startWidgetData();
        return (
          <StartWidget
            tasks={sw.tasks}
            chips={sw.chips}
            solo={!activeWidgets.pomodoro && !activeWidgets.schedule}
            onStart={handleStartWidgetStart}
            onClose={() => setActiveWidgets(w => ({ ...w, start: false }))}
          />
        );
      })()}
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


      {activePanel === 'dashboard' && !chatOpen ? (
        <StudioDashboard
          user={user}
          tasks={tasks}
          events={events}
          onAsk={(prompt) => {
            setChatOpen(true);
            if (prompt && prompt.trim()) {
              setTimeout(() => sendMessage(prompt), 0);
            }
          }}
        />
      ) : activePanel === 'home' ? (
        <HomeScreen
          tasks={tasks}
          events={events}
          prefs={homePrefs}
          onOpenChat={() => setChatOpen(true)}
        />
      ) : activePanel === 'settings' ? (
        <div className="settings-fullscreen">
          <div className="settings-fullscreen-inner">
            <div className="settings-fullscreen-header">
              <div>
                <div className="settings-title">Settings</div>
                <div className="settings-sub">Customize Charles, notifications, and appearance.</div>
              </div>
              <button className="settings-toggle settings-toggle-active" onClick={()=>setActivePanel('dashboard')}>{Icon.x(14)} Close</button>
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
            <ConnectorsSettings onToast={(m) => setToastMsg(m)} />

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
      ) : selectedProject ? (
        <ProjectPanel
          subject={selectedProject}
          tasks={tasks}
          events={events}
          notes={notes}
          flashcardDecks={flashcardDecks}
          onClose={() => setSelectedProject(null)}
          onDeleteItems={(items) => {
            items.forEach(({ type, id }) => {
              if (type === 'task') { setTasks(prev => prev.filter(t => t.id !== id)); if (user) syncOp(() => dbDeleteTask(id, user.id)); }
              else if (type === 'event') { setEvents(prev => prev.filter(e => e.id !== id)); if (user) syncOp(() => dbDeleteEvent(id, user.id)); }
              else if (type === 'note') { setNotes(prev => prev.filter(n => n.id !== id)); if (user) syncOp(() => sb.from('notes').delete().eq('id', id).eq('user_id', user.id)); }
              else if (type === 'deck') { setFlashcardDecks(prev => prev.filter(d => d.id !== id)); if (user) syncOp(() => sb.from('flashcard_decks').delete().eq('id', id).eq('user_id', user.id)); }
            });
          }}
        />
      ) : null}

      {/* ── Chat overlay — always mounted to preserve state, shown when chatOpen ── */}
      {(chatOpen || messages.length > 0 || isLoading) && (
      <div className="sos-chat-overlay" style={{
        position:'absolute', inset:0, zIndex:20,
        display: chatOpen ? 'flex' : 'none',
        flexDirection:'column',
        background:'var(--bg)',
      }}>
      <div className="sos-chat-shell" style={{flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
      <div className="sos-chat-column" style={{flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
      {/* ── Chat close bar ── */}
      <div className="studio-chat-head">
        <span className="studio-chat-head-label">
          {messages.length > 0 ? 'SOS Chat' : 'Ask SOS'}
        </span>
        <span style={{flex:1}}/>
        <button
          className="icon-btn"
          onClick={() => setChatOpen(false)}
          title="Back to dashboard"
          aria-label="Close chat"
          style={{color:'var(--fg-3)'}}
        >{Icon.x(15)}</button>
      </div>
      {/* ── Chat Area ── */}
      <ErrorBoundary>
      <div className={"sos-chat-area" + ((activeWidgets.schedule || activeWidgets.start) ? ' widget-wide' : activeWidgets.pomodoro ? ' widget-narrow' : '')} ref={chatAreaRef} style={{animation:'fadeIn .22s ease'}}>
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
      <div className={"sos-input-area" + ((activeWidgets.schedule || activeWidgets.start) ? ' widget-wide' : activeWidgets.pomodoro ? ' widget-narrow' : '')}>
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
                onChange={e=>setInput(e.target.value)}
                placeholder={pendingPhoto?"add a message or just send the photo...":messages.length===0?["What's on your plate today?","What do you need help with?","Tell me about your classes...","What's coming up this week?","Anything on your mind?"][welcomeIdx]:"Ask anything"}
                disabled={isLoading}
                style={{width:'100%',background:'var(--bg)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:24,padding:'12px 20px',fontSize:'0.92rem',outline:'none',opacity:isLoading?0.5:1,transition:'all .25s cubic-bezier(0.16,1,0.3,1)'}}
                onKeyDown={e=>{
                  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSubmit();}
                }}
              />
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
      </div>
      </div>
      )}
      </div>

      {showNotes&&<NotesPanel notes={notes} events={events} tasks={tasks} onClose={()=>setShowNotes(false)} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} onCreateNote={handleCreateNote}/>}
      {showDeadlines&&<DeadlinesPanel tasks={tasks} events={events} blocks={blocks} ongoing={deadlinesOngoingData()} onClose={()=>setShowDeadlines(false)} onBreakTask={handleBreakTaskFromDeadlines} onOpenChat={()=>setChatOpen(true)}/>}
      {showMyPlans && user && <MyPlansPanel plans={studyPlans} tasks={tasks} onClose={()=>setShowMyPlans(false)} onRevise={(planId)=>{ const plan = studyPlans.find(p=>p.id===planId); setShowMyPlans(false); setPendingRevisionPlanId(planId); postAssistantNote(`What changes should I make to "${plan?.title||'your plan'}"? (e.g. "make the schedule lighter", "add 2 more study sessions per week")`); }} onArchive={(planId)=>{ syncOp(()=>dbUpdateStudyPlan(planId,{status:'archived'},user.id)); setStudyPlans(prev=>prev.map(p=>p.id===planId?{...p,status:'archived'}:p)); }}/>}
      {showGlobalSearch && <GlobalSearchModal
        query={globalSearchQuery}
        onQueryChange={setGlobalSearchQuery}
        onClose={() => setShowGlobalSearch(false)}
        tasks={tasks}
        events={events}
        notes={notes}
        savedChats={savedChats}
        semanticResults={semanticSearchResults}
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
      {showLmsModal && (
        <LmsSetupModal
          onClose={()=>setShowLmsModal(false)}
          onToast={setToastMsg}
        />
      )}
      {showAuthModal && <AuthModal onAuth={(u)=>{handleAuth(u);setShowAuthModal(false);setAuthModalInitialMode('login');}} onClose={()=>{setShowAuthModal(false);setAuthModalInitialMode('login');}} initialMode={authModalInitialMode} />}
      {showOnboarding && <Onboarding firstName={onboardingName} onComplete={handleOnboardingComplete} onSkip={handleOnboardingSkip} />}
      {/* Commitment-lock pledge countdown — shown for the commitment_lock arm
          whenever the user has an active pledge they haven't started yet. */}
      {pledgeCountdown && (() => {
        const ms = new Date(pledgeCountdown.pledgedAt).getTime() - Date.now();
        const isOverdue = ms < 0;
        const absMins = Math.abs(Math.round(ms / 60000));
        const label = isOverdue
          ? `${absMins}m past`
          : absMins < 1 ? 'now' : `in ${absMins}m`;
        return (
          <div style={{
            position:'fixed', top:12, left:'50%', transform:'translateX(-50%)',
            zIndex:1200, background:'var(--card-bg,#1a1a2e)', border:'1px solid var(--accent)',
            borderRadius:10, padding:'8px 16px', display:'flex', alignItems:'center',
            gap:12, boxShadow:'0 4px 20px rgba(0,0,0,0.4)', maxWidth:'90vw',
            color: isOverdue ? 'var(--warn,#ff6b6b)' : 'var(--text)',
          }}>
            <span style={{fontSize:'0.8rem', color:'var(--accent)', letterSpacing:'0.04em', fontWeight:700}}>
              {isOverdue ? '⚡' : '⏳'}
            </span>
            <span style={{fontSize:'0.85rem'}}>
              <strong>{pledgeCountdown.title}</strong>
              {' — '}
              <span style={{color: isOverdue ? 'var(--warn,#ff6b6b)' : 'var(--text-dim)'}}>starts {label}</span>
            </span>
            <button
              onClick={() => setPledgeCountdown(null)}
              style={{marginLeft:4,background:'none',border:'none',cursor:'pointer',
                color:'var(--text-dim)',fontSize:'0.85rem',padding:0,lineHeight:1}}
              aria-label="Dismiss pledge countdown"
            >✕</button>
          </div>
        );
      })()}
      {gateOpen && !showOnboarding && (() => {
        const surfaced = gateSurfacedTasks();
        return (
          <HomeDecisionGate
            tasks={surfaced}
            chips={gateChips(surfaced)}
            clearBoard={surfaced.length === 0}
            canSwap={gateCursor < gateRanked.length}
            onStart={handleGateStart}
            onSwap={handleGateSwap}
            onDefer={handleGateDefer}
            onEscape={handleGateEscape}
            onDismiss={handleGateDismiss}
            onAddEvent={handleGateAddEvent}
          />
        );
      })()}
      {focusLauncherOpen && !showOnboarding && !focusRun && (
        <FocusLauncher
          tasks={focusPool()}
          onLaunch={launchFocusSession}
          onClose={() => setFocusLauncherOpen(false)}
        />
      )}
      {focusRun && !showOnboarding && (() => {
        const { activeTask, onDeckTask } = resolveFocusTasks(focusRun);
        const goalLabel = focusRun.mode === 'marathon' && focusRun.goal
          ? (focusRun.goal.kind === 'count'
              ? `${focusRun.completedIds.length}/${focusRun.goal.count}`
              : `${focusRun.completedIds.length}/${focusRun.goal.taskIds.length}`)
          : '';
        return (
          <FocusSession
            mode={focusRun.mode}
            status={focusRun.status}
            activeTask={activeTask}
            onDeckTask={onDeckTask}
            sprintStartedAt={focusRun.startedAt}
            sprintDurationMs={focusRun.durationMs}
            clockExpired={focusRun.clockExpired}
            remaining={remainingCount(focusRun.queue, focusRun.completedIds, focusRun.skippedIds)}
            goalLabel={goalLabel}
            breakOffer={focusRun.breakOffer}
            breakEndsAt={focusRun.breakEndsAt}
            summary={focusRun.summary}
            onComplete={focusComplete}
            onSkip={focusSkip}
            onTakeBreak={focusTakeBreak}
            onSkipBreak={focusSkipBreak}
            onResumeNow={focusResumeNow}
            onEnd={() => endFocusSession()}
            onClose={closeFocusSession}
          />
        );
      })()}
      {rollupOpen && !showOnboarding && !gateOpen && (
        <DecisionRollup
          items={rollupItems}
          auto={rollupAuto}
          onApply={applyRollup}
          onUndoAuto={undoRollupAuto}
          onDismiss={dismissRollup}
        />
      )}
      {savedChatUndo&&(
        <div className="sos-saved-chat-undo" role="status">
          <span>Deleted “{savedChatUndo.chat.title || 'Saved chat'}”</span>
          <button onClick={restoreDeletedSavedChat}>Undo</button>
          <button onClick={() => { setSavedChatUndo(null); if (savedChatUndoTimerRef.current) clearTimeout(savedChatUndoTimerRef.current); }} aria-label="Dismiss saved chat undo">×</button>
        </div>
      )}
      {toastMsg&&<Toast message={toastMsg} onDone={()=>setToastMsg(null)}/>}
      {lmsPendingConfirm&&(
        <LmsPendingToast
          taskTitle={lmsPendingConfirm.taskTitle}
          lmsName={lmsPendingConfirm.lmsName}
          onConfirm={async()=>{
            setLmsPendingConfirm(null);
            try {
              const tok = (await sb.auth.getSession())?.data?.session?.access_token;
              await fetch('/api/lms-confirm', {
                method:'POST',
                headers:{'Content-Type':'application/json', ...(tok?{Authorization:`Bearer ${tok}`}:{})},
                body: JSON.stringify({ taskId: lmsPendingConfirm.taskId, confirm: true }),
              });
            } catch(e) { console.error('lms-confirm error:', e); }
          }}
          onReject={async()=>{
            setLmsPendingConfirm(null);
            try {
              const tok = (await sb.auth.getSession())?.data?.session?.access_token;
              await fetch('/api/lms-confirm', {
                method:'POST',
                headers:{'Content-Type':'application/json', ...(tok?{Authorization:`Bearer ${tok}`}:{})},
                body: JSON.stringify({ taskId: lmsPendingConfirm.taskId, confirm: false }),
              });
            } catch(e) { console.error('lms-confirm error:', e); }
          }}
        />
      )}
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
