import React from 'react';
import Icon from '../lib/icons';

const WAVE_PEAKS = [6, 10, 14, 8, 12, 16, 7, 13, 9, 15, 11, 8, 14, 6, 12, 10, 16, 7, 11, 9];
const WAVE_SPEEDS = [0.7, 0.9, 0.6, 1.1, 0.8, 0.65, 1.0, 0.75, 0.85, 0.6, 0.95, 0.7, 0.8, 1.0, 0.7, 0.9, 0.65, 1.1, 0.8, 0.75];
const WAVE_DELAYS = [0, 0.1, 0.2, 0.05, 0.15, 0.25, 0.08, 0.18, 0.03, 0.12, 0.22, 0.07, 0.17, 0.27, 0.04, 0.14, 0.24, 0.09, 0.19, 0.01];

function getWeatherEmoji(weatherData) {
  const code = weatherData?.current?.weather_code ?? weatherData?.current?.weathercode;
  if (code == null) return '🌙';
  if (code === 0 || code === 1) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  return '⛈️';
}

function getWeatherTemp(weatherData) {
  const t = weatherData?.current?.temperature_2m;
  return t != null ? Math.round(t) + '°F' : null;
}

function getWeatherDesc(weatherData) {
  return weatherData?.city || null;
}

function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

export default function LofiRightPanel({ weatherData, onOpenSettings, onNewChat }) {
  const [musicPlaying, setMusicPlaying] = React.useState(false);
  const [timerSeconds, setTimerSeconds] = React.useState(25 * 60);
  const [timerRunning, setTimerRunning] = React.useState(false);
  const [smashCount, setSmashCount] = React.useState(0);
  const [widgetOrder, setWidgetOrder] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sos_right_widget_order') || '[]');
      const defaults = ['weather', 'chat', 'radio', 'timer'];
      if (Array.isArray(saved) && saved.length) {
        const merged = [...saved.filter(w => defaults.includes(w)), ...defaults.filter(w => !saved.includes(w))];
        return merged;
      }
      return defaults;
    } catch (_) {
      return ['weather', 'chat', 'radio', 'timer'];
    }
  });

  const weatherEmoji = getWeatherEmoji(weatherData);
  const weatherTemp = getWeatherTemp(weatherData);
  const weatherDesc = getWeatherDesc(weatherData);
  const timerDone = timerSeconds === 0;

  React.useEffect(() => {
    localStorage.setItem('sos_right_widget_order', JSON.stringify(widgetOrder));
  }, [widgetOrder]);

  React.useEffect(() => {
    if (!timerRunning || timerSeconds <= 0) return undefined;
    const tick = setInterval(() => {
      setTimerSeconds(prev => {
        if (prev <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [timerRunning, timerSeconds]);

  function moveWidget(id, dir) {
    setWidgetOrder(prev => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
      return next;
    });
  }

  function WidgetFrame({ id, title, children }) {
    const idx = widgetOrder.indexOf(id);
    return (
      <div className="study-widget-card" data-widget={id}>
        <div className="study-widget-head">
          <span>{title}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="study-widget-move" onClick={() => moveWidget(id, -1)} disabled={idx === 0}>↑</button>
            <button className="study-widget-move" onClick={() => moveWidget(id, 1)} disabled={idx === widgetOrder.length - 1}>↓</button>
          </div>
        </div>
        {children}
      </div>
    );
  }

  const widgets = {
    weather: (
      <WidgetFrame id="weather" title="Weather">
        <div className="study-weather">
          <span className="study-weather-icon">{weatherEmoji}</span>
          <div className="study-weather-info">
            <div className="study-weather-temp">{weatherTemp || '—'}</div>
            <div className="study-weather-desc">{weatherDesc || 'No weather data'}</div>
          </div>
        </div>
      </WidgetFrame>
    ),
    chat: (
      <WidgetFrame id="chat" title="Chat">
        <div className="study-widget-actions">
          <button className="study-widget-btn" onClick={onNewChat}>{Icon.edit(14)} New chat</button>
        </div>
      </WidgetFrame>
    ),
    radio: (
      <WidgetFrame id="radio" title="Radio">
        <div className="study-music-player">
          <div className="study-now-playing-label">Now Playing</div>
          <div className="study-track-name">lofi hip hop radio</div>
          <div className="study-track-artist">beats to study / relax to</div>
          <div className="study-waveform">
            {WAVE_PEAKS.map((peak, i) => (
              <div
                key={i}
                className={'study-wave-bar' + (!musicPlaying ? ' paused' : '')}
                style={{
                  '--wpeak': peak + 'px',
                  '--wspd': WAVE_SPEEDS[i] + 's',
                  '--wdelay': WAVE_DELAYS[i] + 's',
                  height: musicPlaying ? undefined : '3px',
                }}
              />
            ))}
          </div>
          <div className="study-music-controls">
            <button className="study-music-btn" title="Previous" aria-label="Previous">⏮</button>
            <button
              className="study-music-btn play"
              onClick={() => setMusicPlaying(p => !p)}
              title={musicPlaying ? 'Pause' : 'Play'}
              aria-label={musicPlaying ? 'Pause' : 'Play'}
            >
              {musicPlaying ? '⏸' : '▶'}
            </button>
            <button className="study-music-btn" title="Next" aria-label="Next">⏭</button>
          </div>
        </div>
      </WidgetFrame>
    ),
    timer: (
      <WidgetFrame id="timer" title="Timer">
        <div className="study-widget-actions" style={{ alignItems: 'center' }}>
          <div style={{ fontFamily: 'var(--lofi-font-mono)', fontSize: '1.2rem', color: 'var(--lofi-text)' }}>{formatSeconds(timerSeconds)}</div>
          {!timerDone ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="study-widget-btn" onClick={() => setTimerRunning(r => !r)}>{timerRunning ? 'Pause' : 'Start'}</button>
              <button className="study-widget-btn" onClick={() => { setTimerRunning(false); setTimerSeconds(25 * 60); }}>Reset</button>
            </div>
          ) : (
            <button className="study-smash-btn" onClick={() => setSmashCount(c => c + 1)}>Smash It ({smashCount})</button>
          )}
        </div>
      </WidgetFrame>
    ),
  };

  return (
    <div className="study-right study-glass">
      <div className="study-right-controls">
        <button className="study-widget-btn" onClick={onOpenSettings}>{Icon.edit(14)} Settings</button>
        <button className="study-widget-btn" onClick={onNewChat}>{Icon.edit(14)} New chat</button>
      </div>
      {widgetOrder.map(id => <React.Fragment key={id}>{widgets[id]}</React.Fragment>)}
    </div>
  );
}
