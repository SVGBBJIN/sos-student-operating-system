import React, { useState, useEffect } from 'react';

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function calcFocusMinutes(tasks) {
  const today = getTodayStr();
  return (tasks || []).reduce((sum, t) => {
    if (t.completed_at && t.completed_at.slice(0, 10) === today) {
      return sum + (t.focus_minutes || 0);
    }
    return sum;
  }, 0);
}

function formatFocusTime(minutes) {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function calcStreak(recentlyCompleted) {
  // recentlyCompleted is an array of task objects completed recently
  // count distinct days going back from today
  if (!recentlyCompleted || recentlyCompleted.length === 0) return 0;
  const days = new Set(
    recentlyCompleted
      .filter(t => t.completed_at)
      .map(t => t.completed_at.slice(0, 10))
  );
  let streak = 0;
  const d = new Date();
  while (true) {
    const ds = d.toISOString().slice(0, 10);
    if (days.has(ds)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export default function StudyBottomBar({ tasks, recentlyCompleted }) {
  const [time, setTime] = useState('');

  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const streak = calcStreak(recentlyCompleted);
  const focusMins = calcFocusMinutes(tasks);

  return (
    <div className="study-bottombar study-glass">
      <span className="study-bottom-clock">{time}</span>

      {streak > 0 && (
        <span className="study-streak-badge">
          🔥 {streak}-day streak
        </span>
      )}

      {focusMins > 0 && (
        <span className="study-focus-time">
          {formatFocusTime(focusMins)} focus today
        </span>
      )}
    </div>
  );
}
