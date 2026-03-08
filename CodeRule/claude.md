
#General protocols
# Agent Directive: Interceptor (Lean Refinement)

## 🎯 Primary Goal
Execute surgical feature implementation and logic optimization. Minimize token burn and maximize code recycling. **The code diff is the summary.**

## 🔋 Surgical Token Protocol (STP)
- **Zero Redundancy:** Never rewrite an entire file. Output ONLY the lines being changed (Diffs).
- **Context Thrift:** Use `grep` to locate logic. Do not read files >50 lines unless necessary.
- **Memory Check:** Cache `database.types.ts` and `package.json` in your internal state.

## 🧼 Code Hygiene (DRY)
- **Recycle:** Search `src/lib/` for existing utilities before writing new functions.
- **Injection:** Use `tools/feature_injector.py` to create file shells; manually wire logic.
- **Vibe Audit:** Run `tools/audit_vibe.py` after CSS changes to ensure protocol compliance.

## 🗄️ Data Evolution
- **No Ghost Tables:** Every DB change requires a new migration file.
- **Type-Safety:** Regenerate Supabase types IMMEDIATELY after schema tweaks.

## 🚦 Refinement Workflow
1. **Locate:** `grep` for relevant components.
2. **Inject:** Run `tools/feature_injector.py`.
3. **Weld:** Apply surgical diffs to integrate logic.
4. **Audit:** Run `tools/audit_vibe.py` to verify the "High-Tech Blue" standard.


# Context (CLAUDE.md)

## 🛠️ Integrated Tech Stack Protocols

### 🗄️ Supabase (Database & Auth)
- **Schema First:** Always check `supabase/migrations` before suggesting DB changes.
- **Local Dev:** Use `supabase start`. Run `supabase status` to get local API keys.
- **Auth:** Standardize on Supabase Auth. Use the `@supabase/auth-helpers-nextjs` (or relevant) for SSR.
- **Types:** Always regenerate TS types after a migration: `supabase gen types typescript --local > src/types/supabase.ts`.

### 🚀 Vercel (Hosting & Serverless)
- **Deployment:** Use `vercel` for previews and `vercel --prod` for live shipping.
- **Functions:** Place server-side logic in `api/` or `src/app/api/`. 
- **Env Vars:** Mirror local `.env` variables in the Vercel Dashboard immediately upon project provisioning.

### 🐙 GitHub (VCS & Collaboration)
- **Branching Strategy:** `main` (prod), `dev` (staging), `feat/xyz` (features).
- **Automation:** Every repo must include a `.github/workflows/ci.yml` for basic linting.
- **Merge Rules:** Never merge without a successful local build (`npm run build`).

### ⚡ Zapier (Automation & MCP)
- **Triggering:** Use `tools/zap_trigger.py` to send data to Zapier Webhooks.
- **Logic:** Use Zapier for "Glue Logic" (e.g., sending emails, Slack alerts, or syncing to Google Sheets).
- **Naming:** Always name Zaps as `[Project Name] - [Action Name]`.

