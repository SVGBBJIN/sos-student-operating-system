import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { startPerfAdjuster } from './lib/perfAdjuster';

try {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
  startPerfAdjuster();
} catch (e) {
  document.getElementById('root').innerHTML =
    '<div style="padding:40px;text-align:center;color:#ff4757;font-family:sans-serif"><h2>Failed to load SOS</h2><p>' +
    e.message +
    '</p></div>';
}
