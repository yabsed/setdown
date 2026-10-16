import { expect, test } from '@playwright/test';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { pdfFixture } from '../../support/media/pdf-fixture';

async function changedPixels(before: Buffer, after: Buffer): Promise<number> {
  const images = await Promise.all([before, after].map(image => sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  const [original, selected] = images;
  expect(selected.info).toEqual(original.info);
  let changed = 0;
  for (let pixel = 0; pixel < original.data.length; pixel += original.info.channels) {
    if ([0, 1, 2].some(channel => Math.abs(original.data[pixel + channel] - selected.data[pixel + channel]) > 24)) changed++;
  }
  return changed / (original.info.width * original.info.height);
}

test('PDF text selection is visible during and after dragging, and both copy paths preserve it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pdf-selection-'));
  const file = path.join(root, 'selectable.pdf');
  if (process.env.SETDOWN_TEST_PDF_FILE) await copyFile(path.resolve(process.env.SETDOWN_TEST_PDF_FILE), file);
  else await writeFile(file, pdfFixture(1));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  const page = await app.firstWindow();
  await focusApplication(app);
  try {
    const pdf = page.getByRole('region', { name: 'PDF reader', exact: true });
    const text = pdf.locator('[data-page-number="1"] .textLayer span:not(.markedContent):not([role="img"])').first();
    await expect(text).toContainText(/\S/);
    const content = (await text.textContent())!;
    const box = (await text.boundingBox())!;
    const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) };
    const before = await page.screenshot({ clip, path: test.info().outputPath('selection-before.png') });
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, { steps: 10 });
    const during = await page.screenshot({ clip, path: test.info().outputPath('selection-during.png') });
    expect(await changedPixels(before, during), 'Dragging must visibly highlight the selected text').toBeGreaterThan(.1);
    await page.mouse.up();
    const after = await page.screenshot({ clip, path: test.info().outputPath('selection-after.png') });
    expect(await changedPixels(before, after), 'Selection must remain visible after releasing the pointer').toBeGreaterThan(.1);
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selected.trim().length).toBeGreaterThan(3);
    expect(content).toContain(selected.trim());
    expect(await page.evaluate(() => {
      const shadow = document.querySelector('.pdf-host')?.shadowRoot;
      const selection = window.getSelection();
      return !!shadow && !!selection && selection.getComposedRanges({ shadowRoots: [shadow] })
        .some(range => shadow.contains(range.startContainer) && shadow.contains(range.endContainer));
    })).toBe(true);
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.keyboard.press('Control+C');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selected);

    await app.evaluate(({ Menu }) => {
      const build = Menu.buildFromTemplate;
      Menu.buildFromTemplate = function(template) {
        const menu = build.call(this, template);
        if (template.length === 1 && template[0]?.label === 'Copy') (globalThis as any).__pdfSelectionMenu = menu;
        return menu;
      };
    });
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.mouse.click(box.x + 24, box.y + box.height / 2, { button: 'right' });
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as any).__pdfSelectionMenu))).toBe(true);
    await app.evaluate(({ BrowserWindow }) => {
      const menu: Electron.Menu = (globalThis as any).__pdfSelectionMenu;
      const window = BrowserWindow.getAllWindows()[0];
      menu.items[0].click?.(menu.items[0], window, {} as Electron.KeyboardEvent);
      menu.closePopup(window);
    });
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selected);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const cleared = await page.screenshot({ clip, path: test.info().outputPath('selection-cleared.png') });
    expect(await changedPixels(before, cleared), 'Clearing selection must remove the visible highlight').toBeLessThan(.01);
  } finally {
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
  }
});
