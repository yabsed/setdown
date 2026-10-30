import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
const exec = promisify(execFile);

test('Python diagnostics, completion, rename and Undo use the ordinary document', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-config-'));
  const file = path.join(root, 'main.py');
  const original = 'def greeting(name: str) -> str:\n    return name.upper()\n\nvalue: int = "wrong"\nmissing_value\nprint(greeting("Setdown"))\n';
  await writeFile(file, original);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow();
    page.on('console', message => { if (message.type() === 'error') console.log('renderer:', message.text()); });
    await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    await expect(page.locator('.squiggly-warning').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End');
    await editor.pressSequentially('greet');
    await editor.press('Control+Space');
    await expect(page.locator('.suggest-widget.visible')).toContainText('greeting', { timeout: 10_000 });
    await editor.press('Escape');
    // Escape belongs to the suggestion widget, without changing the surface.
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    await editor.press('Control+Home');
    await editor.press('ArrowRight'); await editor.press('ArrowRight');
    await editor.press('ArrowRight'); await editor.press('ArrowRight');
    await editor.press('F2');
    const rename = page.locator('.rename-input');
    await expect(rename).toBeVisible();
    await rename.fill('welcome');
    await rename.press('Enter');
    await expect(rename).not.toBeVisible();
    // Closing the input starts the asynchronous server request. Save only once
    // Monaco has applied its edits; the dialog closing is not that boundary.
    await expect(page.locator('.editor-surface .view-lines')).toContainText('def welcome(');
    await editor.press('Control+S');
    await expect.poll(() => readFile(file, 'utf8')).toContain('def welcome(');
    expect(await readFile(file, 'utf8')).toContain('print(welcome("Setdown"))');
    await editor.press('Control+z');
    await editor.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8')).toContain('def greeting(');
    expect(await readFile(file, 'utf8')).not.toContain('welcome');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('definition opens the existing Setdown tab and Python diagnostics survive restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-definition-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-definition-config-'));
  await writeFile(path.join(root, 'helpers.py'), 'def greeting(name: str) -> str:\n    return name.upper()\n');
  const file = path.join(root, 'main.py');
  await writeFile(file, 'from helpers import greeting\n\nprint(greeting("Setdown"))\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow();
    await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+Home');
    await editor.press('End'); await editor.press('ArrowLeft');
    await editor.press('F12');
    await expect(page.getByRole('tab', { name: /helpers\.py/ })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await editor.press('Control+End');
    await editor.pressSequentially('\nunknown_name');
    await expect(page.locator('.squiggly-warning').first()).toBeVisible({ timeout: 15_000 });
    // Use the real Monaco command palette to exercise the restart action.
    await editor.press('F1');
    await page.locator('.quick-input-box input').fill('>Restart Language Servers');
    await expect(page.locator('.quick-input-widget')).toContainText('Restart Language Servers');
    await page.locator('.quick-input-box input').press('Enter');
    await expect(page.locator('.quick-input-widget')).toBeHidden();
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    await expect(page.locator('.squiggly-warning').first()).toBeVisible({ timeout: 15_000 });
    expect(await readFile(path.join(root, 'helpers.py'), 'utf8')).not.toContain('unknown_name');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('rename includes unopened files without saving them or stealing focus', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-rename-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-rename-config-'));
  const helpers = path.join(root, 'helpers.py'), main = path.join(root, 'main.py');
  await writeFile(helpers, 'def greeting(name: str) -> str:\n    return name.upper()\n');
  const initialMain = 'from helpers import greeting\nprint(greeting("Setdown"))\n';
  await writeFile(main, initialMain);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', helpers], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow();
    await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+Home');
    for (let i = 0; i < 5; i++) await editor.press('ArrowRight');
    await editor.press('F2');
    await page.locator('.rename-input').fill('welcome');
    await page.locator('.rename-input').press('Enter');
    await expect(page.getByRole('tab', { name: /main\.py/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /helpers\.py/ })).toHaveAttribute('aria-selected', 'true');
    expect(await readFile(main, 'utf8')).toBe(initialMain);
    await editor.press('Control+s');
    await expect.poll(() => readFile(helpers, 'utf8')).toContain('def welcome(');
    await page.getByRole('tab', { name: /main\.py/ }).click();
    await editor.press('Control+s');
    await expect.poll(() => readFile(main, 'utf8')).toBe('from helpers import welcome\nprint(welcome("Setdown"))\n');
    await editor.press('Control+z'); await editor.press('Control+s');
    await expect.poll(() => readFile(main, 'utf8')).toBe(initialMain);
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('Save As reconnects Python at the new path and preserves Undo', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-save-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-save-config-'));
  const file = path.join(root, 'main.py'), saved = path.join(root, 'renamed.py');
  await writeFile(file, 'value = 1\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow();
    await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('unknown_name');
    await expect(page.locator('.squiggly-warning').first()).toBeVisible();
    await application.evaluate(({ dialog, BrowserWindow }, target) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
      BrowserWindow.getAllWindows()[0].webContents.send('app:command', 'save-as');
    }, saved);
    await expect(page.getByRole('tab', { name: /renamed\.py/ })).toBeVisible();
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready');
    await expect(page.locator('.squiggly-warning').first()).toBeVisible();
    await editor.press('Control+z'); await editor.press('Control+s');
    await expect.poll(() => readFile(saved, 'utf8')).toBe('value = 1\n');
    await expect(page.locator('.squiggly-warning')).toHaveCount(0);
    expect(await readFile(file, 'utf8')).toBe('value = 1\n');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('server crash preserves unsaved edits; restart recovers and window close reaps the server', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-crash-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-crash-config-'));
  const file = path.join(root, 'main.py');
  await writeFile(file, 'value = 1\n');
  await writeFile(path.join(root, 'start.txt'), 'No language server is needed.\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', path.join(root, 'start.txt')], env: { ...env, XDG_CONFIG_HOME: config } });
  const pids: number[] = [];
  try {
    const page = await application.firstWindow();
    await focusApplication(application);
    await expect(page.locator('.editor-host')).not.toHaveAttribute('data-language-server', /.+/);
    await application.evaluate(() => {
      const childProcess = process.getBuiltinModule('child_process');
      const original = childProcess.spawn;
      const state = globalThis as unknown as { languagePids: number[] };
      state.languagePids = [];
      childProcess.spawn = ((...args: Parameters<typeof original>) => {
        const child = original(...args);
        if (Array.isArray(args[1]) && args[1].some(arg => String(arg).includes('pyright')) && child.pid) state.languagePids.push(child.pid);
        return child;
      }) as typeof original;
    });
    const snapshot = await page.evaluate(file => window.marktex.readDocumentLocation(file), file);
    await application.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('document:opened', snapshot), snapshot);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('unknown_name');
    pids.push(...await application.evaluate(() => (globalThis as unknown as { languagePids: number[] }).languagePids));
    expect(pids).toHaveLength(1);
    process.kill(pids[0], 'SIGKILL');
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'failed');
    await expect(page.locator('.editor-host [role="status"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
    const management = page.getByRole('region', { name: 'Language Support', exact: true });
    await management.getByRole('searchbox').fill('pyright');
    await management.locator('[data-server-id="pyright"]').click();
    await expect(management.locator('.state')).toHaveText('Failed');
    await expect(management.locator('[data-session-state="failed"]')).toContainText(/failed\s*·\s*\S+/);
    await management.getByRole('button', { name: 'Restart servers in this window' }).click();
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    await expect(management.locator('.state')).toHaveText('Running');
    await management.getByRole('button', { name: 'Close language support' }).click();
    await expect(page.locator('.squiggly-warning').first()).toBeVisible();
    pids.splice(0, pids.length, ...await application.evaluate(() => (globalThis as unknown as { languagePids: number[] }).languagePids));
    expect(pids).toHaveLength(2);
    expect(await readFile(file, 'utf8')).toBe('value = 1\n');
    await disposeApplication(application);
    await expect.poll(() => pids.every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } })).toBe(true);
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('first Python Working Tree shares diagnostics and Undo with the ordinary editor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-review-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-review-config-'));
  const file = path.join(root, 'main.py');
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await writeFile(file, 'value: int = 1\n');
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(file, 'value = missing_value\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow();
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), root);
    await Promise.all([page.waitForEvent('load'), page.reload()]);
    await focusApplication(application);
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.locator('.git-change-open').click();
    const modified = page.locator('.modified-in-monaco-diff-editor');
    await expect(modified.locator('.squiggly-warning').first()).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('.original-in-monaco-diff-editor .squiggly-warning')).toHaveCount(0);
    await expect(page.locator('.document-tab:not(.git-diff-tab)')).toHaveCount(0);
    const source = modified.getByRole('textbox');
    await source.press('Control+End'); await source.pressSequentially('unknown_name');
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
    await page.locator('.git-diff-tab .tab-close').click();
    const ordinary = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await expect(page.locator('.editor-surface .view-lines')).toContainText('unknown_name');
    await ordinary.press('Control+z');
    await expect(page.locator('.editor-surface .view-lines')).not.toContainText('unknown_name');
    await expect(page.locator('.editor-surface .squiggly-warning').first()).toBeVisible();
    expect(await readFile(file, 'utf8')).toBe('value = missing_value\n');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});
