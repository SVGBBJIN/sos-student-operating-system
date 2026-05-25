// Packages extension/ into public/sos-extension.zip so the SOS web app can
// serve it as a static download from the LMS setup wizard. The zip contains a
// top-level sos-extension/ folder that the user can point Chrome's "Load
// unpacked" at directly after unzipping.

import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, statSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'extension');
const outDir = resolve(root, 'public');
const out = resolve(outDir, 'sos-extension.zip');

if (!existsSync(src)) {
  console.error('extension/ folder not found at', src);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
if (existsSync(out)) rmSync(out);

const stage = resolve(tmpdir(), `sos-extension-build-${Date.now()}`);
const staged = resolve(stage, 'sos-extension');
mkdirSync(stage, { recursive: true });
cpSync(src, staged, {
  recursive: true,
  filter: (s) => !s.endsWith('.DS_Store'),
});

try {
  execSync(`zip -rqX "${out}" sos-extension`, { cwd: stage, stdio: 'inherit' });
} finally {
  rmSync(stage, { recursive: true, force: true });
}

const size = statSync(out).size;
console.log(`built ${out} (${(size / 1024).toFixed(1)} KB)`);
