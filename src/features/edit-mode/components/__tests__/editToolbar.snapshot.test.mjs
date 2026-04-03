import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ACTION_ORDER, resolveToolbarActionView } from '../editToolbarConfig.js';

function renderToolbarSnapshot(enabledActions, { visible } = { visible: false }) {
  const resolved = DEFAULT_ACTION_ORDER
    .filter((action) => enabledActions.includes(action))
    .map((action) => resolveToolbarActionView(action, visible))
    .filter(Boolean)
    .map((entry) => `${entry.action}:${entry.icon}:${entry.label}`);

  return `toolbar|${resolved.join('|')}`;
}

test('legacy and new blocks keep identical edit-toolbar rendering in edit mode', () => {
  const legacyBlockSnapshot = renderToolbarSnapshot(
    ['edit', 'drag-handle', 'duplicate', 'delete', 'visibility'],
    { visible: true }
  );

  const newRichTextBlockSnapshot = renderToolbarSnapshot(
    ['edit', 'drag-handle', 'duplicate', 'delete', 'visibility'],
    { visible: true }
  );

  assert.equal(newRichTextBlockSnapshot, legacyBlockSnapshot);
  assert.equal(
    newRichTextBlockSnapshot,
    'toolbar|edit:edit:Edit|drag-handle:gripVertical:Drag|duplicate:copy:Duplicate|delete:trash:Delete|visibility:eyeOff:Hide'
  );
});
