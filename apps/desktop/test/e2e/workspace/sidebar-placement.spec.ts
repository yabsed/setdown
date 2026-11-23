import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WebContentsView } from 'electron';
import { chooseNativeMenu } from '../../support/browser/browser-fixture';
import { pngFixture } from '../../support/media/png-fixture';
import { openApplicationMenu } from '../../support/electron/application-menu';

const exec = promisify(execFile);
const entry = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
const names = (group: Locator) => group.locator('.document-tab .tab-name');
const selected = (group: Locator) => group.locator('.document-tab[aria-selected="true"] .tab-name');
const panel = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** File menu → an item. Over a live web page the menu is painted in its own native layer. */
async function fileMenu(page: Page, id: string) {
  await openApplicationMenu(page, 'File');
  const item = async () => {
    for (const layer of [page, ...page.context().pages().filter(layer => layer !== page && layer.url().includes('menu-overlay=1'))]) {
      const found = layer.locator(`[data-menu-item-id="${id}"]`);
      if (await found.isVisible().catch(() => false)) return found;
    }
    return null;
  };
  await expect.poll(async () => !!await item()).toBe(true);
  await (await item())!.click();
}

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-sidebar-placement-'));
  await writeFile(path.join(root, 'used.md'), '# In use\n\nThe tab being read.\n');
  await writeFile(path.join(root, 'other.md'), '# Other\n\nCovered by what the panel opens.\n');
  await writeFile(path.join(root, 'first.md'), '# First\n\nFirst file from the panel.\n');
  await writeFile(path.join(root, 'second.md'), '# Second\n\nSecond file from the panel.\n');
  await writeFile(path.join(root, 'notes.txt'), Array.from({ length: 400 }, (_, index) => index === 299 ? 'needle in the text file' : `notes line ${index + 1}`).join('\n'));
  await writeFile(path.join(root, 'deep.md'), ['# Deep', '', ...Array.from({ length: 300 }, (_, index) => `${index === 249 ? 'needle in the document' : `Paragraph ${index + 1}.`}\n`)].join('\n'));
  await writeFile(path.join(root, 'changed.txt'), 'base\n');
  await writeFile(path.join(root, 'used.png'), pngFixture(40, 30, [41, 128, 185]));
  await writeFile(path.join(root, 'other.png'), pngFixture(30, 40, [39, 174, 96]));
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(path.join(root, 'changed.txt'), 'base\nworking tree line\n');
  return root;
}

/** The project with `used.<kind>` in the left group, which has command focus, and `other.<kind>` in the right one. */
async function launch(root: string, kind: 'md' | 'png' = 'md') {
  const used = `used.${kind}`, other = `other.${kind}`;
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  // The profile lives outside the project, or its files would be changes and search candidates.
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-sidebar-placement-config-'));
  const app = await electron.launch({ args: ['.', path.join(root, used)], env: { ...env, XDG_CONFIG_HOME: config } });
  const page = await app.firstWindow();
  await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
  await Promise.all([page.waitForEvent('load'), page.reload()]);
  await focusApplication(app);
  await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  await panel(page, 'Explorer').click();
  await expect(entry(page, used)).toBeVisible();
  await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), path.join(root, other));
  const tab = page.getByRole('tab', { name: other });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await tab.click({ button: 'right' }); await chooseNativeMenu(app, ['Split & Move', 'Move Right']);
  await expect(page.locator('.editor-group')).toHaveCount(2);
  const left = page.locator('.editor-group').first(), right = page.locator('.editor-group').nth(1);
  await left.getByRole('tab', { name: used }).click();
  await expect(left).toHaveClass(/focused/);
  /** Native views on screen, left to right: Markdown readers and web pages. */
  const views = () => app.evaluate(async ({ BrowserWindow }) => (await Promise.all(BrowserWindow.getAllWindows()[0].contentView.children
    .filter(view => view.getVisible() && view.getBounds().width > 0).map(async view => ({ x: view.getBounds().x,
      text: String(await (view as WebContentsView).webContents.executeJavaScript('document.body.innerText').catch(() => '')).trim().split('\n')[0],
      scrollY: Number(await (view as WebContentsView).webContents.executeJavaScript('window.scrollY').catch(() => 0)) }))))
    .sort((a, b) => a.x - b.x));
  /** The left group still has command focus and still shows the tab that was being used. */
  const inUse = async () => {
    await expect(left).toHaveClass(/focused/);
    await expect(right).not.toHaveClass(/focused/);
    await expect(names(left)).toHaveText([used]);
    await expect(selected(left)).toHaveText(used);
    if (kind === 'md') await expect.poll(async () => (await views())[0]?.text).toBe('In use');
    else await expect(page.locator('.media-content:not(.inactive) .image-surface')).toHaveCount(2);
  };
  const dispose = async () => { await disposeApplication(app); for (const folder of [root, config]) await rm(folder, { recursive: true, force: true }); };
  return { app, page, left, right, views, inUse, dispose };
}

