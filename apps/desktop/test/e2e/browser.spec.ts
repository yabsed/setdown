import { electron } from './electron-app';
import { expect, test } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication, type TestApplication } from './electron-app';
import { pdfFixture } from './pdf-fixture';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);

async function fixture(document = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-browser-'));
  const requests: string[] = [];
  const slowDownloads = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url === '/private') {
      if (req.headers.authorization !== `Basic ${Buffer.from('reader:secret').toString('base64')}`) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="Fixture library"' }); res.end('Authentication required');
      } else res.end('<!doctype html><title>Private library</title><p>Signed in.</p>');
      return;
    }
    if (req.url === '/network-failure') { req.socket.destroy(); return; }
    if (req.url === '/download-pdf') {
      res.setHeader('content-type', 'application/pdf'); res.setHeader('content-disposition', 'attachment; filename="download.pdf"');
      res.end(pdfFixture(1)); return;
    }
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
    if (req.url === '/article') {
      const paragraphs = Array.from({ length: 40 }, (_, i) => `<p data-marker="${i}">Paragraph ${i}: reading mode should feel`
        + ` exactly like the rendered Markdown reader, with the same Esc transition in, the same double-click`
        + ` back out, and the reading position preserved in both directions every single time.</p>`).join('\n');
      res.end(`<!doctype html><title>Long article</title>
        <header><nav><a href="/first">Home</a> <a href="/second">More noise</a></nav></header>
        <input id="draft">
        <article><h1>The Long Article Title</h1><p>By A. Writer</p>${paragraphs}</article>
        <footer>Copyright noise that reader mode must drop.</footer>`);
      return;
    }
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
  const headless = process.env.SETDOWN_E2E_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu'] : [];
  const launchOptions = { args: [...headless, '.', ...(document ? [file] : [])], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } };
  let app = await electron.launch(launchOptions);
  let page = await app.firstWindow();
  await focusApplication(app);
  if (document) await expect(page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  else await expect(page.getByRole('button', { name: 'Open Web Page', exact: true })).toBeVisible();
  // Keep Google navigation assertions off the real network.
  await app.context().route('https://www.google.com/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Google</title><input aria-label="Search">',
  }));
  // A fresh profile compiles uBlock's filter lists for several seconds and
  // first navigation waits for it; that cold start is part of fixture setup
  // (it must still complete), not of each test's 5s UI assertions.
  await page.evaluate(() => window.marktex.browser.extensions());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  return { get app() { return app; }, get page() { return page; }, root, origin, requests, errors,
    finishDownloads() { for (const res of slowDownloads) res.end(Buffer.alloc(131072, 'b')); },
    async restart() {
      await app.close();
      app = await electron.launch(launchOptions);
      page = await app.firstWindow();
      await focusApplication(app);
      await page.evaluate(() => window.marktex.browser.extensions());
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

// Native Electron menus are still constructed and displayed on Xvfb. Retain a
// handle so the tests can choose an OS menu item using real isolated input.
async function captureNativeMenus(app: TestApplication) {
  await app.evaluate(({ Menu }) => {
    const build = Menu.buildFromTemplate;
    const templates = new WeakMap<Electron.Menu, Electron.MenuItemConstructorOptions[]>();
    Menu.buildFromTemplate = function(template) {
      const menu = build.call(this, template); templates.set(menu, template as Electron.MenuItemConstructorOptions[]); return menu;
    };
    const original = Menu.prototype.popup;
    Menu.prototype.popup = function(options) {
      (globalThis as any).__browserTestMenu = this;
      (globalThis as any).__browserTestMenuTemplate = templates.get(this);
      return original.call(this, options);
    };
  });
}
async function chooseNativeMenu(app: TestApplication, labels: string[]) {
  const keys = await app.evaluate(({ Menu }, labels) => {
    const root: Electron.Menu = (globalThis as any).__browserTestMenu;
    let items: Electron.MenuItemConstructorOptions[] = (globalThis as any).__browserTestMenuTemplate;
    if (!root || !items) throw Error('No native menu was opened');
    const keys: string[] = [];
    for (const [index, label] of labels.entries()) {
      const item = items.find(item => item.label === label);
      if (!item) throw Error(`Missing native menu item: ${label}`);
      const available = items.filter(item => item.type !== 'separator' && item.enabled !== false);
      keys.push('Home', ...Array.from({ length: available.indexOf(item) }, () => 'Down'));
      if (index < labels.length - 1) { keys.push('Right'); items = item.submenu as Electron.MenuItemConstructorOptions[]; }
      else {
        if (item.enabled === false || !item.click) throw Error(`Disabled native menu item: ${label}`);
        keys.push('Return');
      }
    }
    void Menu;
    return keys;
  }, labels);
  if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native menu input requires the isolated Xvfb display.');
  await execFile('python3', ['-c', `
import ctypes, ctypes.util, json, sys, time
x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.restype=ctypes.c_void_p
x.XStringToKeysym.argtypes=[ctypes.c_char_p]; x.XStringToKeysym.restype=ctypes.c_ulong
x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong]; x.XKeysymToKeycode.restype=ctypes.c_uint
x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
d=x.XOpenDisplay(None)
if not d: raise RuntimeError('No isolated X display')
for key in json.loads(sys.argv[1]):
 code=x.XKeysymToKeycode(d,x.XStringToKeysym(key.encode()))
 t.XTestFakeKeyEvent(d,code,1,0); t.XTestFakeKeyEvent(d,code,0,0); x.XFlush(d); time.sleep(.03)
x.XCloseDisplay(d)
`, JSON.stringify(keys)]);
}
async function pageContextMenu(app: TestApplication, origin: string, selector: string) {
  await app.evaluate(async ({ webContents }, { origin, selector }) => {
    const wc = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(origin))!;
    const point = await wc.executeJavaScript(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
    const position = { x: Math.round(point.x * wc.getZoomFactor()), y: Math.round(point.y * wc.getZoomFactor()) };
    await new Promise<void>(resolve => {
      wc.once('context-menu', () => resolve());
      wc.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...position });
      wc.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...position });
    });
  }, { origin, selector });
}

