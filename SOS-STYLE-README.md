# SOS Style Overhaul — Implementation Guide

## What's in this package

| File | Purpose |
|---|---|
| `sos-style-overhaul.css` | Full CSS replacement for the current `index-Bzf13lkn.css` |
| `sos-perf-detection.js` | Performance detection + manual toggle utilities |

---

## Design Direction: "Notebook OS"

The new aesthetic is **graph-paper notebook meets digital workspace** — a total departure from generic dark-purple sci-fi.

| Before | After |
|---|---|
| `Inter` (generic) | `Fraunces` (display) + `DM Mono` (UI) + `DM Sans` (body) |
| Purple gradient glow everything | Warm cream/ink palette with highlighter accents |
| Backdrop-filter heavy | Flat borders + offset ink-shadows (notebook stamp) |
| Glassmorphism cards | Ruled-paper cards with thick 2px borders |
| Sci-fi sidebar | Notebook margin line (subtle red rule) + yellow active highlight |

### Color palette

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--paper` | `#f5f2eb` | `#171510` | Main background |
| `--ink` | `#1a1814` | `#f0ece2` | Primary text |
| `--hi-yellow` | `#f7d84a` | `#f5d340` | Primary accent, active states |
| `--hi-coral` | `#f4714a` | `#f26a48` | Danger, overdue |
| `--hi-mint` | `#4abf9f` | `#42b894` | Success, flashcard back |
| `--hi-blue` | `#4a8ef4` | `#5a9bf5` | Info, calendar events |
| `--hi-purple` | `#9b7fe8` | `#a888ee` | AI responses |

---

## Step 1 — Update `index.html`

Replace the Google Fonts link and add the performance detection script:

```html
<head>
  <!-- Remove the old Inter font link -->
  <!-- ADD: Notebook OS fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,400&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;0,9..144,900;1,9..144,400;1,9..144,600&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
  
  <!-- ADD: Performance detection — must run before everything else -->
  <script>
    (function detectPerf() {
      var slow = false;
      if (/CrOS/.test(navigator.userAgent)) slow = true;
      if (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 2) slow = true;
      if (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 2) slow = true;
      var stored = localStorage.getItem('sos-perf');
      if (stored === 'low') slow = true;
      if (stored === 'full') slow = false;
      if (slow) document.documentElement.setAttribute('data-perf', 'low');
    })();
  </script>

  <!-- ADD: favicon -->
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="SOS — your AI-powered student operating system for notes, flashcards, calendar, and homework help.">
</head>
```

---

## Step 2 — Replace the CSS

In your Vite project, replace the contents of your main CSS file (likely `src/index.css` or `src/App.css`) with the contents of `sos-style-overhaul.css`.

If you use a separate CSS file for the app styles, drop this CSS there. The Vite build will bundle it.

---

## Step 3 — Call `initPerfMode()` in `main.jsx`

```jsx
// main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initPerfMode } from './sos-perf-detection';

initPerfMode(); // shows ⚡ lite mode badge if on slow device

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

## Step 4 — Add a toggle in Settings

```jsx
// In your Settings component
import { getPerfMode, setPerfMode } from '../sos-perf-detection';
import { useState } from 'react';

function PerfToggle() {
  const [isLow, setIsLow] = useState(getPerfMode());

  const toggle = () => {
    const next = !isLow;
    setPerfMode(next);
    setIsLow(next);
  };

  return (
    <div className="settings-row">
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Performance mode</div>
        <div className="mono-label" style={{ marginTop: 2 }}>
          {isLow ? '⚡ Lite mode active — animations off' : '✨ Full quality mode'}
        </div>
      </div>
      <button className="settings-toggle" onClick={toggle}>
        {isLow ? 'Enable full quality' : 'Switch to lite mode'}
      </button>
    </div>
  );
}
```

---

## Step 5 — Dark mode

The CSS uses `[data-theme="dark"]` on the `<html>` or `<body>` element. Add a toggle that sets this attribute:

```jsx
// Simple dark mode toggle
const toggleDark = () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('sos-theme', isDark ? 'light' : 'dark');
};

// On load, restore preference:
const stored = localStorage.getItem('sos-theme');
if (stored) document.documentElement.setAttribute('data-theme', stored);
else if (window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', 'dark');
```

---

## Performance mode: what it strips

| Effect | Full quality | Lite mode |
|---|---|---|
| Graph paper grid | ✅ CSS background-image | ❌ Removed (causes scroll repaint) |
| Keyframe animations | ✅ fadeUp, scaleIn, etc. | ❌ All disabled |
| Flashcard 3D flip | ✅ CSS preserve-3d | ❌ Instant show/hide |
| Backdrop-filter blur | ✅ On overlays | ❌ Replaced with opaque bg |
| Ruled lines in bubbles | ✅ Repeating gradient | ❌ Removed |
| Box shadows | ✅ Layered shadows | ❌ Borders only |
| Transition duration | ✅ 120–400ms | ❌ Max 80ms, simple props only |
| Voice ring animation | ✅ 4 rings | ❌ Hidden, just the mic button |

What's **kept** in lite mode: all color, typography, layout, borders, spacing — the app looks designed, just static.

---

## Key CSS classes to use in new components

```css
.fade-up        /* entry animation */
.mono-label     /* small uppercase monospace label */
.hi-mark        /* yellow highlighter text treatment */
.stamp-badge    /* bordered badge with offset shadow */
.loading-dots   /* animated loading indicator */
.cursor-blink   /* blinking text cursor */
.perf-badge     /* ⚡ lite mode indicator (auto-injected) */
```
