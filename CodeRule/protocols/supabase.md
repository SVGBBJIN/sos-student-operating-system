## 🗄️ Refinement Protocol: Data Evolution
- **Migration Shield:** Every new feature that touches the DB must have a corresponding `.sql` migration file in `supabase/migrations/`.
- **RLS Audit:** If a feature adds a "Share" or "Public" view, explicitly verify the Row Level Security (RLS) policy in the response.
- **Type Generation:** After any schema tweak, the AI MUST run the type-gen command immediately to prevent TypeScript "Any" leaks.
- **Edge Functions:** Prefer Supabase Edge Functions for logic that involves Zapier webhooks to keep the frontend lean.