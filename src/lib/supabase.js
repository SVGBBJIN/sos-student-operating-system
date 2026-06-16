import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://evqylqgkzlbbrvogxsjn.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2cXlscWdremxiYnJ2b2d4c2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NTUsImV4cCI6MjA4Njg1MDU1NX0.NDpkE7367X5b3fhBpY268qJR6q8q2xQYs5tKL8RyIDQ';
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Edge Function URL — uses Vercel API route when deployed on Vercel, otherwise Supabase Edge Function */
export const EDGE_FN_URL = window.location.hostname.includes('vercel.app')
  ? '/api/chat'
  : SUPABASE_URL + '/functions/v1/sos-chat';

export const CHAT_MAX_MESSAGES = 60;
