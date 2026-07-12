## SOS Design System — build conventions

SOS is a **dark-theme-only** student planner UI. There is no light mode — every design
built with this system should be composed on the dark surface below, not a white canvas.

### Wrapping and setup

No provider/context wrapper is required — these are plain, self-contained React
components (no theme provider, no router, no i18n context). What IS required:
render on a dark background. `styles.css` sets
`html, body { background: var(--sos-bg) !important; color: var(--sos-text); }`,
so a page that simply includes `styles.css` already gets the right canvas. If you
build your own root container instead of relying on `body`, give it
`background: var(--sos-bg)` explicitly — components' text and "ghost"/"secondary"
surfaces are tuned for this background and read as invisible or washed-out on white.

### Styling idiom: CSS custom properties (tokens), not utility classes

This system has no Tailwind-style utility classes. Every component consumes a fixed
set of CSS custom properties defined at the top of `styles.css`. When you need styling for your
own layout glue (spacing between components, page containers), reach for these same
variables rather than inventing new colors:

| Purpose | Token |
|---|---|
| Page/card background | `--sos-bg`, `--sos-bg-2`, `--sos-card` |
| Body text | `--sos-text` (primary), `--sos-text-dim` (secondary/meta) |
| Borders | `--sos-border`, `--sos-border-mid` |
| Brand accent | `--sos-accent` (cyan), `--sos-teal` (same hex by default) |
| Corner radius | `--sos-radius-sm` (10px, inputs/badges), `--sos-radius` (16px, cards), `--sos-radius-lg` (20px) |
| Spacing scale | `--sos-space-xs` (4px) → `--sos-space-4xl` (48px) |
| Fonts | `--sos-font-display` (Syne, headings/brand), `--sos-font-body` (DM Sans, everything else), `--sos-font-mono` (JetBrains Mono, timestamps/counters) |

Never hardcode a hex color for something these tokens already cover — the tokens
are what keeps a generated design visually identical to the real SOS app. (A few
tokens — `--sos-warning`, `--sos-green`, `--sos-pink`, `--sos-violet` — are defined
for parity with the app's root stylesheet but aren't wired into any component's
styling; don't reach for them expecting a matching visual.)

### Card and Badge accent = the action's type, not decoration

`Card`'s `accent` prop and `Badge`'s `tone` prop share one vocabulary —
`accent | teal | blue | orange | success | danger` — and it's driven by *what kind
of thing the card represents*, mirroring the real app's action-confirmation cards
one-to-one:

| Accent | Real meaning |
|---|---|
| `accent` (cyan) | generic task / default action |
| `teal` | calendar event |
| `blue` | schedule block / update / convert |
| `orange` | breaking a task into parts |
| `success` | completing something |
| `danger` | deleting / destructive |

Pick the accent that matches the action being confirmed or the content being
generated — don't pick for visual variety. `Card` sets the chosen accent on itself
as a CSS custom property that `CardHeader`'s icon badge and a `Button
variant="primary"` inside `CardActions` both automatically pick up — you only set
`accent` once, on the `Card`.

### Where the truth lives

Read `styles.css` (bound alongside this README) for the full token list and every
component's CSS class before styling anything by hand — component classes are
prefixed `sos-ds-*`. Each component also has its own `.prompt.md` under
`components/<group>/<Name>/` with its prop table and usage examples ported from
this file's authored previews.

### One idiomatic build snippet

A typical AI-chat-turn composition — a response bubble containing an action card,
built entirely from this system's own components:

```tsx
<AiBubble text="I found a conflict — want me to move the Chemistry block?" time="4:14 PM">
  <Card accent="teal">
    <CardHeader icon={<CalendarIcon />} title="Move event" subtitle="Chemistry review · Thu 7–8:30 PM" />
    <CardBody>Conflicts with Swim practice. Move to 8:30–10 PM instead?</CardBody>
    <CardActions>
      <Button size="sm">Move it</Button>
      <Button size="sm" variant="ghost">Leave as-is</Button>
    </CardActions>
  </Card>
</AiBubble>
```
