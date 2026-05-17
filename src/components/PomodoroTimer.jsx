import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '../lib/icons';

const PRESETS = {
  pomodoro:    { label: 'Pomodoro',    duration: 25 * 60 },
  short_break: { label: 'Short Break', duration:  5 * 60 },
  long_break:  { label: 'Long Break',  duration: 15 * 60 },
};
const PRESET_KEYS = Object.keys(PRESETS);

const RADIUS = 60;
const CIRC   = 2 * Math.PI * RADIUS;

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(secs) {
  const s = Math.max(0, Math.floor(secs));
  return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
}
// Shorten AI timer labels for the tab so they don't overflow
function shortLabel(label, max = 12) {
  return label.length > max ? label.slice(0, max - 1) + '…' : label;
}

/*
 * Unified Pomodoro + AI-timer widget.
 *
 * Props:
 *   sessionType   — 'pomodoro' | 'short_break' | 'long_break'   (controlled from parent)
 *   onSessionType — (key: string) => void
 *   aiTimers      — [{ id, label, fireAt, startedAt }]           from set_timer executor
 *   onDismissAiTimer — (id: string) => void
 *   onClose       — () => void  (× button)
 */
export default function PomodoroTimer({
  sessionType = 'pomodoro',
  onSessionType,
  aiTimers = [],
  onDismissAiTimer,
  onClose,
}) {
  const [collapsed, setCollapsed]   = useState(false);
  const [running,   setRunning]     = useState(false);
  const [timeLeft,  setTimeLeft]    = useState(PRESETS[sessionType].duration);
  // Which tab is selected — preset key or 'ai-{id}'
  const [selectedTab, setSelectedTab] = useState(sessionType);
  const [, setTick]                 = useState(0); // forces re-render for AI ring updates
  const intervalRef = useRef(null);
  const prevSessionRef = useRef(sessionType);

  // ── Preset session type changed externally (e.g. handleSkip) ──
  useEffect(() => {
    if (sessionType !== prevSessionRef.current) {
      prevSessionRef.current = sessionType;
      setRunning(false);
      clearInterval(intervalRef.current);
      setTimeLeft(PRESETS[sessionType].duration);
      setSelectedTab(sessionType);
    }
  }, [sessionType]);

  // ── When a new AI timer arrives, auto-select its tab ──
  const prevAiCount = useRef(aiTimers.length);
  useEffect(() => {
    if (aiTimers.length > prevAiCount.current && aiTimers.length > 0) {
      const newest = aiTimers[aiTimers.length - 1];
      setSelectedTab('ai-' + newest.id);
      setRunning(false); // pause any preset that was running
    }
    prevAiCount.current = aiTimers.length;
  }, [aiTimers]);

  // ── If the selected AI tab disappears (dismissed/fired), fall back to preset ──
  useEffect(() => {
    if (selectedTab.startsWith('ai-')) {
      const id = selectedTab.slice(3);
      if (!aiTimers.find(t => t.id === id)) {
        setSelectedTab(sessionType);
      }
    }
  }, [aiTimers, selectedTab, sessionType]);

  // ── Preset tick ──
  useEffect(() => {
    if (!running || selectedTab !== sessionType || selectedTab.startsWith('ai-')) {
      clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          setRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, selectedTab, sessionType]);

  // ── AI timer ring tick (1 Hz re-render) ──
  useEffect(() => {
    if (!selectedTab.startsWith('ai-')) return;
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, [selectedTab]);

  const handleReset = useCallback(() => {
    setRunning(false);
    clearInterval(intervalRef.current);
    setTimeLeft(PRESETS[sessionType].duration);
  }, [sessionType]);

  const handleSkip = useCallback(() => {
    const cur = PRESET_KEYS.indexOf(sessionType);
    const next = PRESET_KEYS[(cur + 1) % PRESET_KEYS.length];
    onSessionType?.(next);
  }, [sessionType, onSessionType]);

  function selectTab(key) {
    if (key === selectedTab) return;
    if (!key.startsWith('ai-')) {
      // Switching to preset tab — reset to that preset
      const presetKey = key;
      setRunning(false);
      clearInterval(intervalRef.current);
      setTimeLeft(PRESETS[presetKey].duration);
      onSessionType?.(presetKey);
    }
    setSelectedTab(key);
  }

  // ── Derive ring values for the active tab ──
  let ringProgress = 1;
  let ringLabel    = '';
  let ringTime     = '';
  let isAiTab      = false;
  let selectedAiTimer = null;

  if (selectedTab.startsWith('ai-')) {
    isAiTab = true;
    const id = selectedTab.slice(3);
    selectedAiTimer = aiTimers.find(t => t.id === id);
    if (selectedAiTimer) {
      const remainingMs = Math.max(0, selectedAiTimer.fireAt - Date.now());
      const totalMs     = Math.max(1, selectedAiTimer.fireAt - (selectedAiTimer.startedAt ?? selectedAiTimer.fireAt - 60000));
      ringProgress = remainingMs / totalMs;
      ringLabel    = selectedAiTimer.label;
      ringTime     = fmt(remainingMs / 1000);
    }
  } else {
    const preset = PRESETS[selectedTab] || PRESETS.pomodoro;
    ringProgress = timeLeft / preset.duration;
    ringLabel    = preset.label;
    ringTime     = fmt(timeLeft);
  }

  const offset = CIRC * (1 - ringProgress);

  // ── Collapsed mini-view ──
  const miniDot = (!isAiTab && !running) ? ' paused' : '';

  if (collapsed) {
    return (
      <div className="study-pomodoro collapsed">
        <div className="study-pomodoro-header" onClick={() => setCollapsed(false)}>
          <div className="study-pomodoro-mini">
            <span className={'study-pomodoro-mini-dot' + miniDot} />
            <span>{ringTime}</span>
            <span style={{ fontSize: 10, color: 'var(--lofi-text-dim)' }}>— {shortLabel(ringLabel)}</span>
          </div>
          <button
            className="study-pomodoro-expand-btn"
            onClick={e => { e.stopPropagation(); setCollapsed(false); }}
            aria-label="Expand timer"
          >{Icon.chevronRight(12)}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="study-pomodoro">
      {/* Header row */}
      <div className="study-pomodoro-header" onClick={() => setCollapsed(true)}>
        <div className="study-pomodoro-mini">
          <span className={'study-pomodoro-mini-dot' + miniDot} />
          <span>{ringTime}</span>
          <span style={{ fontSize: 10, color: 'var(--lofi-text-dim)' }}>— {shortLabel(ringLabel)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {onClose && (
            <button
              className="study-pomodoro-expand-btn"
              onClick={e => { e.stopPropagation(); onClose(); }}
              aria-label="Close timer"
            >×</button>
          )}
          <button
            className="study-pomodoro-expand-btn"
            onClick={e => { e.stopPropagation(); setCollapsed(true); }}
            aria-label="Collapse timer"
          >{Icon.chevronLeft(12)}</button>
        </div>
      </div>

      <div className="study-pomodoro-body">
        {/* Session tabs — presets first, then AI timers */}
        <div className="study-session-tabs">
          {PRESET_KEYS.map(key => (
            <button
              key={key}
              className={'study-session-tab' + (selectedTab === key ? ' active' : '')}
              onClick={() => selectTab(key)}
            >{PRESETS[key].label}</button>
          ))}
          {aiTimers.map(t => (
            <button
              key={t.id}
              className={'study-session-tab ai-timer-tab' + (selectedTab === 'ai-' + t.id ? ' active' : '')}
              onClick={() => selectTab('ai-' + t.id)}
              title={t.label}
            >{shortLabel(t.label, 10)}</button>
          ))}
        </div>

        {/* Circular progress ring */}
        <div className="study-timer-ring">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle
              className="study-timer-ring-track"
              cx="70" cy="70" r={RADIUS}
              fill="none" strokeWidth="4"
            />
            <circle
              className={'study-timer-ring-fill' + (isAiTab ? ' ai-timer-fill' : '')}
              cx="70" cy="70" r={RADIUS}
              fill="none" strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="study-timer-digits">
            <span className="study-timer-time">{ringTime}</span>
            <span className="study-timer-session-label">{ringLabel}</span>
          </div>
        </div>

        {/* Controls */}
        {isAiTab ? (
          // AI timer: auto-running — only let user dismiss it
          <div className="study-timer-controls">
            <button
              className="study-timer-btn danger"
              onClick={() => {
                onDismissAiTimer?.(selectedAiTimer?.id);
                setSelectedTab(sessionType);
              }}
              title="Dismiss timer"
              aria-label="Dismiss AI timer"
            >✕ Dismiss</button>
          </div>
        ) : (
          <div className="study-timer-controls">
            <button className="study-timer-btn" onClick={handleReset} title="Reset" aria-label="Reset timer">↺</button>
            <button
              className="study-timer-btn primary"
              onClick={() => setRunning(r => !r)}
              title={running ? 'Pause' : 'Start'}
              aria-label={running ? 'Pause timer' : 'Start timer'}
            >{running ? '⏸' : '▶'}</button>
            <button className="study-timer-btn" onClick={handleSkip} title="Skip" aria-label="Skip to next session">⏭</button>
          </div>
        )}
      </div>
    </div>
  );
}
