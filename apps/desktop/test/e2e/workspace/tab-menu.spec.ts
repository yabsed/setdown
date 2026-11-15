import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WebContentsView } from 'electron';
import type { MarkTexApi } from '../../../src/protocol/desktop-api';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../../support/electron/electron-app';
import { chooseNativeMenu } from '../../support/browser/browser-fixture';
import { nativeInput } from '../../support/electron/native-input';

async function open(page: Page, file: string) {
  await page.evaluate(file => (window as unknown as { marktex: MarkTexApi }).marktex.openLink(`marktex-resource://file${file}`), file);
  await expect(page.getByRole('tab', { name: new RegExp(path.basename(file).replaceAll('.', '\\.')) })).toHaveAttribute('aria-selected', 'true');
}
const overlay = (app: TestApplication) => app.windows().find(page => page.url().includes('menu-overlay=1'));
/** Native views of the first window, split into the menu layer and everything it must not hide. */
const nativeViews = (app: TestApplication) => app.evaluate(({ BrowserWindow }) => {
  const visible = BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible())
    .map(view => (view as WebContentsView).webContents.getURL().includes('menu-overlay=1'));
  return { menu: visible.filter(Boolean).length, content: visible.filter(menu => !menu).length };
});
/** Right-click a tab and wait for its menu in the native layer. */
async function tabMenu(app: TestApplication, page: Page, name: string, strip = 0) {
  const tab = page.locator('.tab-strip').nth(strip).locator('.document-tab').filter({ hasText: name });
  const box = (await tab.boundingBox())!;
  await tab.click({ button: 'right' });
  await expect.poll(async () => (await nativeViews(app)).menu).toBe(1);
  const menu = overlay(app)!;
  await expect(menu.getByRole('menuitem', { name: 'Close Others', exact: true })).toBeVisible();
  return { menu, point: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}
const names = (page: Page, strip = 0) => page.locator('.tab-strip').nth(strip).locator('.tab-name');

test('the tab context menu closes, pins, copies, reveals, splits and moves tabs above a live reader', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tab-menu-'));
  await mkdir(path.join(root, 'docs'));
  const file = (name: string) => path.join(root, name);
  for (const name of ['one.md', 'two.md', 'three.md', 'docs/nested.md']) await writeFile(file(name), `# ${name}\n\nReader content.\n`);
  await writeFile(file('notes.txt'), 'plain notes\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file('one.md')], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
    await page.reload();
    await focusApplication(app);
    await expect(names(page)).toHaveText(['one.md']);
    for (const name of ['notes.txt', 'two.md', 'docs/nested.md', 'three.md']) await open(page, file(name));
    await expect(names(page)).toHaveText(['one.md', 'notes.txt', 'two.md', 'nested.md', 'three.md']);
    const selected = (name: string) => expect(page.getByRole('tab', { name: new RegExp(name.replaceAll('.', '\\.')) })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await nativeViews(app)).content).toBe(1);

    // The menu opens at the pointer for a background tab, without selecting it or hiding the reader.
    const first = await tabMenu(app, page, 'two.md');
    const popup = (await first.menu.locator('.context-menu').first().boundingBox())!;
    expect(Math.abs(popup.x - first.point.x)).toBeLessThan(3); expect(Math.abs(popup.y - first.point.y)).toBeLessThan(3);
    await selected('three.md');
    expect((await nativeViews(app)).content).toBe(1);
    await expect(first.menu.getByRole('menuitem', { name: 'Keep Open', exact: true })).toBeDisabled();
    // The shortcut is part of the row, as in the application menu.
    await expect(first.menu.getByRole('menuitem', { name: /^Close\s*Ctrl\+W$/ })).toBeEnabled();
    await first.menu.screenshot({ path: test.info().outputPath('tab-menu.png') });
    await chooseNativeMenu(app, ['Copy Relative Path']);
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('two.md');
    await expect.poll(async () => (await nativeViews(app)).menu).toBe(0);

    await tabMenu(app, page, 'nested.md'); await chooseNativeMenu(app, ['Copy Path']);
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(file('docs/nested.md'));
    await tabMenu(app, page, 'nested.md'); await chooseNativeMenu(app, ['Reveal in Explorer View']);
    await expect(page.locator('.explorer-row.is-selected .explorer-entry-name')).toHaveText(['nested.md']);
    await expect(page.locator('.explorer-row.is-selected')).toBeInViewport();

    // Pin: the tab leads the strip and trades its close button for the pin.
    await tabMenu(app, page, 'two.md'); await chooseNativeMenu(app, ['Pin']);
    await expect(names(page)).toHaveText(['two.md', 'one.md', 'notes.txt', 'nested.md', 'three.md']);
    const pinnedTab = page.locator('.document-tab[data-pinned]');
    await expect(pinnedTab.locator('.tab-name')).toHaveText(['two.md']);
    await expect(pinnedTab.getByRole('button', { name: 'Unpin tab' })).toBeVisible();
    await expect(pinnedTab.locator('[title="Close tab"]')).toHaveCount(0);
    await page.locator('.tab-strip').first().screenshot({ path: test.info().outputPath('pinned-tab.png') });
    // Ctrl/Cmd+W steps over a pinned tab to the next ordinary one instead of closing it.
    await page.getByRole('tab', { name: /two\.md/ }).click(); await selected('two.md');
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-close-tab')!.click());
    await selected('one.md');
    await expect(names(page)).toHaveCount(5);
    const pinnedMenu = await tabMenu(app, page, 'two.md');
    await expect(pinnedMenu.menu.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible();
    await nativeInput({ keys: ['Escape'] });
    await expect.poll(async () => (await nativeViews(app)).menu).toBe(0);
    await expect(names(page)).toHaveCount(5);

    // Bulk closes spare the pinned tab; the clicked tab takes over from the closed reader.
    await tabMenu(app, page, 'notes.txt'); await chooseNativeMenu(app, ['Close Others']);
    await expect(names(page)).toHaveText(['two.md', 'notes.txt']);
    await selected('notes.txt');
    await open(page, file('three.md')); await open(page, file('one.md'));
    await expect(names(page)).toHaveText(['two.md', 'notes.txt', 'three.md', 'one.md']);
    await tabMenu(app, page, 'notes.txt'); await chooseNativeMenu(app, ['Close to the Right']);
    await expect(names(page)).toHaveText(['two.md', 'notes.txt']);
    await open(page, file('one.md'));
    await tabMenu(app, page, 'one.md'); await chooseNativeMenu(app, ['Close All']);
    await expect(names(page)).toHaveText(['two.md']);
    await selected('two.md');
    await pinnedTab.getByRole('button', { name: 'Unpin tab' }).click();
    await expect(pinnedTab).toHaveCount(0);
    await expect(page.locator('.document-tab [title="Close tab"]')).toHaveCount(1);

    // Split copies the tab into a new group; Move joins the adjacent group.
    await open(page, file('notes.txt'));
    // The submenu repeats Split Right and may already be open under the display's resting pointer.
    const split = await tabMenu(app, page, 'two.md');
    await split.menu.getByRole('menuitem', { name: 'Split Right', exact: true }).first().click();
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect(names(page, 0)).toHaveText(['two.md', 'notes.txt']); await expect(names(page, 1)).toHaveText(['two.md']);
    await tabMenu(app, page, 'notes.txt'); await chooseNativeMenu(app, ['Split & Move', 'Move Right']);
    await expect(names(page, 0)).toHaveText(['two.md']); await expect(names(page, 1)).toHaveText(['two.md', 'notes.txt']);
    await expect(page.locator('.editor-group')).toHaveCount(2);

    // Move into New Window uses the tear-off transfer without a drag.
    await tabMenu(app, page, 'notes.txt', 1); await chooseNativeMenu(app, ['Move into New Window']);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
    await expect(names(page, 0)).toHaveText(['two.md']); await expect(names(page, 1)).toHaveText(['two.md']);
    await expect.poll(async () => {
      for (const candidate of app.windows()) {
        if (candidate === page || candidate.url().includes('menu-overlay=1')) continue;
        const moved = await candidate.locator('.tab-name').allTextContents().catch(() => []);
        if (moved.length) return moved;
      }
      return [];
    }).toEqual(['notes.txt']);
  } finally {
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
  }
});
