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

const exec = promisify(execFile);
const entry = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
const names = (group: Locator) => group.locator('.document-tab .tab-name');
const selected = (group: Locator) => group.locator('.document-tab[aria-selected="true"] .tab-name');
const panel = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
/** The source editor of the group with command focus: the shared foreground surface draws it over that group. */
const focusedEditor = (page: Page) => page.locator('.focused-content .monaco-editor .view-lines:visible');

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
  /** The left group has command focus and took what the panel opened; the right group is as it was. */
  const besideUntouched = async () => {
    await expect(left).toHaveClass(/focused/);
    await expect(right).not.toHaveClass(/focused/);
    await expect(names(right)).toHaveText([other]);
    await expect(selected(right)).toHaveText(other);
    if (kind === 'md') await expect.poll(async () => (await views()).at(-1)).toEqual(expect.objectContaining({ text: 'Other', scrollY: 0 }));
  };
  const dispose = async () => { await disposeApplication(app); for (const folder of [root, config]) await rm(folder, { recursive: true, force: true }); };
  return { app, page, left, right, views, besideUntouched, dispose };
}

test('with two groups the side panel opens in the focused group, as every other command does', async () => {
  test.setTimeout(240_000);
  const root = await project();
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><title>Placed page</title><p>From the browser panel.</p>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { page, left, right, views, besideUntouched, dispose } = await launch(root);
  try {
    // Explorer: a single click previews in the group in use, and the next one reuses that slot.
    await entry(page, 'first.md').click();
    await expect(names(left)).toHaveText(['used.md', 'first.md']);
    await expect(selected(left)).toHaveText('first.md');
    await expect.poll(async () => (await views()).map(view => view.text)).toEqual(['First', 'Other']);
    await besideUntouched();
    await entry(page, 'second.md').click();
    await expect(names(left)).toHaveText(['used.md', 'second.md']);
    await expect.poll(async () => (await views()).map(view => view.text)).toEqual(['Second', 'Other']);
    await besideUntouched();
    await page.screenshot({ path: test.info().outputPath('explorer-preview-focused.png') });

    // A double click opens a tab that stays, after the preview. A text file is shown in the focused group's source editor.
    await entry(page, 'notes.txt').dblclick();
    await expect(names(left)).toHaveText(['used.md', 'second.md', 'notes.txt']);
    await expect(left.locator('.document-tab[aria-selected="true"]')).toHaveAttribute('data-preview', 'false');
    await expect(focusedEditor(page)).toContainText('notes line 1');
    await besideUntouched();

    // Search: the result opens in the focused group and goes to the match.
    await panel(page, 'Search').click();
    await page.getByRole('button', { name: 'All text', exact: true }).click();
    await page.getByLabel('Search in folder').fill('needle');
    for (const file of ['notes.txt', 'deep.md']) await page.locator('.search-file-heading').filter({ hasText: file }).click();
    await page.locator('.search-result[title^="notes.txt:300"]').click();
    await expect(selected(left)).toHaveText('notes.txt');
    await expect(focusedEditor(page)).toContainText('needle in the text file');
    await besideUntouched();
    await page.locator('.search-result[title^="deep.md:"]').click();
    await expect(selected(left)).toHaveText('deep.md');
    await expect.poll(async () => (await views()).map(view => view.text)).toEqual(['Deep', 'Other']);
    await expect.poll(async () => (await views())[0]?.scrollY ?? 0).toBeGreaterThan(1000);
    await besideUntouched();
    await page.screenshot({ path: test.info().outputPath('search-result-focused.png') });
    await page.getByLabel('Search in folder').fill('');

    // Source Control: a change is compared in the focused group.
    await panel(page, 'Source Control').click();
    await page.locator('.git-change-open').filter({ hasText: 'changed.txt' }).click();
    await expect(left.getByRole('tab', { name: /changed\.txt.*Working Tree/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.review-content:not(.inactive)')).toContainText('working tree line');
    await besideUntouched();

    // Terminal: a new session, and a row of the list, show in the focused group.
    await panel(page, 'Terminal').click();
    await page.getByRole('button', { name: 'New terminal session' }).click();
    await expect(selected(left)).toHaveText(/Terminal 1/);
    await expect(page.locator('.terminal-content:not(.inactive) .xterm')).toBeVisible();
    await besideUntouched();
    await left.getByRole('tab', { name: /deep\.md/ }).click();
    await expect(selected(left)).toHaveText('deep.md');
    await page.locator('.terminal-list .session .select').click();
    await expect(selected(left)).toHaveText(/Terminal 1/);
    await besideUntouched();

    // Browser: a visited page opened from History shows its live view in the focused group.
    await page.evaluate(url => window.marktex.openLink(url), `${origin}/`);
    // The first page of a fresh profile waits for the built-in extensions to start.
    await expect(left.getByRole('tab', { name: /Placed page/ })).toBeVisible({ timeout: 60_000 });
    await left.getByRole('tab', { name: /Placed page/ }).locator('.tab-close').click();
    await expect(page.getByRole('tab', { name: /Placed page/ })).toHaveCount(0);
    await panel(page, 'Browser').click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.locator('.open-place').filter({ hasText: 'Placed page' }).click();
    await expect(left.getByRole('tab', { name: /Placed page/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await views()).map(view => view.text)).toEqual(['From the browser panel.', 'Other']);
    await besideUntouched();
    await page.screenshot({ path: test.info().outputPath('browser-history-focused.png') });

    // The group that is clicked into is the one in use from then on.
    const opened = await names(left).allTextContents();
    await right.getByRole('tab', { name: 'other.md' }).click();
    await expect(right).toHaveClass(/focused/);
    await panel(page, 'Explorer').click();
    await entry(page, 'first.md').click();
    await expect(names(right)).toHaveText(['other.md', 'first.md']);
    await expect(selected(right)).toHaveText('first.md');
    await expect(right).toHaveClass(/focused/);
    await expect(names(left)).toHaveText(opened);
    await expect.poll(async () => (await views()).map(view => view.text)).toEqual(['From the browser panel.', 'First']);
  } finally { await dispose(); server.close(); }
});

test('a file with one view is selected where it is, and "Open to the Side" stays an explicit placement', async () => {
  test.setTimeout(120_000);
  const root = await project();
  const { page, left, right, besideUntouched, dispose } = await launch(root, 'png');
  try {
    await besideUntouched();
    // A text file opens in the focused group, beside the picture it had.
    await entry(page, 'notes.txt').dblclick();
    await expect(names(left)).toHaveText(['used.png', 'notes.txt']);
    await expect(selected(left)).toHaveText('notes.txt');
    await expect(focusedEditor(page)).toContainText('notes line 1');
    await besideUntouched();
    // A picture has one view per file: opening the one in the other group selects it there, and focus follows.
    await entry(page, 'other.png').dblclick();
    await expect(right).toHaveClass(/focused/);
    await expect(names(right)).toHaveText(['other.png']);
    await expect(names(left)).toHaveText(['used.png', 'notes.txt']);
    // "Open to the Side" opens to the right of the focused group and takes focus.
    await left.getByRole('tab', { name: 'notes.txt' }).click();
    await expect(left).toHaveClass(/focused/);
    await page.getByRole('treeitem', { name: /^changed\.txt/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open to the Side' }).click();
    await expect(selected(right)).toHaveText('changed.txt');
    await expect(right).toHaveClass(/focused/);
    await expect(names(left)).toHaveText(['used.png', 'notes.txt']);
    // The focused group's editor has the new file; the group that was left keeps showing its own.
    await expect(focusedEditor(page)).toContainText('working tree line');
    await expect(page.locator('.group-editor-host .monaco-editor .view-lines:visible')).toContainText('notes line 1');
  } finally { await dispose(); }
});
