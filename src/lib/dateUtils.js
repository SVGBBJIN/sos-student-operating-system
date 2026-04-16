/* ─── Shared date / time helpers ─────────────────────────────────── */

export function fmt(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtFull(d) {
  return new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function toDateStr(d) {
  const dt = new Date(d);
  return (
    dt.getFullYear() +
    '-' + String(dt.getMonth() + 1).padStart(2, '0') +
    '-' + String(dt.getDate()).padStart(2, '0')
  );
}

export function today() {
  return toDateStr(new Date());
}

export function daysUntil(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - now) / 86400000);
}

export function fmtTime(h, m) {
  const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return hr + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}
