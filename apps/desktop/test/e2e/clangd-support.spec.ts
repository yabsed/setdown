import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from './electron-app';

// These are real clangd tests: install clangd on PATH or set SETDOWN_CLANGD_PATH.
// A missing executable is a failure, not an untested pass.
test('clangd honors compile commands and .clangd, with completion, rename, Undo and header navigation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-clangd-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-clangd-config-'));
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'include'));
  const file = path.join(root, 'src', 'main.cpp');
  const helper = path.join(root, 'include', 'helper.hpp');
  await writeFile(helper, '#pragma once\ninline int helper(int value) { return value + BUILD_VALUE + CONFIG_VALUE; }\n');
  await writeFile(path.join(root, '.clangd'), 'CompileFlags:\n  Add: [-DCONFIG_VALUE=9]\n');
  await writeFile(path.join(root, 'compile_commands.json'), JSON.stringify([{
    directory: root, file, arguments: ['clang++', '-std=c++20', '-Iinclude', '-DBUILD_VALUE=7', '-c', file],
  }]));
  const original = '#include "helper.hpp"\nint greeting(int value) { return helper(value); }\nint main() {\n  int count = "wrong";\n  return greeting(3);\n}\n';
  await writeFile(file, original);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow();
    await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    // Repair the error in the unsaved model; clangd clears versioned diagnostics.
    // Use ordinary editing, without reaching into Monaco or replacing its model.
    await editor.press('Control+Home');
    await editor.press('ArrowDown'); await editor.press('ArrowDown'); await editor.press('ArrowDown');
    await editor.press('Home'); await editor.press('Shift+End');
    await editor.pressSequentially('  int count = 4;');
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });
    // Manual completion is supplied by clangd, including its function snippet.
    await editor.press('Control+End');
    await editor.pressSequentially('greet'); await editor.press('Control+Space');
    await expect(page.locator('.suggest-widget.visible')).toContainText('greeting', { timeout: 15_000 });
    await editor.press('Escape');
    await editor.press('Home'); await editor.press('Shift+End'); await editor.press('Backspace');
    // Rename the definition and call, then undo both edits in the same document.
    await editor.press('Control+Home'); await editor.press('ArrowDown'); await editor.press('Home');
    for (let index = 0; index < 5; index++) await editor.press('ArrowRight');
    await editor.press('F2');
    const rename = page.locator('.rename-input');
    await expect(rename).toBeVisible(); await rename.fill('welcome'); await rename.press('Enter');
    await expect(rename).not.toBeVisible();
    await editor.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8')).toContain('int welcome(');
    expect(await readFile(file, 'utf8')).toContain('return welcome(3)');
    await editor.press('Control+z'); await editor.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8')).toContain('int greeting(');
    expect(await readFile(file, 'utf8')).not.toContain('welcome');
    // F12 crosses into the ordinary header tab and keeps the compile context.
    await editor.press('Control+Home'); await editor.press('ArrowDown'); await editor.press('Home');
    for (let index = 0; index < 35; index++) await editor.press('ArrowRight');
    await editor.press('F12');
    await expect(page.getByRole('tab', { name: /helper\.hpp/ })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready');
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    expect(await readFile(helper, 'utf8')).toContain('BUILD_VALUE + CONFIG_VALUE');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('missing clangd keeps C editable and a native executable selection repairs language support', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-clangd-select-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-clangd-select-config-'));
  const file = path.join(root, 'main.c');
  await writeFile(file, 'int main(void) { return unknown_value; }\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config,
    SETDOWN_CLANGD_PATH: path.join(root, 'missing-clangd') } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'failed', { timeout: 20_000 });
    await expect(page.locator('.editor-host [role="status"]')).toHaveAttribute('title', /Language Support/);
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('// still editable');
    await editor.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8')).toContain('// still editable');
    // Stub only the OS chooser's answer. Production IPC persists the path,
    // restarts the server and synchronizes the actual open buffer.
    const { execFileSync } = await import('node:child_process');
    const executable = process.env.SETDOWN_CLANGD_PATH || execFileSync(process.platform === 'win32' ? 'where' : 'which', ['clangd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    await application.evaluate(({ dialog }, executable) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [executable] })) as typeof dialog.showOpenDialog;
    }, executable);
    await editor.press('F1'); await page.locator('.quick-input-box input').fill('>Language Support');
    await expect(page.locator('.quick-input-widget')).toContainText('Language Support');
    await page.locator('.quick-input-box input').press('Enter');
    await expect(page.locator('.quick-input-widget')).toBeHidden();
    const management = page.getByRole('region', { name: 'Language Support', exact: true });
    await expect(management).toBeVisible();
    await management.getByRole('searchbox').fill('clangd');
    await management.locator('.server-list button').click();
    await management.getByRole('button', { name: 'Choose executable…', exact: true }).click();
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Close language support' }).click();
    const settingsPath = path.join(await application.evaluate(({ app }) => app.getPath('userData')), 'language-servers.json');
    expect(JSON.parse(await readFile(settingsPath, 'utf8')).servers.clangd.executable).toBe(executable);
    await editor.press('F1'); await page.locator('.quick-input-box input').fill('>Restart Language Servers');
    await expect(page.locator('.quick-input-widget')).toContainText('Restart Language Servers');
    await page.locator('.quick-input-box input').press('Enter');
    await expect(page.locator('.quick-input-widget')).toBeHidden();
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 15_000 });
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});
