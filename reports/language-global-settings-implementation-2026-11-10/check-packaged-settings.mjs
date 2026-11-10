import { _electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

assert.equal(process.env.SETDOWN_ISOLATED_DISPLAY, '1');
const packaged = path.resolve('apps/desktop/release/language-global-settings-2026-11-10/linux-unpacked/setdown');
const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-packaged-settings-'));
const config = path.join(root, 'config'), directory = path.join(config, 'Setdown');
const python = path.join(root, 'main.py'), make = path.join(root, 'Makefile');
let application;
try {
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(directory, 'language-packages'), { recursive: true });
  await writeFile(path.join(directory, 'language-packages/catalog.json'), JSON.stringify({ version: 1, checked: Date.now(), packages: [] }));
  await writeFile(path.join(directory, 'language-servers.json'), JSON.stringify({ version: 1, servers: {}, custom: [], preferred: {}, automaticInstall: false }));
  await writeFile(python, 'value = 1\n'); await writeFile(make, 'all:\n\t@echo hello\n');
  const { ELECTRON_RUN_AS_NODE: ignored, ...env } = process.env;
  application = await _electron.launch({ executablePath: packaged, args: [python], chromiumSandbox: true, env: { ...env, XDG_CONFIG_HOME: config } });
  const page = await application.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
  await expect.poll(() => application.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window.isFocused()) { app.focus({ steal: true }); window.show(); window.moveTop(); window.focus(); window.webContents.focus(); }
    return window.isFocused();
  })).toBe(true);
  const identity = await application.evaluate(({ app, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].focus(); return { packaged: app.isPackaged, path: app.getAppPath() };
  });
  assert(identity.packaged && identity.path.endsWith('/app.asar'));
  await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
  const sidebar = page.getByRole('region', { name: 'Language Support', exact: true });
  await expect(sidebar.getByRole('heading', { name: 'Language settings' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Rescan installed servers' })).toHaveCount(0);
  const downloads = sidebar.getByRole('checkbox', { name: 'Download analysis tools automatically' });
  await expect(downloads).not.toBeChecked(); await downloads.check();
  await expect(sidebar).toHaveAttribute('aria-busy', 'false'); await downloads.uncheck();
  await expect(sidebar).toHaveAttribute('aria-busy', 'false');
  assert.equal(JSON.parse(await readFile(path.join(directory, 'language-servers.json'), 'utf8')).automaticInstall, false);
  await application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click());
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  const snapshot = await page.evaluate(file => window.marktex.readDocumentLocation(file), make);
  await application.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('document:opened', snapshot), snapshot);
  await expect(page.getByRole('button', { name: /Language status:/ })).toHaveAccessibleName(/Makefile/);
  await page.getByRole('button', { name: /Language status:/ }).click();
  const popup = page.getByRole('dialog', { name: 'Current file language support' });
  await expect(popup).toContainText('does not include project analysis');
  await expect(popup).not.toContainText('Python environment'); await expect(popup).not.toContainText('turned off');
  await page.screenshot({ path: new URL('./packaged-settings.png', import.meta.url).pathname });
  assert.deepEqual(errors, []);
  const result = { ...identity, bundledPythonWithDownloadsOff: true, globalSettings: true, persistedDownloadPolicy: true, makeWithoutSpuriousEnvironment: true, errors };
  await writeFile(new URL('./packaged-settings-result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  if (application) {
    await application.evaluate(({ app, BrowserWindow }) => { app.removeAllListeners('window-all-closed'); for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await application.close().catch(() => {});
  }
  await rm(root, { recursive: true, force: true });
}
