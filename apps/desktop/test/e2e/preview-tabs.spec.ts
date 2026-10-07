import { _electron as electron, expect, test, type Page } from '@playwright/test';
import type { WebContentsView } from 'electron';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication, type TestApplication } from './electron-app';

async function launch() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-preview-tabs-'));
  for (const name of ['keep.txt', 'first.txt', 'second.txt', 'third.txt', 'fourth.txt']) {
    await writeFile(path.join(root, name), `${name} original\n`);
  }
  await writeFile(path.join(root, 'reader.md'), '# Temporary reader\n\nNative content.\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', path.join(root, 'keep.txt')],
    env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  const page = await app.firstWindow();
  await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
  await page.reload();
  await expect(page.getByRole('tab', { name: /keep\.txt/ })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(page.locator('.explorer-tree')).toBeVisible();
  await focusApplication(app);
  return { root, app, page };
}
const row = (page: Page, name: string) => page.locator('.explorer-row').filter({ hasText: name });
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(name.replaceAll('.', '\\.')) });
async function browse(page: Page, name: string) {
  await row(page, name).click();
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
}
async function cleanup(app: TestApplication, root: string) {
  await disposeApplication(app); await rm(root, { recursive: true, force: true });
}

test('Explorer replaces only the temporary tab, releases its native reader, and editing stays pinned after save', async () => {
  const { root, app, page } = await launch();
  try {
    await expect(tab(page, 'keep.txt')).toHaveAttribute('data-preview', 'false');
    await browse(page, 'reader.md');
    await expect(tab(page, 'reader.md')).toHaveAttribute('data-preview', 'true');
    const visibleReader = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(view => view.getVisible()).map(view => (view as WebContentsView).webContents.id));
    await expect.poll(visibleReader).toHaveLength(1);
    const [readerId] = await visibleReader();
    await tab(page, 'keep.txt').click();
    await browse(page, 'first.txt');
    await expect(tab(page, 'reader.md')).toHaveCount(0);
    await expect(page.locator('.document-tab')).toHaveCount(2);
    await expect.poll(() => app.evaluate(({ webContents }, id) => !!webContents.fromId(id), readerId)).toBe(false);
    await browse(page, 'second.txt');
    await expect(tab(page, 'first.txt')).toHaveCount(0);
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('unsaved marker');
    await expect(tab(page, 'second.txt')).toHaveAttribute('data-preview', 'false');
    await browse(page, 'third.txt');
    await expect(tab(page, 'second.txt').getByLabel('Unsaved changes')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await tab(page, 'second.txt').click(); await editor.press('Control+S');
    await expect.poll(() => readFile(path.join(root, 'second.txt'), 'utf8')).toContain('unsaved marker');
    await expect(tab(page, 'second.txt').getByLabel('Unsaved changes')).toHaveCount(0);
    await browse(page, 'fourth.txt');
    await expect(tab(page, 'second.txt')).toHaveAttribute('data-preview', 'false');
    await expect(tab(page, 'third.txt')).toHaveCount(0);
    await expect(page.locator('.document-tab')).toHaveCount(3);
  } finally { await cleanup(app, root); }
});

test('double-click, middle-click, Enter and explicit open keep files without demoting existing tabs', async () => {
  const { root, app, page } = await launch();
  try {
    await browse(page, 'first.txt');
    await tab(page, 'first.txt').dblclick();
    await expect(tab(page, 'first.txt')).toHaveAttribute('data-preview', 'false');
    await row(page, 'second.txt').dblclick();
    await expect(tab(page, 'second.txt')).toHaveAttribute('data-preview', 'false');
    await row(page, 'third.txt').click({ button: 'middle' });
    await expect(tab(page, 'third.txt')).toHaveAttribute('data-preview', 'false');
    await row(page, 'fourth.txt').press('Enter');
    await expect(tab(page, 'fourth.txt')).toHaveAttribute('data-preview', 'false');
    await browse(page, 'first.txt');
    await expect(tab(page, 'first.txt')).toHaveAttribute('data-preview', 'false');
    await browse(page, 'reader.md');
    await expect(tab(page, 'reader.md')).toHaveAttribute('data-preview', 'true');
    // Native Open / external file requests use the document:opened boundary.
    const opened = await page.evaluate(file => window.marktex.openProjectFile(file), path.join(root, 'reader.md'));
    await app.evaluate(({ BrowserWindow }, document) => BrowserWindow.getAllWindows()[0].webContents
      .send('document:opened', document), opened);
    await expect(tab(page, 'reader.md')).toHaveAttribute('data-preview', 'false');
    await expect(page.locator('.document-tab')).toHaveCount(6);
    await row(page, 'reader.md').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
    await expect(tab(page, 'reader.md')).toHaveAttribute('data-preview', 'false');
    await page.getByRole('button', { name: 'New document', exact: true }).click();
    await expect(page.locator('.document-tab')).toHaveCount(7);
    const draft = page.locator('.document-tab[aria-selected="true"]');
    await expect(draft).toHaveAttribute('data-preview', 'false');
    const draftId = await draft.getAttribute('data-tab-id');
    await browse(page, 'keep.txt');
    await expect(page.locator(`[data-tab-id="${draftId}"]`)).toHaveAttribute('data-preview', 'false');
    await expect(page.locator('.document-tab')).toHaveCount(7);
  } finally { await cleanup(app, root); }
});

