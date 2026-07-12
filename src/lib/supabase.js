import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://evqylqgkzlbbrvogxsjn.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2cXlscWdremxiYnJ2b2d4c2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NTUsImV4cCI6MjA4Njg1MDU1NX0.NDpkE7367X5b3fhBpY268qJR6q8q2xQYs5tKL8RyIDQ';
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Edge Function URL — uses Vercel API route when deployed on Vercel, otherwise Supabase Edge Function */
export const EDGE_FN_URL = window.location.hostname.includes('vercel.app')
  ? '/api/chat'
  : SUPABASE_URL + '/functions/v1/sos-chat';

export const IMPORT_URL_ENDPOINT = window.location.hostname.includes('vercel.app')
  ? '/api/import-url'
  : SUPABASE_URL + '/functions/v1/sos-import-url';

export const GROUP_INVITE_REDEEM_ENDPOINT = window.location.hostname.includes('vercel.app')
  ? '/api/group-invite-redeem'
  : SUPABASE_URL + '/functions/v1/sos-group-invite-redeem';

export const CHAT_MAX_MESSAGES = 60;

/* Fire-and-forget sync of saved work (notes, flashcard decks, study plans)
   into the RAG index so it becomes retrievable via semantic search. Never
   blocks or throws into the caller — a failed embed is not worth surfacing
   as a user-facing error, the save itself already succeeded. */
export async function queueEmbedSync(items, token) {
  if (!token || !Array.isArray(items) || items.length === 0) return;
  const cleaned = items
    .filter(it => it && it.source_id && typeof it.text === 'string' && it.text.trim())
    .map(it => ({ source: it.source, source_id: it.source_id, text: it.text.slice(0, 8000), metadata: it.metadata || {}, chunk_idx: 0 }));
  if (cleaned.length === 0) return;
  try {
    await fetch(SUPABASE_URL + '/functions/v1/embed-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ items: cleaned }),
    });
  } catch (_) { /* best-effort — search just won't find this item yet */ }
}
