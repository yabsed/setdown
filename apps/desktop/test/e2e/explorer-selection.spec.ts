import { electron } from './electron-app';
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { disposeApplication, focusApplication } from './electron-app';

const entry = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
const selected = (page: Page) => page.locator('.explorer-row[aria-selected="true"]');
async function launch() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-selection-'));
  await mkdir(path.join(root, 'destination'));
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) await writeFile(path.join(root, name), `${name} original\n`);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', path.join(root, 'a.txt')], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
  const page = await app.firstWindow();
  await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
  await page.reload();
  await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(entry(page, 'a.txt')).toBeVisible();
  await focusApplication(app);
  return { root, app, page };
  } catch (error) { await disposeApplication(app); await rm(root, { recursive: true, force: true }); throw error; }
}

test('Explorer clipboard shortcuts, Edit menu, duplicate and cut use real files and invalidate on text copy', async () => {
  const { root, app, page } = await launch();
  try {
    await entry(page, 'a.txt').click({ modifiers: ['Control'] });
    await expect(selected(page)).toHaveText(['a.txt']);
    await entry(page, 'a.txt').press('Control+c');
    await expect.poll(() => page.evaluate(() => window.marktex.explorer.clipboard())).toEqual({ paths: [path.join(root, 'a.txt')], cut: false });
    await entry(page, 'destination').click();
    await entry(page, 'destination').press('Control+v');
    await expect.poll(() => readdir(path.join(root, 'destination'))).toEqual(['a.txt']);
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('a.txt original\n');

    // Main Edit-menu execution must use the tree target even after its button takes focus.
    await expect(selected(page)).toHaveAttribute('data-path', path.join(root, 'destination', 'a.txt'));
    await selected(page).focus();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Copy\b/ }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Paste\b/ }).click();
    await expect.poll(() => readdir(path.join(root, 'destination'))).toEqual(['a copy.txt', 'a.txt']);
    await entry(page, 'a copy.txt').press('Control+d');
    await expect.poll(() => readdir(path.join(root, 'destination'))).toEqual(['a copy copy.txt', 'a copy.txt', 'a.txt']);
    await expect.poll(() => page.evaluate(() => window.marktex.explorer.clipboard())).toEqual({ paths: [path.join(root, 'destination', 'a.txt')], cut: false });
    await page.evaluate(() => window.marktex.explorer.clearClipboard());
    await expect.poll(() => page.evaluate(() => window.marktex.explorer.clipboard())).toEqual({ paths: [path.join(root, 'destination', 'a.txt')], cut: false });

    await entry(page, 'b.txt').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Cut\b/ }).click();
    await expect(entry(page, 'b.txt')).toHaveClass(/is-cut/);
    await app.evaluate(async ({ clipboard }) => { await clipboard.writeText('ordinary text'); });
    await expect.poll(() => page.evaluate(() => window.marktex.explorer.clipboard())).toBeNull();
    await entry(page, 'b.txt').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: /^Paste\b/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(await readFile(path.join(root, 'b.txt'), 'utf8')).toContain('original');

    await entry(page, 'b.txt').press('Control+x');
    await expect(entry(page, 'b.txt')).toHaveClass(/is-cut/);
    await entry(page, 'destination').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Paste\b/ }).click();
    await expect.poll(() => readdir(path.join(root, 'destination'))).toContain('b.txt');
    expect(await readdir(root)).not.toContain('b.txt');
    await expect.poll(() => page.evaluate(() => window.marktex.explorer.clipboard())).toBeNull();
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Explorer paste conflicts keep both explicitly and preserve existing destination contents', async () => {
  const { root, app, page } = await launch();
  try {
    await writeFile(path.join(root, 'destination', 'a.txt'), 'KEEP');
    await entry(page, 'a.txt').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Copy\b/ }).first().click();
    await entry(page, 'destination').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Paste\b/ }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Some names already exist');
    await page.getByRole('button', { name: 'Keep Both', exact: true }).click();
    await expect.poll(() => readdir(path.join(root, 'destination'))).toEqual(['a copy.txt', 'a.txt']);
    expect(await readFile(path.join(root, 'destination', 'a.txt'), 'utf8')).toBe('KEEP');
    expect(await readFile(path.join(root, 'destination', 'a copy.txt'), 'utf8')).toContain('original');
    await expect(selected(page)).toHaveText(['a copy.txt']);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Explorer rename selects basename, respects composition, and retains selection across sidebar switches and refresh', async () => {
  const { root, app, page } = await launch();
  try {
    await entry(page, 'a.txt').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Rename\b/ }).click();
    const input = page.getByRole('textbox', { name: 'Rename entry', exact: true });
    await expect(input).toBeFocused();
    expect(await input.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd])).toEqual([0, 1]);
    await input.evaluate(node => {
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '가' }));
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
    });
    await expect(input).toBeVisible();
    await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '가' })));
    await input.pressSequentially('zeta'); await input.press('Enter');
    await expect(entry(page, 'zeta.txt')).toBeVisible();
    await expect(selected(page)).toHaveText(['zeta.txt']);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await expect(selected(page)).toHaveText(['zeta.txt']);
    await writeFile(path.join(root, 'external.txt'), 'external');
    await expect(entry(page, 'external.txt')).toBeVisible();
    await expect(selected(page)).toHaveText(['zeta.txt']);
    await entry(page, 'zeta.txt').press('b');
    await expect(selected(page)).toHaveText(['b.txt']);

    // A real input owns Copy; it must not replace the pending file clipboard.
    await entry(page, 'b.txt').press('F2');
    const rename = page.getByRole('textbox', { name: 'Rename entry' });
    await rename.fill('plain-text.txt'); await rename.press('Control+a'); await rename.press('Control+c');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('plain-text.txt');
    await expect.poll(() => page.evaluate(() => window.marktex.explorer.clipboard())).toBeNull();
    await rename.press('Escape');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('a failed OS trash operation keeps the unsaved tab, text and selection', async () => {
  const { root, app, page } = await launch();
  try {
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('KEEP_UNSAVED');
    await app.evaluate(({ shell }) => { shell.trashItem = async () => { throw new Error('Simulated OS trash failure'); }; });
    await entry(page, 'a.txt').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Move to Trash/ }).click();
    await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await page.getByRole('button', { name: "Don't Save", exact: true }).click();
    await expect(page.locator('.project-error')).toContainText('Simulated OS trash failure');
    await expect(page.getByRole('tab', { name: /a\.txt/ })).toBeVisible();
    await expect(page.locator('.view-lines')).toContainText('KEEP_UNSAVED');
    await expect(selected(page)).toHaveText(['a.txt']);
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('a.txt original\n');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Explorer modifier and keyboard selection, context actions, and a real multi-file folder drop preserve dirty text', async () => {
  const { root, app, page } = await launch();
  try {
    await expect(page.getByRole('tree')).toHaveAttribute('aria-multiselectable', 'true');
    await entry(page, 'a.txt').click();
    await entry(page, 'c.txt').click({ modifiers: ['Control'] });
    await expect(selected(page)).toHaveText(['a.txt', 'c.txt']);
    // A modifier click only selects; it must not open or replace a preview.
    await expect(page.locator('.tab-name')).toHaveText(['a.txt']);
    await entry(page, 'b.txt').click({ modifiers: ['Shift'] });
    await expect(selected(page)).toHaveText(['b.txt', 'c.txt']);
    await entry(page, 'd.txt').click({ modifiers: ['Shift'] });
    await expect(selected(page)).toHaveText(['c.txt', 'd.txt']);
    await entry(page, 'c.txt').click({ modifiers: ['Control'] });
    await expect(selected(page)).toHaveText(['d.txt']);
    await entry(page, 'b.txt').press('Home');
    await page.keyboard.press('Control+a');
    await expect(selected(page)).toHaveCount(await page.locator('.explorer-row').count());
    await page.keyboard.press('Escape'); await expect(selected(page)).toHaveCount(0);
    await entry(page, 'a.txt').press('Space');
    await entry(page, 'a.txt').press('Shift+ArrowDown');
    await expect(selected(page)).toHaveText(['a.txt', 'b.txt']);
    await entry(page, 'b.txt').click({ button: 'right' });
    await expect(selected(page)).toHaveText(['a.txt', 'b.txt']);
    await expect(page.getByRole('menuitem', { name: /^Rename/ })).toHaveCount(0);
    await page.getByRole('menuitem', { name: /^Move to Trash/ }).click();
    await expect(page.getByRole('alertdialog')).toContainText('2 items');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(selected(page)).toHaveText(['a.txt', 'b.txt']);
    await entry(page, 'a.txt').press('Enter');
    await expect(page.locator('.tab-name')).toHaveText(['a.txt', 'b.txt']);
    await page.getByRole('tab', { name: /a\.txt/ }).click();
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('UNSAVED_SELECTION');
    await entry(page, 'b.txt').dragTo(entry(page, 'destination'));
    await expect.poll(() => readdir(path.join(root, 'destination'))).toEqual(['a.txt', 'b.txt']);
    await expect(selected(page)).toHaveText(['a.txt', 'b.txt']);
    await expect(page.getByRole('tab', { name: /a\.txt/ })).toHaveAttribute('title', path.join(root, 'destination', 'a.txt'));
    await expect(page.locator('.view-lines')).toContainText('UNSAVED_SELECTION');
    await editor.press('Control+s');
    await expect.poll(() => readFile(path.join(root, 'destination', 'a.txt'), 'utf8')).toContain('UNSAVED_SELECTION');
    expect((await readdir(root)).includes('a.txt')).toBe(false);
    await page.screenshot({ path: test.info().outputPath('selection-moved.png') });
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Explorer batch conflicts leave all sources and destination contents intact', async () => {
  const { root, app, page } = await launch();
  try {
    await writeFile(path.join(root, 'destination', 'b.txt'), 'DO NOT OVERWRITE');
    await entry(page, 'a.txt').click(); await entry(page, 'b.txt').click({ modifiers: ['Control'] });
    await entry(page, 'b.txt').dragTo(entry(page, 'destination'));
    await expect(page.locator('.project-error')).toContainText('already exists');
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('a.txt original\n');
    expect(await readFile(path.join(root, 'b.txt'), 'utf8')).toBe('b.txt original\n');
    expect(await readFile(path.join(root, 'destination', 'b.txt'), 'utf8')).toBe('DO NOT OVERWRITE');
    expect(await readdir(path.join(root, 'destination'))).toEqual(['b.txt']);
    await expect(selected(page)).toHaveText(['a.txt', 'b.txt']);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('dropping selected files on tab-strip padding opens every file in order as a pinned tab', async () => {
  const { root, app, page } = await launch();
  try {
    await entry(page, 'b.txt').click({ modifiers: ['Control'] });
    await entry(page, 'd.txt').click({ modifiers: ['Shift'] });
    await expect(selected(page)).toHaveText(['b.txt', 'c.txt', 'd.txt']);
    const strip = page.locator('.tab-strip');
    const box = (await strip.boundingBox())!;
    expect(await strip.evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
    await entry(page, 'c.txt').dragTo(strip, { targetPosition: { x: box.width / 2, y: 2 } });
    await expect(page.locator('.tab-name')).toHaveText(['a.txt', 'b.txt', 'c.txt', 'd.txt']);
    await expect(page.locator('.document-tab[data-preview="true"]')).toHaveCount(0);
    await expect(page.locator('.editor-group')).toHaveCount(1);
    await expect(page.locator('.tab-drop-indicator')).toBeHidden();
    await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
