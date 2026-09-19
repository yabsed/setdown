import { expect, test } from '@playwright/test';
import { responsiveRenderedDiff, RENDERED_DIFF_STYLES } from '../../src/core/preview/rendered-diff';

const p = (text: string, line: number) => `<p data-source-line="${line}">${text}</p>`;
const before = '<h2 data-source-line="1">Algebraic properties of products</h2>'
  + p('A long paragraph that wraps on narrow screens. '.repeat(4) + 'old', 3)
  + p('A', 5) + p('B', 7) + p('C', 9);
const after = '<h2 data-source-line="1">Algebraic properties! of products?</h2>'
  + p('A long paragraph that wraps on narrow screens. '.repeat(4) + 'edited', 3)
  + p('A brand new paragraph.', 5) + p('Another new paragraph.', 7)
  + p('A', 9) + p('B', 11) + p('C', 13);
const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin:0; padding:32px; font:22px/1.5 Georgia,serif; background:#f3f1ed; color:#261e1b; }
  body[data-preview-theme=dark] { background:#20242b; color:#e1e4eb; }
  p { margin:1em 0; } h2 { font-weight:400; line-height:1.35; }
</style>${RENDERED_DIFF_STYLES}<body>${responsiveRenderedDiff(before, after, [])}</body>`;

for (const theme of ['light', 'dark']) {
  test(`rendered diff preserves block pairs and continuous emphasis (${theme})`, async ({ page }) => {
    await page.setContent(html);
    await page.evaluate((value) => { document.body.dataset.previewTheme = value; }, theme);
    for (const width of [1200, 850, 721]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('.setdown-rendered-diff-split')).toBeVisible();
      const matched = await page.locator('.setdown-rendered-diff-row-unchanged').evaluateAll((rows) => rows.map((row) => {
        const [left, right] = Array.from(row.children);
        const a = left.firstElementChild!.getBoundingClientRect();
        const b = right.firstElementChild!.getBoundingClientRect();
        return { before: left.textContent, after: right.textContent, top: Math.abs(a.top - b.top), height: Math.abs(a.height - b.height) };
      }));
      expect(matched.map((row) => [row.before, row.after])).toEqual([['A', 'A'], ['B', 'B'], ['C', 'C']]);
      for (const row of matched) {
        expect(row.top).toBeLessThan(1);
        expect(row.height).toBeLessThan(1);
      }
      const emphasis = await page.evaluate(() => {
        const root = document.querySelector('.setdown-rendered-diff-split')!;
        const fresh = Array.from(root.querySelectorAll<HTMLElement>('.setdown-rendered-diff-after[data-change="added"][data-whole="true"]'));
        const word = root.querySelector<HTMLElement>('.setdown-diff-word-added')!;
        const removed = root.querySelector<HTMLElement>('.setdown-diff-word-removed')!;
        return {
          fresh: fresh.map((node) => getComputedStyle(node).backgroundImage),
          word: getComputedStyle(word).backgroundColor,
          gap: fresh[1].getBoundingClientRect().top - fresh[0].getBoundingClientRect().bottom,
          strike: getComputedStyle(removed).textDecorationLine,
          padding: getComputedStyle(word).paddingLeft,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(emphasis.fresh).toEqual([0, 1].map(() => `linear-gradient(${emphasis.word}, ${emphasis.word})`));
      expect(emphasis.gap).toBeLessThan(1);
      expect(emphasis.strike).toBe('none');
      expect(emphasis.padding).toBe('0px');
      expect(emphasis.overflow).toBe(false);
    }
    // Late font/layout changes must reflow both cells in the same grid row.
    await page.evaluate(() => { document.body.style.fontSize = '30px'; });
    const difference = await page.locator('.setdown-rendered-diff-row-unchanged').evaluateAll((rows) => rows.map((row) =>
      Math.abs(row.children[0].firstElementChild!.getBoundingClientRect().top - row.children[1].firstElementChild!.getBoundingClientRect().top)));
    expect(difference.every((value) => value < 1)).toBe(true);
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(page.locator('.setdown-rendered-diff-split')).toBeHidden();
    await expect(page.locator('.setdown-rendered-diff-unified')).toBeVisible();
    await expect(page.locator('.setdown-rendered-diff-unified [data-change="added"][data-whole="true"]')).toHaveCount(2);
  });
}
