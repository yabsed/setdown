import { electron } from '../../support/electron/electron-app';
import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { storeExtensionFixture } from '../../support/browser/store-extension-fixture';

test('Web Store links install only after confirmation, update with stable identity and restore across restart', async () => {
  test.setTimeout(90_000);
  const fixture = storeExtensionFixture();
  let version = '1.0', unavailable = false, downloads = 0;
  const server = createServer((req, res) => {
    if (req.url === '/package') {
      downloads++;
      if (unavailable) { res.writeHead(404); res.end(); }
      else { res.setHeader('content-type', 'application/x-chrome-extension'); res.end(fixture.package(version)); }
    } else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Store test page</title>Article'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-store-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const options = { args: ['.'], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } };
  let app = await electron.launch(options);
  try {
    let page = await app.firstWindow(); await focusApplication(app);
    await page.evaluate(() => window.marktex.browser.extensions());
    await app.evaluate(({ dialog }, origin) => {
      const nativeFetch = globalThis.fetch;
      (globalThis as any).__storeConfirmation = 0;
      (globalThis as any).__storePrompts = [];
      (globalThis as any).__storeRequests = [];
      globalThis.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.hostname === 'clients2.google.com' && url.pathname === '/service/update2/crx') {
          (globalThis as any).__storeRequests.push(url.href);
          return nativeFetch(`${origin}/package`, init);
        }
        return nativeFetch(input, init);
      };
      dialog.showMessageBox = (async (_owner: unknown, options: Electron.MessageBoxOptions) => {
        (globalThis as any).__storePrompts.push(options);
        return { response: (globalThis as any).__storeConfirmation, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, origin);
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-toggle-folder-tools'));
    await page.locator('.activity-bar button[aria-label="Browser"]').click();
    await page.getByRole('navigation', { name: 'Browser library' }).getByRole('button', { name: 'Extensions' }).click();
    await page.getByRole('button', { name: 'Install from Chrome Web Store…' }).click();
    const input = page.getByRole('textbox', { name: 'Chrome Web Store link or extension ID' });
    await input.fill('https://example.com/not-an-extension');
    await page.getByRole('button', { name: 'Install extension', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Chrome Web Store'); expect(downloads).toBe(0);
    await input.fill(`https://chromewebstore.google.com/detail/fixture/${fixture.id}?hl=ko`);
    await page.getByRole('button', { name: 'Install extension', exact: true }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(downloads).toBe(1);
    expect((await page.evaluate(() => window.marktex.browser.extensions())).some(item => item.id === fixture.id)).toBe(false);
    expect(await app.evaluate(() => (globalThis as any).__storePrompts[0])).toMatchObject({
      message: 'Install “Store Fixture” 1.0?', detail: expect.stringContaining('storage'), defaultId: 0,
    });
    await app.evaluate(() => { (globalThis as any).__storeConfirmation = 1; });
    await page.getByRole('button', { name: 'Install extension', exact: true }).click();
    const row = page.locator('.extension').filter({ has: page.locator('.extension-name', { hasText: 'Store Fixture' }) });
    await expect(row).toBeVisible();
    expect((await page.evaluate(() => window.marktex.browser.extensions())).find(item => item.id === fixture.id))
      .toMatchObject({ webStoreId: fixture.id, enabled: true, version: '1.0', error: null });
    const requested = await app.evaluate(() => (globalThis as any).__storeRequests as string[]);
    expect(new URLSearchParams(new URL(requested[0]).searchParams.get('x')!).get('id')).toBe(fixture.id);
    await page.evaluate(url => window.marktex.openLink(url), `${origin}/article`);
    const installedVersion = () => app.evaluate(async ({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/article`);
      return wc?.executeJavaScript('document.documentElement.dataset.storeFixture || ""');
    }, origin);
    await expect.poll(installedVersion).toBe('1.0');
    version = '2.0';
    await row.getByRole('button', { name: 'Update from Web Store' }).click();
    await expect(row.locator('.extension-version')).toHaveText('2.0');
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(installedVersion).toBe('2.0');
    unavailable = true;
    await row.getByRole('button', { name: 'Update from Web Store' }).click();
    await expect(page.getByRole('alert')).toContainText('Failed to download');
    await expect(row.locator('.extension-version')).toHaveText('2.0');
    await expect.poll(installedVersion).toBe('2.0');
    await disposeApplication(app);
    app = await electron.launch(options); page = await app.firstWindow(); await focusApplication(app);
    const restored = await page.evaluate(() => window.marktex.browser.extensions());
    expect(restored.find(item => item.id === fixture.id)).toMatchObject({ version: '2.0', enabled: true, webStoreId: fixture.id });
    const requestsBefore = downloads;
    await page.evaluate(url => window.marktex.openLink(url), `${origin}/article`);
    await expect.poll(installedVersion).toBe('2.0'); expect(downloads).toBe(requestsBefore);
    await page.evaluate(id => window.marktex.browser.setExtensionEnabled(id, false), fixture.id);
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(installedVersion).toBe('');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox; });
    const removed = await page.evaluate(id => window.marktex.browser.removeExtension(id), fixture.id);
    expect(removed.some(item => item.id === fixture.id)).toBe(false);
  } finally {
    await disposeApplication(app); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

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
