shipyard/
├── protocols/              <-- The "Laws" (Fills prompting gaps)
│   ├── ui_standards.md     
│   ├── code_hygiene.md     
│   └── architecture.md     
├── blueprints/             <-- Feature templates (Pre-configured sets)
│   ├── auth_flow.md
│   └── landing_hero.md
├── workflows/              <-- The "Assembly Lines"
│   └── launch_project.md   
└── tools/                  <-- The "Machinery"
    └── provisioner.py


# Shipyard Master Context (CLAUDE.md)

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