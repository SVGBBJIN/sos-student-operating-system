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

## Studio's mint-green theme is a real, separate system — NOT in this design system

The app has a second, wholly separate token system in `src/styles/studio.css`
(scoped under `.studio`, powers flashcard/quiz/outline/summary generation
UI) with its own accent colors — dark mode `--accent: #86efac` (mint green,
genuinely used throughout: buttons, stat highlights, timer ring, badges —
confirmed via `grep -c "var(--accent)" src/styles/studio.css` → 33 live
uses), light mode `--accent: #16a37b`, plus its own light/dark toggle via
`[data-theme="light"] .studio`. This is a real, heavily-used, and
**genuinely different** palette from the main dashboard's cyan-teal accent
(`src/styles/index.css`, what `design-system/src/tokens.css` mirrors).

An earlier pass of this sync conflated the two: it fabricated a "blue means
Studio" narrative on `Card`/`Badge` without checking real Studio markup at
all — blue is real (see below) but has nothing to do with Studio. That was
corrected. **Studio's mint-green/light-mode system is still not represented
in this design system** — incorporating it properly (its own token block,
its own component variants or a parallel theme scope, matching `.studio`'s
actual class names) is real, separate work for an explicit future request,
not something to bolt onto the main accent vocabulary.

## The real per-action-type accent vocabulary (Card / Badge)

`Card`'s `accent` prop and `Badge`'s `tone` prop share one union —
`'accent' | 'teal' | 'blue' | 'orange' | 'success' | 'danger'` — copied
verbatim from `ConfirmationCard`'s `getCardInfo()` switch in
`src/components/ConfirmationCards.jsx` (badgeColor/borderColor per
`action.type`: task→accent, event→teal, block/update_event/convert→blue,
break_task→orange, complete_task→success, delete/clear→danger) and
cross-checked against `ContentCard`'s `accentColor` prop usage in
`ContentDisplayCards.jsx`/`ContentTypeRouter.jsx` (flashcards/summary→accent
default teal, quiz/project-breakdown→orange, outline→blue) — both real,
live call sites agree on the same six colors and no others.

An earlier pass invented `'amber'` and `'violet'` as Card accent options and
`'neutral'`/`'warning'` as Badge tones. None of those correspond to any real
per-type accent anywhere in the app (violet appears exactly once, for an
unrelated Onboarding settings tag; amber/warning don't appear as a *card*
accent at all) — removed.

**Mechanism**: real `ConfirmationCard`/`ContentCard` code computes one `ac`
color per instance and threads it through the border, the header icon's
`color-mix()` tint, the badge, and the primary button's gradient/shadow via
inline styles. This design system reproduces that with a CSS custom
property (`Card` sets `--sos-ds-card-ac` on its own root; `CardHeader`'s
icon and `Button`'s primary variant both read
`var(--sos-ds-card-ac, var(--sos-teal))`) instead of prop-drilling — same
effect (accent flows to every child, teal is the real default
`ac || 'var(--teal)'`), idiomatic CSS instead of copying the inline-style
mechanism literally.

## Fixes made for strict UI fidelity (this pass)

Prompted by a direct request to ground every value in real, currently-live
UI code — not tokens that merely exist, not visually-plausible invention.
Each item below was verified against the real source before changing:

- **Card**: base border/shadow were invented white-ish
  (`rgba(255,255,255,0.06)`) — real `.confirm-card`/`.content-card` use an
  amber tint (`rgba(245,158,11,0.1)` border, `inset rgba(245,158,11,0.06)`
  shadow highlight) and a real hover lift+glow
  (`translateY(-2px)` + `rgba(245,158,11,0.12)` shadow +
  `rgba(245,158,11,0.2)` border) that was missing entirely. Both added,
  verbatim. Same amber tint corrected on `CardHeader`'s border/background
  and `CardActions`' border/background (were white-ish, invented).
- **Button primary / Toast**: real CTA text color is `#fff`, not the
  `#04121a`/`#04120c` dark navy this pass had invented — fixed on both.
  Real `Toast` also has a second glow shadow (`0 0 40px rgba(46,213,115,0.1)`)
  that was missing.
- **Button primary gradient/shadow**: reworked to the real
  `color-mix(in srgb, ${ac} 70%, #000)` / `color-mix(in srgb, ${ac} 25%,
  transparent)` formula from `ContentCard`'s Save button
  (`ContentDisplayCards.jsx`), driven by the inherited `--sos-ds-card-ac`
  (see above) instead of a fixed teal-only gradient.
- **Button secondary**: grounded in `.g-btn` (live, used in
  GoogleImportModal/InviteLinkModal — confirmed via grep, no inline
  override) — including its literal amber hover tint
  (`rgba(245,158,11,0.05)`), previously invented as a cyan tint.
- **Button danger**: grounded in `.g-confirm-btn.danger` (live) — its own
  literal red (`rgba(255,71,87,...)` / `#ff8090` / `#ff4757`), which is
  NOT the same hex as the `--danger` token (`#ff6b81`) — a real,
  pre-existing mismatch in the app itself (see "Known real-app
  inconsistencies" below), replicated as-is since this is what actually
  renders.
- **Button ghost**: already matched `.content-card-dismiss` exactly — no
  change needed.
- **TextField**: was grounded in `.g-input`, which turned out to be **dead
  CSS** — `grep -rn "g-input" src/**/*.jsx` returns nothing; no component
  renders it. Re-grounded in `.confirm-edit-input` (live — used for
  inline-editing fields in `ConfirmationCard`), including its literal
  amber-tinted border/focus-ring (`rgba(245,158,11,0.12)` /
  `rgba(245,158,11,0.1)`) and `rgba(10,10,18,0.8)` background. Label
  restyled to match `.confirm-card-label` (uppercase, 0.75rem, letter-spaced).
- **Badge**: sizing corrected to `.notes-badge`'s real values (`0.65rem`,
  `2px 7px`, `6px` radius, `0.3px` letter-spacing — was `0.68rem`/`2px
  10px`/`8px`/`0.4px`, invented). Tint changed from a fixed-opacity token
  color to `color-mix(var(--sos-X) 12%, transparent)` — the real
  `.notes-badge-*` classes pair each tone's correct foreground token with an
  unrelated hardcoded legacy rgba background (see below); this reproduces
  the real opacity (0.12) and the real per-type color without perpetuating
  that specific mismatch.
