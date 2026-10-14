import { electron } from './electron-app';
import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication } from './electron-app';
import { pdfFixture } from './pdf-fixture';

test('PDF tabs retain canvases and isolate focus; eviction, hidden resize and changed-file reload remain correct', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-media-tabs-'));
  const files = Array.from({ length: 4 }, (_, index) => path.join(root, `reading-${index}.pdf`));
  for (const file of files) await writeFile(file, pdfFixture());
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', files[0]], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  const page = await app.firstWindow();
  await focusApplication(app);
  try {
    const reader = page.getByRole('region', { name: 'PDF reader', exact: true });
    await expect(reader).toHaveAttribute('data-pdf-pages', '12');
    await reader.getByRole('spinbutton', { name: 'PDF page number' }).fill('7');
    await reader.getByRole('spinbutton', { name: 'PDF page number' }).press('Enter');
    await expect(reader.locator('[data-page-number="7"] .textLayer')).toContainText('PDF page 7');
    const original = await reader.locator('[data-page-number="7"] canvas').elementHandle();
    const before = await original!.evaluate((node: HTMLCanvasElement) => node.toDataURL());
    const tab = (index: number) => page.getByRole('tab').filter({ hasText: `reading-${index}.pdf` });
    await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), files[1]);
    await expect(reader).toHaveAttribute('data-pdf-pages', '12');
    await page.keyboard.press('Control+f');
    await expect(reader.getByRole('searchbox', { name: 'Find in PDF' })).toBeFocused();
    await tab(0).click();
    await expect(reader).toHaveAttribute('data-pdf-page', '7');
    expect(await original!.evaluate((node: HTMLCanvasElement) => node.isConnected && node.toDataURL())).toBe(before);
    await tab(1).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 740));
    await tab(0).click();
    await expect(reader).toHaveAttribute('data-pdf-page', '7');
    await expect(reader.locator('[data-page-number="7"] .textLayer')).toContainText('PDF page 7');
    for (const file of files.slice(2)) {
      await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), file);
      await expect(reader).toHaveAttribute('data-pdf-pages', '12');
    }
    // reading-1 was least recently used; visiting it evicts reading-0.
    await tab(1).click();
    await expect(reader).toHaveAttribute('data-pdf-pages', '12');
    expect(await page.locator('.pdf-surface').count()).toBe(3);
    expect(await original!.evaluate((node) => node.isConnected)).toBe(false);
    await tab(0).click();
    await expect(reader).toHaveAttribute('data-pdf-page', '7');
    await expect(reader.locator('[data-page-number="7"] .textLayer')).toContainText('PDF page 7');
    await writeFile(files[0], pdfFixture(4));
    // Read-only documents reload automatically on the file watcher notification.
    await expect(reader).toHaveAttribute('data-pdf-pages', '4');
    await expect(reader).toHaveAttribute('data-pdf-page', '4');
    await expect(reader.locator('[data-page-number="4"] .textLayer')).toContainText('PDF page 4');
    // New tabs are inserted after the active tab. Put reading-0 next to the
    // already-cached reading-1 so active close tests disposal without loading
    // an evicted neighbor into the cache at the same time.
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await tab(0).dispatchEvent('dragstart', { dataTransfer: transfer });
    const list = page.locator('.tab-list'), bounds = (await list.boundingBox())!;
    const point = { clientX: bounds.x + bounds.width - 2, clientY: bounds.y + bounds.height / 2, dataTransfer: transfer };
    await list.dispatchEvent('dragover', point);
    await list.dispatchEvent('drop', point);
    await transfer.dispose();
    await expect(page.locator('.document-tab').last()).toContainText('reading-0.pdf');
    const closedId = await tab(0).getAttribute('data-tab-id');
    await tab(0).getByTitle('Close tab', { exact: true }).click();
    await expect(tab(0)).toHaveCount(0);
    await expect(page.locator(`[data-media-tab="${closedId}"]`)).toHaveCount(0);
    await expect(page.locator('.pdf-surface')).toHaveCount(2);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