test('with two groups the side panel opens beside the tab in use and leaves command focus with it', async () => {
  test.setTimeout(240_000);
  const root = await project();
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><title>Placed page</title><p>From the browser panel.</p>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { page, left, right, views, inUse, dispose } = await launch(root);
  try {
    // Explorer: a single click previews beside the tab in use, and the next one reuses that slot.
    await entry(page, 'first.md').click();
    await expect(names(right)).toHaveText(['other.md', 'first.md']);
    await expect(selected(right)).toHaveText('first.md');
    await expect.poll(async () => (await views()).map(view => view.text)).toEqual(['In use', 'First']);
    await inUse();
    await entry(page, 'second.md').click();
    await expect(names(right)).toHaveText(['other.md', 'second.md']);
    await expect.poll(async () => (await views()).map(view => view.text)).toEqual(['In use', 'Second']);
    await inUse();
    // The keyboard stays in the panel: the arrow keys keep walking the tree.
    expect(await page.evaluate(() => !!document.activeElement?.closest('.project-sidebar'))).toBe(true);
    await page.screenshot({ path: test.info().outputPath('explorer-preview-beside.png') });

    // A double click keeps the file open there. A text file gets that group's source editor.
    await entry(page, 'notes.txt').dblclick();
    await expect(selected(right)).toHaveText('notes.txt');
    await expect(right.locator('.document-tab[aria-selected="true"]')).toHaveAttribute('data-preview', 'false');
    await expect(right.locator('.monaco-editor .view-lines')).toContainText('notes line 1');
    await expect(right.locator('.monaco-editor.focused')).toHaveCount(0);
    await inUse();

    // Search: the result's tab goes to the match; the tab in use neither moves nor loses its place.
    await panel(page, 'Search').click();
    await page.getByRole('button', { name: 'All text', exact: true }).click();
    await page.getByLabel('Search in folder').fill('needle');
    for (const file of ['notes.txt', 'deep.md']) await page.locator('.search-file-heading').filter({ hasText: file }).click();
    await page.locator('.search-result[title^="notes.txt:300"]').click();
    await expect(selected(right)).toHaveText('notes.txt');
    await expect(right.locator('.monaco-editor .view-lines')).toContainText('needle in the text file');
    await inUse();
    await page.locator('.search-result[title^="deep.md:"]').click();
    await expect(selected(right)).toHaveText('deep.md');
    await expect.poll(async () => (await views()).map(view => view.text)).toEqual(['In use', 'Deep']);
    await expect.poll(async () => (await views())[1]?.scrollY ?? 0).toBeGreaterThan(1000);
    expect((await views())[0].scrollY).toBe(0);
    await inUse();
    await page.screenshot({ path: test.info().outputPath('search-result-beside.png') });
    await page.getByLabel('Search in folder').fill('');

    // Source Control: a change is compared beside the tab in use.
    await panel(page, 'Source Control').click();
    await page.locator('.git-change-open').filter({ hasText: 'changed.txt' }).click();
    await expect(selected(right)).toHaveText(/changed\.txt/);
    await expect(right.getByRole('tab', { name: /changed\.txt.*Working Tree/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.review-content:not(.inactive)')).toContainText('working tree line');
    await inUse();

    // Terminal: a new session, and a session row, show in the other group.
    await panel(page, 'Terminal').click();
    await page.getByRole('button', { name: 'New terminal session' }).click();
    await expect(selected(right)).toHaveText(/Terminal 1/);
    await expect(page.locator('.terminal-content:not(.inactive) .xterm')).toBeVisible();
    await inUse();

    // Files: a new file manager tab shows in the other group.
    await panel(page, 'Files').click();
    await page.getByRole('button', { name: 'New file manager tab' }).click();
    await expect(selected(right)).toHaveText(path.basename(root));
    await expect(page.locator('.folder-content:not(.inactive)')).toBeVisible();
    await inUse();
    await panel(page, 'Terminal').click();
    await page.locator('.terminal-list .session .select').click();
    await expect(selected(right)).toHaveText(/Terminal 1/);
    await inUse();
    await panel(page, 'Files').click();
    await page.locator('.folder-sessions .session .select').click();
    await expect(selected(right)).toHaveText(path.basename(root));
    await inUse();

    // Browser: a visited page opened from History shows its live view in the other group.
    await page.evaluate(url => window.marktex.openLink(url), `${origin}/`);
    // The first page of a fresh profile waits for the built-in extensions to start.
    await expect(left.getByRole('tab', { name: /Placed page/ })).toBeVisible({ timeout: 60_000 });
    await left.getByRole('tab', { name: /Placed page/ }).locator('.tab-close').click();
    await expect(page.getByRole('tab', { name: /Placed page/ })).toHaveCount(0);
    await inUse();
    await panel(page, 'Browser').click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.locator('.open-place').filter({ hasText: 'Placed page' }).click();
    await expect(right.getByRole('tab', { name: /Placed page/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await views()).map(view => view.text)).toEqual(['In use', 'From the browser panel.']);
    await inUse();
    await page.screenshot({ path: test.info().outputPath('browser-history-beside.png') });

    // Commands still act on the tab in use: Close Tab closes it, not what the panel opened.
    const opened = await names(right).allTextContents();
    await fileMenu(page, 'menu-close-tab');
    await expect(page.getByRole('tab', { name: /used\.md/ })).toHaveCount(0);
    await expect(page.locator('.editor-group')).toHaveCount(1);
    await expect(names(page.locator('.editor-group'))).toHaveText(opened);
    // With one group left, the panel opens in it and the file takes focus as before.
    await panel(page, 'Explorer').click();
    await entry(page, 'first.md').click();
    await expect(selected(page.locator('.editor-group'))).toHaveText('first.md');
    await expect(page.locator('.editor-group')).toHaveCount(1);
    await expect.poll(async () => (await views()).map(view => view.text)).toEqual(['First']);
  } finally { await dispose(); server.close(); }
});

test('a group that never had a source editor shows the text file the panel opens in it', async () => {
  test.setTimeout(120_000);
  const root = await project();
  // Two pictures: no document has asked for the source editor yet, in either group.
  const { page, right, inUse, dispose } = await launch(root, 'png');
  try {
    await inUse();
    expect(await page.locator('.monaco-editor').count()).toBe(0);
    await entry(page, 'notes.txt').dblclick();
    await expect(selected(right)).toHaveText('notes.txt');
    await expect(right.locator('.monaco-editor .view-lines')).toContainText('notes line 1');
    await expect(page.locator('.media-content:not(.inactive) .image-surface')).toHaveCount(1);
    await expect(page.locator('.editor-group').first()).toHaveClass(/focused/);
    await expect(selected(page.locator('.editor-group').first())).toHaveText('used.png');
    // The picture is a document with one view: selecting it again from the panel shows it where it is.
    await entry(page, 'other.png').dblclick();
    await expect(selected(right)).toHaveText('other.png');
    await inUse();
    // "Open to the Side" stays an explicit placement: it takes focus in the group on the right.
    await page.getByRole('treeitem', { name: /^changed\.txt/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open to the Side' }).click();
    await expect(selected(right)).toHaveText('changed.txt');
    await expect(right).toHaveClass(/focused/);
    // The focused group's editor is drawn by the shared foreground surface, over that group.
    await expect(page.locator('.monaco-editor .view-lines:visible')).toContainText('working tree line');
  } finally { await dispose(); }
});
