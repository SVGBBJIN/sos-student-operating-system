import React from 'react';

// Wave bar heights (20 bars, varied peaks)
const WAVE_PEAKS = [6, 10, 14, 8, 12, 16, 7, 13, 9, 15, 11, 8, 14, 6, 12, 10, 16, 7, 11, 9];
const WAVE_SPEEDS = [0.7, 0.9, 0.6, 1.1, 0.8, 0.65, 1.0, 0.75, 0.85, 0.6, 0.95, 0.7, 0.8, 1.0, 0.7, 0.9, 0.65, 1.1, 0.8, 0.75];
const WAVE_DELAYS = [0, 0.1, 0.2, 0.05, 0.15, 0.25, 0.08, 0.18, 0.03, 0.12, 0.22, 0.07, 0.17, 0.27, 0.04, 0.14, 0.24, 0.09, 0.19, 0.01];

// Open-Meteo WMO weathercode → emoji
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

export default function LofiRightPanel({ weatherData }) {
  const [musicPlaying, setMusicPlaying] = React.useState(false);

  const weatherEmoji = getWeatherEmoji(weatherData);
  const weatherTemp  = getWeatherTemp(weatherData);
  const weatherDesc  = getWeatherDesc(weatherData);

  return (
    <div className="study-right study-glass">

      {/* ── Cat widget — exact copy from lofi-study-ui.html ── */}
      <div className="study-cat-scene">
        <div className="window-frame" />
        <div className="cat-wrap">
          <svg className="cat-svg" viewBox="0 0 80 70" xmlns="http://www.w3.org/2000/svg">
            {/* tail */}
            <g className="tail">
              <path d="M38 58 Q20 65 18 55 Q16 45 28 48" stroke="#c4b5fd" strokeWidth="5" fill="none" strokeLinecap="round"/>
            </g>
            {/* body */}
            <ellipse cx="40" cy="50" rx="20" ry="16" fill="#1e1b2e"/>
            {/* head */}
            <circle cx="40" cy="28" r="16" fill="#1e1b2e"/>
            {/* ears */}
            <polygon points="24,16 20,4 30,14" fill="#1e1b2e"/>
            <polygon points="56,16 60,4 50,14" fill="#1e1b2e"/>
            <polygon points="25,14 22,7 30,13" fill="#c4b5fd" opacity="0.6"/>
            <polygon points="55,14 58,7 50,13" fill="#c4b5fd" opacity="0.6"/>
            {/* eyes */}
            <g className="eye-l" style={{transformOrigin: '33px 28px'}}>
              <ellipse cx="33" cy="28" rx="4" ry="5" fill="#7c3aed"/>
              <ellipse cx="33" cy="28" rx="2" ry="4" fill="#0a0a12"/>
              <circle cx="34" cy="26" r="1" fill="rgba(255,255,255,0.6)"/>
            </g>
            <g className="eye-r" style={{transformOrigin: '47px 28px'}}>
              <ellipse cx="47" cy="28" rx="4" ry="5" fill="#7c3aed"/>
              <ellipse cx="47" cy="28" rx="2" ry="4" fill="#0a0a12"/>
              <circle cx="48" cy="26" r="1" fill="rgba(255,255,255,0.6)"/>
            </g>
            {/* nose & mouth */}
            <ellipse cx="40" cy="33" rx="1.5" ry="1" fill="#fda4af"/>
            <path d="M38 34.5 Q40 37 42 34.5" stroke="#c4b5fd" strokeWidth="1" fill="none" opacity="0.7"/>
            {/* whiskers */}
            <line x1="20" y1="32" x2="34" y2="34" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8"/>
            <line x1="20" y1="35" x2="34" y2="35" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8"/>
            <line x1="46" y1="34" x2="60" y2="32" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8"/>
            <line x1="46" y1="35" x2="60" y2="35" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8"/>
            {/* paws */}
            <ellipse cx="28" cy="62" rx="7" ry="4" fill="#1a172a"/>
            <ellipse cx="52" cy="62" rx="7" ry="4" fill="#1a172a"/>
          </svg>
        </div>
      </div>

      {/* Music player */}
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

      {/* Weather widget */}
      <div className="study-weather">
        <span className="study-weather-icon">{weatherEmoji}</span>
        <div className="study-weather-info">
          <div className="study-weather-temp">{weatherTemp || '—'}</div>
          <div className="study-weather-desc">{weatherDesc || 'No weather data'}</div>
        </div>
      </div>

      {/* Placeholder — future panel */}
      <div className="study-right-placeholder" />
    </div>
  );
}

