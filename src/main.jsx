import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import './styles/neon-lofi.css';   // override layer — cascades on top of index.css
import './styles/lofi-layout.css'; // lofi 3-column grid layout
import SkyBackground from './components/SkyBackground';
import { PresenceProvider } from './context/PresenceContext';
import { startPerfAdjuster } from './lib/perfAdjuster';

// Register service worker for push notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

try {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <>
      <SkyBackground />
      <PresenceProvider>
        <App />
      </PresenceProvider>
    </>
  );
  startPerfAdjuster();
} catch (e) {
  document.getElementById('root').innerHTML =
    '<div style="padding:40px;text-align:center;color:#00E5CC;font-family:\'DM Sans\',sans-serif;background:#080a12;height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column"><h2 style="margin-bottom:12px">Failed to load SOS</h2><p style="opacity:0.6">' +
    e.message +
    '</p></div>';
}
