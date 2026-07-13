# SOS Design System — sync notes

This repo is a **Vite application**, not a component-library package: no `dist/`,
no `.d.ts` exports, no Storybook. The sync runs the converter in **synth-entry
mode** against a hand-authored entry that re-exports the real, shipped SOS
components from `src/components/`.

## How the build is wired (all in `.design-sync/`)
- **`ds-entry.jsx`** — the `--entry` for the converter. Re-exports the 38 scoped
  components (verbatim, no reimplementation) + `DSRouterProvider` (`MemoryRouter`,
  the preview provider — see below). Add/remove components here **and** in
  `config.json`'s `componentSrcMap` (the component list comes from the map, not
  the entry).
- **`ds-styles.css`** — `cfg.cssEntry`. The app's real stylesheets concatenated
  verbatim (`index.css` + `lofi-layout.css` + `studio.css` +
  `CalendarWindow.css`) with remote `@import url(...)` font lines stripped, plus a
  `:root` block that maps the **mint** Studio accent (`#86efac` / light `#16a37b`)
  onto the global `--accent*`/`--teal`/`--success` names so the older `.sos-app`
  cards render mint too. Regenerate with `node .design-sync/gen-styles.mjs`.
- **`fonts/`** — brand webfonts (Fraunces, Syne, DM Sans, DM Mono, JetBrains Mono,
  Archivo Black, Inter, Gochi Hand, Noto Sans JP) vendored as woff2 + `fonts.css`
  (`cfg.extraFonts`) so they ship self-contained (claude.ai/design CSP blocks
  remote font hosts). Regenerate with `node .design-sync/fetch-fonts.mjs` (fetches
  Google Fonts latin subset via curl/proxy).
- **`docs/<Name>.md`** — `cfg.docsDir`. Frontmatter `category` sets the DS-pane
  group (Brand / Landing / Confirmations / Plans / Content / Studio / Widgets);
  body is the component's `.prompt.md`. Regenerate with
  `node .design-sync/gen-docs.mjs`.
- **`previews/<Name>.tsx`** — authored preview cards (37 of 38; PlanTemplateSelector
  is a floor card — see bug below).

## Scoping conventions (important — designs must follow these)
- **Studio-family components** (StudioDashboard, StudioHomeView, StudioSidebar,
  StudyTopBar, Panel, AskBar, QuickActions, UpNext, AgendaList, DueList,
  CourseGrid, ReviewDecks, StatStrip, WelcomeBox, AddCard, DynamicIsland,
  FocusSessionWidget) render bare classes (`.panel`, `.stat-strip`, `.di`, …)
  that are **scoped under `.studio`** in `studio.css`. Their previews wrap them
  in `<div className="studio">`. When the wrapped element is a single component
  (not the full grid), add `display:block` to the wrapper — the raw `.studio`
  grid (`grid-template-rows:48px 1fr`) otherwise drops a lone child into the 48px
  row and clips it (this bit StudioDashboard).
- **Global cards** (confirmation, content, plan, auth, proposal, schedule) use
  top-level classes in `index.css`/`lofi-layout.css` and need no wrapper; they
  pick up mint from the `:root` override.

## Data-shape gotchas (for authoring previews)
- `ConfirmationCard` — `action={type, …type-specific fields}`; colour/icon keyed
  off `action.type`.
- `StudyPackCard.data.summary` must be an **array** (it `.map`s it), not a string.
- `ScheduleWidget` — events need `time`/`end_time` in **24h `HH:MM`** and
  `date === today`; it's an absolutely-positioned timeline that auto-scrolls to
  "now", so wrap it in a `position:relative` fixed-height parent (its CSS is
  `position:absolute; max-height: calc(100% - 220px)`). Blocks are
  `{recurring:[{days:[dow…], start, end, name, category}]}`.
- `StudioDashboard` — pass real `tasks`+`events` (else it shows the empty-state
  WelcomeBox). Events use `{date, time, end_time}`, tasks `{task_name, due_date,
  status}`.
- Several Studio panels (AgendaList, DueList, CourseGrid, ReviewDecks, StatStrip)
  ship **built-in demo data** as defaults — previews can render them prop-less.

## Preview provider
`cfg.provider = {component: "DSRouterProvider"}` wraps every preview in
`MemoryRouter` (re-exported from the entry) — StudioSidebar/StudyTopBar call
`useNavigate()`, which needs a Router from the **same** react-router instance the
components bundle against. A design that uses those components must likewise sit
under a react-router `<Router>`.

## Known findings / warnings
- **SOURCE BUG — FIXED:** `PlanTemplateSelector` used to crash on render because
  its `exam_prep` template references `iconFn: Icon.target` and `Icon.target` did
  not exist in `src/lib/icons.jsx` (→ `tmpl.iconFn is not a function`). Fixed by
  adding a Lucide-style `target:` icon (three concentric circles) to
  `src/lib/icons.jsx`. PlanTemplateSelector now renders fully (authored preview,
  no longer a floor card).
- `[FONT_MISSING] "Arial Black", "Impact"` — these are **system fallback fonts**
  in font stacks, not brand fonts. Intentionally not bundled. Safe to ignore.

## Re-sync risks (what can silently go stale)
- **`ds-styles.css` and `docs/` are generated but committed.** If the app's real
  stylesheets or component set change, re-run `gen-styles.mjs` / `gen-docs.mjs`
  (and re-check `componentSrcMap` + `ds-entry.jsx`). They do not auto-track source.
- **Fonts are vendored copies.** Re-run `fetch-fonts.mjs` if the app changes its
  font families/weights (compare against `index.html`).
- **The mint `:root` override is a deliberate unification**, not present in the
  running app (which keeps `.sos-app` teal + `.studio` mint separate). Keep it if
  the DS should stay mint-accented; drop the appended `:root` block in
  `gen-styles.mjs` to revert to the app's per-surface accents.
- Preview data shapes were reverse-engineered from component source (no types).
  If a component's props change, its preview may silently render the empty state —
  re-check against source.
