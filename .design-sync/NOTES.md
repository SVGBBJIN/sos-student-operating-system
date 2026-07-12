# design-sync notes

## Repo shape

`sos-student-operating-system` is the SOS application itself (a ~7800-line
monolithic `src/App.jsx`), not a standalone design-system package — no
Storybook, no isolable component library, no `dist/` build.

Per user request, `design-system/` at the repo root is a **new, hand-authored
package** that extracts SOS's visual language (dark-theme tokens from
`src/styles/index.css` `:root`, the Syne/DM Sans/JetBrains Mono type stack,
card/chip/button visual patterns) into a small set of clean, standalone,
presentational components with real TypeScript prop APIs — not a literal
lift of `src/components/*.jsx` (those are deeply coupled to app state:
`pending`, `executeAction`, Supabase data, etc. and can't render standalone).

This is a genuinely smaller design system than the full app UI — 17 exports
across Button, Badge/Chip, Card (+Header/Body/Actions), Toast/ConfirmToast,
Switch, BrandMark, ProgressBar, TextField, Banner, and chat bubbles
(UserBubble/AiBubble/HistorySeparator). It can grow on future re-syncs by
adding components to `design-system/src/components/` and re-exporting them
from `design-system/src/index.ts`.

## Build

`design-system/` is a separate `npm` package (its own `package.json`,
gitignored `node_modules`) built with `tsup` → `dist/index.js` +
`dist/index.d.ts`. `scripts/bundle-css.mjs` (run by `npm run build` after
tsup) concatenates `src/tokens.css` + `src/styles.css` into a single
self-contained `dist/styles.css` — there is deliberately no separate
`dist/tokens.css` / `cfg.tokensGlob`; `cfg.cssEntry` points straight at the
merged file so the DS's `@import` closure never depends on cross-file
resolution. Run `(cd design-system && npm install && npm run build)` before
re-syncing if the design-system source changed.

## Dark-theme-only design system

SOS has no light theme. `design-system/src/styles.css` sets
`html, body { background: var(--sos-bg) !important; color: var(--sos-text); }`
— the `!important` is required because this DS's own generated preview
harness (`.ds-sync/lib/emit.mjs`, not editable by this repo) hardcodes an
inline `body{background:#fff}` that loads after this stylesheet and would
otherwise win the cascade by source order, silently putting every component
back on an unreadable white canvas (confirmed by screenshot during the
initial sync — badges/ghost buttons/dim text were invisible on white before
this fix). Any design built with this DS should be composed on a dark
surface; don't fight individual components' text/border colors.

## Known render warns

- `components/general/Card/Card.html` — `package-validate.mjs` flags a
  `[RENDER_ERRORS]` caught in-cell error whose message is just the cell's
  own rendered text concatenated together (not a real exception message).
  The card renders correctly in every capture (see
  `_screenshots/review/raw/general__Card__ConfirmationCard.png` — clean).
  Triaged as a harness quirk, not a component bug. If a future re-sync sees
  a *new* `[RENDER_ERRORS]` on a different component, treat it as new and
  investigate — only this specific benign one is expected.

## Re-sync risks

- The component set is curated, not exhaustive — most of `src/components/`
  (StudioDashboard, CalendarWindow, GroupsPanel, etc.) is app-specific and
  intentionally NOT in this design system.
- Token values are copied from `src/styles/index.css` `:root` at sync time
  (renamed with a `--sos-` prefix to avoid collision) — if the app's palette
  changes, `design-system/src/tokens.css` needs a manual re-sync, it will
  not drift automatically.
- Fonts (Syne/DM Sans/JetBrains Mono) are loaded via a remote Google Fonts
  `@import` in `tokens.css` (`[FONT_REMOTE]`, non-blocking) — not shipped as
  local `@font-face` files. If Claude Design's environment can't reach
  Google Fonts, these render in a fallback font.
