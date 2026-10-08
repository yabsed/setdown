import { _electron as electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication, type TestApplication } from './electron-app';

async function fixture(document = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-browser-'));
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url?.endsWith('.js')) {
      res.setHeader('content-type', 'application/javascript');
      res.end(req.url.includes('blocked') ? 'window.blockedScript=true' : 'window.allowedScript=true'); return;
    }
    res.setHeader('content-type', 'text/html');
    if (req.url === '/frame') { res.end('<!doctype html><div class="frame-ad">Frame advertisement</div><div class="removable">Control</div>'); return; }
    res.end(`<!doctype html><title>${req.url === '/second' ? 'Second page' : 'Research page'}</title>
      <style>.ad { display:block !important }</style><input id="draft"><a href="/second">Next page</a>
      <div class="ad">Advertisement</div><iframe src="/frame"></iframe>
      <script>window.probeFlag=false</script><script src="/blocked.js"></script><script src="/allowed.js"></script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const file = path.join(root, 'notes.md'); await writeFile(file, '# Notes\n\nKeep the reader intact.\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const launchOptions = { args: document ? ['.', file] : ['.'], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } };
  let app = await electron.launch(launchOptions);
  let page = await app.firstWindow();
  await focusApplication(app);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  return { get app() { return app; }, get page() { return page; }, origin, requests, errors,
    async restart() {
      await app.close();
      app = await electron.launch(launchOptions);
      page = await app.firstWindow();
      await focusApplication(app);
      page.on('pageerror', error => errors.push(String(error)));
    }, async dispose() {
    await disposeApplication(app); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true });
  } };
}
async function evaluatePage<T>(app: TestApplication, origin: string, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, { origin, script }) => {
    const page = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(origin) && wc.getType() !== 'backgroundPage');
    if (!page) throw Error('Web page not found');
    return page.executeJavaScript(script);
  }, { origin, script });
}

test('web pages share document tabs, retain live state, navigate, bookmark, and split', async () => {
  test.setTimeout(90_000);
  const f = await fixture();
  try {
    await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const webTab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(webTab).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'web');
    await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue(`${f.origin}/first`);
    const identity = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
    await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="unsent notes";window.keptObject={value:42};true');
    const requestCount = f.requests.filter(url => url === '/first').length;
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
    await webTab.click();
    expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,value:window.keptObject.value,node:typeof require,desktop:typeof window.marktex})'))
      .toEqual({ draft: 'unsent notes', value: 42, node: 'undefined', desktop: 'undefined' });
    expect(f.requests.filter(url => url === '/first').length).toBe(requestCount);
    await f.page.getByRole('button', { name: 'Bookmark page', exact: true }).click();
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Research page']);
    await f.page.getByRole('textbox', { name: 'Address or file path' }).fill(`${f.origin}/second`);
    await f.page.getByRole('textbox', { name: 'Address or file path' }).press('Enter');
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    await f.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(f.page.getByRole('textbox', { name: 'Address or file path' })).toHaveValue(`${f.origin}/first`);
    const data = await f.page.evaluateHandle(() => new DataTransfer());
    await webTab.dispatchEvent('dragstart', { dataTransfer: data });
    const body = f.page.locator('.group-body').first(), box = (await body.boundingBox())!;
    const point = { clientX: box.x + box.width * .98, clientY: box.y + box.height / 2, dataTransfer: data };
    await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
    await webTab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
    await expect(f.page.locator('.editor-group')).toHaveCount(2);
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(2);
    expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
    await f.page.screenshot({ path: 'test-results/browser-split.png' });
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('bundled uBlock blocks requests, scripts and frame cosmetics, and enforces response-header filters', async () => {
  test.setTimeout(90_000);
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await expect(f.page.getByRole('button', { name: 'uBlock Origin', exact: true })).toBeEnabled();
    const filters = "*/blocked.js$script\n127.0.0.1##.ad\n127.0.0.1##.frame-ad\n127.0.0.1##+js(set-constant, probeFlag, true)\n*/csp$csp=script-src 'none'\n";
    await f.app.evaluate(async ({ webContents }, filters) => {
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage' && wc.getURL().endsWith('/background.html'))!;
      await background.executeJavaScript(`(async()=>{const {default:u}=await import('./js/background.js');await u.saveSelectedFilterLists([u.userFiltersPath]);await u.saveUserFilters(${JSON.stringify(filters)});await u.loadFilterLists();return true;})()`);
    }, filters);
    f.requests.length = 0;
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, '({ad:getComputedStyle(document.querySelector(".ad")).display, frame:getComputedStyle(document.querySelector("iframe").contentDocument.querySelector(".frame-ad")).display, flag:window.probeFlag, blocked:!!window.blockedScript,allowed:!!window.allowedScript})'))
      .toEqual({ ad: 'none', frame: 'none', flag: true, blocked: false, allowed: true });
    expect(f.requests).not.toContain('/blocked.js');
    // Actual frame user styles can be removed without navigating the page.
    expect(await f.app.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage')!;
      const frame = page.mainFrame.frames.find(frame => frame.url.endsWith('/frame'))!;
      const args = JSON.stringify([page.id, { frameId: frame.frameTreeNodeId, code: '.removable{display:none!important}' }]);
      await background.executeJavaScript(`chrome.tabs.insertCSS(...${args})`);
      const hidden = await frame.executeJavaScript('getComputedStyle(document.querySelector(".removable")).display');
      await background.executeJavaScript(`chrome.tabs.removeCSS(...${args})`);
      const shown = await frame.executeJavaScript('getComputedStyle(document.querySelector(".removable")).display');
      return { hidden, shown };
    }, f.origin)).toEqual({ hidden: 'none', shown: 'block' });
    await f.page.getByRole('textbox', { name: 'Address or file path' }).fill(`${f.origin}/csp`);
    await f.page.getByRole('textbox', { name: 'Address or file path' }).press('Enter');
    await expect.poll(() => evaluatePage(f.app, f.origin, '({url:location.pathname,allowed:!!window.allowedScript})')).toEqual({ url: '/csp', allowed: false });
    await f.page.getByRole('button', { name: 'uBlock Origin', exact: true }).click();
    await expect.poll(() => f.app.evaluate(async ({ webContents }) => {
      const popup = webContents.getAllWebContents().find(wc => wc.getURL().includes('/popup-fenix.html'));
      return popup && popup.mainFrame.executeJavaScript('document.querySelector("#hostname")?.textContent');
    })).toContain('127.0.0.1');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('uBlock migrates the recursive managed cache and preserves filtering across restarts', async () => {
  test.setTimeout(90_000);
  const f = await fixture(false);
  const filters = '*/blocked.js$script\n127.0.0.1##.ad\n';
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await f.app.evaluate(async ({ webContents }, filters) => {
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage')!;
      await background.executeJavaScript(`(async()=>{
        const {default:u}=await import('./js/background.js');
        await u.saveSelectedFilterLists([u.userFiltersPath]);
        await u.saveUserFilters(${JSON.stringify(filters)});
        u.userSettings.showIconBadge=false;await u.saveUserSettings();await u.loadFilterLists();
        // Reproduce the old adapter's nested cache without a multi-GB fixture.
        let cache={payload:'x'.repeat(65536)};
        for(let i=0;i<6;i++)cache={cachedManagedStorage:cache,previous:cache};
        await new Promise(resolve=>chrome.storage.local.set({cachedManagedStorage:cache},resolve));
      })()`);
    }, filters);
    for (let cycle = 0; cycle < 3; cycle++) {
      f.requests.length = 0;
      await f.restart();
      await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible({ timeout: 30_000 });
      await expect(f.page.getByRole('button', { name: 'uBlock Origin', exact: true })).toBeEnabled();
      expect(await evaluatePage(f.app, f.origin, '({ad:getComputedStyle(document.querySelector(".ad")).display,blocked:!!window.blockedScript,allowed:!!window.allowedScript})'))
        .toEqual({ ad: 'none', blocked: false, allowed: true });
      expect(f.requests).not.toContain('/blocked.js');
      expect(await f.app.evaluate(async ({ webContents }) => {
        const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage')!;
        return background.executeJavaScript(`(async()=>{
          const {default:u}=await import('./js/background.js');
          return {managed:typeof chrome.storage.managed,badge:u.userSettings.showIconBadge,
            filters:(await u.loadUserFilters()).content,
            cacheBytes:await new Promise(resolve=>chrome.storage.local.getBytesInUse('cachedManagedStorage',resolve))};
        })()`);
      })).toEqual({ managed: 'undefined', badge: false, filters: filters.trim(), cacheBytes: 0 });
    }
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('the first web page opens from a fresh empty workspace and popups preserve their opener', async () => {
  const f = await fixture(false);
  try {
    await f.page.getByRole('button', { name: 'Open Web Page', exact: true }).click();
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await expect(address).toBeFocused();
    await address.fill(`${f.origin}/first`);
    await address.press('Enter');
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, `window.child=window.open('about:blank');child.document.title='Live popup';child.document.body.innerHTML='<p>Popup content</p>';true`);
    await expect(f.page.getByRole('tab', { name: /Live popup/ })).toBeVisible();
    expect(await evaluatePage(f.app, f.origin, 'child.opener===window')).toBe(true);
    await expect(f.page.getByRole('tab', { name: /Live popup/ })).toHaveAttribute('aria-selected', 'true');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('moving a web tab to another window preserves its live page and enforces ownership', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const tab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(tab).toBeVisible();
    const id = (await tab.getAttribute('data-tab-id'))!;
    const contentsId = await f.app.evaluate(({webContents}, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
    await evaluatePage(f.app, f.origin, 'window.unsentDraft={value:42};true');
    const destinationReady = f.app.waitForEvent('window');
    await tab.evaluate(element => {
      const dataTransfer = new DataTransfer();
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer, screenX: 600, screenY: 400 }));
      element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer, relatedTarget: null }));
      element.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer, screenX: 600, screenY: 400 }));
    });
    const destination = await destinationReady;
    await expect(destination.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await expect(tab).toHaveCount(0);
    expect(await f.app.evaluate(async ({webContents}, id) => {
      const page = webContents.fromId(id)!;
      return { id: page.id, value: await page.executeJavaScript('window.unsentDraft.value') };
    }, contentsId)).toEqual({ id: contentsId, value: 42 });
    expect(await f.page.evaluate(async id => {
      try { await window.marktex.browser.command(id, 'reload'); return 'allowed'; }
      catch { return 'rejected'; }
    }, id)).toBe('rejected');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