test('browser details: notification requests stay quiet, coalesce and expire with their document', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, `window.permissionResults=[]; Notification.requestPermission().then(r=>permissionResults.push(r)); Notification.requestPermission().then(r=>permissionResults.push(r)); true`);
    const review = f.page.getByRole('button', { name: 'Review permissions: Notifications', exact: true });
    await expect(review).toBeVisible();
    await expect(f.page.getByRole('dialog')).toHaveCount(0);
    expect(await evaluatePage(f.app, f.origin, 'permissionResults.length')).toBe(0);
    await review.click();
    await chooseNativeMenu(f.app, [`Notifications · ${f.origin}`, 'Deny']);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'permissionResults')).toEqual(['denied', 'denied']);
    await expect(review).toHaveCount(0);
    await evaluatePage(f.app, f.origin, `Notification.requestPermission().then(r=>permissionResults.push(r)); true`);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'permissionResults.length')).toBe(3);
    await expect(review).toHaveCount(0);
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.readyState')).toBe('complete');
    await evaluatePage(f.app, f.origin, `Notification.requestPermission().then(r=>window.permissionResult=r);true`);
    await expect(review).toBeVisible(); await review.click();
    await chooseNativeMenu(f.app, [`Notifications · ${f.origin}`, 'Allow for This Page']);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'window.permissionResult')).toBe('granted');
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.readyState')).toBe('complete');
    await evaluatePage(f.app, f.origin, `Notification.requestPermission();true`); await expect(review).toBeVisible();
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await address.fill(`${f.origin}/second`); await address.press('Enter');
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible(); await expect(review).toHaveCount(0);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('browser details: native image copying and link menus preserve pixels, URLs and source ownership', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, `(() => {
      const canvas=document.createElement('canvas');canvas.width=20;canvas.height=10;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,20,10);
      const image=new Image();image.id='copy-target';image.src=canvas.toDataURL();image.style='display:block;width:100px;height:50px';
      document.body.prepend(image);return image.decode();
    })()`);
    const id = await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id');
    await f.page.evaluate(id => window.marktex.browser.command(id!, 'zoom-in'), id);
    await f.app.evaluate(({ clipboard }) => clipboard.clear());
    await pageContextMenu(f.app, f.origin, '#copy-target'); await chooseNativeMenu(f.app, ['Copy Image']);
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.focus());
    await expect.poll(() => f.page.evaluate(async () => {
      const item = (await navigator.clipboard.read()).find(item => item.types.includes('image/png'));
      if (!item) return null;
      const bitmap = await createImageBitmap(await item.getType('image/png'));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
      const copied = { width: bitmap.width, height: bitmap.height, pixel: [...context.getImageData(0, 0, 1, 1).data] };
      bitmap.close(); return copied;
    })).toEqual({ width: 20, height: 10, pixel: [255, 0, 0, 255] });
    await pageContextMenu(f.app, f.origin, 'a'); await chooseNativeMenu(f.app, ['Copy Link Address']);
    expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(`${f.origin}/second`);
    await pageContextMenu(f.app, f.origin, 'a'); await chooseNativeMenu(f.app, ['Open Link in New Tab']);
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
    // Keep a stale native menu through a real navigation: it cannot copy data
    // or operate on the replacement document.
    await pageContextMenu(f.app, `${f.origin}/first`, '#copy-target');
    await f.app.evaluate(async ({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      await wc.loadURL(`${origin}/second?replacement`);
    }, f.origin);
    await f.app.evaluate(({ clipboard }) => clipboard.clear());
    await chooseNativeMenu(f.app, ['Copy Image']);
    expect(await f.app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(false);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('browser details: hidden pages retain forms, mute remains accessible and closed tabs reopen without stale forms', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const web = f.page.getByRole('tab', { name: /Research page/ }); await expect(web).toBeVisible();
    // Playwright enables focus emulation on every attached page, which forces
    // document.visibilityState to "visible". Observe actual Blink visibility.
    const target = f.app.context().pages().find(page => page.url().startsWith(f.origin))!;
    // This must be the session that enabled the emulation: a new CDP session
    // cannot release another session's capturer. Confine Playwright's internal
    // adapter to this test; an API change fails here instead of faking visibility.
    const implementation = (target as any)._connection.toImpl(target);
    await implementation.delegate._mainFrameSession._client.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const id = await web.getAttribute('data-tab-id');
    const identity = await evaluatePage(f.app, f.origin, `window.pageIdentity=crypto.randomUUID();document.querySelector('#draft').value='Keep my draft';pageIdentity`);
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.visibilityState')).toBe('hidden');
    await web.click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.visibilityState')).toBe('visible');
    expect(await evaluatePage(f.app, f.origin, `({id:pageIdentity,draft:document.querySelector('#draft').value})`)).toEqual({ id: identity, draft: 'Keep my draft' });
    await f.page.evaluate(id => window.marktex.browser.command(id!, 'mute'), id);
    await expect(web.getByRole('button', { name: 'Unmute tab' })).toBeVisible();
    await web.getByRole('button', { name: 'Unmute tab' }).click();
    await expect(web.getByRole('button', { name: 'Unmute tab' })).toHaveCount(0);
    await f.page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-reload-no-cache'));
    await expect.poll(() => evaluatePage(f.app, f.origin, 'window.pageIdentity')).toBeUndefined();
    await expect(web).toHaveAttribute('data-tab-id', id!); await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
    await web.locator('.tab-close').click(); await expect(web).toHaveCount(0);
    await f.page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-reopen-web'));
    await expect(web).toHaveAttribute('aria-selected', 'true');
    expect(await web.getAttribute('data-tab-id')).not.toBe(id);
    expect(await evaluatePage(f.app, f.origin, `document.querySelector('#draft').value`)).toBe('');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('browser details: page find discards cleared searches and Escape respects editable controls', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, `document.body.insertAdjacentHTML('beforeend','<p>needle needle</p>');document.querySelector('#draft').focus();true`);
    await f.app.evaluate(({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(origin))!; wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    }, f.origin);
    await expect(f.page.getByRole('button', { name: 'Enter reader mode', exact: true })).toBeVisible();
    expect(await evaluatePage(f.app, f.origin, 'document.activeElement.id')).toBe('draft');
    await f.page.evaluate(() => window.dispatchEvent(new Event('setdown:browser-find')));
    const finder = f.page.getByRole('textbox', { name: 'Find in web page' });
    await expect(finder).toBeFocused(); await finder.fill('needle');
    await expect(f.page.locator('.location-bar .find-count')).toHaveText('1/2');
    await finder.fill(''); await expect(f.page.locator('.location-bar .find-count')).toHaveText('0/0');
    await finder.dispatchEvent('keydown', { key: 'Escape', isComposing: true }); await expect(finder).toBeVisible();
    await finder.press('Escape'); await expect(finder).toHaveCount(0);
    await expect(f.page.getByRole('button', { name: 'Enter reader mode', exact: true })).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('browser details: HTTP authentication is an owned opt-in prompt and error reload preserves its URL', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/private`);
    const signIn = f.page.getByRole('button', { name: 'Sign in to website', exact: true });
    await expect(signIn).toBeVisible(); await expect(f.page.getByRole('dialog')).toHaveCount(0);
    await signIn.click();
    const prompt = f.page.getByRole('dialog', { name: 'Sign in to website', exact: true });
    await expect(prompt).toBeVisible(); await expect(prompt).toContainText(f.origin);
    await prompt.getByLabel('Username').fill('reader'); await prompt.getByLabel('Password', { exact: true }).fill('secret');
    await prompt.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(prompt).not.toBeVisible(); await expect(f.page.getByRole('tab', { name: /Private library/ })).toBeVisible();
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await address.fill(`${f.origin}/network-failure`); await address.press('Enter');
    await expect(f.page.locator('.browser-empty')).toBeVisible(); await expect(address).toHaveValue(`${f.origin}/network-failure`);
    const before = f.requests.filter(url => url === '/network-failure').length;
    await f.page.locator('.browser-empty').getByRole('button', { name: 'Reload page' }).click();
    await expect.poll(() => f.requests.filter(url => url === '/network-failure').length).toBeGreaterThan(before);
    await expect(address).toHaveValue(`${f.origin}/network-failure`);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('browser details: site reset preserves other sites and PDF completion leaves the active tab alone', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const web = f.page.getByRole('tab', { name: /Research page/ }); await expect(web).toBeVisible();
    const id = await web.getAttribute('data-tab-id');
    await evaluatePage(f.app, f.origin, `localStorage.setItem('draft','site data');document.cookie='fixture=local';true`);
    await f.page.evaluate(url => window.marktex.browser.bookmark(url, 'Retained bookmark', true), `${f.origin}/first`);
    await f.app.evaluate(async ({ session, dialog }, origin) => {
      await session.fromPartition('persist:setdown-browser').cookies.set({ url: 'https://unrelated.example/', name: 'fixture', value: 'keep' });
      dialog.showMessageBox = (async (_window, options) => {
        if (!options?.detail?.includes(origin)) throw Error('Site reset must identify the exact origin');
        return { response: 1, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, f.origin);
    await f.page.getByRole('button', { name: 'Site controls', exact: true }).click(); await chooseNativeMenu(f.app, ['Clear This Site’s Data…']);
    await expect.poll(() => evaluatePage(f.app, f.origin, `localStorage.getItem('draft')`)).toBe(null);
    expect(await evaluatePage(f.app, f.origin, 'document.cookie')).not.toContain('fixture=local');
    expect(await f.app.evaluate(async ({ session }) => (await session.fromPartition('persist:setdown-browser').cookies.get({ url: 'https://unrelated.example/' }))[0]?.value)).toBe('keep');
    expect(await f.page.evaluate(async url => (await window.marktex.browser.places(url, 'bookmarks')).some(place => place.url === url), `${f.origin}/first`)).toBe(true);
    const target = path.join(f.root, 'download.pdf');
    await f.app.evaluate(({ session }, target) => session.fromPartition('persist:setdown-browser').once('will-download', (_event, item) => item.setSavePath(target)), target);
    await evaluatePage(f.app, f.origin, `const link=document.createElement('a');link.href='/download-pdf';link.download='download.pdf';document.body.append(link);link.click();true`);
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.downloads()).some(item => item.name === 'download.pdf' && item.state === 'completed'))).toBe(true);
    await expect(web).toHaveAttribute('aria-selected', 'true'); expect(await web.getAttribute('data-tab-id')).toBe(id);
    expect((await readFile(target)).subarray(0, 4).toString()).toBe('%PDF');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('browser details: cancelling native beforeunload preserves the form and does not add a closed tab', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const web = f.page.getByRole('tab', { name: /Research page/ }); await expect(web).toBeVisible();
    // Electron's will-prevent-unload handler answers this dialog. Prevent
    // Playwright's automatic dismissal from racing that native answer.
    f.app.context().pages().find(page => page.url().startsWith(f.origin))!.on('dialog', () => {});
    const id = await web.getAttribute('data-tab-id');
    await f.app.evaluate(async ({ webContents, dialog }, origin) => {
      dialog.showMessageBoxSync = () => 0;
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      await wc.executeJavaScript(`document.querySelector('#draft').value='unsaved form';window.onbeforeunload=()=>false;true`, true);
    }, f.origin);
    expect(await f.page.evaluate(id => window.marktex.browser.close(id!, true), id)).toBe(false);
    await expect(web).toHaveAttribute('aria-selected', 'true');
    expect(await evaluatePage(f.app, f.origin, `document.querySelector('#draft').value`)).toBe('unsaved form');
    await f.page.evaluate(() => window.marktex.browser.reopen()); await expect(web).toHaveCount(1);
    await f.app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    expect(await f.page.evaluate(id => window.marktex.browser.close(id!, true), id)).toBe(true);
    await expect(web).toHaveCount(0); await f.page.evaluate(() => window.marktex.browser.reopen());
    await expect(web).toHaveAttribute('aria-selected', 'true');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('closing a window with audible web contents releases pages without main-process exceptions', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    const id = await f.app.evaluate(async ({ webContents, BrowserWindow, dialog }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      await wc.executeJavaScript(`(() => {
        const audio = window.testAudio = new AudioContext();
        const oscillator = audio.createOscillator(); oscillator.connect(audio.destination); oscillator.start();
        return audio.resume();
      })()`, true);
      // Keep the process inspectable after the real workspace closes. The
      // observer is not a workspace and cannot retain any of its browser tabs.
      (globalThis as any).__closeObserver = new BrowserWindow({ show: false });
      (globalThis as any).__closeErrors = [];
      process.on('uncaughtExceptionMonitor', error => (globalThis as any).__closeErrors.push(String(error)));
      dialog.showErrorBox = (title, content) => { (globalThis as any).__closeErrors.push(`${title}: ${content}`); };
      return wc.id;
    }, f.origin);
    await expect.poll(() => f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isCurrentlyAudible(), id)).toBe(true);
    await f.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.close();
    });
    await expect.poll(() => f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isDestroyed() ?? true, id)).toBe(true);
    expect(await f.app.evaluate(() => (globalThis as any).__closeErrors)).toEqual([]);
  } finally { await f.dispose(); }
});

for (const command of ['close', 'quit'] as const) test(`canceling ${command} preserves audible pages, confirmed exit releases them`, async () => {
  const f = await fixture();
  let stderr = '';
  f.app.process().stderr?.on('data', data => { stderr += String(data); });
  try {
    await f.page.locator('.mode-toggle').click();
    const editor = f.page.getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially(' unsaved');
    await expect(f.page.locator('.tab-dirty')).toHaveCount(1);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    const id = await f.app.evaluate(async ({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      await wc.executeJavaScript(`(() => {
        const audio = window.testAudio = new AudioContext();
        const tone = audio.createOscillator(); tone.connect(audio.destination); tone.start(); return audio.resume();
      })()`, true);
      return wc.id;
    }, f.origin);
    const audible = () => f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isCurrentlyAudible() ?? false, id);
    await expect.poll(audible).toBe(true);
    const close = () => f.app.evaluate(({ app, BrowserWindow }, command) => {
      if (command === 'quit') app.quit(); else BrowserWindow.getAllWindows()[0].close();
    }, command);
    await close();
    const prompt = f.page.locator('dialog[aria-labelledby="close-prompt-title"]');
    await expect(prompt).toBeVisible();
    await prompt.locator('.close-cancel').click();
    await expect(prompt).toBeHidden();
    await expect.poll(audible).toBe(true);
    expect(await evaluatePage(f.app, f.origin, 'window.testAudio.state')).toBe('running');
    await close(); await expect(prompt).toBeVisible();
    const exited = f.app.waitForEvent('close');
    await prompt.locator('.close-discard').click();
    await exited;
    expect(stderr).not.toMatch(/Uncaught Exception|Cannot read properties of undefined|Object has been destroyed/);
  } finally { await f.dispose(); }
});

for (const right of ['markdown', 'reader', 'web'] as const) test(`address suggestions preserve live video beside ${right}`, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const tab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(tab).toBeVisible();
    const data = await f.page.evaluateHandle(() => new DataTransfer());
    await tab.dispatchEvent('dragstart', { dataTransfer: data });
    const body = f.page.locator('.group-body').first(), bounds = (await body.boundingBox())!;
    const point = { clientX: bounds.x + bounds.width * .02, clientY: bounds.y + bounds.height / 2, dataTransfer: data };
    await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
    await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
    await expect(f.page.locator('.location-bar')).toHaveCount(2);
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).last();
    if (right !== 'markdown') {
      await address.fill(`${f.origin}/article`); await address.press('Enter');
      await expect(f.page.getByRole('tab', { name: /Long article/ })).toBeVisible();
      if (right === 'reader') await f.page.getByRole('button', { name: 'Enter reader mode', exact: true }).last().click();
    }
    await f.page.evaluate(url => window.marktex.browser.bookmark(url, 'Chosen destination', true), `${f.origin}/second`);
    await evaluatePage(f.app, `${f.origin}/first`, `(() => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d'); let frame = 0;
      setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 640, 480); }, 50);
      const video = document.createElement('video'); video.muted = true;
      video.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:fill';
      video.srcObject = canvas.captureStream(20); document.body.append(video);
      window.presentedFrames = 0;
      const count = () => { window.presentedFrames++; video.requestVideoFrameCallback(count); };
      video.requestVideoFrameCallback(count); return video.play();
    })()`);
    await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(3);
    const nativePages = () => f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().startsWith(origin))
      .map(view => ({ id: (view as Electron.WebContentsView).webContents.id, bounds: view.getBounds(), visible: view.getVisible() })), f.origin);
    if (right === 'web') {
      await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
      await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeGreaterThan(1);
      await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const factor = await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
      const tops = await f.page.locator('.group-body').evaluateAll((nodes, factor) => nodes.map(node => Math.round(node.getBoundingClientRect().top * factor)), factor);
      await expect.poll(async () => (await nativePages()).map(page => page.bounds.y)).toEqual(tops);
    }
    const initialPages = await nativePages();
    // CDP fill does not transfer native WebContents focus. Establish the same
    // shell focus as an actual address click before testing popup attachment.
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.focus());
    await address.click(); await address.fill(f.origin);
    await expect.poll(() => f.app.windows().some(page => page.url().includes('location-overlay=1'))).toBe(true);
    const popup = f.app.windows().find(page => page.url().includes('location-overlay=1'))!;
    await expect(popup.getByRole('option', { name: /Chosen destination/ })).toBeVisible();
    // Give the real dropdown its normal presentation cycle before observing
    // frames; a paused video can still deliver its last queued callback.
    const before = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(before + 10);
    await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
    await expect(address).toBeFocused();
    expect(await nativePages()).toEqual(initialPages);
    // A trusted native popup must not steal the composing input or resize any
    // live web page. Exercise both composition and real native mouse routing.
    expect(await f.app.evaluate(({ BrowserWindow, webContents }) => webContents.getFocusedWebContents()?.id
      === BrowserWindow.getAllWindows()[0].webContents.id)).toBe(true);
    await address.evaluate(input => {
      (window as any).__addressIme = { starts: 0, ends: 0, blur: 0 };
      input.addEventListener('compositionstart', () => { (window as any).__addressIme.starts++; });
      input.addEventListener('compositionend', () => { (window as any).__addressIme.ends++; });
      input.addEventListener('blur', () => { (window as any).__addressIme.blur++; });
      window.addEventListener('blur', () => { (window as any).__addressIme.blur++; });
    });
    const cdp = await f.app.context().newCDPSession(f.page);
    await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
    await expect(address).toBeFocused();
    const composingFrame = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(composingFrame + 5);
    expect(await f.page.evaluate(() => (window as any).__addressIme)).toEqual({ starts: 1, ends: 0, blur: 0 });
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await cdp.detach();
    await address.fill(f.origin);
    const row = popup.getByRole('option', { name: /Chosen destination/ });
    await expect(row).toBeVisible();
    const rowBounds = (await row.boundingBox())!;
    const click = await f.app.evaluate(({ BrowserWindow }, point) => {
      const owner = BrowserWindow.getAllWindows()[0];
      const view = owner.contentView.children.find(view => 'webContents' in view
        && (view as Electron.WebContentsView).webContents.getURL().includes('location-overlay=1')) as Electron.WebContentsView;
      if (!view?.getVisible()) throw Error('Address dropdown is not natively visible');
      const root = owner.getContentBounds(), bounds = view.getBounds(), zoom = view.webContents.getZoomFactor();
      return { x: Math.round(root.x + bounds.x + (point.x + point.width / 2) * zoom),
        y: Math.round(root.y + bounds.y + (point.y + point.height / 2) * zoom) };
    }, rowBounds);
    if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native pointer input requires isolated Xvfb.');
    await execFile('python3', ['-c', `
