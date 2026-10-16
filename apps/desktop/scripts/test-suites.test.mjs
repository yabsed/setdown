import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suites, validateSuites } from './test-suites.mjs';

test('every Electron, external tool and Python test is classified and every suite path exists', () => {
  validateSuites();
});

test('new or moved specs cannot silently drop out of the manifest', () => {
  const manifest = structuredClone(suites);
  const file = Object.keys(manifest.e2e)[0];
  delete manifest.e2e[file];
  assert.throws(() => validateSuites(manifest), /Unclassified test/);
  manifest.e2e['browser/missing.spec.ts'] = { previewContract: true };
  assert.throws(() => validateSuites(manifest), /Missing classified test/);
});

test('contract membership and benchmark inputs cannot become ambiguous', () => {
  const manifest = structuredClone(suites);
  manifest.unit.previewContract.push(manifest.unit.previewContract[0]);
  manifest.e2e[Object.keys(manifest.e2e)[0]] = {};
  manifest.benchmark.support.push('test/support/missing.ts');
  assert.throws(() => validateSuites(manifest), /Classify preview-contract membership/);
  assert.throws(() => validateSuites(manifest), /Duplicate contract units/);
  assert.throws(() => validateSuites(manifest), /Missing benchmark support/);
});
