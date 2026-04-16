import React, { useState, useEffect, useRef, useCallback } from 'react';

const SPEEDS = [0.75, 1, 1.25, 1.5];

/**
 * parsePodcastScript — parse [ALEX]: / [SAM]: dialogue into an array.
 * @param {string} raw  — raw AI response string
 * @returns {{ speaker: 'ALEX'|'SAM', text: string }[]}
 */
export function parsePodcastScript(raw) {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .reduce((acc, line) => {
      const alexMatch = line.match(/^\[ALEX\]:\s*(.*)/i);
      const samMatch  = line.match(/^\[SAM\]:\s*(.*)/i);
      if (alexMatch) acc.push({ speaker: 'ALEX', text: alexMatch[1] });
      else if (samMatch) acc.push({ speaker: 'SAM',  text: samMatch[1] });
      return acc;
    }, []);
}

/**
 * PodcastPlayer — Web Speech API podcast player.
 *
 * Props:
 *   lines   — [{ speaker: 'ALEX'|'SAM', text: string }]
 *   title   — string  (used for download filename)
 */
export default function PodcastPlayer({ lines = [], title = 'lesson' }) {
  const [currentIdx,    setCurrentIdx]    = useState(0);
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [speed,         setSpeed]         = useState(1);
  const [activeSpeaker, setActiveSpeaker] = useState(null);
  const [voices,        setVoices]        = useState([]);
  const synthRef = useRef(window.speechSynthesis);
  const idxRef   = useRef(0);   // mutable so callbacks see latest value
  const playRef  = useRef(false);

  // Load voices
  useEffect(() => {
    function loadVoices() {
      const v = synthRef.current.getVoices();
      if (v.length) setVoices(v);
    }
    loadVoices();
    synthRef.current.addEventListener('voiceschanged', loadVoices);
    return () => synthRef.current.removeEventListener('voiceschanged', loadVoices);
  }, []);

  // Cancel speech on unmount
  useEffect(() => {
    return () => { synthRef.current.cancel(); };
  }, []);

  // Sync idx ref
  useEffect(() => { idxRef.current = currentIdx; }, [currentIdx]);
  useEffect(() => { playRef.current = isPlaying; }, [isPlaying]);

  const speakLine = useCallback((idx) => {
    if (idx >= lines.length) {
      setIsPlaying(false);
      setActiveSpeaker(null);
      return;
    }
    const line = lines[idx];
    const utt  = new SpeechSynthesisUtterance(line.text);
    utt.rate   = speed;

    // Assign voices: ALEX → voices[0], SAM → voices[1], fallback to default
    if (voices.length > 0) {
      utt.voice = line.speaker === 'ALEX' ? voices[0] : (voices[1] || voices[0]);
    }

    utt.onstart = () => {
      setActiveSpeaker(line.speaker);
      setCurrentIdx(idx);
    };

    utt.onend = () => {
      if (!playRef.current) return;
      const nextIdx = idx + 1;
      idxRef.current = nextIdx;
      setCurrentIdx(nextIdx);
      speakLine(nextIdx);
    };

    utt.onerror = () => {
      setIsPlaying(false);
      setActiveSpeaker(null);
    };

    synthRef.current.speak(utt);
  }, [lines, speed, voices]);

  function handlePlay() {
    if (isPlaying) return;
    setIsPlaying(true);
    playRef.current = true;
    synthRef.current.cancel();
    speakLine(idxRef.current);
  }

  function handlePause() {
    setIsPlaying(false);
    playRef.current = false;
    synthRef.current.pause();
  }

  function handleResume() {
    setIsPlaying(true);
    playRef.current = true;
    synthRef.current.resume();
  }

  function handleRestart() {
    synthRef.current.cancel();
    setCurrentIdx(0);
    idxRef.current = 0;
    setIsPlaying(false);
    setActiveSpeaker(null);
  }

  function handleNext() {
    synthRef.current.cancel();
    const next = Math.min(idxRef.current + 1, lines.length - 1);
    setCurrentIdx(next);
    idxRef.current = next;
    if (isPlaying) speakLine(next);
  }

  function handleSpeedChange(s) {
    setSpeed(s);
    if (isPlaying) {
      synthRef.current.cancel();
      setTimeout(() => speakLine(idxRef.current), 50);
    }
  }

  function handleDownload() {
    const text = lines.map(l => `[${l.speaker}]: ${l.text}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `podcast-${title.replace(/\s+/g, '-').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const currentLine = lines[currentIdx] || null;
  const progress    = lines.length > 0 ? (currentIdx / lines.length) * 100 : 0;

  if (!lines.length) return null;

  return (
    <div
      className="card-gradient"
      style={{
        borderRadius: 'var(--radius-lg)',
        border: '1px solid hsla(170, 50%, 50%, 0.15)',
        boxShadow: 'var(--shadow-md)',
        padding: 'var(--spacing-6)',
        maxWidth: 560,
        margin: 'var(--spacing-6) auto',
        fontFamily: 'var(--font-ui)',
      }}
    >
      {/* Avatar row */}
      <div style={{ display: 'flex', gap: 'var(--spacing-4)', alignItems: 'center', marginBottom: 'var(--spacing-4)' }}>
        {['ALEX', 'SAM'].map(name => {
          const isActive = activeSpeaker === name && isPlaying;
          return (
            <div
              key={name}
              style={{
                width: 40, height: 40,
                borderRadius: 'var(--radius-full)',
                background: name === 'ALEX' ? 'hsl(210,55%,30%)' : 'hsl(155,25%,30%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-heading)',
                fontWeight: 700,
                fontSize: 16,
                color: 'var(--foreground)',
                border: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                transform: isActive ? 'scale(1.1)' : 'scale(1)',
                animation: isActive ? 'speakerPulse 1.5s ease-in-out infinite' : 'none',
                transition: 'transform var(--duration-fast) ease-out, border-color var(--duration-fast) ease-out',
                flexShrink: 0,
              }}
            >
              {name[0]}
            </div>
          );
        })}
        <span style={{ fontSize: 12, color: 'var(--muted-foreground)', marginLeft: 'auto' }}>
          {currentIdx + 1} / {lines.length}
        </span>
      </div>

      {/* Current line */}
      {currentLine && (
        <div style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--spacing-4)',
          marginBottom: 'var(--spacing-4)',
          minHeight: 64,
        }}>
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 11,
            color: 'var(--primary)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 4,
          }}>
            {currentLine.speaker}
          </div>
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 14,
            color: 'var(--foreground)',
            lineHeight: 1.6,
          }}>
            {currentLine.text}
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div style={{
        width: '100%',
        height: 4,
        background: 'var(--muted)',
        borderRadius: 'var(--radius-full)',
        marginBottom: 'var(--spacing-4)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: 'var(--primary)',
          borderRadius: 'var(--radius-full)',
          transition: 'width var(--duration-normal) ease-out',
        }} />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--spacing-4)', marginBottom: 'var(--spacing-4)', flexWrap: 'wrap' }}>
        <button onClick={handleRestart} title="Restart" style={iconBtnStyle}>⏮</button>

        {isPlaying ? (
          <button onClick={handlePause} title="Pause" style={{ ...iconBtnStyle, fontSize: 22 }}>⏸</button>
        ) : (
          <button onClick={handlePlay}  title="Play"  style={{ ...iconBtnStyle, fontSize: 22, color: 'var(--primary)' }}>▶</button>
        )}

        <button onClick={handleNext}  title="Next line" style={iconBtnStyle}>⏭</button>

        {/* Speed pills */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'var(--spacing-2)' }}>
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => handleSpeedChange(s)}
              style={{
                background: 'transparent',
                border: 'none',
                fontFamily: 'var(--font-ui)',
                fontSize: 12,
                color: speed === s ? 'var(--primary)' : 'var(--muted-foreground)',
                cursor: 'pointer',
                padding: '2px 4px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: speed === s ? 700 : 400,
              }}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* Download Script */}
      <button
        onClick={handleDownload}
        style={{
          width: '100%',
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--muted-foreground)',
          borderRadius: 'var(--radius)',
          fontFamily: 'var(--font-ui)',
          fontSize: 13,
          padding: 'var(--spacing-2) var(--spacing-4)',
          cursor: 'pointer',
          marginTop: 'var(--spacing-2)',
          transition: 'border-color var(--duration-fast) ease-out, color var(--duration-fast) ease-out',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--foreground)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted-foreground)'; }}
      >
        Download Script
      </button>
    </div>
  );
}

const iconBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: 'var(--foreground)',
  fontSize: 18,
  cursor: 'pointer',
  padding: 'var(--spacing-2)',
  borderRadius: 'var(--radius-sm)',
  lineHeight: 1,
  transition: 'color var(--duration-fast) ease-out',
};
