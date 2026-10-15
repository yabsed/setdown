import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if (process.platform === 'linux' && process.env.SETDOWN_ISOLATED_DISPLAY !== '1') {
  throw Error('Run the package smoke check with with-isolated-display.sh.');
}
if (process.platform === 'win32' && process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw Error('Windows package smoke checks require an isolated hosted runner.');
}
const { RELEASE_PLATFORM: platform, RELEASE_VERSION: version } = process.env;
if (!['linux', 'win'].includes(platform) || !version) throw Error('Set RELEASE_PLATFORM and RELEASE_VERSION.');
const releaseDirectory = process.argv[2] ?? 'apps/desktop/release';
const executablePath = path.resolve(releaseDirectory, platform === 'win' ? 'win-unpacked/Setdown.exe' : 'linux-unpacked/setdown');
const output = path.resolve('apps/desktop/test-results/package-smoke');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), 'setdown-package-smoke-'));
const file = path.join(profile, 'smoke.md');
const heading = 'Setdown package smoke';
await writeFile(file, `# ${heading}\n\nPackaged Markdown rendering works.\n`);
const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
let app;
let page;
let stderr = '';
const pageErrors = [];
try {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${path.join(profile, 'data')}`, file],
    env: { ...environment, XDG_CONFIG_HOME: path.join(profile, 'config') }, timeout: 60_000 });
  app.process().stderr?.on('data', chunk => { stderr += chunk; });
  app.on('window', window => window.on('pageerror', error => pageErrors.push(String(error))));
  expect(await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion() })))
    .toEqual({ packaged: true, version });
  page = await app.firstWindow({ timeout: 60_000 });
  await expect(page.locator('.viewer-surface')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => app.evaluate(async ({ BrowserWindow }) => {
    const views = BrowserWindow.getAllWindows()[0].contentView.children;
    for (const view of views) {
      if (!('webContents' in view) || !view.getVisible()) continue;
      const text = await view.webContents.executeJavaScript('document.querySelector(".markdown-preview h1")?.textContent').catch(() => null);
      if (text) return text.trim();
    }
    return null;
  }), { timeout: 60_000 }).toBe(heading);
  await page.locator('.mode-toggle').click();
  await expect(page.getByRole('textbox', { name: 'Editor content' })).toBeEditable({ timeout: 30_000 });
  // The packaged server must resolve its own runtime and typeshed from the
  // installed application, without a system Node installation or repository.
  const python = path.join(profile, 'smoke.py');
  await writeFile(python, 'value: int = "wrong"\n');
  const snapshot = await page.evaluate(file => window.marktex.readDocumentLocation(file), python);
  await app.evaluate(({ BrowserWindow }, document) => {
    BrowserWindow.getAllWindows()[0].webContents.send('document:opened', document);
  }, snapshot);
  await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 30_000 });
  await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 30_000 });
  expect(pageErrors).toEqual([]);
  console.log(`Packaged ${platform} ${version}: launched, rendered Markdown, opened editor, received Python diagnostics.`);
} catch (error) {
  stderr += `\n${error.stack ?? error}\n`;
  await page?.screenshot({ path: path.join(output, 'shell.png') }).catch(() => undefined);
  throw error;
} finally {
  await writeFile(path.join(output, 'electron.log'), `${stderr}\n${pageErrors.join('\n')}`);
  if (app) {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => undefined);
    await app.close();
  }
  await rm(profile, { recursive: true, force: true });
}
