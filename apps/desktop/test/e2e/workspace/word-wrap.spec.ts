import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';

const source = '# ' + 'word wrap 한글 0123456789 '.repeat(35) + '\nlast line';
async function launch(root: string, file: string, config = path.join(root, 'config')) {
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  await focusApplication(app);
  return app;
}
async function wrapping(editor: Locator, enabled: boolean) {
  // Measure actual Chromium-rendered visual lines, not just the option value.
  if (enabled) await expect.poll(() => editor.locator('.view-line').count()).toBeGreaterThan(2);
  else await expect(editor.locator('.view-line')).toHaveCount(2);
}
async function command(page: Page, title: string) {
  await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-editor-commands'));
  const dialog = page.getByRole('dialog', { name: 'Commands', exact: true });
  await dialog.getByRole('searchbox').fill(title);
  await dialog.getByRole('option').filter({ hasText: title }).first().click();
}

test('Alt+Z keeps independent file state across tab switches and preserves selection, text and Undo', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-word-wrap-'));
  const first = path.join(root, 'first.py'), second = path.join(root, 'second.txt');
  await writeFile(first, source); await writeFile(second, source);
  const app = await launch(root, first);
  try {
    const page = await app.firstWindow();
    const editor = page.locator('.editor-surface .monaco-editor:visible');
    const input = editor.getByRole('textbox', { name: 'Editor content' });
    await wrapping(editor, false);
    await expect(input).toBeVisible();
    await input.press('Control+Home'); await input.press('Shift+ArrowRight');
    await input.press('Alt+z'); await wrapping(editor, true);
    await expect(input).toBeFocused();
    await input.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('#');
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');

    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), second);
    await expect(page.getByRole('tab', { name: /second.txt/ })).toHaveAttribute('aria-selected', 'true');
    await wrapping(editor, false);
    await page.getByRole('tab', { name: /first.py/ }).click(); await wrapping(editor, true);
    await input.press('Alt+z'); await wrapping(editor, false);
    await input.press('Control+End'); await input.pressSequentially(' undo-sentinel');
    await input.press('Alt+z'); await wrapping(editor, true);
    await input.press('Control+z');
    await expect.poll(() => page.evaluate(async () => (await window.marktex.getDocument())?.text)).toBe(source);
    expect(await readFile(first, 'utf8')).toBe(source);

    // Transient state ends with the last model owner, not a persisted file setting.
    await page.getByRole('tab', { name: /first.py/ }).getByTitle('Close tab', { exact: true }).click();
    await wrapping(editor, false);
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), first);
    await expect(page.getByRole('tab', { name: /first.py/ })).toHaveAttribute('aria-selected', 'true');
    await wrapping(editor, false);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('split views of one model share VS Code transient state and the existing Wrap command', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-word-wrap-split-'));
  const file = path.join(root, 'shared.txt'); await writeFile(file, source);
  const app = await launch(root, file);
  try {
    const page = await app.firstWindow();
    const editors = page.locator('.monaco-editor:visible');
    await wrapping(editors.first(), false);
    await editors.first().getByRole('textbox', { name: 'Editor content' }).press('Alt+z');
    await command(page, 'Split editor right'); await expect(editors).toHaveCount(2);
    await wrapping(editors.first(), true); await wrapping(editors.last(), true);
    await editors.last().getByRole('textbox', { name: 'Editor content' }).press('Alt+z');
    await wrapping(editors.first(), false); await wrapping(editors.last(), false);
    await command(page, 'Change this editor’s display');
    await page.getByRole('dialog', { name: 'Editor display' }).getByRole('option', { name: 'Wrap', exact: true }).click();
    await wrapping(editors.first(), true); await wrapping(editors.last(), true);
    await editors.first().getByRole('textbox', { name: 'Editor content' }).press('Alt+z');
    await wrapping(editors.first(), false); await wrapping(editors.last(), false);
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('Markdown and Git review retain wrapping across reader transitions and synchronize diff sides', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-word-wrap-review-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-word-wrap-review-config-'));
  const file = path.join(root, 'review.md');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init'); git('config', 'user.email', 'setdown@example.test'); git('config', 'user.name', 'Setdown Test');
  await writeFile(file, source); git('add', 'review.md'); git('commit', '-m', 'base');
  await writeFile(file, source.replace('last line', 'changed line'));
  const app = await launch(root, file, config);
  const page = await app.firstWindow();
  try {
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
    await page.reload();
    await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
    const ordinary = page.locator('.editor-surface .monaco-editor:visible');
    await wrapping(ordinary, true);
    await ordinary.getByRole('textbox', { name: 'Editor content' }).press('Alt+z');
    await wrapping(ordinary, false);
    await ordinary.getByRole('textbox', { name: 'Editor content' }).press('Escape');
    await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
    await wrapping(ordinary, false);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) })
      .locator('.git-change-open').filter({ hasText: 'review.md' }).click();
    // The diff revert gutter also has .monaco-editor styling; select the two
    // source editors explicitly, including after the asynchronous diff arrives.
    const editors = page.locator('.git-diff-editor .monaco-editor:is(.original-in-monaco-diff-editor, .modified-in-monaco-diff-editor):visible');
    await expect(editors).toHaveCount(2);
    // The review shares the Working Tree model, so it inherits the Alt+Z override.
    await wrapping(editors.first(), false); await wrapping(editors.last(), false);
    const modified = page.getByRole('textbox', { name: 'Current document', exact: true });
    // Clearing the override returns both sides to Markdown's wrapped default.
    await modified.press('Alt+z');
    await wrapping(editors.first(), true); await wrapping(editors.last(), true);
    // Read-only original editors can toggle wrapping too.
    await editors.first().getByRole('textbox').press('Alt+z');
    await wrapping(editors.first(), false); await wrapping(editors.last(), false);
    // Refocusing the other pane must retain the active review's command state:
    // Escape works immediately, without waiting for another tab activation IPC.
    await modified.press('Escape');
    await page.getByRole('button', { name: 'View Source Diff', exact: true }).click();
    await wrapping(editors.first(), false); await wrapping(editors.last(), false);
    await page.screenshot({ path: test.info().outputPath('diff-word-wrap-off.png') });
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('word-wrap-failure.png') });
    const layoutPath = test.info().outputPath('editor-layout.json');
    await writeFile(layoutPath, JSON.stringify(await page.locator('.monaco-editor').evaluateAll(nodes => nodes.map(node => ({
      box: node.getBoundingClientRect().toJSON(), style: node.getAttribute('style'), visibility: getComputedStyle(node).visibility,
      lines: node.querySelectorAll('.view-line').length, viewport: node.querySelector('.view-lines')?.getBoundingClientRect().toJSON(),
    })))));
    await test.info().attach('editor-layout', { contentType: 'application/json', path: layoutPath });
    await test.info().attach('dom', { body: await page.locator('body').innerText(), contentType: 'text/plain' });
    throw error;
  } finally {
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true });
  }
});