- **Chip**: the fabricated `selected` gradient state was removed — grep
  confirms `.sos-chip` has no selected/active variant anywhere, and no JSX
  applies one. Added the real hover shimmer (`::after` sweep) and press
  scale-down (`:active { scale(0.96) }`), both present in `.sos-chip` and
  previously omitted.
- **Banner**: the entire component was fabricated (three tones —
  info/warning/danger — inline layout with a trailing action). No such
  element exists anywhere in the app. The only real "banner" is
  `RateLimitBanner.jsx` (the "Charles is resting" AI-unavailable notice): a
  single fixed dark style, icon + message + optional dismiss (×), no tone
  variants. Rewrote `Banner` to match it exactly instead
  (`rgba(20,20,30,0.97)` bg, `rgba(255,255,255,0.08)` border, `#e2e8f0`
  text, `14px` radius, `0 4px 32px rgba(0,0,0,0.5)` shadow).
- **ConfirmToast**: grounded in `LmsPendingToast`
  (`src/components/Toast.jsx`), which styles itself with
  `var(--bg-secondary,#1e1e2e)` and `var(--text-secondary,#94a3b8)` — two
  custom properties that are **never defined anywhere** in the app (grep
  confirms), so they always render at their literal fallback hex — used
  those literals verbatim (`#1e1e2e` background, `#94a3b8` reject-button
  text). By contrast `var(--border,...)`, `var(--success,...)`, and
  `var(--text,...)` in that same component ARE defined in `:root`, so those
  resolve to the real current tokens, not their fallbacks — used
  `--sos-border`/`--sos-success`/`--sos-text` for those, not the fallback
  literals. Added an optional `footnote` prop (small centered muted text)
  to represent the real "Auto-confirming in {countdown}" line, without
  embedding the actual 5-minute countdown timer/state machine itself (that's
  app business logic, out of scope for a presentational component).
- **Switch "on" state**: the real gradient's second color stop,
  `--accent-highlight`, is not a static value — `AppearanceSettings.jsx`'s
  `applyAccent()` computes it at runtime as the active accent mixed 55%
  toward white, and only ever gets set once a user has opened Settings (it
  has no `:root` definition or CSS fallback). A static stylesheet can't run
  that JS, so this reproduces the formula with `color-mix(in srgb,
  var(--sos-accent) 45%, white)` (55% white ≈ keep 45% original) instead of
  the literal runtime value. An earlier version of this component used a
  fixed `--sos-accent → --sos-teal` gradient — since those two tokens are
  the *same hex* by default, that rendered as a flat, non-gradient fill,
  not a real visual; not a grounding error exactly (nothing was invented),
  just a mistake that happened to look like a no-op.

## Known real-app inconsistencies (replicated, not "fixed")

The real app mixes two eras of its color system in a few specific, still
provably real inconsistencies. This design system replicates their VISIBLE
behavior (since that's what a user actually sees) but does not silently
"clean them up," and doesn't invent replacements for values that are
genuinely dead:

- `.g-confirm-btn.danger` uses its own literal red hex (`#ff8090`/`#ff4757`)
  distinct from the `--danger` token (`#ff6b81`) — both real, just two
  different reds in use for "danger" depending on which button class
  renders it. `Button`'s `danger` variant matches this specific class's
  literal hex, not the `--danger` token.
- Several tint backgrounds (`.g-btn:hover`, `.confirm-btn-yes`'s
  box-shadow default, `.notes-badge-ai`) hardcode an amber/orange rgba
  (`rgba(245,158,11,...)` / `rgba(234,88,12,...)`) that doesn't match
  their own token-based foreground color (cyan `--accent`, teal `--teal`) —
  apparent leftovers from an earlier amber/orange brand before the app's
  current cyan-teal palette. Where the mismatched literal is **live and
  currently rendered** (`.g-btn` hover, `.confirm-edit-input` border/focus,
  card header/action bands, danger button), it was replicated verbatim.
  Where it's **dead** — `.content-card-save`/`.confirm-btn-yes`'s own
  hardcoded `background`/`box-shadow` CSS is always overridden by an inline
  style computed from the card's real per-instance accent
  (`ContentCard`/`ConfirmationCard` always pass `style={{background:...,
  boxShadow:...}}`) — the dead CSS default was NOT replicated; the live
  inline-style behavior (accent-driven `color-mix()`) was, since that's
  what actually renders.
- The app has a **user-customizable runtime accent-color system**
  (`AppearanceSettings.jsx`'s `applyAccent()`, defaulting to Sage
  `#5fa882` from `localStorage.getItem('sos_accent')`) that overwrites
  `--accent`/`--teal`/`--border`/etc. on `documentElement` once the
  Settings panel has ever mounted. This design system's tokens mirror only
  the STATIC `:root` defaults from `index.css` (cyan `#38d8e8`) — it does
  not model the dynamic theming engine. A real user who has customized
  their accent color sees a different hue app-wide than what's synced
  here. Out of scope for this pass; flagging so a future sync doesn't
  mistake the static cyan for the only real value.

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
