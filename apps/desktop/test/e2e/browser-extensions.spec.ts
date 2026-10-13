import { _electron as electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication } from './electron-app';

test('user-installed extensions load, run content scripts, and can be disabled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-extensions-'));
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>Research page</title><main>Article</main>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const headless = process.env.SETDOWN_E2E_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu'] : [];
  const launchOptions = { args: [...headless, '.'], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } };
  let app = await electron.launch(launchOptions);
  try {
    // Learn the profile directory from the running app, then seed an
    // installed extension exactly as the file installer would leave it.
    const userData = await app.evaluate(({ app }) => app.getPath('userData'));
    await disposeApplication(app);
    const extensionDir = path.join(userData, 'extensions', 'seeded-test');
    await mkdir(extensionDir, { recursive: true });
    await writeFile(path.join(extensionDir, 'manifest.json'), JSON.stringify({
      manifest_version: 2, name: 'Seeded Test Extension', version: '1.0', description: 'E2E fixture',
      permissions: ['storage'], browser_action: { default_popup: 'popup.html' },
      background: { scripts: ['background.js'] },
      content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_end' }],
    }));
    await writeFile(path.join(extensionDir, 'content.js'),
      'document.documentElement.dataset.seededExtension = String(Number(document.documentElement.dataset.seededExtension || 0) + 1);');
    await writeFile(path.join(extensionDir, 'background.js'),
      'chrome.storage.local.set({ seeded: true });');
    await writeFile(path.join(extensionDir, 'popup.html'), '<!doctype html><title>Seeded popup</title>Popup');
    const mv3Dir = path.join(userData, 'extensions', 'seeded-mv3');
    await mkdir(mv3Dir, { recursive: true });
    await writeFile(path.join(mv3Dir, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'Seeded MV3 Extension', version: '2.0',
      permissions: ['storage'], host_permissions: ['http://127.0.0.1/*'],
      action: { default_popup: 'popup.html' }, background: { service_worker: 'worker.js' },
      content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_end' }],
    }));
    await writeFile(path.join(mv3Dir, 'content.js'),
      'document.documentElement.dataset.seededMv3 = "yes";');
    await writeFile(path.join(mv3Dir, 'worker.js'), 'chrome.storage.local.set({ seededMv3: true });');
    await writeFile(path.join(mv3Dir, 'popup.html'), '<!doctype html><title>MV3 popup</title>Popup');
    await writeFile(path.join(userData, 'browser-extensions.json'),
      JSON.stringify([{ dir: 'seeded-test', enabled: true }, { dir: 'seeded-mv3', enabled: true }]));

    app = await electron.launch(launchOptions);
    const page = await app.firstWindow();
    await focusApplication(app);
    await expect(page.getByRole('button', { name: 'Open Web Page', exact: true })).toBeVisible();
    // Cold extension startup (uBlock filter compilation) is setup, not part
    // of the title assertion's default timeout below.
    await page.evaluate(() => window.marktex.browser.extensions());
    await page.evaluate(url => window.marktex.openLink(url), `${origin}/article`);
    await expect(page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');

    const extensions = await page.evaluate(() => window.marktex.browser.extensions());
    const seeded = extensions.find(item => item.name === 'Seeded Test Extension');
    expect(seeded).toMatchObject({ version: '1.0', enabled: true, builtin: false, hasPopup: true, error: null });
    expect(extensions.some(item => item.builtin)).toBe(true);
    const mv3 = extensions.find(item => item.name === 'Seeded MV3 Extension');
    expect(mv3).toMatchObject({ version: '2.0', manifestVersion: 3, enabled: true, hasPopup: true, error: null });

    // The four library sections must stay inside the sidebar (wrapping to a
    // second row) instead of overflowing past the panel edge.
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-toggle-folder-tools'));
    await expect(page.locator('.project-sidebar')).toBeVisible();
    await page.locator('.activity-bar button[aria-label="Browser"]').click();
    const library = page.getByRole('navigation', { name: 'Browser library' });
    // Search sits below the section selector.
    const searchBelow = await page.locator('.browser-sidebar').evaluate(sidebar => {
      const nav = sidebar.querySelector('nav')!.getBoundingClientRect();
      const input = sidebar.querySelector('input')!.getBoundingClientRect();
      return input.top >= nav.bottom;
    });
    expect(searchBelow).toBe(true);
    await library.getByRole('button', { name: 'Extensions' }).click();
    await expect(page.getByRole('button', { name: 'Install from file (.zip/.crx)…' })).toBeVisible();
    const inside = await page.locator('.browser-sidebar').evaluate(sidebar => {
      const box = sidebar.getBoundingClientRect();
      const buttons = [...sidebar.querySelectorAll('nav button, .extensions button')];
      return sidebar.scrollWidth <= sidebar.clientWidth + 1 && buttons.every(button => {
        const rect = button.getBoundingClientRect();
        return rect.left >= box.left - 1 && rect.right <= box.right + 1;
      });
    });
    expect(inside).toBe(true);

    const runs = () => app.evaluate(async ({ webContents }, target) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(target));
      return page ? page.executeJavaScript('Number(document.documentElement.dataset.seededExtension || 0)') : 0;
    }, origin);
    await expect.poll(runs).toBeGreaterThan(0);
    const mv3Runs = () => app.evaluate(async ({ webContents }, target) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(target));
      return page ? page.executeJavaScript('document.documentElement.dataset.seededMv3 || ""') : '';
    }, origin);
    await expect.poll(mv3Runs).toBe('yes');

    const disabled = await page.evaluate(id => window.marktex.browser.setExtensionEnabled(id, false), seeded!.id);
    expect(disabled.find(item => item.name === 'Seeded Test Extension')?.enabled).toBe(false);
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(runs).toBe(0);

    const enabled = await page.evaluate(id => window.marktex.browser.setExtensionEnabled(id, true), seeded!.id);
    expect(enabled.find(item => item.name === 'Seeded Test Extension')?.enabled).toBe(true);
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(runs).toBeGreaterThan(0);
  } finally {
    await disposeApplication(app);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
