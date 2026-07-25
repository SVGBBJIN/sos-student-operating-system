/* ================================================================
   SOS — Service Worker
   Handles scheduled push notifications for tasks, exams, and the
   daily plan reminder. No caching strategy — just notifications.
   ================================================================ */

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

/* ── Notification scheduling ────────────────────────────────── */
// Pending notification timeouts, keyed by an incrementing id → timeout handle.
const pendingTimers = new Map();
let timerCounter = 0;

self.addEventListener('message', e => {
  const { type, notifications } = e.data || {};
  if (type !== 'SCHEDULE_NOTIFICATIONS' || !Array.isArray(notifications)) return;

  // Clear all previous timers. Must clear by the stored timeout HANDLE — the
  // map key is only a counter, so clearing by key cancelled nothing and every
  // reschedule leaked its predecessor into duplicate notifications.
  pendingTimers.forEach(handle => clearTimeout(handle));
  pendingTimers.clear();

  const now = Date.now();
  notifications.forEach(n => {
    const delay = n.fireAt - now;
    if (delay < 0 || delay > 7 * 24 * 60 * 60 * 1000) return; // skip past or >7d out
    const id = ++timerCounter;
    const handle = setTimeout(() => {
      self.registration.showNotification(n.title, {
        body: n.body,
        icon: '/brain-logo.svg',
        badge: '/brain-logo.svg',
        tag: n.tag || 'sos-reminder',
        renotify: false,
        data: { url: '/' },
      }).catch(() => {});
      pendingTimers.delete(id);
    }, delay);
    pendingTimers.set(id, handle);
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    })
  );
});
