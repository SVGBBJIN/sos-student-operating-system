import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tokens = readFileSync(join(root, 'src/tokens.css'), 'utf8');
const styles = readFileSync(join(root, 'src/styles.css'), 'utf8').replace(
  /^@import '\.\/tokens\.css';\s*\n/,
  ''
);

writeFileSync(join(root, 'dist/styles.css'), `${tokens}\n${styles}`);
