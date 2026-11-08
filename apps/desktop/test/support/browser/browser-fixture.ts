import { electron } from '../electron/electron-app';
import { expect } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication, type TestApplication } from '../electron/electron-app';
import { pdfFixture } from '../media/pdf-fixture';

export async function fixture(document = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-browser-'));
  const requests: string[] = [];
  const slowDownloads = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url === '/theme.css' || req.url === '/route.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${req.url === '/route.css' ? '#route-external' : '#external'} { background-color: white; color: black }`); return;
    }
    if (req.url === '/theme' || req.url === '/theme-csp') {
      res.setHeader('content-type', 'text/html');
      if (req.url === '/theme-csp') res.setHeader('content-security-policy', "script-src 'none'; style-src 'self' https://theme-assets.example 'unsafe-inline'");
      res.end(`<!doctype html><title>Theme fixture</title>
        <link rel="stylesheet" href="https://theme-assets.example/theme.css">
        <style>
          :root { color-scheme: light dark; --article: light-dark(#fff,#171717); --text: light-dark(#000,#eee) }
          body { margin:0; background:light-dark(#f5f5f5,#222); color:var(--text); min-height:2500px }
          #article,#sidebar { background:var(--article); padding:24px; margin:16px }
          input::placeholder { color:#a9a9a9 }
          a { color:#0275d8 }
          #colored { background:#f3dfad; color:#373a3c }
        </style><main id="article"><h1>Document</h1><input id="draft" placeholder="Search">
        <a href="/second">Readable link</a><table><tr><td id="colored">Authored color</td></tr></table></main>
        <aside id="sidebar">Sidebar</aside><div id="external">External CSS without CORS</div><iframe src="/frame"></iframe>`);
      return;
    }
    if (req.url === '/private') {
      if (req.headers.authorization !== `Basic ${Buffer.from('reader:secret').toString('base64')}`) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="Fixture library"' }); res.end('Authentication required');
      } else res.end('<!doctype html><title>Private library</title><p>Signed in.</p>');
      return;
    }
    if (req.url === '/network-failure') { req.socket.destroy(); return; }
    if (req.url === '/pdf-redirect') {
      res.writeHead(302, { location: '/paper', 'set-cookie': 'paper-access=yes; Path=/' }); res.end(); return;
    }
    if (req.url === '/paper' || req.url === '/broken-pdf') {
      res.setHeader('content-type', 'application/pdf');
      res.end(req.url === '/broken-pdf' || !req.headers.cookie?.includes('paper-access=yes') ? '<html>Sign in</html>' : pdfFixture()); return;
    }
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
    if (req.url?.startsWith('/fullscreen-embed')) {
      const port = (server.address() as { port: number }).port;
      res.end(`<!doctype html><title>Embedded player</title><style>body{margin:0}iframe{border:0;width:100%;height:400px}</style>
        <iframe src="http://localhost:${port}/fullscreen" ${req.url.endsWith('denied') ? '' : 'allowfullscreen'}></iframe>`);
      return;
    }
    if (req.url === '/fullscreen') {
      res.end(`<!doctype html><title>Fullscreen player</title><style>
        body{margin:0} #player{position:relative;width:100%;height:300px;background:#168648}
        #player:fullscreen{width:100%;height:100%} video{width:100%;height:100%;object-fit:fill}
        button{position:absolute;top:20px;left:20px;width:140px;height:40px}
      </style><input id="draft"><div id="player"><video muted></video><button id="toggle">Fullscreen</button></div>
      <script>
        window.fullscreenError = ''; window.fullscreenClicks = 0; window.presentedFrames = 0;
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext('2d');
        setInterval(() => { ctx.fillStyle = '#168648'; ctx.fillRect(0, 0, 640, 480); }, 50);
        const video = document.querySelector('video'); video.srcObject = canvas.captureStream(20);
        const count = () => { window.presentedFrames++; video.requestVideoFrameCallback(count); };
        video.requestVideoFrameCallback(count); video.play();
        document.querySelector('#toggle').onclick = () => {
          window.fullscreenClicks++;
          (document.fullscreenElement ? document.exitFullscreen() : document.querySelector('#player').requestFullscreen())
            .catch(error => { window.fullscreenError = error.name; });
        };
      </script>`);
      return;
    }
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
    if (req.url?.startsWith('/memory-')) {
      res.end(`<!doctype html><title>${req.url.slice(1)}</title><style>body{min-height:6000px}</style>
        <input id="draft"><a href="/memory-next">Next</a><button id="guard">Protect</button>
        <h1>Memory fixture</h1><script>
          window.retained = new Uint8Array(16 * 1024 * 1024).fill(7);
          document.querySelector('#guard').onclick = () => window.onbeforeunload = event => { event.preventDefault(); event.returnValue = ''; };
        </script>`); return;
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
  const headless = process.env.SETDOWN_E2E_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu']
    : process.env.SETDOWN_TEST_DISPLAY === 'wayland' ? ['--ozone-platform=wayland']
    : process.env.SETDOWN_TEST_DISPLAY === 'xwayland' ? ['--ozone-platform=x11'] : [];
  const launchOptions = { args: [...headless, '.', ...(document ? [file] : [])], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config'),
    ...(process.env.SETDOWN_WAYLAND_TRACE ? { WAYLAND_DEBUG: 'client' } : {}) } };
  let app = await electron.launch(launchOptions);
  let page = await app.firstWindow();
  await focusApplication(app);
  if (document) await expect(page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  else await expect(page.getByRole('button', { name: 'Open Web Page', exact: true })).toBeVisible();
  // Keep Google navigation assertions off the real network. Use the session
  // protocol: global CDP routing can strand a paused script request when Back
  // replaces a WebContents and the user navigates again during history restore.
  await app.evaluate(({ session, net }) => {
    session.fromPartition('persist:setdown-browser').protocol.handle('https', request =>
      new URL(request.url).hostname === 'www.google.com'
        ? new Response('<!doctype html><title>Google</title><input aria-label="Search">', { headers: { 'content-type': 'text/html' } })
        : net.fetch(request, { bypassCustomProtocolHandlers: true }));
  });
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

// Retain the constructed menu generation while exercising the themed overlay.
export async function captureNativeMenus(app: TestApplication) {
  await app.evaluate(({ Menu }) => {
    const build = Menu.buildFromTemplate;
    Menu.buildFromTemplate = function(template) {
      const menu = build.call(this, template);
      (globalThis as any).__browserTestMenuGeneration = ((globalThis as any).__browserTestMenuGeneration ?? 0) + 1;
      (globalThis as any).__browserTestMenu = menu;
      return menu;
    };
  });
}
export async function chooseNativeMenu(app: TestApplication, labels: string[]) {
  // Product menus now paint in a real themed native overlay. Exercise their
  // actual DOM controls rather than invoking captured callbacks directly.
  await expect.poll(() => app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
  const overlay = app.windows().find(page => page.url().includes('menu-overlay=1'))!;
  for (const label of labels) {
    const item = overlay.getByRole('menuitem', { name: label, exact: true })
      .or(overlay.getByRole('menuitemcheckbox', { name: label, exact: true }))
      .or(overlay.getByRole('menuitemradio', { name: label, exact: true }));
    await expect(item).toBeEnabled(); await item.click();
  }
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


export async function findOverlay(app: TestApplication) {
  await expect.poll(() => app.windows().some(page => page.url().includes('browser-find-overlay=1'))).toBe(true);
  return app.windows().find(page => page.url().includes('browser-find-overlay=1'))!;
}
export async function findOverlayVisible(app: TestApplication) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(owner => owner.contentView.children.some(view =>
    'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().includes('browser-find-overlay=1') && view.getVisible())));
}
