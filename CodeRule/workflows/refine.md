# Workflow: Lean Feature Rollout

## 1. Discovery
- AI must use `grep` to find existing components similar to the new feature.
- AI identifies where the new logic fits into `src/lib`.

## 2. Surgical Injection
- Run `tools/feature_injector.py` to create the file shells.
- Apply logic using **Diffs Only** to the existing `main.js` or `App.js`.

## 3. Validation
- Run `tools/audit_vibe.py` to ensure CSS consistency.
- Manually check `CLAUDE.md` to see if Supabase types need regeneration.