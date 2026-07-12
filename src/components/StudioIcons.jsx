import React from 'react';

export function StudioIcon({ name, size = 16, strokeWidth = 1.75 }) {
  const paths = {
    plus:    <><path d="M12 5v14M5 12h14"/></>,
    arrowUp: <><path d="M12 19V5M6 11l6-6 6 6"/></>,
    arrowRight: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    mic:     <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    sun:     <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon:    <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
    more:    <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    paperclip: <><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-2.8-2.8L14 8"/></>,
    home:    <><path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/></>,
    calendar:<><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></>,
    book:    <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></>,
    cards:   <><rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-2"/></>,
    edit:    <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
    sparkles:<><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/></>,
    clock:   <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    flame:   <><path d="M12 3c1 3-1.5 4.5-1.5 7A3.5 3.5 0 0 0 14 13c0-1.2-.5-2-.5-2s3 1.6 3 5a4.5 4.5 0 1 1-9 0c0-3.6 4-5.2 4.5-13z"/></>,
    bell:    <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></>,
    search:  <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
    chevronRight: <><path d="M9 6l6 6-6 6"/></>,
    target:  <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></>,
    check:   <><path d="M5 12.5l4.5 4.5L19 7"/></>,
    play:    <><path d="M7 5l12 7-12 7z"/></>,
    pause:   <><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></>,
    zap:     <><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></>,
    upload:  <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></>,
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}
         fill="none" stroke="currentColor" strokeWidth={strokeWidth}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default StudioIcon;
