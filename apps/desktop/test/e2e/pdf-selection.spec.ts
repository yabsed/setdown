import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from './electron-app';
import { pdfFixture } from './pdf-fixture';

test('PDF text can be selected with the pointer and copied to the clipboard', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pdf-selection-'));
  const file = path.join(root, 'selectable.pdf');
  await writeFile(file, pdfFixture(1));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  const page = await app.firstWindow();
  await focusApplication(app);
  try {
    const pdf = page.getByRole('region', { name: 'PDF reader', exact: true });
    const text = pdf.locator('[data-page-number="1"] .textLayer span').first();
    await expect(text).toContainText('PDF page 1');
    const box = (await text.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selected).toContain('PDF page 1');
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
  } finally {
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
  }
});