import ctypes, ctypes.util, sys
x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.restype=ctypes.c_void_p
x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
d=x.XOpenDisplay(None)
if not d: raise RuntimeError('No isolated X display')
t.XTestFakeMotionEvent(d,-1,int(sys.argv[1]),int(sys.argv[2]),0)
t.XTestFakeButtonEvent(d,1,1,0); t.XTestFakeButtonEvent(d,1,0,0); x.XFlush(d); x.XCloseDisplay(d)
`, String(click.x), String(click.y)]);
    await expect(address).toHaveValue(`${f.origin}/second`);
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    const afterChoice = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(afterChoice + 5);
    await address.click(); await address.fill(`${f.origin}/second`);
    const destination = popup.getByRole('option', { name: /Second page/ });
    await expect(destination).toBeVisible();
    await address.press('ArrowDown');
    await expect(destination).toHaveAttribute('aria-selected', 'true');
    await address.press('Escape');
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().includes('location-overlay=1')))).toBe(false);
    const leftAddress = f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).first();
    await leftAddress.fill(f.origin);
    await expect(popup.getByRole('option').first()).toBeVisible();
    const samePaneFrame = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(samePaneFrame + 5);
    await expect(leftAddress).toBeFocused();
    await leftAddress.press('Escape');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('reading surfaces offer native copy/search menus and local Markdown PDF export', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    const menu = async () => f.app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.getVisible()
        && 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().startsWith('marktex-preview:')) as Electron.WebContentsView;
      const wc = view.webContents; wc.focus();
      const point = await wc.executeJavaScript(`(() => { const p=document.querySelector('.markdown-preview p'); const range=document.createRange(); range.selectNodeContents(p); const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);const r=p.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
      await new Promise<void>(resolve => {
        wc.once('context-menu', () => resolve());
        wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'right', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'right', clickCount: 1 });
      });
    });
    await menu();
    await chooseNativeMenu(f.app, ['Copy']);
    expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Keep the reader intact.');
    await menu(); await chooseNativeMenu(f.app, ['Search Google']);
    await expect(f.page.getByRole('tab', { name: /Google/ })).toBeVisible();
    expect(await f.page.getByRole('textbox', { name: 'Address or file path' }).inputValue()).toContain('search?q=Keep%20the%20reader');
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    const target = test.info().outputPath('notes.pdf');
    await f.app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog; }, target);
    await menu(); await chooseNativeMenu(f.app, ['Export to PDF…']);
    await expect.poll(() => readFile(target).then(data => data.subarray(0, 5).toString()).catch(() => '')).toBe('%PDF-');
    await expect(f.page.getByRole('tab', { name: /notes.md/ })).toHaveAttribute('aria-selected', 'true');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('web reader searches the visible article and exports its snapshot as Markdown and PDF', async () => {
  const f = await fixture();
  try {
    await captureNativeMenus(f.app);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/article`);
    const tab = f.page.getByRole('tab', { name: /Long article/ }); await expect(tab).toBeVisible();
    const id = (await tab.getAttribute('data-tab-id'))!;
    await f.page.getByRole('button', { name: 'Enter reader mode' }).click();
    const reader = f.page.getByRole('region', { name: 'Reader mode', exact: true });
    await expect(reader).toBeVisible();
    await f.app.evaluate(({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/article`)!;
      (globalThis as any).__readerNativeFind = 0;
      const find = wc.findInPage.bind(wc);
      wc.findInPage = (...args) => { (globalThis as any).__readerNativeFind++; return find(...args); };
    }, f.origin);
    await f.page.keyboard.press('Control+f');
    const find = f.page.getByRole('textbox', { name: 'Find in web page' });
    await expect(find).toBeFocused(); await find.fill('Paragraph ');
    await expect(f.page.locator('.location-bar .find-count')).toHaveText('1/40');
    await find.press('Enter'); await expect(f.page.locator('.location-bar .find-count')).toHaveText('2/40');
    await find.press('Shift+Enter'); await expect(f.page.locator('.location-bar .find-count')).toHaveText('1/40');
    await find.press('Shift+Enter'); await expect(f.page.locator('.location-bar .find-count')).toHaveText('40/40');
    await find.fill('Export to Markdown'); await expect(f.page.locator('.location-bar .find-count')).toHaveText('0/0');
    await find.fill('Paragraph 39');
    await expect(f.page.locator('.location-bar .find-count')).toHaveText('1/1');
    expect(await f.app.evaluate(() => (globalThis as any).__readerNativeFind)).toBe(0);
    expect(await reader.evaluate((element, id) => {
      const highlight = CSS.highlights.get(`reader-${id}-active`)!;
      const range = [...highlight][0] as Range; const rect = range.getBoundingClientRect(), viewport = element.getBoundingClientRect();
      return range.toString() === 'Paragraph 39' && rect.top >= viewport.top && rect.bottom <= viewport.bottom;
    }, id)).toBe(true);
    await find.press('Escape'); await expect(reader).toBeFocused();
    const paragraph = reader.locator('p').filter({ hasText: 'Paragraph 39:' });
    await paragraph.evaluate(p => { const range = document.createRange(); range.selectNodeContents(p); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
    await paragraph.click({ button: 'right' }); await chooseNativeMenu(f.app, ['Copy']);
    expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Paragraph 39:');
    const markdown = test.info().outputPath('article.md'), pdf = test.info().outputPath('article.pdf');
    await f.app.evaluate(({ dialog }, { markdown, pdf }) => {
      dialog.showSaveDialog = (async (_owner, options) => ({ canceled: false, filePath: options!.defaultPath!.endsWith('.pdf') ? pdf : markdown })) as typeof dialog.showSaveDialog;
    }, { markdown, pdf });
    await reader.getByRole('button', { name: 'Export to Markdown', exact: true }).click();
    await expect.poll(() => readFile(markdown, 'utf8').catch(() => '')).toContain('Paragraph 39:');
    const text = await readFile(markdown, 'utf8'); expect(text).toContain('# The Long Article Title'); expect(text).toContain(`${f.origin}/article`);
    expect(text).not.toContain('Copyright noise');
    await reader.getByRole('button', { name: 'Export to PDF', exact: true }).click();
    await expect.poll(() => readFile(pdf).then(data => data.subarray(0, 5).toString()).catch(() => '')).toBe('%PDF-');
    await expect(reader).toBeVisible(); await expect(tab).toHaveAttribute('aria-selected', 'true');
    await rm(pdf);
    await f.page.getByRole('button', { name: 'File', exact: true }).click();
    await expect(f.page.getByRole('menuitem', { name: 'Export as PDF…', exact: true })).toBeEnabled();
    await f.page.getByRole('menuitem', { name: 'Export as PDF…', exact: true }).click();
    await expect.poll(() => readFile(pdf).then(data => data.subarray(0, 5).toString()).catch(() => '')).toBe('%PDF-');
    await f.page.keyboard.press('Control+f'); await find.fill('Paragraph 39');
    await expect(f.page.locator('.location-bar .find-count')).toHaveText('1/1');
    await paragraph.dblclick(); await expect(reader).toHaveCount(0);
    await expect.poll(() => f.app.evaluate(() => (globalThis as any).__readerNativeFind)).toBeGreaterThan(0);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('Namu reader extracts hashed div layouts, keeps tables and anchors and restores the live paragraph', async () => {
  const f = await fixture();
  try {
    const markup = `<!doctype html><title>Fixture wiki - 나무위키</title>
        <style>body{margin:0}h1{height:80px}td{padding:12px}.leaf{margin-bottom:28px}</style><h1>Fixture wiki</h1><nav>Site navigation, edit, history</nav>
        <div class="random-root"><table><tr><th>Name</th><th>Value</th></tr><tr><td>Identity</td><td>Preserved table</td></tr></table><div id="toc"><a href="#s-1">1. Overview</a><a href="#s-2">2. More</a></div>
        <div class="hash-A"><div class="empty">&nbsp;</div><div class="hash-B"><h2><a id="s-1" href="#toc">1.</a><span id="Overview">Overview<a href="/edit/Fixture?section=1">[편집]</a></span></h2></div></div>
        ${Array.from({ length: 25 }, (_, i) => `<div class="layout-${i}"><div>&nbsp;</div><div class="leaf">Wiki paragraph ${i}: useful content in a leaf div, containing <a href="/w/Other">a wiki link</a>. Reading preserves paragraphs despite changing obfuscated CSS classes.</div></div>`).join('')}
        <h2><a id="s-2" href="#toc">2.</a>More</h2><details><summary>Folded section</summary><div>Folded wiki content must remain readable.</div></details><p id="fn-1">Footnote preserved.</p></div><aside>Recent changes sidebar noise</aside>`;
    let served = 0;
    await f.app.context().route('https://namu.wiki/**', route => {
      served++; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: markup });
    });
    await f.page.evaluate(() => window.marktex.openLink('https://namu.wiki/w/Fixture'));
    await expect(f.page.getByRole('tab', { name: /Fixture wiki/ })).toBeVisible();
    expect(served).toBeGreaterThan(0);
    await f.page.getByRole('button', { name: 'Enter reader mode' }).click();
    const reader = f.page.getByRole('region', { name: 'Reader mode', exact: true }); await expect(reader).toBeVisible();
    await expect(reader.locator('table')).toContainText('Preserved table');
    await expect(reader.locator('p').filter({ hasText: 'Wiki paragraph 20:' })).toBeVisible();
    await expect(reader.locator('a[href="https://namu.wiki/w/Other"]').first()).toBeAttached();
    await expect(reader.locator('details')).toHaveAttribute('open', '');
    await expect(reader).not.toContainText('[편집]'); await expect(reader).not.toContainText('Recent changes sidebar noise');
    const paragraph = reader.locator('p').filter({ hasText: 'Wiki paragraph 20:' });
    await paragraph.dblclick(); await expect(reader).toHaveCount(0);
    expect(await evaluatePage(f.app, 'https://namu.wiki/w/Fixture', `(() => { const p=[...document.querySelectorAll('.leaf')].find(p=>p.textContent.startsWith('Wiki paragraph 20:')); const r=p.getBoundingClientRect(); return r.bottom>0 && r.top<innerHeight; })()`)).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('application menus preserve live video frames, playback and web view visibility', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
    await evaluatePage(f.app, f.origin, `(() => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d'); let frame = 0;
      setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 640, 480); }, 50);
      const video = document.createElement('video'); video.id = 'live-video'; video.muted = true;
      video.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:fill';
      video.srcObject = canvas.captureStream(20); document.body.append(video);
      window.presentedFrames = 0;
      const count = () => { window.presentedFrames++; video.requestVideoFrameCallback(count); };
      video.requestVideoFrameCallback(count); return video.play();
    })()`);
    await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(3);
    await f.page.getByRole('button', { name: 'View', exact: true }).click();
    await expect.poll(() => f.app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
    const menu = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
    await expect(menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true })).toBeVisible();
    const before = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(before + 5);
    expect(await evaluatePage(f.app, f.origin, 'document.querySelector("video").paused')).toBe(false);
    expect(await f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
      .some(view => view.getVisible() && 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === `${origin}/first`), f.origin)).toBe(true);
    await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
    await menu.getByRole('menuitem', { name: /^Theme/ }).hover();
    await expect(menu.getByRole('menuitemradio').first()).toBeVisible();
    const duringSubmenu = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(duringSubmenu + 5);
    await menu.screenshot({ path: test.info().outputPath('menu-layer.png'), omitBackground: true });
    await menu.keyboard.press('Escape');
    await expect(f.page.getByRole('button', { name: 'View', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await f.page.getByRole('button', { name: 'View', exact: true }).click();
    await expect(menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true }).click();
    await expect(f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true })).toHaveAttribute('aria-expanded', 'true');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('terminal addresses navigate through web and files while sessions and tab zoom stay independent', async () => {
  const f = await fixture();
  try {
    await f.page.locator('.new-terminal-tab-button').click();
    await expect(f.page.getByRole('tab', { name: /Terminal 1/ })).toHaveAttribute('aria-selected', 'true');
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true });
    const location = await address.inputValue(); expect(location).toMatch(/^terminal:\/\/[\da-f-]+$/);
    const input = () => f.page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
    await input().pressSequentially('export SETDOWN_SESSION=retained'); await input().press('Enter');
    await f.page.getByRole('button', { name: 'Zoom terminal in', exact: true }).click();
    await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
    const go = async (url: string) => { await address.fill(url); await address.press('Enter'); };
    await go(`${f.origin}/first`);
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('Research page');
    await go(pathToFileURL(path.join(f.root, 'notes.md')).href);
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('notes.md');
    await expect(address).toHaveValue(/^file:\/\//);
    await f.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(address).toHaveValue(`${f.origin}/first`);
    await f.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(address).toHaveValue(location);
    await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
    await input().pressSequentially(`printf "$SETDOWN_SESSION" > '${f.root}/retained.txt'`); await input().press('Enter');
    await expect.poll(() => readFile(path.join(f.root, 'retained.txt'), 'utf8').catch(() => '')).toBe('retained');
    await f.page.getByRole('button', { name: 'Forward', exact: true }).click();
    await expect(address).toHaveValue(`${f.origin}/first`);
    await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await f.page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await f.page.locator('.terminal-list .select').filter({ hasText: 'Terminal 1' }).click();
    await expect(address).toHaveValue(location);
    await f.page.locator('.new-terminal-tab-button').click();
    await expect(f.page.getByRole('tab', { name: /Terminal 2/ })).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('100%');
    await f.page.getByRole('tab', { name: /Terminal 1/ }).click();
    await expect(f.page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

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
    const point = await evaluatePage<{ x: number; y: number }>(f.app, f.origin, `(() => {
      const frame = document.querySelector('iframe'), region = frame.getBoundingClientRect();
      const button = frame.contentDocument.querySelector('#home').getBoundingClientRect();
      return { x: region.left + frame.clientLeft + button.left + button.width / 2,
        y: region.top + frame.clientTop + button.top + button.height / 2 };
    })()`);
    await contents.evaluate((wc, point) => {
      wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    }, point);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.querySelector("iframe").contentWindow.homeClicks')).toBe(1);
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'homeClicks')).toBe(0);
    await expect.poll(inspect).toEqual({ width: expect.any(Number), rail: 'no-drag', button: 'no-drag', pseudo: 'no-drag', frame: 'no-drag' });
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(650, 820));
    await expect.poll(async () => (await inspect()).width).toBeLessThan(800);
    expect((await inspect()).button).toBe('no-drag');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

for (const surface of ['markdown', 'web'] as const) test(`Explorer menus cover native ${surface} panels and restore their live state`, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(folder => window.marktex.restoreProjectFolder(folder), f.root);
    await f.page.reload();
    await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await f.page.getByRole('button', { name: 'Explorer', exact: true }).click();
    const row = f.page.locator('.explorer-row').filter({ hasText: 'notes.md' });
    await expect(row).toBeVisible();
    if (surface === 'web') {
      await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
      const tab = f.page.getByRole('tab', { name: /Research page/ });
      await expect(tab).toBeVisible();
      await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="Unsaved web input";true');
      const data = await f.page.evaluateHandle(() => new DataTransfer());
      await tab.dispatchEvent('dragstart', { dataTransfer: data });
      const body = f.page.locator('.group-body').first(), bounds = (await body.boundingBox())!;
      const point = { clientX: bounds.x + bounds.width * .98, clientY: bounds.y + bounds.height / 2, dataTransfer: data };
      await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
      await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
    }
    const visible = () => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(view => view.getVisible()).length);
    const count = surface === 'web' ? 2 : 1;
    await expect.poll(visible).toBe(count);
    const identities = () => f.app.evaluate(async ({ BrowserWindow }) => Promise.all(
      BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).map(async view => {
        const contents = (view as Electron.WebContentsView).webContents;
        const identity = await contents.executeJavaScript('window.__explorerMenuIdentity ??= crypto.randomUUID()');
        return { id: contents.id, url: contents.getURL(), identity };
      }))).then(rows => rows.sort((a, b) => a.id - b.id));
    const original = await identities();
    const frozen = surface === 'web' ? '.group-body[data-browser-frozen="true"]' : '.preview-frames[data-frozen="true"]';
    const openMenu = async () => {
      const bounds = (await row.boundingBox())!;
      await row.click({ button: 'right', position: { x: bounds.width - 20, y: bounds.height / 2 } });
      const menu = f.page.locator('.project-context-menu');
      await expect(menu).toBeVisible();
      await expect.poll(visible).toBe(0);
      await expect(f.page.locator(frozen)).toHaveCount(1);
      expect(await f.page.locator(frozen).evaluate(node => getComputedStyle(node).backgroundImage)).not.toBe('none');
      const menuBounds = (await menu.boundingBox())!;
      const panelBounds = (await f.page.locator('.group-body').first().boundingBox())!;
      expect(menuBounds.x + menuBounds.width).toBeGreaterThan(panelBounds.x + 60);
      return menu;
    };
    const restored = async () => {
      await expect.poll(visible).toBe(count);
      await expect.poll(identities).toEqual(original);
      await expect(f.page.locator(frozen)).toHaveCount(0);
      if (surface === 'web') expect(await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value')).toBe('Unsaved web input');
    };
    await openMenu();
    await f.page.screenshot({ path: `test-results/explorer-context-menu-${surface}.png` });
    await f.page.keyboard.press('Escape');
    await expect(f.page.locator('.project-context-menu')).toHaveCount(0);
    await restored();

    const menu = await openMenu();
    const rename = menu.getByRole('menuitem', { name: /Rename/ }), renameBounds = (await rename.boundingBox())!;
    await rename.click({ position: { x: renameBounds.width - 5, y: renameBounds.height / 2 } });
    await expect(f.page.getByRole('textbox', { name: 'Rename entry' })).toBeFocused();
    await restored();
    await expect(f.page.getByRole('textbox', { name: 'Rename entry' })).toBeFocused();
    await f.page.getByRole('textbox', { name: 'Rename entry' }).press('Escape');

    await openMenu();
    await f.page.getByRole('menuitem', { name: /Move to Trash/ }).click();
    await expect(f.page.getByRole('alertdialog')).toBeVisible();
    await expect.poll(visible).toBe(0);
    await f.page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await restored();

    await f.page.getByRole('button', { name: 'More Actions', exact: true }).click();
    await expect(f.page.locator('.side-view-menu')).toBeVisible();
    await expect.poll(visible).toBe(0);
    await f.page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-toggle-folder-tools'));
    await expect(f.page.locator('.side-view-menu')).toBeHidden();
    await restored();
    await f.page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-toggle-folder-tools'));
    await expect(f.page.locator('.side-view-menu')).toBeVisible();
    await expect.poll(visible).toBe(0);
    await f.page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(f.page.locator('.side-view-menu')).toHaveCount(0);
    await restored();
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
    const body = f.page.locator('.group-body').first(), box = (await body.boundingBox())!;
    const tabBox = (await webTab.boundingBox())!;
    await f.page.mouse.move(tabBox.x + 30, tabBox.y + tabBox.height / 2);
    await f.page.mouse.down();
    await f.page.mouse.move(tabBox.x + 45, tabBox.y + tabBox.height / 2, { steps: 3 });
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(0);
    await f.page.evaluate(point => window.dispatchEvent(new DragEvent('dragleave', {
      bubbles: true, cancelable: true, relatedTarget: null, clientX: point.x, clientY: point.y,
    })), { x: tabBox.x + 45, y: tabBox.y + tabBox.height / 2 });
    await expect(f.page.locator('.shell')).toHaveClass(/is-tab-dragging/);
    await f.page.mouse.move(box.x + box.width * .96, box.y + box.height / 2, { steps: 12 });
    await expect(f.page.locator('.group-drop-overlay')).toBeVisible();
    await f.page.mouse.up();
    await expect(f.page.locator('.editor-group')).toHaveCount(2);
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(2);
    expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
    await f.page.screenshot({ path: 'test-results/browser-split.png' });
    await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value="strip move draft";window.stripIdentity={value:73};true');
    const strip = f.page.locator('.tab-strip').first(), stripBox = (await strip.boundingBox())!;
    await webTab.dragTo(strip, { targetPosition: { x: stripBox.width - 16, y: 2 } });
    await expect(f.page.locator('.editor-group')).toHaveCount(1);
    await expect(f.page.locator('.tab-name')).toHaveText(['notes.md', 'Research page']);
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).length)).toBe(1);
    expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), identity)).toBe(`${f.origin}/first`);
    expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,identity:window.stripIdentity.value})'))
      .toEqual({ draft: 'strip move draft', identity: 73 });

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
    // Keep the actual view reference while hidden tabs detach from the window.
    // Continue checking the same native bounds, identity and zoom off-screen.
    const native = await f.app.evaluateHandle(({ BrowserWindow, webContents }, origin) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      const window = BrowserWindow.getAllWindows()[0];
      const view = window.contentView.children.find(view => 'webContents' in view
        && (view as Electron.WebContentsView).webContents.id === page.id) as Electron.WebContentsView;
      return { window, view };
    }, f.origin);
    const state = () => native.evaluate(({ window, view }) => ({ id: view.webContents.id,
      factor: view.webContents.getZoomFactor(), bounds: view.getBounds(), app: window.webContents.getZoomFactor() }));
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
    expect(await f.page.evaluate(async () => { const { tabs, revision, ...scopes } = await window.marktex.getZoom(); return scopes; })).toEqual({ app: preferences.app, text: preferences.text, terminal: preferences.terminal });
    expect(await evaluatePage(f.app, f.origin, '({draft:document.querySelector("#draft").value,value:window.keptObject.value})'))
      .toEqual({ draft: 'keep this', value: 42 });
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await firstTab.click();
    expect((await state()).factor).toBeCloseTo(1.1, 4);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toHaveAttribute('aria-selected', 'true');
    expect(await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents()
      .find(wc => wc.getURL() === `${origin}/second`)!.getZoomFactor(), f.origin)).toBeCloseTo(1, 4);
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
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.restore()).every(page => page.protection === 'ready'))).toBe(true);
    // uBO aliases chrome to browser on startup. Both names must retain the
    // augmented APIs in Chromium versions exposing a separate browser object.
    expect(await f.app.evaluate(async ({ webContents }) => {
      const background = webContents.getAllWebContents().find(wc => wc.getType() === 'backgroundPage')!;
      return background.executeJavaScript(`({same:browser===chrome,
        badge:typeof browser.browserAction.setBadgeBackgroundColor,
        css:typeof browser.tabs.insertCSS, managed:typeof browser.storage.managed})`);
    })).toEqual({ same: true, badge: 'function', css: 'function', managed: 'undefined' });
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
    await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await f.page.getByRole('navigation', { name: 'Browser library' }).getByRole('button', { name: 'Extensions' }).click();
    await f.page.locator('.extension').filter({ has: f.page.locator('.extension-name', { hasText: 'uBlock Origin' }) })
      .getByRole('button', { name: 'Popup', exact: true }).click();
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
      await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.restore()).every(page => page.protection === 'ready'))).toBe(true);
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
    // New renderer process + navigation + title can exceed the default 5s
    // expect budget on a loaded headless machine; widths are asserted after.
    await expect(web).toContainText('Google', { timeout: 15_000 });
    const widths = () => f.page.locator('.document-tab').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().width));
    const settled = await widths();
    expect(settled[0]).toBe(originalWidth);
    await evaluatePage(f.app, 'https://www.google.com/', 'document.title = "A much longer website title that should only change the text inside its tab"; true');
    await expect(web).toContainText('A much longer website title', { timeout: 15_000 });
    expect(await widths()).toEqual(settled);
    await evaluatePage(f.app, 'https://www.google.com/', 'document.title = "Google"; true');
    await expect(web).toContainText('Google', { timeout: 15_000 });
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
    // Each new tab spawns a renderer process and navigates; on a loaded
    // headless machine that exceeds Playwright's default 5s expect budget.
    await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveCount(2, { timeout: 15_000 });
    const selected = f.page.locator('.document-tab[aria-selected="true"]');
    await expect(selected).toContainText('Google', { timeout: 15_000 });
    expect(await selected.getAttribute('data-tab-id')).not.toBe(blankId);
    await expect(address).not.toBeFocused();
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
    await f.page.keyboard.press('Control+l');
    await expect(address).toBeFocused();
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === 0
      && (input as HTMLInputElement).selectionEnd === (input as HTMLInputElement).value.length)).toBe(true);
    await f.page.keyboard.press('Control+t');
    await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveCount(3, { timeout: 15_000 });
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

