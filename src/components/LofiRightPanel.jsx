import React, { useState } from 'react';
import { Icon } from '../lib/icons';
import ErrorBoundary from './ErrorBoundary';

// Wave bar heights (20 bars, varied peaks)
const WAVE_PEAKS = [6, 10, 14, 8, 12, 16, 7, 13, 9, 15, 11, 8, 14, 6, 12, 10, 16, 7, 11, 9];
const WAVE_SPEEDS = [0.7, 0.9, 0.6, 1.1, 0.8, 0.65, 1.0, 0.75, 0.85, 0.6, 0.95, 0.7, 0.8, 1.0, 0.7, 0.9, 0.65, 1.1, 0.8, 0.75];
const WAVE_DELAYS = [0, 0.1, 0.2, 0.05, 0.15, 0.25, 0.08, 0.18, 0.03, 0.12, 0.22, 0.07, 0.17, 0.27, 0.04, 0.14, 0.24, 0.09, 0.19, 0.01];

function getWeatherEmoji(weatherData) {
  if (!weatherData) return '🌙';
  const desc = (weatherData.description || weatherData.condition || '').toLowerCase();
  if (desc.includes('thunder') || desc.includes('storm')) return '⛈️';
  if (desc.includes('rain') || desc.includes('drizzle')) return '🌧️';
  if (desc.includes('snow')) return '❄️';
  if (desc.includes('fog') || desc.includes('mist')) return '🌫️';
  if (desc.includes('cloud')) return '☁️';
  if (desc.includes('clear') || desc.includes('sun')) return '☀️';
  return '🌙';
}

function getWeatherTemp(weatherData) {
  if (!weatherData) return null;
  const t = weatherData.temp ?? weatherData.temperature;
  if (t == null) return null;
  return Math.round(t) + '°F';
}

function getWeatherDesc(weatherData) {
  if (!weatherData) return null;
  return weatherData.description || weatherData.condition || weatherData.city || null;
}

