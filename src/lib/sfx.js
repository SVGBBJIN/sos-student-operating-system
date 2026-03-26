/**
 * sfx.js — Lofi UI sound effects via Web Audio API
 * Zero external files. All sounds are synthesized inline.
 * Lofi aesthetic: warm oscillators, slight detune, soft envelopes.
 */

let _ctx = null;
let _master = null;
let _lp = null;
let _ambientNoiseSource = null;
let _ambientNoiseGain = null;
let _ambientPulseInterval = null;
const STORAGE_KEY = 'sos:sfx-enabled';

function getCtx() {
  if (_ctx) return _ctx;
  _ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Low-pass filter for warmth — rolls off harshness above 4kHz
  _lp = _ctx.createBiquadFilter();
  _lp.type = 'lowpass';
  _lp.frequency.value = 4000;
  _lp.Q.value = 0.5;

  // Master gain
  _master = _ctx.createGain();
  _master.gain.value = 0.22;

  _lp.connect(_master);
  _master.connect(_ctx.destination);

  return _ctx;
}

function isEnabled() {
  const val = localStorage.getItem(STORAGE_KEY);
  return val === null ? true : val === 'true';
}

function setEnabled(v) {
  localStorage.setItem(STORAGE_KEY, String(v));
}

function toggle() {
  const next = !isEnabled();
  setEnabled(next);
  if (next) startAmbient();
  else stopAmbient();
  return next;
}

/**
 * Core synth: plays an oscillator with optional glide and a volume envelope.
 * @param {object} opts
 * @param {string}  opts.type      - oscillator type (sine|triangle|square|sawtooth)
 * @param {number}  opts.freq      - start frequency Hz
 * @param {number}  [opts.freqEnd] - end frequency Hz (glide)
 * @param {number}  opts.attack    - attack time seconds
 * @param {number}  opts.decay     - decay time seconds
 * @param {number}  opts.peak      - peak gain (0–1)
 * @param {number}  [opts.detune]  - cents of detune
 * @param {number}  [opts.delay]   - seconds before starting
 */
function synth(opts) {
  if (!isEnabled()) return;
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();

  const t = ctx.currentTime + (opts.delay || 0);
  const osc = ctx.createOscillator();
  const env = ctx.createGain();

  osc.type = opts.type || 'sine';
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.freqEnd != null) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(opts.freqEnd, 0.001),
      t + opts.attack + opts.decay
    );
  }
  if (opts.detune) osc.detune.value = opts.detune;

  // Envelope: ramp up then decay
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(opts.peak, t + opts.attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + opts.attack + opts.decay);

  osc.connect(env);
  env.connect(_lp);
  osc.start(t);
  osc.stop(t + opts.attack + opts.decay + 0.01);
}

/**
 * Soft noise burst for the lofi crackle layer.
 * @param {number} duration seconds
 * @param {number} gain     peak gain
 * @param {number} [delay]  start offset
 */
function noise(duration, gain, delay = 0) {
  if (!isEnabled()) return;
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();

  const t = ctx.currentTime + delay;
  const bufLen = Math.ceil(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1);

  const src = ctx.createBufferSource();
  src.buffer = buf;

  // Band-pass to make it sound like vinyl crackle, not white noise
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3200;
  bp.Q.value = 2;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  src.connect(bp);
  bp.connect(env);
  env.connect(_master);
  src.start(t);
  src.stop(t + duration + 0.01);
}

// ─────────────────────────────────────────────────────────────────────────────
// Named sounds
// ─────────────────────────────────────────────────────────────────────────────

/** Very short button click — keyboard tap feel */
export function tap() {
  synth({ type: 'sine',     freq: 420, attack: 0.003, decay: 0.055, peak: 0.9, detune: -8 });
  noise(0.03, 0.04);
}

/** Sidebar / panel navigation click — softer than tap */
export function nav() {
  synth({ type: 'triangle', freq: 370, attack: 0.002, decay: 0.045, peak: 0.7, detune: 6 });
}

