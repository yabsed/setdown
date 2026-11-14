import { electron } from '../../support/electron/electron-app';
import { expect, test, type Locator } from '@playwright/test';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { previews } from '../../support/preview/preview-view';

// report.*, budget.* and deck.* are generated for this repository; table.hwp and
// sample.hwpx come from the hwplib/hwpxlib corpora (see the fixture README).
const fixtures = path.join(import.meta.dirname, '../../fixtures/office');
const launch = async (file: string, config: string) => {
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  await focusApplication(app);
  return app;
};
async function workspace(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  for (const name of await readdir(fixtures)) if (/\.(docx?|xlsx?|pptx?|hwpx?)$/.test(name)) await copyFile(path.join(fixtures, name), path.join(root, name));
  return root;
}
/** The largest scroll offset inside the viewer's shadow tree. */
const scrolled = (reader: Locator) => reader.evaluate(surface => Math.max(0,
  ...Array.from(surface.querySelector('.office-host')!.shadowRoot!.querySelectorAll('*'), element => element.scrollTop)));

test('opens a Word document read-only with tab zoom and in-document find', async () => {
  const root = await workspace('setdown-office-word-');
  const docx = path.join(root, 'report.docx');
  const app = await launch(docx, path.join(root, 'config'));
  const page = await app.firstWindow();
  try {
    const reader = page.getByRole('region', { name: 'Office document reader', exact: true });
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'office');
    await expect(reader).toHaveAttribute('data-office-ready', 'true');
    await expect(reader).toHaveAttribute('data-office-family', 'word');
    const marker = reader.getByText('Unique marker: quokka-reading-room.');
    await expect(marker).toBeVisible();
    // The document is drawn by the Office viewer, not by a Markdown preview or the text editor.
    expect(await previews(app).count()).toBe(0);
    await expect(page.locator('.mode-toggle')).toBeHidden();

    const reset = page.getByRole('button', { name: 'Reset document zoom', exact: true });
    const width = () => marker.evaluate(node => node.getBoundingClientRect().width);
    await expect(reset).toHaveText('100%');
    const initial = await width();
    await page.getByRole('button', { name: 'Zoom document in', exact: true }).click();
    await expect(reset).toHaveText('110%');
    await expect.poll(async () => Math.round(await width() / initial * 100)).toBe(110);
    await page.getByRole('button', { name: 'Zoom document in', exact: true }).click();
    await expect.poll(async () => Math.round(await width() / initial * 100)).toBe(120);
    await reset.click();
    await expect(reset).toHaveText('100%');
    await expect.poll(async () => Math.round(await width() / initial * 100)).toBe(100);
    // Ctrl+wheel belongs to the tab zoom, not to a second zoom inside the viewer.
    const box = (await marker.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 5);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
    await expect(reset).not.toHaveText('100%');
    await expect.poll(async () => await width() > initial).toBe(true);
    await reset.click();
    await expect.poll(async () => Math.round(await width() / initial * 100)).toBe(100);

    await page.keyboard.press('Control+f');
    const search = reader.getByPlaceholder('Search document');
    await expect(search).toBeFocused();
    await search.fill('quokka'); await search.press('Enter');
    await expect(reader.locator('[part~="toolbar-status"]')).toHaveText('1/1');

    const before = await readFile(docx);
    await page.keyboard.press('Control+s');
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-save-as'));
    await expect(page.getByRole('tab', { name: /Save/ })).toHaveCount(0);
    expect(await readFile(docx)).toEqual(before);
    await expect(reader).toHaveAttribute('data-office-ready', 'true');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('opens legacy Word, Excel, PowerPoint and Hangul documents in tabs', async () => {
  test.setTimeout(120_000);
  const root = await workspace('setdown-office-formats-');
  const app = await launch(path.join(root, 'report.doc'), path.join(root, 'config'));
  const page = await app.firstWindow();
  try {
    const reader = page.getByRole('region', { name: 'Office document reader', exact: true });
    const tab = (name: string) => page.locator(`.document-tab[title="${path.join(root, name)}"]`);
    const open = async (name: string, family: string) => {
      await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), path.join(root, name));
      await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
      await expect(reader).toHaveAttribute('data-office-family', family);
      await expect(reader).toHaveAttribute('data-office-ready', 'true');
    };
    await expect(reader).toHaveAttribute('data-office-ready', 'true');
    await expect(reader.getByText('Unique marker: quokka-reading-room.')).toBeVisible();
    for (const name of ['budget.xlsx', 'budget.xls']) {
      await open(name, 'spreadsheet');
      // Cells are painted on a canvas; the workbook summary is the DOM evidence.
      await expect(reader.getByText('61 rows, 3 columns', { exact: false })).toBeVisible();
      await expect(reader.locator('canvas').first()).toBeVisible();
    }
    await open('deck.pptx', 'presentation');
    await expect(reader.getByText('First slide marker: wombat-opening-slide')).toBeVisible();
    await open('deck.ppt', 'presentation');
    await expect.poll(() => reader.locator('canvas').count()).toBeGreaterThan(0);
    await open('table.hwp', 'hangul');
    await expect(reader.getByText('LMN', { exact: true })).toBeVisible();
    await open('sample.hwpx', 'hangul');
    await expect(reader.getByText('우리는', { exact: false }).first()).toBeVisible();
    // Earlier tabs are remounted from disk when revisited, still read-only.
    await tab('report.doc').click();
    await expect(reader).toHaveAttribute('data-office-family', 'word');
    await expect(reader.getByText('Unique marker: quokka-reading-room.')).toBeVisible();
    expect(await previews(app).count()).toBe(0);
    for (const name of await readdir(fixtures)) if (/\.(docx?|xlsx?|pptx?|hwpx?)$/.test(name))
      expect(await readFile(path.join(root, name))).toEqual(await readFile(path.join(fixtures, name)));
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('restores the Word reading position after restart', async () => {
  const root = await workspace('setdown-office-history-');
  const file = path.join(root, 'report.docx'), config = path.join(root, 'config');
  let app = await launch(file, config), page = await app.firstWindow();
  try {
    const reader = () => page.getByRole('region', { name: 'Office document reader', exact: true });
    await expect(reader()).toHaveAttribute('data-office-ready', 'true');
    await focusApplication(app);
    const box = (await reader().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 1800);
    await expect.poll(() => scrolled(reader())).toBeGreaterThan(1000);
    const before = await scrolled(reader());
    await expect.poll(() => page.evaluate(async () => {
      const position = (await window.marktex.reloadDocument())?.readingPosition;
      return position?.kind === 'office' && position.top > 0;
    })).toBe(true);
    await app.close();
    app = await launch(file, config); page = await app.firstWindow();
    await expect(reader()).toHaveAttribute('data-office-ready', 'true');
    await expect.poll(async () => Math.abs(await scrolled(reader()) - before)).toBeLessThan(before * .15);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('a link inside a document opens a Setdown browser tab, never a child window or a navigation', async () => {
  const root = await workspace('setdown-office-links-');
  const app = await launch(path.join(root, 'links.pptx'), path.join(root, 'config'));
  const page = await app.firstWindow();
  try {
    const reader = page.getByRole('region', { name: 'Office document reader', exact: true });
    await expect(reader).toHaveAttribute('data-office-ready', 'true');
    const shell = page.url();
    const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    // The slide link is authored with target=_blank, which would otherwise open a window that inherits the preload.
    await reader.getByText('external-slide-link').click();
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'web');
    await expect(page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue('https://setdown-link-test.invalid/slide');
    await expect(page.locator('.document-tab')).toHaveCount(2);
    expect(await windows()).toBe(1);
    expect(page.url()).toBe(shell);
    // Main also refuses both paths for any shell content, whatever a renderer lets through.
    expect(await page.evaluate(async () => {
      const child = window.open('https://setdown-link-test.invalid/popup');
      location.href = 'https://setdown-link-test.invalid/leave';
      await new Promise(resolve => setTimeout(resolve, 400));
      return child === null && typeof window.marktex.openLink === 'function';
    })).toBe(true);
    expect(await windows()).toBe(1);
    expect(page.url()).toBe(shell);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
