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
  assert.equal(results[0].shouldFlagMissingRegistration, false);
  assert.equal(results[1].shouldFlagMissingRegistration, false);
});

test('edit mode visually flags surfaces missing editable registration', () => {
  const result = getEditableSurfaceMeta({
    isEditMode: true,
    editableFields: ['title'],
    onPatch: () => {},
  });

  assert.equal(result.showAffordance, false);
  assert.equal(result.shouldFlagMissingRegistration, true);
  assert.equal(result.missingEditableId, true);
});
