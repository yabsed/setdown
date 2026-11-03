import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import { electron, disposeApplication } from '../../support/electron/electron-app';
import { previews } from '../../support/preview/preview-view';

test('math braces, accents, roots and arrows retain their SVG geometry and paint', async () => {
  test.setTimeout(60_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-stretchy-math-'));
  const file = path.join(root, 'math.md');
  await writeFile(file, await readFile(path.resolve('test/fixtures/stretchy-math.md')));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    const preview = previews(app);
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await expect.poll(() => preview.evaluate('document.querySelectorAll(".katex .brace-center").length')).toBe(3);

    for (const theme of ['github-light', 'github-dark']) {
      await app.evaluate(({ Menu }, theme) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${theme}`)!.click(), theme);
      await expect.poll(() => preview.evaluate('document.body.dataset.setdownPreviewTheme')).toBe(theme);
      const geometry = await preview.evaluate<{
        math: { height: number; parentHeight: number }[];
        media: { width: number; height: number; available: number };
      }>(`(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const media = document.querySelector('.markdown-preview svg:not(.katex svg)');
        const rect = media.getBoundingClientRect();
        return {
          math: [...document.querySelectorAll('.katex svg')].map(svg => ({
            height: svg.getBoundingClientRect().height,
            parentHeight: svg.parentElement.getBoundingClientRect().height,
          })),
          media: { width: rect.width, height: rect.height, available: media.parentElement.clientWidth },
        };
      })()`);
      expect(geometry!.math.length).toBeGreaterThan(10);
      for (const svg of geometry!.math) {
        expect(svg.height, 'Math SVG must not collapse to a subpixel height').toBeGreaterThan(1);
        expect(Math.abs(svg.height - svg.parentHeight)).toBeLessThan(.1);
      }
      expect(geometry!.media.width).toBeLessThanOrEqual(geometry!.media.available);
      expect(geometry!.media.width / geometry!.media.height).toBeCloseTo(10, 1);

      // Capture actual native pixels from each brace's center, where the cusp
      // must be visible; DOM presence alone did not catch the collapsed SVG.
      const captures = await app.evaluate(async ({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
          'webContents' in candidate && candidate.getVisible()) as Electron.WebContentsView;
        const clips = await view.webContents.executeJavaScript(`
          [...document.querySelectorAll('.katex .brace-center')].map(node => {
            const r = node.getBoundingClientRect();
            return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
          })`);
        const braces: Buffer[] = [];
        for (const clip of clips) braces.push((await view.webContents.capturePage(clip)).toPNG());
        return { braces, full: (await view.webContents.capturePage()).toPNG() };
      });
      await writeFile(test.info().outputPath(`${theme}.png`), captures.full);
      for (const [index, bytes] of captures.braces.entries()) {
        await writeFile(test.info().outputPath(`${theme}-brace-${index}.png`), bytes);
        const stats = await sharp(Buffer.from(bytes)).removeAlpha().stats();
        expect(Math.max(...stats.channels.map(channel => channel.stdev)), 'Brace must paint against the background').toBeGreaterThan(10);
      }
    }
  } finally {
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
  }
});
