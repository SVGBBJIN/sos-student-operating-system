import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';

try {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
} catch (e) {
  document.getElementById('root').innerHTML =
    '<div style="padding:40px;text-align:center;color:#ff4757;font-family:sans-serif"><h2>Failed to load SOS</h2><p>' +
    e.message +
    '</p></div>';
}
