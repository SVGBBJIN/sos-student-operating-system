import test from 'node:test';
import assert from 'node:assert/strict';
import { getEditableSurfaceMeta } from './editableSurfaceContract.js';

test('newly registered editable modules show top edit affordance when edit mode is active', () => {
  const modules = [
    { editableId: 'module-a', editableFields: ['title'], onPatch: () => {} },
    { editableId: 'module-b', editableFields: ['title', 'description'], onPatch: () => {} },
  ];

  const results = modules.map((module) => getEditableSurfaceMeta({ isEditMode: true, ...module }));

  assert.equal(results[0].showAffordance, true);
  assert.equal(results[1].showAffordance, true);
});