export default function LofiRightPanel({
  weatherData,
  tasks,
  blocks,
  events,
  notes,
  onDeleteNote,
  onUpdateNote,
  onCreateNote,
}) {
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [rightTab, setRightTab] = useState('schedule'); // 'schedule' | 'notes'

  const weatherEmoji = getWeatherEmoji(weatherData);
  const weatherTemp = getWeatherTemp(weatherData);
  const weatherDesc = getWeatherDesc(weatherData);

  return (
    <div className="study-right study-glass">
      {/* Cat widget */}
      <div className="study-cat-scene">
        <div className="study-cat-wrap">
          <svg className="study-cat-svg" width="72" height="72" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Body */}
            <ellipse cx="50" cy="72" rx="22" ry="16" fill="#2a2d3a"/>
            {/* Head */}
            <circle cx="50" cy="48" r="20" fill="#2a2d3a"/>
            {/* Ears */}
            <polygon points="34,34 30,20 42,30" fill="#2a2d3a"/>
            <polygon points="66,34 70,20 58,30" fill="#2a2d3a"/>
            {/* Inner ears */}
            <polygon points="35,32 32,23 41,30" fill="#c4b5fd" opacity="0.5"/>
            <polygon points="65,32 68,23 59,30" fill="#c4b5fd" opacity="0.5"/>
            {/* Eyes */}
            <ellipse className="study-cat-eye"  cx="43" cy="46" rx="3.5" ry="3.5" fill="#f5c842"/>
            <ellipse className="study-cat-eye-r" cx="57" cy="46" rx="3.5" ry="3.5" fill="#f5c842"/>
            <circle cx="43" cy="46" r="1.8" fill="#111"/>
            <circle cx="57" cy="46" r="1.8" fill="#111"/>
            {/* Nose */}
            <ellipse cx="50" cy="53" rx="2" ry="1.2" fill="#fda4af" opacity="0.8"/>
            {/* Mouth */}
            <path d="M47 55 Q50 58 53 55" stroke="#c4b5fd" strokeWidth="1" fill="none" opacity="0.5"/>
            {/* Whiskers */}
            <line x1="30" y1="52" x2="43" y2="53" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8"/>
            <line x1="30" y1="55" x2="43" y2="55" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8"/>
            <line x1="70" y1="52" x2="57" y2="53" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8"/>
            <line x1="70" y1="55" x2="57" y2="55" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8"/>
            {/* Tail */}
            <path className="study-cat-tail" d="M68 78 Q80 68 75 58 Q70 50 76 44" stroke="#2a2d3a" strokeWidth="6" fill="none" strokeLinecap="round"/>
            <path className="study-cat-tail" d="M68 78 Q80 68 75 58 Q70 50 76 44" stroke="#3a3d4a" strokeWidth="4" fill="none" strokeLinecap="round"/>
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

      {/* Schedule / Notes tab switcher */}
      <div className="study-right-tabs">
        <button
          className={'study-right-tab' + (rightTab === 'schedule' ? ' active' : '')}
          onClick={() => setRightTab('schedule')}
        >
          Schedule
        </button>
        <button
          className={'study-right-tab' + (rightTab === 'notes' ? ' active' : '')}
          onClick={() => setRightTab('notes')}
        >
          Notes
        </button>
      </div>

      {/* Sub-panel */}
      <div className="study-right-subpanel">
        <ErrorBoundary>
          {rightTab === 'schedule' && (
            <RightSchedule tasks={tasks} blocks={blocks} events={events} weatherData={weatherData} />
          )}
          {rightTab === 'notes' && (
            <RightNotes notes={notes} onDeleteNote={onDeleteNote} onUpdateNote={onUpdateNote} onCreateNote={onCreateNote} />
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

// Lightweight schedule summary for the right panel
function RightSchedule({ tasks, events }) {
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = (events || []).filter(e => e.event_date && e.event_date.slice(0, 10) === today).slice(0, 4);
  const upcomingTasks = (tasks || []).filter(t => t.status !== 'done').slice(0, 5);

  return (
    <div style={{ padding: '10px', overflow: 'auto', maxHeight: '100%', fontSize: 11, color: 'var(--lofi-text-muted)', fontFamily: 'var(--lofi-font-mono)' }}>
      {todayEvents.length > 0 && (
        <>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--lofi-text-dim)', marginBottom: 4 }}>Events today</div>
          {todayEvents.map(e => (
            <div key={e.id} style={{ padding: '4px 6px', borderRadius: 6, marginBottom: 2, background: 'rgba(255,255,255,0.03)', borderLeft: '2px solid var(--lofi-amber)' }}>
              {e.title}
            </div>
          ))}
        </>
      )}
      {upcomingTasks.length > 0 && (
        <>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--lofi-text-dim)', marginBottom: 4, marginTop: todayEvents.length ? 8 : 0 }}>Tasks</div>
          {upcomingTasks.map(t => (
            <div key={t.id} style={{ padding: '4px 6px', borderRadius: 6, marginBottom: 2, background: 'rgba(255,255,255,0.03)' }}>
              {t.title}
            </div>
          ))}
        </>
      )}
      {todayEvents.length === 0 && upcomingTasks.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 12, color: 'var(--lofi-text-dim)' }}>Nothing scheduled</div>
      )}
    </div>
  );
}

// Lightweight notes list for the right panel
function RightNotes({ notes, onCreateNote }) {
  const [input, setInput] = useState('');

  const sorted = (notes || []).slice().sort((a, b) => {
    return (b.updated_at || b.created_at || '') > (a.updated_at || a.created_at || '') ? 1 : -1;
  }).slice(0, 6);

  return (
    <div style={{ padding: '10px', overflow: 'auto', maxHeight: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 12, fontSize: 11, color: 'var(--lofi-text-dim)', fontFamily: 'var(--lofi-font-mono)' }}>No notes yet</div>
      ) : sorted.map(note => (
        <div key={note.id} style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--lofi-border)', fontSize: 11, color: 'var(--lofi-text-muted)', fontFamily: 'var(--lofi-font-mono)', cursor: 'default' }}>
          <div style={{ fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note.name || 'Untitled'}</div>
          <div style={{ fontSize: 10, color: 'var(--lofi-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {(note.content || '').replace(/<[^>]+>/g, '').slice(0, 60)}
          </div>
        </div>
      ))}
      {onCreateNote && (
        <button
          onClick={() => onCreateNote('Quick note', '')}
          style={{ marginTop: 4, padding: '5px', borderRadius: 8, border: '1px dashed var(--lofi-border)', background: 'transparent', color: 'var(--lofi-text-dim)', fontSize: 10, cursor: 'pointer', fontFamily: 'var(--lofi-font-mono)' }}
        >
          + New note
        </button>
      )}
    </div>
  );
}