/** Message sent — quick ascending glide */
export function send() {
  synth({ type: 'sine',     freq: 300, freqEnd: 540, attack: 0.01, decay: 0.09, peak: 0.85 });
  noise(0.05, 0.03, 0.01);
}

/** AI response arrived — soft bell ping */
export function arrive() {
  // Primary tone
  synth({ type: 'sine',     freq: 660, attack: 0.005, decay: 0.28, peak: 0.75, detune: -5 });
  // Subtle harmonic
  synth({ type: 'triangle', freq: 990, attack: 0.005, decay: 0.18, peak: 0.22, detune: 8  });
  noise(0.04, 0.015, 0.01);
}

/** Task/action confirmed — warm two-note chime (C5 + E5) */
export function confirm() {
  synth({ type: 'sine',     freq: 523, attack: 0.005, decay: 0.32, peak: 0.72 });
  synth({ type: 'sine',     freq: 659, attack: 0.005, decay: 0.28, peak: 0.45, delay: 0.04 });
  noise(0.04, 0.02);
}

/** Dismiss / cancel — short descending tone */
export function dismiss() {
  synth({ type: 'triangle', freq: 400, freqEnd: 260, attack: 0.003, decay: 0.07, peak: 0.65, detune: 10 });
}

/** Toast / notification — single gentle chime */
export function chime() {
  synth({ type: 'sine',     freq: 880, attack: 0.005, decay: 0.38, peak: 0.6,  detune: -4 });
  synth({ type: 'sine',     freq: 1100, attack: 0.005, decay: 0.22, peak: 0.18, detune: 5, delay: 0.02 });
}

/** Lock screen enters — low drone descend */
export function lock() {
  synth({ type: 'sine',     freq: 180, freqEnd: 90, attack: 0.12, decay: 1.1, peak: 0.55, detune: -12 });
  synth({ type: 'triangle', freq: 90,  attack: 0.08, decay: 0.9,  peak: 0.2 });
  noise(0.18, 0.03, 0.08);
}

/** Lock screen exits / presence return — quick ascending arpeggio */
export function unlock() {
  synth({ type: 'sine', freq: 330, attack: 0.005, decay: 0.1,  peak: 0.7,  delay: 0     });
  synth({ type: 'sine', freq: 440, attack: 0.005, decay: 0.12, peak: 0.65, delay: 0.07  });
  synth({ type: 'sine', freq: 550, attack: 0.005, decay: 0.18, peak: 0.55, delay: 0.14  });
  noise(0.05, 0.025, 0.14);
}

/**
 * Ambient audio bed: low white-noise texture + occasional soft lo-fi pulses.
 * Placeholder for future asset-backed ambience.
 */
export function startAmbient() {
  if (!isEnabled()) return;
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  if (_ambientNoiseSource) return;

  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  lp.Q.value = 0.8;

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 180;
  hp.Q.value = 0.6;

  const gain = ctx.createGain();
  gain.gain.value = 0.012;

  source.connect(lp);
  lp.connect(hp);
  hp.connect(gain);
  gain.connect(_master);
  source.start();

  _ambientNoiseSource = source;
  _ambientNoiseGain = gain;

  _ambientPulseInterval = window.setInterval(() => {
    if (!isEnabled()) return;
    synth({ type: 'sine', freq: 196, attack: 0.08, decay: 1.6, peak: 0.06, detune: -2 });
    synth({ type: 'triangle', freq: 247, attack: 0.08, decay: 1.3, peak: 0.04, detune: 4, delay: 0.12 });
  }, 18000);
}

export function stopAmbient() {
  if (_ambientPulseInterval) {
    clearInterval(_ambientPulseInterval);
    _ambientPulseInterval = null;
  }
  if (_ambientNoiseSource) {
    try { _ambientNoiseSource.stop(); } catch {}
    _ambientNoiseSource.disconnect();
    _ambientNoiseSource = null;
  }
  if (_ambientNoiseGain) {
    _ambientNoiseGain.disconnect();
    _ambientNoiseGain = null;
  }
}

export { isEnabled, setEnabled, toggle };
