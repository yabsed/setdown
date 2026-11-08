import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { themeProfile, type ThemeId } from '../../../src/core/theme/theme-catalog';
import { fixture } from '../../support/browser/browser-fixture';

// Include tinted light, dark, an imported theme, and the white control theme.
const themes: ThemeId[] = ['solarized-light', 'github-dark', 'paper', 'vscode-dark-2026', 'github-light'];

for (const theme of themes) for (const source of ['Markdown', 'Web Reader'] as const) {
  test(`${theme} ${source} PDF paints every page through its outer margins`, async () => {
    test.setTimeout(90_000);
    const f = await fixture();
    try {
      await f.page.evaluate(theme => window.marktex.executeApplicationMenuItem(`preview-theme-${theme}`), theme);
      await expect(f.page.locator('html')).toHaveAttribute('data-theme', theme);
      let title: string, first: string, last: string;
      if (source === 'Markdown') {
        const file = path.join(f.root, 'paginated.md');
        const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: the complete document must remain readable across page breaks. `
          + 'Export preserves the theme throughout the paper, including its margins, while keeping the original text selectable and the content inset.').join('\n\n');
        await writeFile(file, `# First PDF page\n\n${paragraphs}\n\n# Last PDF page\n\nSelectable final paragraph.\n`);
        await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
        title = 'paginated.md'; first = 'First PDF page'; last = 'Selectable final paragraph.';
      } else {
        await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/article`);
        await expect(f.page.getByRole('tab', { name: /Long article/ })).toBeVisible();
        await f.page.getByRole('button', { name: 'Enter reader mode' }).click();
        await expect(f.page.getByRole('region', { name: 'Reader mode', exact: true })).toBeVisible();
        title = 'Long article'; first = 'The Long Article Title'; last = 'Paragraph 39:';
      }
      const original = f.page.getByRole('tab', { name: new RegExp(title.replace('.', '\\.')) });
      await expect(original).toHaveAttribute('aria-selected', 'true');
      const target = test.info().outputPath('export.pdf');
      await f.app.evaluate(({ dialog }, target) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
      }, target);
      await f.page.getByRole('button', { name: 'File', exact: true }).click();
      await f.page.getByRole('menuitem', { name: 'Export as PDF…', exact: true }).click();
      await expect.poll(() => readFile(target).then(data => data.subarray(0, 5).toString()).catch(() => ''), { timeout: 20_000 }).toBe('%PDF-');
      await expect(original).toHaveAttribute('aria-selected', 'true');

      // Render the saved bytes in the real PDF.js reader, not the source HTML.
      await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), target);
      const pdf = f.page.getByRole('region', { name: 'PDF reader', exact: true });
      await expect(pdf).toHaveAttribute('data-pdf-pages', /^[1-9]\d*$/);
      const pages = Number(await pdf.getAttribute('data-pdf-pages'));
      expect(pages).toBeGreaterThanOrEqual(3);
      await pdf.getByRole('combobox', { name: 'PDF zoom', exact: true }).selectOption('page-fit');
      const expected = themeProfile(theme).preview.background.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16));
      let text = '';
      for (let number = 1; number <= pages; number++) {
        const input = pdf.getByRole('spinbutton', { name: 'PDF page number' });
        await input.fill(String(number)); await input.press('Enter');
        const sheet = pdf.locator(`[data-page-number="${number}"]`);
        const canvas = sheet.locator('canvas');
        await expect(canvas).toBeVisible();
        // PDF.js appends this marker after text rendering, including blank pages.
        // Theme padding can occupy a final page; its background must match too.
        await expect(sheet.locator('.textLayer .endOfContent')).toBeAttached();
        text += await sheet.locator('.textLayer').textContent();
        const result = await canvas.evaluate((canvas: HTMLCanvasElement) => {
          const { width, height } = canvas;
          const context = canvas.getContext('2d')!;
          const points = [[2, 2], [width / 2, 2], [width - 3, 2], [2, height / 2], [width - 3, height / 2],
            [2, height - 3], [width / 2, height - 3], [width - 3, height - 3]];
          return { ratio: width / height, pixels: points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]), png: canvas.toDataURL() };
        });
        await writeFile(test.info().outputPath(`page-${number}.png`), Buffer.from(result.png.split(',')[1], 'base64'));
        expect(result.ratio).toBeCloseTo(210 / 297, 2);
        for (const pixel of result.pixels) expect(pixel, `Page ${number} outer margin`).toEqual([...expected, 255]);
      }
      expect(text).toContain(first); expect(text).toContain(last);
      expect(f.errors).toEqual([]);
    } finally { await f.dispose(); }
  });
}
