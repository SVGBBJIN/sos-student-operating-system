// HomeScreen — an opt-in calm landing surface inside the studio.
//
// Not a screensaver. Not a dashboard. One background, the time, today's
// date, and ONE focus element the user picked: top task / next event /
// custom message. All preferences live in localStorage; nothing here
// reaches into Supabase.
//
// Enabled via Settings → Home screen (off by default to honor the
// "opt-in" choice). When enabled, a small home button appears in the
// chat panel header that switches `activePanel` to `'home'`.

import React, { useEffect, useState } from 'react';

export const HOME_BACKGROUNDS = [
  { id: 'aurora',  label: 'Aurora',  css: 'linear-gradient(160deg, #0f1224 0%, #1a1542 35%, #2a1856 70%, #4c2a8a 100%)' },
  { id: 'dusk',    label: 'Dusk',    css: 'linear-gradient(160deg, #1c1a3a 0%, #3b2657 40%, #6b3d6b 75%, #b56576 100%)' },
  { id: 'forest',  label: 'Forest',  css: 'linear-gradient(160deg, #0a1f1a 0%, #133029 40%, #1f4d3f 75%, #2d6e54 100%)' },
  { id: 'paper',   label: 'Paper',   css: 'linear-gradient(160deg, #f4ecd8 0%, #e8dcc0 35%, #d4c4a0 70%, #c4b288 100%)' },
  { id: 'midnight', label: 'Midnight', css: 'linear-gradient(160deg, #050715 0%, #0a0f24 50%, #131838 100%)' },
];

export const HOME_FOCUS_OPTIONS = [
  { id: 'task',    label: 'Today\'s top task' },
  { id: 'event',   label: 'Next upcoming event' },
  { id: 'message', label: 'Custom message' },
];

export function getHomePrefs() {
  try {
    return {
      enabled:    localStorage.getItem('sos_home_enabled') === 'true',
      background: localStorage.getItem('sos_home_background') || 'aurora',
      focus:      localStorage.getItem('sos_home_focus') || 'task',
      message:    localStorage.getItem('sos_home_message') || 'Stay focused. The next hour belongs to you.',
    };
  } catch (_) {
    return { enabled: false, background: 'aurora', focus: 'task', message: 'Stay focused.' };
  }
}

export function setHomePref(key, value) {
  try { localStorage.setItem(`sos_home_${key}`, String(value)); } catch (_) {}
}

function selectFocusContent({ focus, message, tasks, events }) {
  if (focus === 'message') {
    return { primary: message || '', secondary: '' };
  }
  if (focus === 'task') {
    const today = new Date(); today.setHours(0,0,0,0);
    const candidates = (tasks || [])
      .filter(t => t.status !== 'done')
      .sort((a, b) => {
        const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return da - db;
      });
    const top = candidates[0];
    if (top) {
      return {
        primary: top.title,
        secondary: top.dueDate ? `due ${top.dueDate}` : (top.subject ? top.subject : ''),
      };
    }
    return { primary: 'Nothing on your plate.', secondary: 'Take the win.' };
  }
  if (focus === 'event') {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const upcoming = (events || [])
      .filter(e => e.date && e.date >= today)
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
    const next = upcoming[0];
    if (next) {
      return {
        primary: next.title || 'Untitled event',
        secondary: [next.date, next.time].filter(Boolean).join(' · '),
      };
    }
    return { primary: 'No events upcoming.', secondary: 'Open week is yours.' };
  }
  return { primary: '', secondary: '' };
}

export default function HomeScreen({ tasks, events, prefs, onOpenChat }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  const bg = HOME_BACKGROUNDS.find(b => b.id === prefs.background) || HOME_BACKGROUNDS[0];
  const focus = selectFocusContent({ focus: prefs.focus, message: prefs.message, tasks, events });

  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        background: bg.css,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        textAlign: 'center',
        gap: 24,
        overflow: 'hidden',
        animation: 'homeFadeIn 480ms ease-out',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.08), transparent 60%)', pointerEvents: 'none' }} />

      <div style={{ fontSize: 16, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>
        {dateStr}
      </div>

      <div style={{ fontSize: 'clamp(64px, 14vw, 132px)', fontWeight: 200, color: 'rgba(255,255,255,0.95)', lineHeight: 1, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>
        {timeStr}
      </div>

      <div style={{ marginTop: 12, maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: 'rgba(255,255,255,0.92)', lineHeight: 1.3 }}>
          {focus.primary || ''}
        </div>
        {focus.secondary && (
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)' }}>
            {focus.secondary}
          </div>
        )}
      </div>

      <button
        onClick={onOpenChat}
        style={{
          marginTop: 32,
          padding: '10px 24px',
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(255,255,255,0.06)',
          color: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(12px)',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: '0.04em',
        }}
      >
        Open chat
      </button>

      <style>{`
        @keyframes homeFadeIn {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
