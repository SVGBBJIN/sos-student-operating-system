# SOS Design System — build conventions

SOS is a chat-first AI student planner. Its look is **dark-first, mint-accented**
(spring green `#86efac`), with a warm-serif brand wordmark. Build screens by
composing the real SOS components below; style your own layout glue with the CSS
custom properties and fonts the design system already defines — do not invent a
parallel class vocabulary.

## Two surfaces, one wrapper rule

SOS has two style scopes. Getting the wrapper right is what makes components look
styled instead of unstyled:

- **Studio components** — `StudioDashboard`, `StudioHomeView`, `StudioSidebar`,
  `StudyTopBar`, `Panel`, `AskBar`, `QuickActions`, `UpNext`, `AgendaList`,
  `DueList`, `CourseGrid`, `ReviewDecks`, `StatStrip`, `WelcomeBox`, `AddCard`,
  `DynamicIsland`, `FocusSessionWidget` — their CSS is scoped under `.studio`.
  **Wrap them in an element with `className="studio"`.** That element also carries
  the design tokens, so nest your own markup inside it too. For light mode, put
  `data-theme="light"` on an ancestor.
- **Everything else** — the AI confirmation/plan/content cards
  (`ConfirmationCard`, `BulkConfirmationCard`, `ProposalCard`, `PlanCard`,
  `IntentPlanCard`, `ClarificationCard`, `FlashcardDisplay`, `QuizDisplay`,
  `StudyPackCard`, `ClueCard`, `WorkCheckCard`, …) and the landing screens
  (`AuthScreen`, `Onboarding`, `BrandMark`) — use global classes and need **no
  wrapper**. Put them on a dark surface (`background: #0f1115`).

`StudioSidebar` and `StudyTopBar` call react-router; if you use them, mount your
screen under a react-router `<Router>`.

## Styling idiom: CSS custom properties (no utility classes, no style props)

SOS is **not** a Tailwind/prop-styled system. Components render fixed internal
class names and read design tokens as CSS variables. For your own layout and
accents, use these variables (do not hard-code the hex — use the token so light
mode and theming work):

Colors — `var(--accent)` (mint `#86efac`, the primary accent — buttons, active
states, "next" pills), `var(--accent-strong)`, `var(--success)` (mint),
`var(--danger)` (`#f87171`), `var(--warning)` (`#fbbf24`); surfaces
`var(--bg)` `var(--bg-2)` `var(--bg-3)` `var(--bg-4)`; text `var(--fg-1)`
(primary) `var(--fg-2)` (muted) `var(--fg-3)`; hairlines `var(--line)`
`var(--line-2)`. (Global cards also read `var(--text)` / `var(--text-dim)` /
`var(--blue)` / `var(--orange)` from `:root`.)

Radii — `var(--r-sm)` 6 · `var(--r-md)` 10 · `var(--r-lg)` 14 · `var(--r-xl)` 18 ·
`var(--r-pill)`. Shadows — `var(--shadow-sm|md|lg)`.

Fonts — `var(--font-display)` **Syne** (headings, greetings), `var(--font-body)`
**DM Sans** (body — the default), `var(--font-mono)` **JetBrains Mono** (times,
counts, labels). The brand wordmark uses **Fraunces** 900 italic (via
`<BrandMark />`; the middle "O" is coral `#f4714a`) — reserve Fraunces for the
wordmark.

Mint is the accent everywhere — prefer `var(--accent)` for primary buttons and
active/selected states. Reserve `--danger` for destructive confirmations.

## Where the truth lives

- Bound stylesheet + tokens: read `_ds/<folder>/styles.css` and its `@import`
  closure (the concatenated app CSS + `_ds_bundle.css`; the `.studio` block and
  the `:root` block define every token above).
- Per-component API + usage: each component's `.d.ts` (props) and `.prompt.md`
  (what it's for, how it composes) under `components/<group>/<Name>/`.

## One idiomatic build snippet

```jsx
// A Studio panel with a mint call-to-action, using real SOS components.
<div className="studio" style={{ display: 'block', padding: 'var(--r-lg)', background: 'var(--bg)', color: 'var(--fg-1)' }}>
  <Panel title="Today" icon="calendar" count={4} action="Open">
    <AgendaList />
  </Panel>
  <button className="btn-mint" style={{ marginTop: 12 }}>Start focus</button>
</div>
```

For a card surface, drop the confirmation card straight onto a dark background:

```jsx
<div style={{ background: '#0f1115', padding: 24 }}>
  <ConfirmationCard
    action={{ type: 'add_task', task_name: 'Finish problem set', subject: 'Calculus', due_date: '2026-07-16', estimated_minutes: 45 }}
    onConfirm={() => {}} onCancel={() => {}} />
</div>
```