test('Esc opens reader mode at the same block and double-click returns to the live page at the clicked block', async () => {
  test.setTimeout(90_000);
  const f = await fixture(false);
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/article`);
    await expect(f.page.getByRole('tab', { name: /Long article/ })).toBeVisible();
    await expect.poll(() => evaluatePage<boolean>(f.app, f.origin,
      'document.readyState === "complete" && !!document.querySelector("[data-marker=\\"30\\"]")')).toBe(true);
    const before = await evaluatePage<{ marker: number }>(f.app, f.origin, `(() => {
      document.querySelector('#draft').value = 'keep me';
      const el = document.querySelector('[data-marker="18"]');
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - innerHeight * 0.372 + 5);
      const golden = innerHeight * 0.372;
      const hit = [...document.querySelectorAll('[data-marker]')].find(p => {
        const rect = p.getBoundingClientRect(); return rect.top <= golden && rect.bottom > golden;
      });
      return { marker: hit ? Number(hit.dataset.marker) : -1 };
    })()`);
    expect(before.marker).toBe(18);
    await f.app.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.getVisible()) as import('electron').WebContentsView;
      view.webContents.focus();
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    });
    const reader = f.page.locator('.web-reader');
    await expect(reader).toBeVisible();
    await expect(reader.locator('h1').first()).toContainText('Long article');
    await expect(reader).toContainText('The Long Article Title');
    await expect(reader).not.toContainText('Copyright noise');
    const look = await reader.evaluate(el => {
      const style = getComputedStyle(el);
      return { font: style.fontFamily, size: style.fontSize };
    });
    expect(look.font).toContain('D2Coding');
    expect(look.size).toBe('14px');
    await expect.poll(() => reader.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const golden = rect.top + el.clientHeight * 0.372;
      const hit = [...el.querySelectorAll('[data-setdown-block]')].find(block => {
        const bounds = block.getBoundingClientRect(); return bounds.top <= golden && bounds.bottom > golden;
      });
      return hit ? hit.textContent.trim().slice(0, 40) : '';
    })).toContain('Paragraph 18:');
    const target = reader.locator('[data-setdown-block]', { hasText: 'Paragraph 30:' }).first();
    await target.scrollIntoViewIfNeeded();
    await target.dblclick();
    await expect(reader).toHaveCount(0);
    await expect.poll(() => evaluatePage<{ value: string; ratio: number }>(f.app, f.origin, `(() => {
      const rect = document.querySelector('[data-marker="30"]').getBoundingClientRect();
      return { value: document.querySelector('#draft').value, ratio: rect.top / innerHeight };
    })()`)).toEqual(expect.objectContaining({ value: 'keep me' }));
    const after = await evaluatePage<{ ratio: number }>(f.app, f.origin,
      '({ ratio: document.querySelector("[data-marker=\\"30\\"]").getBoundingClientRect().top / innerHeight })');
    expect(after.ratio).toBeGreaterThan(-0.25);
    expect(after.ratio).toBeLessThan(0.5);
    // The address-bar toggle enters and leaves reader mode as well; leaving
    // via the button returns at the reader's published golden-line place.
    const toggle = f.page.getByRole('button', { name: 'Enter reader mode' });
    await toggle.click();
    await expect(reader).toBeVisible();
    await expect(f.page.getByRole('button', { name: 'Exit reader mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(await reader.locator('.web-reader-column').evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(900);
    await reader.locator('[data-setdown-block]', { hasText: 'Paragraph 12:' }).first().scrollIntoViewIfNeeded();
    await f.page.waitForTimeout(150);
    const readerMarker = await reader.evaluate(el => {
      const golden = el.getBoundingClientRect().top + el.clientHeight * 0.372;
      let best = -1;
      for (const block of el.querySelectorAll('[data-setdown-block]')) {
        if (block.getBoundingClientRect().top > golden) break;
        best = Number(/Paragraph (\d+):/.exec(block.textContent)?.[1] ?? best);
      }
      return best;
    });
    // Paragraph 12 is on screen; the golden line can sit a few blocks either side of it.
    expect(Math.abs(readerMarker - 12)).toBeLessThanOrEqual(3);
    await f.page.getByRole('button', { name: 'Exit reader mode' }).click();
    await expect(reader).toHaveCount(0);
    // The golden line can fall in a paragraph gap, so land on the last
    // paragraph that started above it.
    const landedAt = () => evaluatePage<number>(f.app, f.origin, `(() => {
      const golden = innerHeight * 0.372;
      let best = -1;
      for (const p of document.querySelectorAll('[data-marker]')) {
        if (p.getBoundingClientRect().top > golden) break;
        best = Number(p.dataset.marker);
      }
      return best;
    })()`);
    // Page and reader typeset paragraphs at different heights, so the
    // golden-line paragraph can shift by a couple of blocks; it must stay
    // the passage the reader was showing, not the old position near 30.
    await expect.poll(async () => Math.abs((await landedAt()) - readerMarker)).toBeLessThanOrEqual(2);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('reader toolbar and wheel use tab text zoom independently of other Markdown tabs and live website zoom', async () => {
  const f = await fixture();
  try {
    const textReset = f.page.getByRole('button', { name: 'Reset text zoom', exact: true });
    await expect(textReset).toHaveText('100%');
    await f.page.getByRole('button', { name: 'Zoom text in', exact: true }).click();
    await expect(textReset).toHaveText('110%');
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/article`);
    const websiteReset = f.page.getByRole('button', { name: 'Reset website zoom', exact: true });
    await expect(websiteReset).toHaveText('100%');
    await expect(f.page.getByRole('button', { name: 'uBlock Origin', exact: true })).toHaveCount(0);
    const bookmark = f.page.getByRole('button', { name: 'Bookmark page', exact: true });
    const enter = f.page.getByRole('button', { name: 'Enter reader mode', exact: true });
    expect((await bookmark.boundingBox())!.x).toBeLessThan((await enter.boundingBox())!.x);
    expect((await enter.boundingBox())!.x).toBeLessThan((await websiteReset.boundingBox())!.x);
    await f.page.getByRole('button', { name: 'Zoom website in', exact: true }).click();
    await expect(websiteReset).toHaveText('110%');
    await f.page.getByRole('button', { name: 'Zoom website in', exact: true }).click();
    await expect(websiteReset).toHaveText('120%');
    await evaluatePage(f.app, f.origin, "document.querySelector('#draft').value = 'keep zoom state'");
    await enter.click();
    const reader = f.page.getByRole('region', { name: 'Reader mode', exact: true });
    await expect(reader).toBeVisible();
    await expect(websiteReset).toHaveCount(0);
    await expect(textReset).toHaveText('100%');
    await f.page.getByRole('button', { name: 'Zoom text in', exact: true }).click();
    await expect(textReset).toHaveText('110%');
    await expect.poll(() => reader.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(15.4, 2);
    await reader.hover();
    await f.page.keyboard.down('Control'); await f.page.mouse.wheel(0, -80); await f.page.keyboard.up('Control');
    await expect(textReset).toHaveText('120%');
    await expect.poll(() => f.page.evaluate(() => window.marktex.getZoom())).toMatchObject({ app: 100, text: 100, terminal: 100 });
    await f.page.screenshot({ path: test.info().outputPath('reader-toolbar.png') });
    await f.page.getByRole('button', { name: 'Exit reader mode', exact: true }).click();
    await expect(websiteReset).toHaveText('120%');
    expect(await evaluatePage(f.app, f.origin, "document.querySelector('#draft').value")).toBe('keep zoom state');
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await expect(textReset).toHaveText('110%');
    await textReset.click(); await expect(textReset).toHaveText('100%');
    await f.page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
    await f.page.getByRole('button', { name: 'Zoom text in', exact: true }).click();
    await expect.poll(() => f.page.locator('.monaco-editor .view-line').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(15.4, 1);
    await f.page.screenshot({ path: test.info().outputPath('markdown-toolbar.png') });
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
