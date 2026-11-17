import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { WebContentsView } from 'electron';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../../support/electron/electron-app';
import { chooseNativeMenu } from '../../support/browser/browser-fixture';
import { pngFixture } from '../../support/media/png-fixture';

/** Folder tabs and the in-app chooser run with a temporary HOME and the platform dialog disabled. */
async function launch(): Promise<{ root: string; home: string; app: TestApplication; page: Page }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-folder-tab-'));
  const home = path.join(root, 'home');
  await mkdir(path.join(home, 'Projects', 'alpha', 'notes'), { recursive: true });
  await mkdir(path.join(home, 'Documents'), { recursive: true });
  await writeFile(path.join(home, 'Projects', 'alpha', 'README.md'), '# Alpha\n\nFolder tab fixture.\n');
  await writeFile(path.join(home, 'Projects', 'alpha', 'data.csv'), 'a,b\n');
  await writeFile(path.join(home, 'Projects', 'alpha', '.hidden-note'), 'secret\n');
  await writeFile(path.join(home, 'Projects', 'beta.txt'), 'beta\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, HOME: home, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'), SETDOWN_NATIVE_DIALOGS: '0' } });
  const page = await app.firstWindow();
  await focusApplication(app);
  return { root, home, app, page };
}
const list = (page: Page) => page.locator('.folder-content:not(.inactive) [data-folder-list]');
const row = (page: Page, name: string) => list(page).getByRole('option', { name, exact: false }).filter({ has: page.locator('.folder-label', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const labels = (page: Page) => list(page).locator('.folder-row .folder-label').allTextContents();
/** The folder tab's menus open in the native menu layer, above every other view of the window. */
const menuViews = (app: TestApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
  .filter(view => view.getVisible() && (view as WebContentsView).webContents.getURL().includes('menu-overlay=1')).length);
async function openMenu(app: TestApplication, target: Locator, position?: { x: number; y: number }): Promise<Page> {
  await target.click({ button: 'right', position });
  await expect.poll(() => menuViews(app)).toBe(1);
  return app.windows().find(page => page.url().includes('menu-overlay=1'))!;
}
/** A row by its label alone: its accessible name also carries the shortcut. */
const item = (menu: Page, label: string) => menu.locator('[role^="menuitem"]')
  .filter({ has: menu.locator('.product-menu-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
async function choose(app: TestApplication, target: Locator, label: string, position?: { x: number; y: number }) {
  const menu = await openMenu(app, target, position);
  await item(menu, label).click();
  await expect.poll(() => menuViews(app)).toBe(0);
}

test('a folder tab browses from the new-tab button, keeps selection through Back, and opens documents in tabs', async () => {
  const { root, home, app, page } = await launch();
  try {
    await page.getByRole('button', { name: 'Browse Files', exact: true }).click();
    await expect(page.getByRole('tab', { name: /home/ })).toHaveAttribute('aria-selected', 'true');
    await expect(list(page)).toBeFocused();
    await expect.poll(() => labels(page)).toEqual(['Documents', 'Projects']);
    await row(page, 'Projects').dblclick();
    await expect.poll(() => labels(page)).toEqual(['alpha', 'beta.txt']);
    await row(page, 'alpha').click();
    await page.keyboard.press('Enter');
    await expect.poll(() => labels(page)).toEqual(['notes', 'data.csv', 'README.md']);
    await page.keyboard.press('Control+h');
    await expect.poll(() => labels(page)).toEqual(['notes', '.hidden-note', 'data.csv', 'README.md']);
    await page.keyboard.press('Control+h');
    // Back keeps the folder tab and reselects the folder that was left (Nautilus keeps the selection per history entry).
    await page.keyboard.press('Alt+ArrowLeft');
    await expect.poll(() => labels(page)).toEqual(['alpha', 'beta.txt']);
    await expect(row(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Alt+ArrowRight');
    await expect.poll(() => labels(page)).toEqual(['notes', 'data.csv', 'README.md']);
    await page.keyboard.press('Backspace');
    await expect(row(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
    // The address bar takes folder paths, including ~, and completes them from the filesystem.
    const address = page.locator('.location-bar input').first();
    await address.click(); await address.fill('~/Proj');
    // Completion is debounced; wait for the filesystem suggestion before Tab accepts it.
    await page.waitForTimeout(400);
    await address.press('Tab');
    await expect(address).toHaveValue(`${path.join(home, 'Projects')}/`);
    await address.fill('~/Documents'); await address.press('Enter');
    await expect(page.locator('.folder-content:not(.inactive) .folder-crumbs [aria-current="location"]')).toHaveText('Documents');
    await address.click(); await address.fill(path.join(home, 'Projects', 'alpha')); await address.press('Enter');
    await expect.poll(() => labels(page)).toEqual(['notes', 'data.csv', 'README.md']);
    await row(page, 'README.md').dblclick();
    await expect(page.getByRole('tab', { name: /README\.md/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /alpha/ })).toBeVisible();
    expect(await page.evaluate(() => window.marktex.files.places().then(places => places.map(place => place.kind)))).toContain('home');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('folder tab file operations work outside any workspace and route Ctrl+C/V to the focused folder', async () => {
  const { root, home, app, page } = await launch();
  try {
    await app.evaluate(({ shell }) => {
      const { rm } = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises');
      shell.trashItem = async file => { await rm(file, { recursive: true }); };
    });
    const alpha = path.join(home, 'Projects', 'alpha');
    await page.getByRole('button', { name: 'Browse Files', exact: true }).click();
    const address = page.locator('.location-bar input').first();
    await address.click(); await address.fill(alpha); await address.press('Enter');
    await expect.poll(() => labels(page)).toEqual(['notes', 'data.csv', 'README.md']);
    await list(page).focus();
    await page.keyboard.press('Control+Shift+N');
    const name = list(page).getByRole('textbox', { name: 'New folder name' });
    await expect(name).toBeFocused();
    await name.fill('drafts'); await name.press('Enter');
    await expect.poll(() => readdir(alpha)).toContain('drafts');
    await expect(row(page, 'drafts')).toHaveAttribute('aria-selected', 'true');
    await row(page, 'data.csv').click();
    await page.keyboard.press('F2');
    const rename = list(page).getByRole('textbox', { name: 'Rename' });
    await rename.fill('table.csv'); await rename.press('Enter');
    await expect.poll(() => readdir(alpha)).toContain('table.csv');
    // The context menu reaches the same commands with the pointer as the keyboard shortcuts do.
    await choose(app, row(page, 'table.csv'), 'Rename');
    await expect(rename).toBeFocused();
    await rename.fill('sheet.csv'); await rename.press('Enter');
    await expect.poll(() => readdir(alpha)).toContain('sheet.csv');
    await choose(app, row(page, 'sheet.csv'), 'Properties');
    const properties = page.getByRole('dialog', { name: 'Properties' });
    await expect(properties).toContainText('sheet.csv');
    await properties.getByRole('button', { name: 'Close' }).click();
    await expect(properties).toHaveCount(0);
    await choose(app, row(page, 'sheet.csv'), 'Rename');
    await rename.fill('table.csv'); await rename.press('Enter');
    await expect.poll(() => readdir(alpha)).toContain('table.csv');
    await row(page, 'table.csv').click();
    await page.keyboard.press('Control+c');
    await row(page, 'drafts').dblclick();
    await expect.poll(() => labels(page)).toEqual([]);
    await list(page).focus();
    await page.keyboard.press('Control+v');
    // Paste completes asynchronously; selection is published after the copy and re-list.
    await expect(row(page, 'table.csv')).toHaveAttribute('aria-selected', 'true');
    expect(await readFile(path.join(alpha, 'drafts', 'table.csv'), 'utf8')).toBe('a,b\n');
    await page.keyboard.press('Delete');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
    await expect.poll(() => readdir(path.join(alpha, 'drafts'))).toEqual([]);
    await expect.poll(() => labels(page)).toEqual([]);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('an image copied from another application pastes into a folder tab as a new file', async () => {
  const { root, home, app, page } = await launch();
  try {
    const documents = path.join(home, 'Documents');
    await writeFile(path.join(documents, 'Pasted image.png'), 'KEEP');
    await page.getByRole('button', { name: 'Browse Files', exact: true }).click();
    await row(page, 'Documents').dblclick();
    await expect.poll(() => labels(page)).toEqual(['Pasted image.png']);
    // A screenshot or a browser's “Copy image”: pixels on the clipboard, no file behind them.
    const png = pngFixture(7, 5, [39, 174, 96]);
    await app.evaluate(async ({ clipboard, ClipboardItem }, bytes) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(bytes, 'base64')], { type: 'image/png' }) })]);
    }, png.toString('base64'));
    await list(page).focus();
    await page.keyboard.press('Control+v');
    await expect(row(page, 'Pasted image 2.png')).toHaveAttribute('aria-selected', 'true');
    const pasted = await readFile(path.join(documents, 'Pasted image 2.png'));
    expect([pasted.subarray(1, 4).toString('latin1'), pasted.readUInt32BE(16), pasted.readUInt32BE(20)]).toEqual(['PNG', 7, 5]);
    expect(await readFile(path.join(documents, 'Pasted image.png'), 'utf8')).toBe('KEEP');
    await expect(page.locator('.folder-content:not(.inactive) .folder-error')).toHaveCount(0);
    // The folder's own menu offers Paste for image data too.
    const menu = await openMenu(app, list(page), { x: 400, y: 300 });
    await expect(item(menu, 'Paste')).toBeEnabled();
    await item(menu, 'Paste').click();
    await expect.poll(() => menuViews(app)).toBe(0);
    await expect(row(page, 'Pasted image 3.png')).toHaveAttribute('aria-selected', 'true');
    expect((await readdir(documents)).sort()).toEqual(['Pasted image 2.png', 'Pasted image 3.png', 'Pasted image.png']);
    // Undo removes only the file the last paste created.
    await app.evaluate(({ shell }) => {
      const { rm } = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises');
      shell.trashItem = async file => { await rm(file, { recursive: true }); };
    });
    await list(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await readdir(documents)).sort()).toEqual(['Pasted image 2.png', 'Pasted image.png']);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('two folder tabs of one directory stay two tabs when one is dragged along the tab strip', async () => {
  const { root, app, page } = await launch();
  try {
    await page.getByRole('button', { name: 'Browse Files', exact: true }).click();
    await page.locator('.new-folder-tab-button').click();
    const tabs = page.locator('.document-tab');
    const ids = () => tabs.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tab-id')));
    await expect(tabs).toHaveCount(2);
    expect(new Set(await tabs.evaluateAll(nodes => nodes.map(node => node.getAttribute('title')))).size).toBe(1);
    // The dragged tab keeps its own state; a path is not a tab identity.
    await row(page, 'Projects').click();
    const [first, second] = await ids();
    const from = (await tabs.nth(1).boundingBox())!, to = (await tabs.nth(0).boundingBox())!;
    await page.mouse.move(from.x + 30, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + from.height / 2, { steps: 5 });
    await page.mouse.move(to.x + 8, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
    await expect.poll(ids).toEqual([second, first]);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(row(page, 'Projects')).toHaveAttribute('aria-selected', 'true');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('a folder tab’s menu leaves a website in another group running, and Open in Terminal starts in that folder', async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  test.setTimeout(120_000);
  const { root, home, app, page } = await launch();
  // The page counts the frames it draws: a hidden or detached view draws none.
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><title>Live page</title><p>Playing.</p><script>window.drawn = 0; (function draw() { window.drawn++; requestAnimationFrame(draw); })();</script>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const site = () => app.evaluate(async ({ BrowserWindow }, origin) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => (view as WebContentsView).webContents?.getURL().startsWith(origin)) as WebContentsView | undefined;
    return { shown: !!view?.getVisible(), drawn: view ? await view.webContents.executeJavaScript('window.drawn') as number : -1 };
  }, origin);
  const advancing = async () => { const before = (await site()).drawn; await expect.poll(async () => (await site()).drawn).toBeGreaterThan(before + 5); };
  const terminal = page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
  const where = async (name: string) => {
    await expect(terminal).toBeFocused();
    await terminal.pressSequentially(`pwd > "$HOME/${name}"`); await terminal.press('Enter');
    await expect.poll(() => readFile(path.join(home, name), 'utf8').catch(() => '')).not.toBe('');
    return (await readFile(path.join(home, name), 'utf8')).trim();
  };
  try {
    const alpha = await realpath(path.join(home, 'Projects', 'alpha'));
    await page.evaluate(url => window.marktex.openLink(url), `${origin}/`);
    await expect(page.getByRole('tab', { name: /Live page/ })).toBeVisible();
    // The folder tab moves to a group of its own, beside the website.
    await page.getByRole('button', { name: 'New folder tab', exact: true }).click();
    const folder = page.locator('.document-tab[aria-selected="true"]').filter({ hasText: 'home' });
    await expect(folder).toBeVisible();
    await folder.click({ button: 'right' }); await chooseNativeMenu(app, ['Split & Move', 'Move Right']);
    await expect(page.locator('.editor-group')).toHaveCount(2);
    const address = page.locator('.editor-group.focused .location-bar input');
    await address.click(); await address.fill(alpha); await address.press('Enter');
    await expect.poll(() => labels(page)).toEqual(['notes', 'data.csv', 'README.md']);
    await expect.poll(async () => (await site()).shown).toBe(true);
    await advancing();

    // With the menu open the website is still on screen and still drawing.
    const menu = await openMenu(app, row(page, 'notes'));
    await expect(item(menu, 'Open in Terminal')).toBeVisible();
    expect((await site()).shown).toBe(true);
    await advancing();
    await menu.screenshot({ path: test.info().outputPath('folder-menu.png') });

    // A folder row: the shell starts inside it, not in the workspace or home folder.
    await item(menu, 'Open in Terminal').click();
    await expect.poll(() => menuViews(app)).toBe(0);
    await expect(page.getByRole('tab', { name: /^Terminal 1/ })).toHaveAttribute('aria-selected', 'true');
    expect(await where('folder-row.txt')).toBe(path.join(alpha, 'notes'));
    // A file row: the folder that holds it.
    await page.locator('.editor-group.focused .document-tab').filter({ hasText: 'alpha' }).click();
    await choose(app, row(page, 'README.md'), 'Open in Terminal');
    await expect(page.getByRole('tab', { name: /^Terminal 2/ })).toHaveAttribute('aria-selected', 'true');
    expect(await where('file-row.txt')).toBe(alpha);
    // The folder's own menu, on empty space: the folder shown.
    await page.locator('.editor-group.focused .document-tab').filter({ hasText: 'alpha' }).click();
    await row(page, 'notes').dblclick();
    await expect.poll(() => labels(page)).toEqual([]);
    const box = (await list(page).boundingBox())!;
    await choose(app, list(page), 'Open in Terminal', { x: box.width / 2, y: box.height - 60 });
    await expect(page.getByRole('tab', { name: /^Terminal 3/ })).toHaveAttribute('aria-selected', 'true');
    expect(await where('folder-space.txt')).toBe(path.join(alpha, 'notes'));
    expect((await site()).shown).toBe(true);
  } finally {
    await page.screenshot({ path: test.info().outputPath('folder-terminal.png') }).catch(() => {});
    await disposeApplication(app); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true });
  }
});

test('Open Folder and Save As use the in-app chooser instead of the platform dialog', async () => {
  const { root, home, app, page } = await launch();
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<title>Chooser detour</title><p>Web page</p>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await app.evaluate(({ dialog }) => {
      const fail = () => { throw Error('The platform dialog must not open.'); };
      dialog.showOpenDialog = fail as typeof dialog.showOpenDialog; dialog.showSaveDialog = fail as typeof dialog.showSaveDialog;
    });
    await page.locator('.empty-folder').click();
    const chooser = page.getByRole('tab', { name: /Open Folder/ });
    await expect(chooser).toHaveAttribute('aria-selected', 'true');
    const bar = page.getByRole('form', { name: 'Open Folder' });
    await row(page, 'Projects').dblclick();
    // A file cannot answer a folder request; with no fitting selection the current folder is chosen.
    await row(page, 'beta.txt').click();
    await expect(bar).toContainText('Choose “Projects”');
    await row(page, 'alpha').click();
    await expect(bar).toContainText('Choose “alpha”');
    await bar.getByRole('button', { name: 'Select Folder' }).click();
    await expect(chooser).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Workspace folder', exact: true })).toHaveAttribute('title', path.join(home, 'Projects', 'alpha'));

    // Escape cancels a chooser and returns to the requesting tab.
    // A new folder tab starts in the workspace folder that was just chosen.
    await page.getByRole('button', { name: 'Browse Files', exact: true }).click();
    await expect.poll(() => labels(page)).toEqual(['notes', 'data.csv', 'README.md']);
    await row(page, 'README.md').dblclick();
    const draft = page.getByRole('tab', { name: /README\.md/ });
    await expect(draft).toHaveAttribute('aria-selected', 'true');
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-save-as'));
    const save = page.getByRole('tab', { name: /Save/ });
    await expect(save).toHaveAttribute('aria-selected', 'true');
    await list(page).focus();
    await page.keyboard.press('Escape');
    await expect(save).toHaveCount(0);
    await expect(draft).toHaveAttribute('aria-selected', 'true');

    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-save-as'));
    await expect(page.getByRole('tab', { name: /Save/ })).toHaveAttribute('aria-selected', 'true');
    const name = page.getByRole('textbox', { name: 'File name' });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('README.md');
    expect(await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 6]);
    // The address bar works as in any tab: a web address or search opens beside the chooser,
    // which keeps waiting for its answer.
    const address = page.locator('.editor-group.focused .location-bar input');
    await address.click(); await address.fill(`127.0.0.1:${(server.address() as AddressInfo).port}/detour`); await address.press('Enter');
    await expect(page.getByRole('tab', { name: /Chooser detour/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.location-error')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Save/ })).toHaveCount(1);
    await page.getByRole('tab', { name: /Save/ }).click();
    await expect(page.locator('.editor-group.focused .location-bar input')).toHaveValue(new RegExp(`${path.join(home, 'Projects', 'alpha').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await name.fill('chooser.md');
    await name.press('Enter');
    const saved = path.join(home, 'Projects', 'alpha', 'chooser.md');
    await expect.poll(() => readFile(saved, 'utf8').catch(() => '')).toContain('Folder tab fixture.');
    await expect(page.getByRole('tab', { name: /chooser\.md/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Save/ })).toHaveCount(0);
  } finally { await disposeApplication(app); server.close(); await rm(root, { recursive: true, force: true }); }
});

test('a chooser manages files like any folder tab and still answers its request', async () => {
  const { root, home, app, page } = await launch();
  try {
    await app.evaluate(({ shell }) => {
      const { rm } = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises');
      shell.trashItem = async file => { await rm(file, { recursive: true }); };
    });
    const alpha = path.join(home, 'Projects', 'alpha');
    await page.locator('.empty-folder').click();
    const chooser = page.getByRole('tab', { name: /Open Folder/ });
    await expect(chooser).toHaveAttribute('aria-selected', 'true');
    const address = page.locator('.editor-group.focused .location-bar input');
    await address.click(); await address.fill(alpha); await address.press('Enter');
    await expect.poll(() => labels(page)).toEqual(['notes', 'data.csv', 'README.md']);

    // The row menu is the folder tab's. A file cannot answer a folder request, so its first command opens it.
    const menu = await openMenu(app, row(page, 'README.md'));
    await expect(item(menu, 'Open')).toBeVisible();
    await expect(item(menu, 'Choose')).toHaveCount(0);
    for (const name of ['Open to the Side', 'Cut', 'Copy Path', 'Compress to .zip', 'Move to Trash', 'Delete Permanently', 'Open in Terminal', 'Properties'])
      await expect(item(menu, name)).toBeVisible();
    // Escape closes the menu and hands the keyboard back to the list.
    await menu.keyboard.press('Escape');
    await expect.poll(() => menuViews(app)).toBe(0);
    await expect(list(page)).toBeFocused();
    await expect(chooser).toHaveAttribute('aria-selected', 'true');
    await choose(app, row(page, 'data.csv'), 'Rename');
    const rename = list(page).getByRole('textbox', { name: 'Rename' });
    await expect(rename).toBeFocused();
    await rename.fill('table.csv'); await rename.press('Enter');
    await expect.poll(() => readdir(alpha)).toContain('table.csv');

    // Keyboard commands reach the chooser too: copy, paste into a subfolder, rename, trash.
    await row(page, 'table.csv').click();
    await page.keyboard.press('Control+c');
    await row(page, 'notes').dblclick();
    await expect.poll(() => labels(page)).toEqual([]);
    await list(page).focus();
    await page.keyboard.press('Control+v');
    await expect(row(page, 'table.csv')).toHaveAttribute('aria-selected', 'true');
    expect(await readFile(path.join(alpha, 'notes', 'table.csv'), 'utf8')).toBe('a,b\n');
    await page.keyboard.press('F2');
    await rename.fill('sheet.csv'); await rename.press('Enter');
    await expect.poll(() => readdir(path.join(alpha, 'notes'))).toEqual(['sheet.csv']);
    await expect(row(page, 'sheet.csv')).toHaveAttribute('aria-selected', 'true');
    await list(page).focus();
    await page.keyboard.press('Delete');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
    await expect.poll(() => readdir(path.join(alpha, 'notes'))).toEqual([]);
    await expect.poll(() => labels(page)).toEqual([]);

    // So does the folder's own menu.
    const box = (await list(page).boundingBox())!;
    await choose(app, list(page), 'New File', { x: box.width / 2, y: box.height - 60 });
    const created = list(page).getByRole('textbox', { name: 'New file name' });
    await created.fill('draft.md'); await created.press('Enter');
    await expect.poll(() => readdir(path.join(alpha, 'notes'))).toEqual(['draft.md']);

    // None of this answered or cancelled the request.
    await expect(chooser).toHaveAttribute('aria-selected', 'true');
    const bar = page.getByRole('form', { name: 'Open Folder' });
    await expect(bar).toContainText('Choose “notes”');
    await bar.getByRole('button', { name: 'Select Folder' }).click();
    await expect(chooser).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Workspace folder', exact: true })).toHaveAttribute('title', path.join(alpha, 'notes'));
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('the file manager searches subfolders, shows a grid, properties and stays usable in a narrow pane', async () => {
  const { root, home, app, page } = await launch();
  try {
    await page.getByRole('button', { name: 'Browse Files', exact: true }).click();
    await expect.poll(() => labels(page)).toEqual(['Documents', 'Projects']);
    // Typing filters this folder at once, then the same words search its subfolders.
    await list(page).focus();
    await page.keyboard.press('Control+f');
    const search = page.getByRole('textbox', { name: 'Search this folder and its subfolders' });
    await expect(search).toBeFocused();
    await search.fill('readme');
    await expect.poll(() => labels(page)).toEqual(['README.md']);
    await expect(page.locator('.folder-content:not(.inactive) .folder-status')).toContainText('1 item found');
    await search.press('Escape');
    await expect.poll(() => labels(page)).toEqual(['Documents', 'Projects']);
    await expect(list(page)).toBeFocused();

    // Grid view keeps selection and keyboard navigation; Ctrl+1 returns to the list.
    await page.keyboard.press('Control+2');
    const cells = list(page).locator('.folder-cell');
    await expect(cells).toHaveCount(2);
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    await expect(cells.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect.poll(() => list(page).locator('.folder-cell .folder-label').allTextContents()).toEqual(['alpha', 'beta.txt']);
    await page.keyboard.press('Control+1');
    await expect.poll(() => labels(page)).toEqual(['alpha', 'beta.txt']);

    await row(page, 'alpha').click();
    await page.keyboard.press('Alt+Enter');
    const properties = page.getByRole('dialog', { name: 'Properties' });
    await expect(properties).toContainText('alpha');
    await expect(properties).toContainText('4 items');
    await properties.getByRole('button', { name: 'Close' }).click();
    await expect(properties).toHaveCount(0);

    // The Files side view manages file-manager tabs like terminal sessions.
    await page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const sessions = page.getByRole('region', { name: 'File manager tabs' });
    await expect(sessions.locator('.session')).toHaveCount(1);
    await sessions.getByRole('button', { name: 'New file manager tab' }).click();
    await expect(sessions.locator('.session')).toHaveCount(2);
    await sessions.locator('.session').first().locator('.select').click();
    await expect(page.locator('.folder-content:not(.inactive) .folder-crumbs [aria-current="location"]')).toHaveText('Projects');
    await sessions.locator('.session').nth(1).getByRole('button', { name: /Close file manager/ }).click();
    await expect(sessions.locator('.session')).toHaveCount(1);

    // A narrow pane turns Places into a drawer and still shows file names.
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(300, 300); window.setContentSize(720, 620); });
    const surface = page.locator('.folder-content:not(.inactive) .folder-surface');
    await expect(surface).toHaveClass(/narrow/);
    await expect(surface.locator('.folder-places')).toHaveCount(0);
    const label = row(page, 'alpha').locator('.folder-label');
    await expect(label).toBeVisible();
    expect((await label.boundingBox())!.width).toBeGreaterThan(30);
    const surfaceBox = (await surface.boundingBox())!, listBox = (await list(page).boundingBox())!;
    expect(listBox.width).toBeGreaterThan(surfaceBox.width - 4);
    // The drawer never covers its own toggle, and the toggle, the scrim or Escape close it.
    const toggle = surface.locator('.folder-toolbar button').first();
    await toggle.click();
    await expect(surface.locator('.folder-places')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-label', 'Hide Places');
    await toggle.click();
    await expect(surface.locator('.folder-places')).toHaveCount(0);
    await toggle.click();
    await surface.getByRole('button', { name: 'Close Places' }).click({ position: { x: 300, y: 80 } });
    await expect(surface.locator('.folder-places')).toHaveCount(0);
    await toggle.click();
    await surface.locator('.folder-places').getByRole('button', { name: 'Home', exact: true }).click();
    await expect(surface.locator('.folder-places')).toHaveCount(0);
    await expect.poll(() => labels(page)).toEqual(['Documents', 'Projects']);
    void home;
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('grid view keeps every thumbnail inside its cell and above the name, whatever its shape', async () => {
  const { root, home, app, page } = await launch();
  try {
    const pictures = path.join(home, 'Pictures');
    await mkdir(pictures);
    // A page-shaped image is taller than a cell's picture area even after the thumbnailer scales it.
    await writeFile(path.join(pictures, 'tall.png'), pngFixture(60, 480, [41, 128, 185]));
    await writeFile(path.join(pictures, 'wide.png'), pngFixture(480, 60, [39, 174, 96]));
    await writeFile(path.join(pictures, 'small.png'), pngFixture(24, 24, [192, 57, 43]));
    await page.getByRole('button', { name: 'Browse Files', exact: true }).click();
    const address = page.locator('.editor-group.focused .location-bar input');
    await address.click(); await address.fill(pictures); await address.press('Enter');
    await expect.poll(() => labels(page)).toEqual(['small.png', 'tall.png', 'wide.png']);
    await list(page).focus();
    await page.keyboard.press('Control+2');
    const cells = list(page).locator('.folder-cell');
    await expect(cells).toHaveCount(3);
    const measure = () => cells.evaluateAll(cells => cells.map(cell => {
      const image = cell.querySelector<HTMLImageElement>('.folder-thumb img');
      if (!image?.complete || !image.naturalWidth) return null;
      const box = image.getBoundingClientRect(), area = cell.querySelector('.folder-thumb')!.getBoundingClientRect();
      const name = cell.querySelector('.folder-cell-name')!.getBoundingClientRect(), outer = cell.getBoundingClientRect();
      return { name: cell.querySelector('.folder-label')!.textContent,
        inside: box.top >= area.top - .5 && box.bottom <= area.bottom + .5 && box.left >= area.left - .5 && box.right <= area.right + .5,
        aboveName: box.bottom <= name.top + .5, cellHoldsName: name.bottom <= outer.bottom + .5,
        // Scaled as a whole: the picture keeps its shape, and a small one is not blown up.
        shape: Math.abs(box.width / box.height - image.naturalWidth / image.naturalHeight) < .05, enlarged: box.width > image.naturalWidth + .5 };
    }));
    await expect.poll(measure).toEqual(['small.png', 'tall.png', 'wide.png'].map(name => ({ name, inside: true, aboveName: true, cellHoldsName: true, shape: true, enlarged: false })));
    // Rows do not run into each other: each cell is as tall as its line.
    const heights = await cells.evaluateAll(cells => cells.map(cell => [cell.getBoundingClientRect().height, cell.scrollHeight, cell.clientHeight]));
    for (const [, scroll, client] of heights) expect(scroll).toBeLessThanOrEqual(client);
    await page.screenshot({ path: test.info().outputPath('grid-thumbnails.png') });
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('launching with a folder opens it, and a file opens from a folder chooser', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-folder-launch-'));
  const folder = path.join(root, 'shared docs');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'note.md'), '# Launch note\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', folder], env: { ...env, HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'), SETDOWN_NATIVE_DIALOGS: '0' } });
  try {
    const page = await app.firstWindow();
    await focusApplication(app);
    await expect(page.getByRole('tab', { name: /shared docs/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => labels(page)).toEqual(['note.md']);
    // Another application's "Show in folder" arrives as an open request with a selection.
    await app.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].webContents.send('files:open-request', { path: file.folder, selection: [file.note] }),
      { folder, note: path.join(folder, 'note.md') });
    await expect(row(page, 'note.md')).toHaveAttribute('aria-selected', 'true');
    // In a folder chooser a file is not a valid answer, but opening it still works.
    await page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
    const chooser = page.getByRole('tab', { name: /Open Folder/ });
    await expect(chooser).toHaveAttribute('aria-selected', 'true');
    const address = page.locator('.editor-group.focused .location-bar input');
    await address.click(); await address.fill(folder); await address.press('Enter');
    await row(page, 'note.md').dblclick();
    await expect(page.getByRole('tab', { name: /note\.md/ })).toHaveAttribute('aria-selected', 'true');
    await expect(chooser).toHaveCount(1);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
