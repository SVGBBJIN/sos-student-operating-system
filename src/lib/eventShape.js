// Shared event shape helpers. Used by App.jsx, CalendarPage.jsx, and anywhere
// that converts between Supabase rows and the app's in-memory event shape.

/** Supabase row → app event shape */
export function dbEventToApp(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.event_type || 'other',
    subject: row.subject || '',
    date: row.event_date || '',
    // time persisted once column migration lands; safe fallback to null
    time: row.start_time ? row.start_time.slice(0, 5) : (row.time || null),
    end_time: row.end_time ? row.end_time.slice(0, 5) : null,
    description: row.description || '',
    location: row.location || '',
    priority: row.priority || 'medium',
    recurring: row.recurring || 'none',
    createdAt: row.created_at,
    googleId: row.google_id || null,
    source: row.source || 'manual',
  };
}

/** App event shape → Supabase row */
export function appEventToDb(e, userId) {
  return {
    id: e.id,
    user_id: userId,
    title: e.title,
    event_type: e.type || 'other',
    subject: e.subject || '',
    event_date: e.date,
    recurring: e.recurring || 'none',
    created_at: e.createdAt || new Date().toISOString(),
    google_id: e.googleId || null,
    source: e.source || 'manual',
  };
}
