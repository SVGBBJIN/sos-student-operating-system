// Generate .design-sync/ds-styles.css (cfg.cssEntry) — the app's real
// stylesheets concatenated verbatim, with remote @import url(...) font lines
// stripped (fonts ship via .design-sync/fonts, wired through cfg.extraFonts),
// plus a :root block mapping the mint Studio accent onto the global token names
// so the older .sos-app cards render mint too.
// Run: node .design-sync/gen-styles.mjs   (see NOTES.md)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SRC = [
  'src/styles/index.css',
  'src/styles/lofi-layout.css',
  'src/styles/studio.css',
  'src/components/CalendarWindow/CalendarWindow.css',
];

let out = `/* SOS Design System — combined stylesheet.
   Concatenated verbatim from the app's real stylesheets:
     ${SRC.join(', ')}
   plus a :root mint-accent unification (values taken from studio.css).
   Regenerate with: node .design-sync/gen-styles.mjs   (see NOTES.md) */\n\n`;

for (const rel of SRC) {
  const css = readFileSync(resolve(ROOT, rel), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*@import\s+url\(/.test(l)) // drop remote font @imports
    .join('\n');
  out += `/* ===== ${rel} ===== */\n${css}\n\n`;
}

out += `/* ===== SOS DS — mint-accent unification =====
   The Studio surface (studio.css) is the canonical mint-green accent.
   Map it onto the global :root token names so every component — including
   the older .sos-app cards that read var(--accent) — renders mint.
   All values are taken verbatim from studio.css / index.css. */
:root{
  --accent:#86efac;
  --accent-dim:rgba(134,239,172,.36);
  --accent-glow:rgba(134,239,172,.2);
  --teal:#86efac;
  --success:#35d29a;
  --green:#35d29a;
}
`;

writeFileSync(resolve(ROOT, '.design-sync/ds-styles.css'), out);
console.log('wrote .design-sync/ds-styles.css');