async function markdownWordWrap(page: Page) {
  const entries = await page.evaluate(() => window.marktex.getApplicationMenu('application-menu-view'));
  return { setting: await page.evaluate(() => window.marktex.getMarkdownWordWrap()),
    checked: entries.find(entry => entry.id === 'menu-markdown-word-wrap')?.checked };
}

test('View > Markdown Word Wrap wraps only Markdown source, applies live and persists', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-word-wrap-markdown-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-word-wrap-markdown-config-'));
  const notes = path.join(root, 'notes.md'), code = path.join(root, 'code.py');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init'); git('config', 'user.email', 'setdown@example.test'); git('config', 'user.name', 'Setdown Test');
  await writeFile(notes, source); await writeFile(code, source); git('add', '.'); git('commit', '-m', 'base');
  await writeFile(notes, source.replace('last line', 'changed line'));
  await writeFile(code, source.replace('last line', 'changed line'));
  let app = await launch(root, notes, config);
  try {
    let page = await app.firstWindow();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
    await page.reload();
    await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
    const editor = page.locator('.editor-surface .monaco-editor:visible');
    const input = editor.getByRole('textbox', { name: 'Editor content' });
    expect(await markdownWordWrap(page)).toEqual({ setting: true, checked: true });
    await wrapping(editor, true);

    // Code in the same editor group keeps its unwrapped default in both directions.
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), code);
    await expect(page.getByRole('tab', { name: /code.py/ })).toHaveAttribute('aria-selected', 'true');
    await wrapping(editor, false);
    await page.getByRole('tab', { name: /notes.md/ }).click(); await wrapping(editor, true);

    // The checkbox changes the mounted Markdown editor without touching its text, focus or code tabs.
    await input.focus();
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-markdown-word-wrap'));
    await wrapping(editor, false);
    await expect.poll(() => markdownWordWrap(page)).toEqual({ setting: false, checked: false });
    await expect(input).toBeFocused();
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
    // Alt+Z still overrides the setting for this file, and its next press inherits it again.
    await input.press('Alt+z'); await wrapping(editor, true);
    await input.press('Alt+z'); await wrapping(editor, false);
    await page.getByRole('tab', { name: /code.py/ }).click(); await wrapping(editor, false);

    // The choice survives a restart, like Auto Save.
    await disposeApplication(app);
    app = await launch(root, notes, config);
    page = await app.firstWindow();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
    await page.reload();
    // The relaunched window reopens this document on its last surface, the editor.
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    const restarted = page.locator('.editor-surface .monaco-editor:visible');
    expect(await markdownWordWrap(page)).toEqual({ setting: false, checked: false });
    await wrapping(restarted, false);

    // Git review follows the same rule: only the Markdown diff wraps, on both sides.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const changes = page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) });
    const sides = page.locator('.git-diff-editor .monaco-editor:is(.original-in-monaco-diff-editor, .modified-in-monaco-diff-editor):visible');
    await changes.locator('.git-change-open').filter({ hasText: 'notes.md' }).click();
    await expect(sides).toHaveCount(2);
    await wrapping(sides.first(), false); await wrapping(sides.last(), false);
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-markdown-word-wrap'));
    await expect.poll(() => markdownWordWrap(page)).toEqual({ setting: true, checked: true });
    await wrapping(sides.first(), true); await wrapping(sides.last(), true);
    await expect(page.getByRole('textbox', { name: 'Current document', exact: true })).toBeVisible();
    await changes.locator('.git-change-open').filter({ hasText: 'code.py' }).click();
    await expect(sides.last()).toContainText('changed line');
    await wrapping(sides.first(), false); await wrapping(sides.last(), false);
    await changes.locator('.git-change-open').filter({ hasText: 'notes.md' }).click();
    await wrapping(sides.first(), true); await wrapping(sides.last(), true);
  } finally {
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true });
  }
});

test('notebook cell Alt+Z toggles from its unwrapped default without affecting another cell', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-word-wrap-notebook-'));
  const file = path.join(root, 'cells.ipynb');
  await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells:
    ['first', 'second'].map(id => ({ id, cell_type: 'code', metadata: {}, source, execution_count: null, outputs: [] })) }));
  const app = await launch(root, file);
  try {
    const page = await app.firstWindow();
    const first = page.locator('[data-cell-id="first"] .monaco-editor');
    const second = page.locator('[data-cell-id="second"] .monaco-editor');
    await wrapping(first, false); await wrapping(second, false);
    await first.getByRole('textbox').press('Alt+z');
    await wrapping(first, true); await wrapping(second, false);
    await first.getByRole('textbox').press('Alt+z');
    await wrapping(first, false); await wrapping(second, false);
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
