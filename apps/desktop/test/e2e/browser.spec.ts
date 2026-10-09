import { _electron as electron, expect, test } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication, type TestApplication } from './electron-app';
import { pdfFixture } from './pdf-fixture';

async function fixture(document = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-browser-'));
  const requests: string[] = [];
  const slowDownloads = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url === '/download' || req.url === '/slow-download') {
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('content-disposition', `attachment; filename="${req.url === '/download' ? 'report.txt' : 'slow.txt'}"`);
      if (req.url === '/download') res.end('Downloaded by Setdown.');
      else {
        res.setHeader('content-length', 262144); res.write(Buffer.alloc(131072, 'a'));
        slowDownloads.add(res); res.on('close', () => slowDownloads.delete(res));
      }
      return;
    }
    if (req.url?.endsWith('.js')) {
      res.setHeader('content-type', 'application/javascript');
      res.end(req.url.includes('blocked') ? 'window.blockedScript=true' : 'window.allowedScript=true'); return;
    }
    res.setHeader('content-type', 'text/html');
    if (req.url === '/draggable' || req.url === '/draggable-frame') {
      res.end(`<!doctype html><title>Website draggable regions</title>
        <style>
          body { margin: 0 }
          .rail { -webkit-app-region: drag !important; height: 64px }
          .rail::before { content: ''; position: absolute; width: 64px; height: 64px; -webkit-app-region: drag !important }
          button { position: relative; width: 48px; height: 48px; margin: 8px }
          @media (max-width: 800px) { .rail { -webkit-app-region: no-drag !important } }
        </style>
        <div class="rail"><button id="home" style="-webkit-app-region: drag !important"
          onclick="window.homeClicks++;history.pushState({}, '', '#home')">Home</button></div>
        ${req.url === '/draggable' ? '<iframe src="/draggable-frame"></iframe>' : ''}
        <script>window.homeClicks = 0</script>`);
      return;
    }
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
  if (document) await expect(page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  else await expect(page.getByRole('button', { name: 'Open Web Page', exact: true })).toBeVisible();
  // HTTPS is a built-in Chromium protocol: handle() does not intercept its
  // browser navigation on Electron 38. Keep this fixture off the real network.
  await app.evaluate(({ session, net }) => session.fromPartition('persist:setdown-browser').protocol.interceptBufferProtocol('https', (request, respond) => {
    if (new URL(request.url).hostname === 'www.google.com') {
      respond({ data: Buffer.from('<!doctype html><title>Google</title><input aria-label="Search">'), mimeType: 'text/html' });
      return;
    }
    void net.fetch(request.url, { bypassCustomProtocolHandlers: true }).then(async response => respond({
      data: Buffer.from(await response.arrayBuffer()), headers: Object.fromEntries(response.headers), statusCode: response.status,
    })).catch(() => respond({ error: -2 }));
  }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  return { get app() { return app; }, get page() { return page; }, root, origin, requests, errors,
    finishDownloads() { for (const res of slowDownloads) res.end(Buffer.alloc(131072, 'b')); },
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

test('website draggable CSS cannot consume home navigation input in web tab frames', async () => {
  const f = await fixture(false);
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/draggable`);
    await expect(f.page.getByRole('tab', { name: /Website draggable regions/ })).toHaveAttribute('aria-selected', 'true');
    const inspect = () => evaluatePage<{ width: number; rail: string; button: string; pseudo: string; frame: string }>(f.app, f.origin, `({
      width: innerWidth,
      rail: getComputedStyle(document.querySelector('.rail')).getPropertyValue('-webkit-app-region'),
      button: getComputedStyle(document.querySelector('#home')).getPropertyValue('-webkit-app-region'),
      pseudo: getComputedStyle(document.querySelector('.rail'), '::before').getPropertyValue('-webkit-app-region'),
      frame: getComputedStyle(document.querySelector('iframe').contentDocument.querySelector('#home')).getPropertyValue('-webkit-app-region')
    })`);
    await expect.poll(inspect).toEqual({ width: expect.any(Number), rail: 'no-drag', button: 'no-drag', pseudo: 'no-drag', frame: 'no-drag' });
    expect((await inspect()).width).toBeGreaterThan(800);
    const contents = await f.app.evaluateHandle(({ webContents }, origin) => webContents.getAllWebContents()
      .find(wc => wc.getURL().startsWith(origin))!, f.origin);
    await contents.evaluate(wc => {
      wc.focus();
      wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 32, y: 32 });
      wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 32, y: 32 });
    });
    await expect.poll(() => evaluatePage(f.app, f.origin, '({clicks:homeClicks,hash:location.hash})'))
      .toEqual({ clicks: 1, hash: '#home' });
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'homeClicks')).toBe(0);
    await expect.poll(inspect).toEqual({ width: expect.any(Number), rail: 'no-drag', button: 'no-drag', pseudo: 'no-drag', frame: 'no-drag' });
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(650, 820));
    await expect.poll(async () => (await inspect()).width).toBeLessThan(800);
    expect((await inspect()).button).toBe('no-drag');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

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

test('browser Ctrl+wheel zooms websites and frames independently of the app and documents', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const firstTab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(firstTab).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0]
      .contentView.children.some(view => view.getVisible() && 'webContents' in view
        && (view as Electron.WebContentsView).webContents.getURL() === `${origin}/first`), f.origin)).toBe(true);
    const state = () => f.app.evaluate(({ BrowserWindow, webContents }, origin) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      const window = BrowserWindow.getAllWindows()[0];
      const view = window.contentView.children.find(view => 'webContents' in view
        && (view as Electron.WebContentsView).webContents.id === page.id)!;
      return { id: page.id, factor: page.getZoomFactor(), bounds: view.getBounds(), app: window.webContents.getZoomFactor() };
    }, f.origin);
    const wheel = async (deltaY: number, control = true, frame = false) => {
      await f.app.evaluate(async ({ webContents }, { origin, deltaY, control, frame }) => {
        const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
        const point = frame ? await page.executeJavaScript(`(()=>{
          const r=document.querySelector('iframe').getBoundingClientRect();
          return {x:r.x+r.width/2,y:r.y+r.height/2};})()`) : { x: 100, y: 20 };
        const factor = page.getZoomFactor();
        // Test the top-level surface first; (100,100) lands inside the iframe
        // before its compositor input region is registered. The explicit frame
        // case below separately verifies native wheel input inside the iframe.
        // Native input uses DIP; page wheel deltas are CSS pixels after zoom.
        const x = Math.round(point.x * factor), y = Math.round(point.y * factor);
        page.focus(); page.sendInputEvent({ type: 'mouseMove', x, y });
        page.sendInputEvent({ type: 'mouseWheel', x, y,
          deltaX: 0, deltaY: deltaY * factor, modifiers: control ? ['control'] : [], canScroll: true });
      }, { origin: f.origin, deltaY, control, frame });
    };
    await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="keep this";window.keptObject={value:42};true');
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.readyState')).toBe('complete');
    await evaluatePage(f.app, f.origin, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const original = await state();
    const preferences = await f.page.evaluate(() => window.marktex.getZoom());
    await evaluatePage(f.app, f.origin, 'window.dispatchEvent(new WheelEvent("wheel",{ctrlKey:true,deltaY:-120}));true');
    expect((await state()).factor).toBe(1);
    await wheel(120, false);
    expect((await state()).factor).toBe(1);
    await wheel(120);
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('110%');
    await wheel(-120);
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
    await wheel(40);
    expect((await state()).factor).toBeCloseTo(1, 4);
    await wheel(40);
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
    await wheel(-80);
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
    await wheel(120, true, true);
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
    expect(await state()).toEqual({ ...original, factor: expect.closeTo(1.1, 4) });
    expect(await f.page.evaluate(() => window.marktex.getZoom())).toEqual(preferences);
    expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,value:window.keptObject.value})'))
      .toEqual({ draft: 'keep this', value: 42 });
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await firstTab.click();
    expect((await state()).factor).toBeCloseTo(1.1, 4);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toHaveAttribute('aria-selected', 'true');
    expect(await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents()
      .find(wc => wc.getURL() === `${origin}/second`)!.getZoomFactor(), f.origin)).toBeCloseTo(1.1, 4);
    await f.page.getByRole('button', { name: 'New web tab', exact: true }).click();
    await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => f.app.evaluate(({ webContents }) => webContents.getAllWebContents()
      .find(wc => wc.getURL() === 'https://www.google.com/')!.getZoomFactor())).toBeCloseTo(1, 4);
    await f.page.keyboard.press('Control+=');
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.21, 4);
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
    await f.page.keyboard.press('Control+0');
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.1, 4);
    await firstTab.click();
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('110%');
    await f.page.getByRole('button', { name: 'Zoom website in', exact: true }).click();
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1.2, 4);
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('120%');
    expect(await evaluatePage(f.app, `${f.origin}/first`, 'document.querySelector("#draft").value')).toBe('keep this');
    await f.page.getByRole('button', { name: 'Reset website zoom' }).click();
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
    await expect.poll(async () => (await state()).factor).toBeCloseTo(1, 4);
    await f.page.getByRole('button', { name: 'Zoom website out', exact: true }).click();
    await expect.poll(async () => (await state()).factor).toBeCloseTo(.9, 4);
    await f.page.getByRole('button', { name: 'Reset website zoom' }).click();
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, `${f.origin}/first`, 'document.readyState')).toBe('complete');
    expect((await state()).factor).toBeCloseTo(1, 4);
    expect((await state()).id).toBe(original.id);
    await f.page.getByRole('tab', { name: /Second page/ }).click();
    await expect(f.page.getByRole('button', { name: 'Reset website zoom' })).toHaveText('100%');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('history deletion updates persistent places while preserving bookmarks and page state', async () => {
  const f = await fixture(false);
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await f.page.getByRole('button', { name: 'Bookmark page', exact: true }).click();
    await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="retained";true');
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await f.page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Research page']);
    await f.page.getByRole('button', { name: 'Delete history: Research page', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place')).toHaveCount(0);
    expect(await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value')).toBe('retained');
    expect(await f.page.evaluate(() => window.marktex.browser.places('', 'history'))).toEqual([]);
    await f.page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Research page']);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    await f.page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Second page']);
    await f.page.getByRole('button', { name: 'Clear history…', exact: true }).click();
    await f.page.getByRole('group', { name: 'Confirm clear history' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place-title')).toContainText(['Second page']);
    await f.page.getByRole('button', { name: 'Clear history…', exact: true }).click();
    await f.page.getByRole('button', { name: 'Clear all history', exact: true }).click();
    await expect(f.page.locator('.browser-sidebar .place')).toHaveCount(0);
    const bookmark = await f.page.evaluate(() => window.marktex.browser.places('', 'bookmarks'));
    expect(bookmark).toEqual([{ url: `${f.origin}/first`, title: 'Research page', bookmarked: true, lastVisit: 0, visits: 0 }]);
    // Prevent restored tabs from creating genuinely new visits during this
    // persistence check; reopening a page should normally record a new visit.
    await f.page.evaluate(async () => {
      for (const page of await window.marktex.browser.restore()) await window.marktex.browser.close(page.id);
    });
    await f.restart();
    expect(await f.page.evaluate(() => window.marktex.browser.places('', 'history'))).toEqual([]);
    expect(await f.page.evaluate(() => window.marktex.browser.places('', 'bookmarks'))).toEqual(bookmark);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('downloads expose native progress and controls, retain completed files across restart, and remove only records', async () => {
  test.setTimeout(90_000);
  const f = await fixture(false);
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await f.app.evaluate(({ session, shell }, root) => {
      session.fromPartition('persist:setdown-browser').on('will-download', (_event, item) => item.setSavePath(`${root}/${item.getFilename()}`));
      // Exercise main's path handling without launching external apps/windows.
      const calls: string[] = [];
      (globalThis as { downloadCalls?: string[] }).downloadCalls = calls;
      shell.openPath = async file => { calls.push(`open:${file}`); return ''; };
      shell.showItemInFolder = file => { calls.push(`show:${file}`); };
    }, f.root);
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await f.page.getByRole('button', { name: 'Downloads', exact: true }).click();
    await evaluatePage(f.app, f.origin, 'location.href="/download";true');
    let report = f.page.locator('.download').filter({ hasText: 'report.txt' });
    await expect(report).toHaveAttribute('data-state', 'completed');
    expect(await readFile(path.join(f.root, 'report.txt'), 'utf8')).toBe('Downloaded by Setdown.');
    await report.getByRole('button', { name: 'Open download: report.txt', exact: true }).click();
    await report.getByRole('button', { name: 'Show download in folder: report.txt', exact: true }).click();
    expect(await f.app.evaluate(() => (globalThis as { downloadCalls?: string[] }).downloadCalls))
      .toEqual([`open:${f.root}/report.txt`, `show:${f.root}/report.txt`]);
    await evaluatePage(f.app, f.origin, 'location.href="/slow-download";true');
    const slow = f.page.locator('.download').filter({ hasText: 'slow.txt' });
    await expect(slow).toHaveAttribute('data-state', 'progressing');
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.downloads()).find(item => item.name === 'slow.txt')?.received)).toBeGreaterThan(0);
    await slow.getByRole('button', { name: 'Pause download: slow.txt', exact: true }).click();
    await expect(slow.locator('.status')).toContainText('Paused');
    await slow.getByRole('button', { name: 'Resume download: slow.txt', exact: true }).click();
    await expect(slow.locator('.status')).toContainText('Downloading');
    f.finishDownloads();
    await expect(slow).toHaveAttribute('data-state', 'completed');
    expect((await readFile(path.join(f.root, 'slow.txt'))).length).toBe(262144);
    await evaluatePage(f.app, f.origin, 'location.href="/slow-download";true');
    const progressing = f.page.locator('.download[data-state="progressing"]');
    await progressing.getByRole('button', { name: 'Cancel download: slow.txt', exact: true }).click();
    await expect(progressing).toHaveCount(0);
    await expect(f.page.locator('.download[data-state="cancelled"]')).toHaveCount(1);
    await f.restart();
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await f.page.getByRole('button', { name: 'Downloads', exact: true }).click();
    report = f.page.locator('.download').filter({ hasText: 'report.txt' });
    await expect(report).toHaveAttribute('data-state', 'completed');
    await report.getByRole('button', { name: 'Remove download: report.txt', exact: true }).click();
    await expect(report).toHaveCount(0);
    expect(await readFile(path.join(f.root, 'report.txt'), 'utf8')).toBe('Downloaded by Setdown.');
    expect(f.errors).toEqual([]);
  } finally { f.finishDownloads(); await f.dispose(); }
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
    await expect(address).not.toBeFocused();
    await expect(address).toHaveValue('https://www.google.com/');
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
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

test('tab widths stay stable when adding tabs and updating web page titles', async () => {
  const f = await fixture();
  try {
    const notes = f.page.getByRole('tab', { name: /notes.md/ });
    await expect(notes).toBeVisible();
    const originalWidth = (await notes.boundingBox())!.width;
    await f.page.getByRole('button', { name: 'New web tab', exact: true }).click();
    const web = f.page.locator('.document-tab[aria-selected="true"]');
    await expect(web).toContainText('Google');
    const widths = () => f.page.locator('.document-tab').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().width));
    const settled = await widths();
    expect(settled[0]).toBe(originalWidth);
    await evaluatePage(f.app, 'https://www.google.com/', 'document.title = "A much longer website title that should only change the text inside its tab"; true');
    await expect(web).toContainText('A much longer website title');
    expect(await widths()).toEqual(settled);
    await evaluatePage(f.app, 'https://www.google.com/', 'document.title = "Google"; true');
    await expect(web).toContainText('Google');
    expect(await widths()).toEqual(settled);
    await f.page.getByRole('button', { name: 'New document', exact: true }).click();
    await expect(f.page.locator('.document-tab')).toHaveCount(3);
    await expect(f.page.locator('.editor-surface')).toBeVisible();
    expect((await widths()).slice(0, 2)).toEqual(settled);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('new web tabs take selection without selecting the address, including after a stale native focus event', async () => {
  const f = await fixture();
  try {
    await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const previous = f.page.getByRole('tab', { name: /Research page/ });
    await expect(previous).toHaveAttribute('aria-selected', 'true');
    const previousId = (await previous.getAttribute('data-tab-id'))!;
    await f.page.getByRole('button', { name: 'New web tab', exact: true }).click();
    const blank = f.page.getByRole('tab', { name: /Google/ });
    await expect(blank).toHaveAttribute('aria-selected', 'true');
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await expect(address).not.toBeFocused();
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
    const blankId = (await blank.getAttribute('data-tab-id'))!;
    // Native focus can already be in flight when a visible page is hidden.
    const received = await f.page.evaluateHandle(id => {
      const state = { received: false };
      const unsubscribe = window.marktex.browser.onEvent(event => {
        if (event.type !== 'focus' || event.id !== id) return;
        unsubscribe(); requestAnimationFrame(() => { state.received = true; });
      });
      return state;
    }, previousId);
    await f.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0].webContents.send('browser:event', { type: 'focus', id }), previousId);
    await expect.poll(() => received.evaluate(state => state.received)).toBe(true);
    await received.dispose();
    await expect(blank).toHaveAttribute('aria-selected', 'true');
    await previous.click();
    await f.page.keyboard.press('Control+t');
    await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveCount(2);
    const selected = f.page.locator('.document-tab[aria-selected="true"]');
    await expect(selected).toContainText('Google');
    expect(await selected.getAttribute('data-tab-id')).not.toBe(blankId);
    await expect(address).not.toBeFocused();
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
    await f.page.keyboard.press('Control+l');
    await expect(address).toBeFocused();
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === 0
      && (input as HTMLInputElement).selectionEnd === (input as HTMLInputElement).value.length)).toBe(true);
    await f.page.keyboard.press('Control+t');
    await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveCount(3);
    await expect(address).not.toBeFocused();
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
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

test('file URLs and web addresses replace the current tab, including PDFs outside the project', async () => {
  const f = await fixture();
  const downloads = await mkdtemp(path.join(os.tmpdir(), 'setdown-downloads-'));
  const pdf = path.join(downloads, "'26년 하반기 서울대 JD_게시용 # %20.pdf");
  await writeFile(pdf, pdfFixture(2));
  try {
    const selected = f.page.locator('.document-tab[aria-selected="true"]');
    await expect(selected).toContainText('notes.md');
    const id = (await selected.getAttribute('data-tab-id'))!;
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    const original = path.join(f.root, 'notes.md');
    await expect(address).toHaveValue(pathToFileURL(original).href);
    const go = async (value: string) => { await address.fill(value); await address.press('Enter'); };
    await go(`${f.origin}/first`);
    await expect(selected).toContainText('Research page');
    const contentsId = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
    await go(pathToFileURL(pdf).href);
    await expect(selected).toContainText(path.basename(pdf));
    await expect(address).toHaveValue(pathToFileURL(pdf).href);
    const reader = f.page.getByRole('region', { name: 'PDF reader', exact: true });
    await expect(reader).toHaveAttribute('data-pdf-pages', '2');
    await expect(reader.locator('[data-page-number="1"] .textLayer')).toContainText('PDF page 1');
    await expect.poll(() => f.app.evaluate(({ webContents }, id) => !!webContents.fromId(id), contentsId)).toBe(false);
    await go(`${f.origin}/second`);
    await expect(selected).toContainText('Second page');
    await expect(f.page.locator('.pdf-surface')).toHaveCount(0);
    await go(original); // Absolute paths remain accepted too.
    await expect(selected).toContainText('notes.md');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
    await expect(address).toHaveValue(pathToFileURL(original).href);
    await expect.poll(() => f.app.evaluate(async ({ BrowserWindow }) => {
      const views = BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible());
      if (views.length !== 1) return '';
      return (views[0] as import('electron').WebContentsView).webContents.executeJavaScript('document.body.innerText');
    })).toContain('Keep the reader intact.');
    await go(pathToFileURL(path.join(downloads, 'missing.pdf')).href);
    await expect(f.page.locator('.location-error[role="alert"]')).toContainText('ENOENT');
    await expect(selected).toContainText('notes.md');
    await expect(selected).toHaveAttribute('data-tab-id', id);
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); await rm(downloads, { recursive: true, force: true }); }
});

test('address navigation asks to save edited files and cancellation preserves the current tab', async () => {
  const f = await fixture();
  const file = path.join(f.root, 'edited.txt');
  await writeFile(file, 'Original text\n');
  try {
    const selected = f.page.locator('.document-tab[aria-selected="true"]');
    await expect(selected).toContainText('notes.md');
    const id = (await selected.getAttribute('data-tab-id'))!;
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await address.fill(pathToFileURL(file).href); await address.press('Enter');
    await expect(selected).toContainText('edited.txt');
    const editor = f.page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('unsaved marker');
    await expect(selected.getByLabel('Unsaved changes')).toBeVisible();
    await address.fill(`${f.origin}/first`); await address.press('Enter');
    const prompt = f.page.getByRole('dialog', { name: 'Save Changes' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    await expect(prompt).toHaveCount(0);
    await expect(selected).toContainText('edited.txt');
    await expect(selected.getByLabel('Unsaved changes')).toBeVisible();
    await expect(address).toHaveValue(pathToFileURL(file).href);
    expect(await readFile(file, 'utf8')).not.toContain('unsaved marker');
    await address.fill(`${f.origin}/first`); await address.press('Enter');
    await prompt.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(selected).toContainText('Research page');
    expect(await readFile(file, 'utf8')).toContain('unsaved marker');
    await expect(selected).toHaveAttribute('data-tab-id', id);
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('Back and Forward traverse file and web boundaries while restoring the native web stack', async () => {
  const f = await fixture();
  const pdf = path.join(f.root, 'history.pdf');
  await writeFile(pdf, pdfFixture(2));
  try {
    const selected = f.page.locator('.document-tab[aria-selected="true"]');
    await expect(selected).toContainText('notes.md');
    const id = await selected.getAttribute('data-tab-id');
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    const back = f.page.getByRole('button', { name: 'Back', exact: true });
    const forward = f.page.getByRole('button', { name: 'Forward', exact: true });
    await expect(back).toBeDisabled();
    await address.fill(`${f.origin}/first`); await address.press('Enter');
    await expect(selected).toContainText('Research page');
    await evaluatePage(f.app, f.origin, 'document.querySelector("a").click();true');
    await expect(address).toHaveValue(`${f.origin}/second`);
    await address.fill(pathToFileURL(pdf).href); await address.press('Enter');
    await expect(f.page.getByRole('region', { name: 'PDF reader', exact: true })).toHaveAttribute('data-pdf-pages', '2');
    await back.click();
    await expect(address).toHaveValue(`${f.origin}/second`);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'location.pathname')).toBe('/second');
    await back.click();
    await expect(address).toHaveValue(`${f.origin}/first`);
    // Input in the native page must also cross the last web entry into a file.
    await f.app.evaluate(({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      page.focus(); page.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['alt'] });
      page.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['alt'] });
    }, f.origin);
    await expect(selected).toContainText('notes.md');
    await expect(address).toHaveValue(pathToFileURL(path.join(f.root, 'notes.md')).href);
    await expect(back).toBeDisabled();
    await forward.click(); await expect(address).toHaveValue(`${f.origin}/first`);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'location.pathname')).toBe('/first');
    await forward.click(); await expect(address).toHaveValue(`${f.origin}/second`);
    await forward.click(); await expect(selected).toContainText('history.pdf');
    await back.click(); await expect(address).toHaveValue(`${f.origin}/second`);
    await address.fill(`${f.origin}/new-branch`); await address.press('Enter');
    await expect.poll(() => evaluatePage(f.app, f.origin, 'location.pathname')).toBe('/new-branch');
    await expect(forward).toBeDisabled();
    await expect(selected).toHaveAttribute('data-tab-id', id!);
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('address focus selects the whole URL for mouse, keyboard, and native page shortcuts', async () => {
  const f = await fixture();
  try {
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    const selected = () => address.evaluate(input => {
      const value = input as HTMLInputElement;
      return value.selectionStart === 0 && value.selectionEnd === value.value.length;
    });
    await expect(address).not.toBeFocused();
    await address.click();
    expect(await selected()).toBe(true);
    await f.page.keyboard.type('replacement');
    await expect(address).toHaveValue('replacement');
    await address.fill(`${f.origin}/first`); await address.press('Enter');
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('Research page');
    await f.app.evaluate(({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      page.focus(); page.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: ['control'] });
      page.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: ['control'] });
    }, f.origin);
    await expect(address).toBeFocused();
    expect(await selected()).toBe(true);
    await f.page.keyboard.type('fresh input');
    await expect(address).toHaveValue('fresh input');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('native Markdown reader shortcuts select the address and go back to the previous file', async () => {
  const f = await fixture();
  const previous = path.join(f.root, 'previous.txt');
  await writeFile(previous, 'Previous file content\n');
  try {
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('notes.md');
    await address.fill(previous); await address.press('Enter');
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('previous.txt');
    await address.fill(path.join(f.root, 'notes.md')); await address.press('Enter');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]
      .contentView.children.filter(v => v.getVisible()).length)).toBe(1);
    const send = async (keyCode: string, modifier: 'control' | 'alt') => {
      await f.app.evaluate(({ BrowserWindow }, { keyCode, modifier }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.getVisible()) as import('electron').WebContentsView;
        view.webContents.focus();
        view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [modifier] });
        view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [modifier] });
      }, { keyCode, modifier });
    };
    await send('L', 'control');
    await expect(address).toBeFocused();
    expect(await address.evaluate(input => {
      const value = input as HTMLInputElement;
      return value.selectionStart === 0 && value.selectionEnd === value.value.length;
    })).toBe(true);
    await send('Left', 'alt');
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('previous.txt');
    await expect(f.page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    await expect(f.page.locator('.document-tab')).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
