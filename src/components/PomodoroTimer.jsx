import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '../lib/icons';

const SESSION_CONFIG = {
  pomodoro: { label: 'Pomodoro', duration: 25 * 60 },
  short:    { label: 'Short Break', duration: 5 * 60 },
  long:     { label: 'Long Break', duration: 15 * 60 },
};

// SVG ring math: r=60, circumference = 2π*60 ≈ 377
const RADIUS = 60;
const CIRC = 2 * Math.PI * RADIUS;

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatTime(seconds) {
  return pad(Math.floor(seconds / 60)) + ':' + pad(seconds % 60);
}

export default function PomodoroTimer({ sessionType, onSessionType }) {
  const [collapsed, setCollapsed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SESSION_CONFIG[sessionType || 'pomodoro'].duration);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);
  const prevSessionRef = useRef(sessionType);

  // Reset when session type changes externally
  useEffect(() => {
    if (sessionType !== prevSessionRef.current) {
      prevSessionRef.current = sessionType;
      setRunning(false);
      clearInterval(intervalRef.current);
      setTimeLeft(SESSION_CONFIG[sessionType].duration);
    }
  }, [sessionType]);

  // Tick
  useEffect(() => {
    if (running) {
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
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  const handleReset = useCallback(() => {
    setRunning(false);
    clearInterval(intervalRef.current);
    setTimeLeft(SESSION_CONFIG[sessionType || 'pomodoro'].duration);
  }, [sessionType]);

  const handleSkip = useCallback(() => {
    const keys = Object.keys(SESSION_CONFIG);
    const cur = sessionType || 'pomodoro';
    const next = keys[(keys.indexOf(cur) + 1) % keys.length];
    onSessionType(next);
  }, [sessionType, onSessionType]);

  const total = SESSION_CONFIG[sessionType || 'pomodoro'].duration;
  const progress = timeLeft / total;
  const offset = CIRC * (1 - progress);

  const sessionLabel = SESSION_CONFIG[sessionType || 'pomodoro'].label;

  if (collapsed) {
    return (
      <div className="study-pomodoro collapsed">
        <div className="study-pomodoro-header" onClick={() => setCollapsed(false)}>
          <div className="study-pomodoro-mini">
            <span className={'study-pomodoro-mini-dot' + (!running ? ' paused' : '')} />
            <span>{formatTime(timeLeft)}</span>
            <span style={{ fontSize: 10, color: 'var(--lofi-text-dim)' }}>— {sessionLabel}</span>
          </div>
          <button
            className="study-pomodoro-expand-btn"
            onClick={e => { e.stopPropagation(); setCollapsed(false); }}
            aria-label="Expand timer"
          >
            {Icon.chevronRight(12)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="study-pomodoro">
      {/* Collapse header */}
      <div className="study-pomodoro-header" onClick={() => setCollapsed(true)}>
        <div className="study-pomodoro-mini">
          <span className={'study-pomodoro-mini-dot' + (!running ? ' paused' : '')} />
          <span>{formatTime(timeLeft)}</span>
          <span style={{ fontSize: 10, color: 'var(--lofi-text-dim)' }}>— {sessionLabel}</span>
        </div>
        <button
          className="study-pomodoro-expand-btn"
          onClick={e => { e.stopPropagation(); setCollapsed(true); }}
          aria-label="Collapse timer"
        >
          {Icon.chevronLeft(12)}
        </button>
      </div>

      {/* Full timer body */}
      <div className="study-pomodoro-body">
        {/* Session tabs */}
        <div className="study-session-tabs">
          {Object.entries(SESSION_CONFIG).map(([key, cfg]) => (
            <button
              key={key}
              className={'study-session-tab' + ((sessionType || 'pomodoro') === key ? ' active' : '')}
              onClick={() => {
                if (sessionType !== key) {
                  onSessionType(key);
                }
              }}
            >
              {cfg.label}
            </button>
          ))}
        </div>

        {/* Circular ring */}
        <div className="study-timer-ring">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle
              className="study-timer-ring-track"
              cx="70" cy="70" r={RADIUS}
              fill="none"
              strokeWidth="4"
            />
            <circle
              className="study-timer-ring-fill"
              cx="70" cy="70" r={RADIUS}
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="study-timer-digits">
            <span className="study-timer-time">{formatTime(timeLeft)}</span>
            <span className="study-timer-session-label">{sessionLabel}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="study-timer-controls">
          <button className="study-timer-btn" onClick={handleReset} title="Reset" aria-label="Reset timer">
            ↺
          </button>
          <button
            className="study-timer-btn primary"
            onClick={() => setRunning(r => !r)}
            title={running ? 'Pause' : 'Start'}
            aria-label={running ? 'Pause timer' : 'Start timer'}
          >
            {running ? '⏸' : '▶'}
          </button>
          <button className="study-timer-btn" onClick={handleSkip} title="Skip to next" aria-label="Skip to next session">
            ⏭
          </button>
        </div>
      </div>
    </div>
  );
}
