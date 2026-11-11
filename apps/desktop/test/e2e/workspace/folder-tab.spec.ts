import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../../support/electron/electron-app';

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
  const app = await electron.launch({ args: ['.'], env: { ...env, HOME: home, XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'), SETDOWN_NATIVE_DIALOGS: '0' } });
  const page = await app.firstWindow();
  await focusApplication(app);
  return { root, home, app, page };
}
const list = (page: Page) => page.locator('.folder-content:not(.inactive) [data-folder-list]');
const row = (page: Page, name: string) => list(page).getByRole('option', { name, exact: false }).filter({ has: page.locator('.folder-label', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const labels = (page: Page) => list(page).locator('.folder-row .folder-label').allTextContents();

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

test('Open Folder and Save As use the in-app chooser instead of the platform dialog', async () => {
  const { root, home, app, page } = await launch();
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
    await name.fill('chooser.md');
    await name.press('Enter');
    const saved = path.join(home, 'Projects', 'alpha', 'chooser.md');
    await expect.poll(() => readFile(saved, 'utf8').catch(() => '')).toContain('Folder tab fixture.');
    await expect(page.getByRole('tab', { name: /chooser\.md/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Save/ })).toHaveCount(0);
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