test('each group owns one preview and dragging a preview keeps its tab', async () => {
  const { root, app, page } = await launch();
  try {
    await browse(page, 'first.txt');
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await tab(page, 'first.txt').dispatchEvent('dragstart', { dataTransfer: transfer });
    const body = page.locator('.group-body').first(), box = (await body.boundingBox())!;
    const point = { clientX: box.x + box.width * .98, clientY: box.y + box.height / 2, dataTransfer: transfer };
    await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
    await transfer.dispose();
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect(tab(page, 'first.txt')).toHaveAttribute('data-preview', 'false');
    await browse(page, 'second.txt');
    await tab(page, 'keep.txt').click();
    await browse(page, 'third.txt');
    await expect(page.locator('.editor-group').first().locator('[data-preview="true"]')).toHaveText(/third\.txt/);
    await expect(page.locator('.editor-group').nth(1).locator('[data-preview="true"]')).toHaveText(/second\.txt/);
    await tab(page, 'first.txt').getByTitle('Close tab', { exact: true }).click();
    await tab(page, 'second.txt').click();
    await expect(tab(page, 'second.txt')).toHaveAttribute('aria-selected', 'true');
    const groupId = await tab(page, 'second.txt').evaluate(node => node.closest<HTMLElement>('.editor-group')!.dataset.groupId);
    await browse(page, 'fourth.txt');
    await expect(tab(page, 'second.txt')).toHaveCount(0);
    await expect(page.locator('.editor-group')).toHaveCount(2);
    expect(await tab(page, 'fourth.txt').evaluate(node => node.closest<HTMLElement>('.editor-group')!.dataset.groupId)).toBe(groupId);
    await expect(tab(page, 'third.txt')).toHaveAttribute('data-preview', 'true');
  } finally { await cleanup(app, root); }
});

test('a late file read cannot replace the last selected file or an explicit native open', async () => {
  const { root, app, page } = await launch();
  try {
    await app.evaluate(({ ipcMain }, delayedPath) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, file: string) => Promise<unknown>;
      const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })
        ._invokeHandlers.get('project:open-file')!;
      const state = { waiting: false, finished: false, release: () => {} };
      (globalThis as typeof globalThis & { heldOpen: typeof state }).heldOpen = state;
      ipcMain.removeHandler('project:open-file');
      ipcMain.handle('project:open-file', async (event, file: string) => {
        if (file.endsWith('/fourth.txt')) throw new Error('Test read failure');
        const result = await original(event, file);
        if (file === delayedPath) {
          state.waiting = true;
          await new Promise<void>(resolve => state.release = resolve);
          state.finished = true;
        }
        return result;
      });
    }, path.join(root, 'first.txt'));
    await row(page, 'first.txt').click();
    await expect.poll(() => app.evaluate(() =>
      (globalThis as typeof globalThis & { heldOpen: { waiting: boolean } }).heldOpen.waiting)).toBe(true);
    await browse(page, 'second.txt');
    await app.evaluate(() => (globalThis as typeof globalThis & { heldOpen: { release(): void } }).heldOpen.release());
    await expect.poll(() => app.evaluate(() =>
      (globalThis as typeof globalThis & { heldOpen: { finished: boolean } }).heldOpen.finished)).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(tab(page, 'first.txt')).toHaveCount(0);
    await expect(tab(page, 'second.txt')).toHaveAttribute('aria-selected', 'true');

    await app.evaluate(() => {
      const state = (globalThis as typeof globalThis & { heldOpen: { waiting: boolean; finished: boolean } }).heldOpen;
      state.waiting = false; state.finished = false;
    });
    await row(page, 'first.txt').click();
    await expect.poll(() => app.evaluate(() =>
      (globalThis as typeof globalThis & { heldOpen: { waiting: boolean } }).heldOpen.waiting)).toBe(true);
    const opened = await page.evaluate(file => window.marktex.openProjectFile(file), path.join(root, 'third.txt'));
    await app.evaluate(({ BrowserWindow }, document) => BrowserWindow.getAllWindows()[0].webContents
      .send('document:opened', document), opened);
    await expect(tab(page, 'third.txt')).toHaveAttribute('aria-selected', 'true');
    await app.evaluate(() => (globalThis as typeof globalThis & { heldOpen: { release(): void } }).heldOpen.release());
    await expect.poll(() => app.evaluate(() =>
      (globalThis as typeof globalThis & { heldOpen: { finished: boolean } }).heldOpen.finished)).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(tab(page, 'first.txt')).toHaveCount(0);
    await expect(tab(page, 'third.txt')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'third.txt')).toHaveAttribute('data-preview', 'false');
    await expect(tab(page, 'second.txt')).toHaveAttribute('data-preview', 'true');
    await row(page, 'fourth.txt').click();
    await expect(page.locator('.project-error')).toContainText('Test read failure');
    await expect(tab(page, 'fourth.txt')).toHaveCount(0);
    await expect(tab(page, 'third.txt')).toHaveAttribute('aria-selected', 'true');
  } finally { await cleanup(app, root); }
});
