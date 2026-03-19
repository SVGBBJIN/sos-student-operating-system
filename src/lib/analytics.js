import { sb } from './supabase';

/*
 * Minimal self-hosted analytics — P4.2
 *
 * Required Supabase table:
 *   CREATE TABLE analytics_events (
 *     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     user_id uuid REFERENCES auth.users(id),
 *     event_type text NOT NULL,
 *     metadata jsonb DEFAULT '{}',
 *     created_at timestamptz DEFAULT now()
 *   );
 *   CREATE INDEX idx_analytics_user ON analytics_events(user_id);
 *   CREATE INDEX idx_analytics_type ON analytics_events(event_type);
 */

export async function trackEvent(userId, eventType, metadata = {}) {
  if (!userId) return;
  try {
    await sb.from('analytics_events').insert({
      user_id: userId,
      event_type: eventType,
      metadata,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    // Analytics should never block the user experience
    console.warn('Analytics tracking failed:', e);
  }
}


export async function trackTutorEvent(userId, eventType, metadata = {}) {
  return trackEvent(userId, `tutor_${eventType}`, metadata);
}
