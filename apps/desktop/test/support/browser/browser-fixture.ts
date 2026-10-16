import { electron } from '../electron/electron-app';
import { expect } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication, type TestApplication } from '../electron/electron-app';
import { pdfFixture } from '../media/pdf-fixture';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);

export async function fixture(document = true) {
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
  page.on('pageerror', error => errors.push(error.stack ?? String(error)));
  return { get app() { return app; }, get page() { return page; }, root, origin, requests, errors,
    finishDownloads() { for (const res of slowDownloads) res.end(Buffer.alloc(131072, 'b')); },
    async restart() {
      await app.close();
      app = await electron.launch(launchOptions);
      page = await app.firstWindow();
      await focusApplication(app);
      await page.evaluate(() => window.marktex.browser.extensions());
      page.on('pageerror', error => errors.push(error.stack ?? String(error)));
    }, async dispose() {
    await disposeApplication(app); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true });
  } };
}
export async function evaluatePage<T>(app: TestApplication, origin: string, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, { origin, script }) => {
    const page = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(origin) && wc.getType() !== 'backgroundPage');
    if (!page) throw Error('Web page not found');
    return page.executeJavaScript(script);
  }, { origin, script });
}

// Native Electron menus are still constructed and displayed on Xvfb. Retain a
// handle so the tests can choose an OS menu item using real isolated input.
export async function captureNativeMenus(app: TestApplication) {
  await app.evaluate(({ Menu }) => {
    const build = Menu.buildFromTemplate;
    const templates = new WeakMap<Electron.Menu, Electron.MenuItemConstructorOptions[]>();
    Menu.buildFromTemplate = function(template) {
      const menu = build.call(this, template); templates.set(menu, template as Electron.MenuItemConstructorOptions[]); return menu;
    };
    const original = Menu.prototype.popup;
    Menu.prototype.popup = function(options) {
      (globalThis as any).__browserTestMenuGeneration = ((globalThis as any).__browserTestMenuGeneration ?? 0) + 1;
      (globalThis as any).__browserTestMenu = this;
      (globalThis as any).__browserTestMenuTemplate = templates.get(this);
      return original.call(this, options);
    };
  });
}
export async function chooseNativeMenu(app: TestApplication, labels: string[]) {
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
export async function pageContextMenu(app: TestApplication, origin: string, selector: string) {
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

