import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import type { SourceAtlas } from '../../src/preview-runtime/source-atlas';

type Harness = {
  atlas: SourceAtlas; reads: number; messages: Record<string, unknown>[];
  ReviewHarness: { SourceAtlas: typeof SourceAtlas; installReviewPreparation(options: unknown): void };
};
const script = async () => (await build({
  stdin: { contents: `export { SourceAtlas } from './src/preview-runtime/source-atlas';
    export { installReviewPreparation } from './src/preview-runtime/review-preparation';`, resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ReviewHarness',
})).outputFiles[0].text;

test('warm review positions reuse geometry and preserve side/weighted-band semantics', async ({ page }) => {
  const rows = Array.from({ length: 500 }, (_, index) => `<div class="row">
    <div class="setdown-rendered-diff-before"><p data-source-line="${(index + 1) * 2}">before</p></div>
    <div class="setdown-rendered-diff-after"><p data-source-line="${(index + 1) * 3}">after</p></div></div>`).join('');
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.setContent(`<!doctype html><style>body{margin:0}.row{display:grid;grid-template-columns:1fr 1fr}p{height:80px;margin:0}</style>
    <div class="markdown-preview" data-for="preview"><div class="setdown-rendered-diff-split">${rows}</div></div>`);
  await page.addScriptTag({ content: await script() });
  const result = await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.atlas = new w.ReviewHarness.SourceAtlas({ lineCount: () => 1500, documentIsBlank: () => false });
    w.reads = 0;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('[data-source-line]')) w.reads += 1;
      return original.call(this);
    };
    w.atlas.position(120, .8, [], 'after'); const cold = w.reads;
    w.reads = 0;
    for (let i = 0; i < 50; i++) w.atlas.position(120 + (i % 5) * 3, .8, [], 'after');
    const warm = w.reads;
    w.atlas.position(120, .4, [], 'before'); const before = scrollY;
    w.atlas.position(120, .4, [], 'after'); const after = scrollY;
    w.atlas.position(120, .372, [{ sourceLine: 120, yRatio: .2 }, { sourceLine: 123, yRatio: .8 }], 'after');
    return { cold, warm, difference: before - after, weighted: scrollY };
  });
  expect(result).toEqual({ cold: 1000, warm: 0, difference: 1600, weighted: 2860 });
  await page.setViewportSize({ width: 760, height: 650 });
  expect(await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.reads = 0; w.atlas.position(120, .4, [], 'after'); return w.reads;
  })).toBe(1000);
});

test('hidden preparation acknowledges without waiting for animation frames', async ({ page }) => {
  await page.setContent(`<!doctype html><style>p{height:900px}</style>
    <div class="markdown-preview" data-for="preview"><div class="setdown-rendered-diff-split">
      <div class="setdown-rendered-diff-after"><p data-source-line="1">A</p><p data-source-line="2">B</p></div></div></div>`);
  await page.addScriptTag({ content: await script() });
  await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.atlas = new w.ReviewHarness.SourceAtlas({ lineCount: () => 2, documentIsBlank: () => false });
    w.messages = [];
    w.ReviewHarness.installReviewPreparation({ sourceAtlas: w.atlas, revision: () => 31,
      hydrate() {}, send: (message: Record<string, unknown>) => w.messages.push(message) });
    window.requestAnimationFrame = () => { throw new Error('Readiness depends on hidden rAF'); };
    window.postMessage({ command: 'marktex:prepare-review', revision: 31, requestId: 4,
      sourceSide: 'after', sourceLine: 2, topRatio: .8 }, '*');
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as Harness).messages)).toContainEqual({
    type: 'marktex:review-prepared', requestId: 4, revision: 31,
  });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
