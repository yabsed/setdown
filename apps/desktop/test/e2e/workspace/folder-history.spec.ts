import { expect, test } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

test('starts empty, keeps five recent folders, and None preserves unsaved file tabs', async () => {
  const f = await fixture(false);
  try {
    await expect(f.page.locator('.document-tab')).toHaveCount(0);
    expect(await f.page.evaluate(() => window.marktex.getProjectFolder())).toBeNull();
    const folders = Array.from({ length: 6 }, (_, i) => path.join(f.root, `folder-${i}`));
    for (const folder of folders) await mkdir(folder);
    for (const folder of [...folders, folders[2]]) {
      await f.app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
      await f.page.locator('.empty-folder').click();
      await expect(f.page.getByRole('button', { name: 'Workspace folder', exact: true })).toHaveAttribute('title', folder);
    }
    const expected = [folders[2], folders[5], folders[4], folders[3], folders[1]];
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.getRecentProjectFolders()).map(folder => folder.path))).toEqual(expected);
    const recent = f.page.getByRole('region', { name: 'Recent folders' });
    await expect(recent.getByRole('button')).toHaveCount(5);
    await expect(recent.locator('button span')).toHaveText(expected.map(folder => path.basename(folder)));
    await f.page.getByRole('button', { name: 'Workspace folder', exact: true }).click();
    const menu = f.page.getByRole('menu', { name: 'Choose workspace folder' });
    await expect(menu.getByRole('menuitemradio')).toHaveCount(6);
    await expect(menu.getByRole('menuitemradio', { checked: true })).toContainText('folder-2');
    await menu.getByRole('menuitemradio', { checked: true }).press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(f.page.getByRole('button', { name: 'Workspace folder', exact: true })).toBeFocused();

    const file = path.join(folders[2], 'draft.txt');
    await writeFile(file, 'Original draft\n');
    await f.app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await f.page.locator('.empty-open').click();
    const tab = f.page.getByRole('tab', { name: /draft.txt/ });
    await expect(tab).toBeVisible();
    const tabId = await tab.getAttribute('data-tab-id');
    const editor = f.page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('KEEP_UNSAVED');
    await expect(tab.getByLabel('Unsaved changes')).toBeVisible();
    await f.page.getByRole('button', { name: 'Workspace folder', exact: true }).click();
    await menu.getByRole('menuitemradio', { name: /^None/ }).click();
    await expect(f.page.getByRole('button', { name: 'Workspace folder', exact: true })).toHaveText('None');
    expect(await f.page.evaluate(() => window.marktex.getProjectFolder())).toBeNull();
    await expect(f.page.locator('.explorer-root')).toHaveCount(0);
    await expect(tab).toHaveAttribute('data-tab-id', tabId!);
    await expect(tab.getByLabel('Unsaved changes')).toBeVisible();
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.getDocument())?.text)).toContain('KEEP_UNSAVED');
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    await f.page.screenshot({ path: test.info().outputPath('none-preserves-draft.png') });
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('Reload retains the current folder and live pages; restarting keeps only folder history', async () => {
  const f = await fixture(false);
  try {
    await f.app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, f.root);
    await f.page.locator('.empty-folder').click();
    await expect(f.page.getByRole('button', { name: 'Workspace folder', exact: true })).toHaveAttribute('title', f.root);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="LIVE_AFTER_RELOAD";true');
    const contentsId = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
    await f.page.reload();
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await expect(f.page.getByRole('button', { name: 'Workspace folder', exact: true })).toHaveAttribute('title', f.root);
    expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), contentsId)).toBe('LIVE_AFTER_RELOAD');
    const requests = f.requests.filter(url => url === '/first').length;
    await f.restart();
    await expect(f.page.locator('.empty-state')).toBeVisible();
    expect(await f.page.evaluate(() => window.marktex.getProjectFolder())).toBeNull();
    expect(await f.page.evaluate(() => window.marktex.browser.restore())).toEqual([]);
    await expect(f.page.locator('.document-tab')).toHaveCount(0);
    const recent = f.page.getByRole('region', { name: 'Recent folders' });
    await expect(recent.getByRole('button')).toHaveCount(1);
    expect(f.requests.filter(url => url === '/first').length).toBe(requests);
    await f.page.screenshot({ path: test.info().outputPath('empty-start-recent-folders.png') });
    await recent.getByRole('button').click();
    await expect(f.page.getByRole('button', { name: 'Workspace folder', exact: true })).toHaveAttribute('title', f.root);
    await expect(f.page.locator('.document-tab')).toHaveCount(0);
    // A new window has its own None state and shares history, without adopting
    // the other window's folder or opening a placeholder tab.
    const created = f.app.waitForEvent('window');
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-window')!.click());
    const other = await created;
    await expect(other.getByRole('region', { name: 'Recent folders' }).getByRole('button')).toHaveCount(1);
    expect(await other.evaluate(() => window.marktex.getProjectFolder())).toBeNull();
    await expect(other.locator('.document-tab')).toHaveCount(0);
    expect(await f.page.evaluate(() => window.marktex.getProjectFolder())).toMatchObject({ path: f.root });
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('an explicit startup file opens alone, and a missing recent folder keeps the current workspace', async () => {
  const f = await fixture();
  try {
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    expect(await f.page.evaluate(() => window.marktex.getProjectFolder())).toBeNull();
    const missing = path.join(f.root, 'removed-folder');
    await mkdir(missing);
    // Populate history through the service, then let Reload reconnect the UI.
    await f.page.evaluate(folder => window.marktex.restoreProjectFolder(folder), missing);
    await f.page.evaluate(folder => window.marktex.restoreProjectFolder(folder), f.root);
    await f.page.reload();
    await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await f.page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await rm(missing, { recursive: true });
    await f.page.getByRole('button', { name: 'Workspace folder', exact: true }).click();
    await f.page.getByRole('menuitemradio', { name: /removed-folder/ }).click();
    await expect(f.page.locator('.project-error')).toContainText('Folder is unavailable');
    expect(await f.page.evaluate(() => window.marktex.getProjectFolder())).toMatchObject({ path: f.root });
    await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('the folder menu owns Escape and reselecting the current folder keeps Explorer state', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(folder => window.marktex.restoreProjectFolder(folder), f.root);
    await f.page.reload();
    await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await f.page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-toggle-surface')!.click());
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    const picker = f.page.getByRole('button', { name: 'Workspace folder', exact: true });
    const menu = f.page.getByRole('menu', { name: 'Choose workspace folder' });
    await picker.click();
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitemradio', { checked: true }).press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(picker).toBeFocused();
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    const root = f.page.locator('.explorer-root');
    await root.click();
    await expect(root).toHaveAttribute('aria-expanded', 'false');
    await picker.click();
    await f.page.screenshot({ path: test.info().outputPath('folder-selector.png') });
    await menu.getByRole('menuitemradio', { checked: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(root).toHaveAttribute('aria-expanded', 'false');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
