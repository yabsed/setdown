import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const checks = require('../../scripts/review-math-browser-checks.cjs') as () => {
  checks: number; passed: number; results: { name: string; ok: boolean; error?: string }[];
};

test('first edit and repeated review patches preserve exact math DOM and MathML', async ({ page }) => {
  const bundle = await build({
    stdin: { contents: `
      export { applyReviewRowsPatch } from './src/preview-runtime/review-row-patcher';
      export { prepareReviewMathRow } from './src/preview-runtime/review-math-dom';
      export { readReviewRows, diffReviewRows } from './src/core/preview/review-row-patch';
    `, resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    globalName: '__reviewMathHarness',
  });
  await page.setViewportSize({ width: 1000, height: 650 });
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(checks);
  expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
  expect(result.checks).toBe(11);
  expect(result.passed).toBe(result.checks);
});
