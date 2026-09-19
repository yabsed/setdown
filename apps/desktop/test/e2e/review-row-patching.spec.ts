import { build } from 'esbuild';
import { expect, test } from '@playwright/test';
import { responsiveRenderedDiff, RENDERED_DIFF_STYLES } from '../../src/core/preview/rendered-diff';
import { diffReviewRows, readReviewRows } from '../../src/core/preview/review-row-patch';
import type * as Patcher from '../../src/preview-runtime/review-row-patcher';

let script = '';
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: `export { applyReviewRowsPatch } from './src/preview-runtime/review-row-patcher';`,
      resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: '__reviewRows', platform: 'browser', target: 'chrome120',
  });
  script = result.outputFiles[0].text;
});
const fragment = (words: string[]) => words.map((word, i) =>
  `<p data-source-line="${i * 2 + 1}"><span data-source-start="${i * 2 + 1}:3">${word}</span></p>`).join('');

for (const width of [1200, 600]) test(`row patches preserve actual DOM and independent source metadata (${width}px)`, async ({ page }) => {
  const words = Array.from({ length: 1000 }, (_, i) => `Paragraph ${i} 한글 unchanged`);
  const before = responsiveRenderedDiff(fragment(words), fragment(words), []);
  const edited = [...words]; edited[500] += '!';
  const after = responsiveRenderedDiff(fragment(words), fragment(edited), []);
  const shifted = responsiveRenderedDiff(fragment(words), fragment(['Inserted', ...edited]), []);
  const patch = diffReviewRows(readReviewRows(before), readReviewRows(after), 1, 2);
  const second = diffReviewRows(readReviewRows(after), readReviewRows(shifted), 2, 3);
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(`<html><head>${RENDERED_DIFF_STYLES}</head><body><input value="조합중"><main id="root"></main><main id="fresh" hidden></main></body></html>`);
  await page.addScriptTag({ content: script });
  const result = await page.evaluate(({ before, after, shifted, patch, second }) => {
    const api = (window as typeof window & { __reviewRows: typeof Patcher }).__reviewRows;
    const root = document.querySelector<HTMLElement>('#root')!;
    const fresh = document.querySelector<HTMLElement>('#fresh')!;
    const canonical = (element: Element) => JSON.stringify(Array.from(element.children)
      .map((wrapper) => Array.from(wrapper.children).map((row) => row.outerHTML)));
    root.innerHTML = before;
    const wrappers = Array.from(root.children);
    const sentinel = root.querySelectorAll('.setdown-rendered-diff-row')[800];
    const input = document.querySelector('input')!; input.focus(); input.setSelectionRange(1, 2);
    const stats = api.applyReviewRowsPatch(root, patch, 1); fresh.innerHTML = after;
    const equalsFresh = canonical(root) === canonical(fresh);
    const retained = root.querySelectorAll('.setdown-rendered-diff-row')[800] === sentinel;
    api.applyReviewRowsPatch(root, second, 2); fresh.innerHTML = shifted;
    const exactShift = canonical(root) === canonical(fresh);
    const beforeLine = sentinel.querySelector('section:first-child p')?.getAttribute('data-source-line');
    const afterLine = sentinel.querySelector('section:last-child p')?.getAttribute('data-source-line');
    const column = sentinel.querySelector('section:last-child span')?.getAttribute('data-source-start');
    const untouched = root.innerHTML;
    let rejected = false;
    try { api.applyReviewRowsPatch(root, second, 3); } catch { rejected = true; }
    const left = sentinel.children[0].getBoundingClientRect();
    const right = sentinel.children[1].getBoundingClientRect();
    return { retained, equalsFresh, exactShift, beforeLine, afterLine, column,
      wrappersSame: root.children[0] === wrappers[0] && root.children[1] === wrappers[1],
      focus: document.activeElement === input && input.selectionStart === 1 && input.selectionEnd === 2,
      rejectedWithoutMutation: rejected && root.innerHTML === untouched,
      replaced: stats.replacedRows, kept: stats.retainedRows,
      aligned: Math.abs(left.top - right.top) < 1 && Math.abs(left.height - right.height) < 1 };
  }, { before, after, shifted, patch, second });
  expect(result).toEqual({ retained: true, equalsFresh: true, exactShift: true,
    beforeLine: '1601', afterLine: '1603', column: '1603:3', wrappersSame: true,
    focus: true, rejectedWithoutMutation: true, replaced: 2, kept: 1998, aligned: true });
  expect(Buffer.byteLength(JSON.stringify(patch))).toBeLessThan(Buffer.byteLength(after) / 100);
  if (width < 720) {
    await expect(page.locator('.setdown-rendered-diff-unified')).toBeVisible();
    await expect(page.locator('.setdown-rendered-diff-split')).toBeHidden();
  } else {
    await expect(page.locator('.setdown-rendered-diff-unified')).toBeHidden();
    await expect(page.locator('.setdown-rendered-diff-split')).toBeVisible();
  }
});

test('a malformed split patch cannot partly mutate the unified tree', async ({ page }) => {
  const before = responsiveRenderedDiff(fragment(['A', 'B']), fragment(['A', 'B']), []);
  const after = responsiveRenderedDiff(fragment(['A', 'B']), fragment(['New', 'B']), []);
  const patch = diffReviewRows(readReviewRows(before), readReviewRows(after), 1, 2);
  patch.split.baseLength += 1;
  await page.setContent('<main></main>'); await page.addScriptTag({ content: script });
  const result = await page.evaluate(({ before, patch }) => {
    const root = document.querySelector('main')!; root.innerHTML = before;
    const old = root.innerHTML; let rejected = false;
    try { (window as typeof window & { __reviewRows: typeof Patcher }).__reviewRows.applyReviewRowsPatch(root, patch, 1); }
    catch { rejected = true; }
    return rejected && old === root.innerHTML;
  }, { before, patch });
  expect(result).toBe(true);
});
