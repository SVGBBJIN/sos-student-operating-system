import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const appPath = path.join(repoRoot, 'src', 'App.jsx');

const content = fs.readFileSync(appPath, 'utf8');

const modulePattern = /\{[\s\S]*?editableId:\s*'([^']+)'[\s\S]*?render:\s*\(\)\s*=>\s*\([\s\S]*?\)\s*\}/g;
const issues = [];

let match;
while ((match = modulePattern.exec(content)) !== null) {
  const moduleBlock = match[0];
  const editableId = match[1];

  const hasRegistration = /editableRegistration:\s*\{[\s\S]*?\}/.test(moduleBlock);
  const hasSchemaPaths = /schemaPaths:\s*\[[\s\S]*?\]/.test(moduleBlock);
  const hasStorage = /storage:\s*\[[\s\S]*?\]/.test(moduleBlock);

  if (!hasRegistration || !hasSchemaPaths || !hasStorage) {
    issues.push(`- ${editableId}: missing editableRegistration metadata (schemaPaths/storage required)`);
  }
}

if (issues.length > 0) {
  console.error('Homepage editability check failed. Add editable registration metadata for new homepage sections:');
  console.error(issues.join('\n'));
  process.exit(1);
}

console.log('Homepage editability check passed.');
