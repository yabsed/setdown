import { electron } from '../electron/electron-app';
import { expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication, type TestApplication } from '../electron/electron-app';
import { pdfFixture } from '../media/pdf-fixture';

type FixtureOptions = {
  /** Extra launch arguments, such as an address to open; they follow the app path. */
  args?: (origin: string) => string[];
  /** Extra environment for the application, such as private XDG directories under the fixture root. */
  env?: (root: string) => Record<string, string>;
  /** Files the application must find at launch. */
  prepare?: (root: string) => Promise<void>;
  /**
   * HTTPS hosts answered by this fixture instead of the network: the application resolves them to a local TLS
   * server with a throwaway certificate. A session protocol handler cannot stand in for them, because Electron
   * skips its interception while an extension (the built-in uBlock) observes requests.
   */
  secureHosts?: string[];
};
export async function fixture(document = true, markdown = '# Notes\n\nKeep the reader intact.\n', options: FixtureOptions = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-browser-'));
  const requests: string[] = [];
  const headers = new Map<string, IncomingHttpHeaders>();
  const slowDownloads = new Set<ServerResponse>();
  const respond = (req: IncomingMessage, res: ServerResponse) => {
    requests.push(req.url!); headers.set(req.url!, req.headers);
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (req.url === '/signin') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>Sign in</title><input id="draft"><script src="/signin.js"></script>'); return;
    }
    if (req.url === '/signin.js') { res.setHeader('content-type', 'text/javascript'); res.end('window.signInScript = true'); return; }
    if (req.url === '/site-icon.svg') {
      res.setHeader('content-type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#c0392b"/></svg>'); return;
    }
    if (req.url === '/icon-page') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>Icon page</title><link rel="icon" href="/site-icon.svg"><input id="draft"><a href="/first">Plain page</a>'); return;
    }
    if (req.url === '/embed') {
      // 127.0.0.1 and localhost are different sites: the frame is a third party that the page delegates capabilities to.
      const port = (server.address() as { port: number }).port;
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>Embedding page</title><input id="draft">
        <iframe id="widget" src="http://localhost:${port}/embedded" allow="camera; microphone; geolocation; clipboard-read; display-capture"></iframe>`); return;
    }
    if (req.url === '/embedded') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Embedded widget</title><p>Widget</p>'); return; }
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
          #sidebar { --lightningcss-light: initial; --lightningcss-dark: ; --radius: 4px;
            background-color: var(--lightningcss-light, #fff) var(--lightningcss-dark, #171717);
            background-image: linear-gradient(transparent, var(--article) calc(100% - var(--radius))) }
          input::placeholder { color:#a9a9a9 }
          a { color:#0275d8 }
          #colored { background:#f3dfad; color:#373a3c }
        </style><main id="article"><h1>Document</h1><input id="draft" placeholder="Search">
        <a href="/second">Readable link</a><table><tr><td id="colored">Authored color</td></tr></table></main>
        <aside id="sidebar">Sidebar</aside><div id="external">External CSS without CORS</div><iframe src="/frame"></iframe>`);
      return;
    }
    if (req.url === '/theme-tokens') {
      // Raw HSL component tokens: the dark set follows the light one, both as a
      // selector and as a media query, and one subtree opts into it.
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><html data-mode="auto"><title>Token fixture</title><style>
        :root, [data-mode=light] { --surface: 0 0% 100%; --ink: 0 0% 0%; --gray-0: 0, 0%, 100%; --alias: var(--gray-0); --panel: var(--alias); --bubble: hsl(var(--surface)) }
        [data-mode=dark] { --surface: 60 3% 8%; --ink: 48 33% 97%; --gray-0: 60, 3%, 8% }
        @media (prefers-color-scheme: dark) { :root { --surface: 60 3% 8%; --ink: 48 33% 97%; --gray-0: 60, 3%, 8% } }
        body { margin: 0; background-color: hsl(var(--surface)); color: hsl(var(--ink)) }
        #page { background-color: hsl(var(--surface) / 1); padding: 24px }
        #panel { background-color: hsla(var(--panel), 1) }
        #bubble { background-color: var(--bubble) }
        #muted { color: hsl(var(--ink) / .8) }
        #scope { background-color: hsl(var(--surface)); color: hsl(var(--ink)) }
      </style><main id="page"><input id="draft"><p id="text">Chat text</p><div id="panel">Aliased token</div>
        <div id="bubble">Token color</div><p id="muted">Muted text</p>
        <section id="scope" data-mode="dark">Dark scope</section></main>`);
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
    // A query string only tells apart tabs that show the same form.
    const route = req.url?.split('?')[0];
    if (route === '/login' || route === '/signup') {
      // A real form post: the page navigates away, like most sign-ins.
      res.end(`<!doctype html><title>Sign in</title><form action="/welcome" method="post">
        <input id="search" name="q" placeholder="Search">
        <input id="user" name="username" autocomplete="username">
        <input id="pass" name="password" type="password" ${route === '/signup' ? 'autocomplete="new-password"' : ''}>
        <button id="show" type="button">Show</button><button id="go" type="submit">Sign in</button></form>
        <script>window.filled = []; for (const id of ['user', 'pass']) document.getElementById(id).addEventListener('input', () => window.filled.push(id));</script>`);
      return;
    }
    if (route === '/welcome') { req.resume(); res.end('<!doctype html><title>Welcome</title><p id="state">Signed in.</p><input id="draft">'); return; }
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
    const sentence = 'reading mode should keep the place where the reader stopped, in every tab, every single time.';
    if (req.url === '/tall.svg') {
      res.setHeader('content-type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1600"><rect width="600" height="1600" fill="#b33"/></svg>'); return;
    }
    // Ends in a figure taller than the reader, like a magazine cover under an article.
    if (req.url === '/article-figure') {
      res.end(`<!doctype html><title>Figure article</title><article><h1>The Figure Article Title</h1>
        ${Array.from({ length: 12 }, (_, i) => `<p>Figure paragraph ${i}: ${sentence}</p>`).join('\n')}
        <figure><img src="/tall.svg" width="600" height="1600" alt="Cover"></figure>
        <h2>From this edition</h2><p>Closing line, ${sentence}</p></article>`);
      return;
    }
    // Paragraphs separated by line breaks: Readability rebuilds them as new elements,
    // so only the opening paragraph carries a block ordinal.
    if (req.url === '/article-breaks') {
      res.end(`<!doctype html><title>Newsletter article</title><article><h1>The Newsletter Title</h1>
        <p>Opening paragraph: ${sentence} ${sentence}</p>
        <div>${Array.from({ length: 40 }, (_, i) => `Break paragraph ${i}: ${sentence} ${sentence}`).join('<br><br>')}</div></article>`);
      return;
    }
    res.end(`<!doctype html><title>${req.url === '/second' ? 'Second page' : 'Research page'}</title>
      <style>.ad { display:block !important }</style><input id="draft"><a href="/second">Next page</a>
      <div class="ad">Advertisement</div><iframe src="/frame"></iframe>
      <script>window.probeFlag=false</script><script src="/blocked.js"></script><script src="/allowed.js"></script>`);
  };
  const server = createServer(respond);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  let secure: ReturnType<typeof createSecureServer> | undefined;
  const secureSwitches: string[] = [];
  if (options.secureHosts?.length) {
    const key = path.join(root, 'fixture-key.pem'), certificate = path.join(root, 'fixture-certificate.pem');
    await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2',
      '-keyout', key, '-out', certificate, '-subj', '/CN=Setdown test fixture', '-addext', `subjectAltName=${options.secureHosts.map(host => `DNS:${host}`).join(',')}`]);
    secure = createSecureServer({ key: await readFile(key), cert: await readFile(certificate) }, respond);
    await new Promise<void>(resolve => secure!.listen(0, '127.0.0.1', resolve));
    const port = (secure.address() as { port: number }).port;
    // Only this application instance trusts the throwaway certificate, and only these hosts are redirected.
    secureSwitches.push(`--host-resolver-rules=${options.secureHosts.map(host => `MAP ${host} 127.0.0.1:${port}`).join(', ')}`, '--ignore-certificate-errors');
  }
  const file = path.join(root, 'notes.md'); await writeFile(file, markdown);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const headless = process.env.SETDOWN_E2E_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu']
    : process.env.SETDOWN_TEST_DISPLAY === 'wayland' ? ['--ozone-platform=wayland']
    : process.env.SETDOWN_TEST_DISPLAY === 'xwayland' ? ['--ozone-platform=x11'] : [];
  await options.prepare?.(root);
  const launchOptions = { args: [...headless, ...secureSwitches, '.', ...(document ? [file] : []), ...(options.args?.(origin) ?? [])], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config'),
    ...(process.env.SETDOWN_WAYLAND_TRACE ? { WAYLAND_DEBUG: 'client' } : {}), ...options.env?.(root) } };
  let app = await electron.launch(launchOptions);
  let page = await app.firstWindow();
  await focusApplication(app);
  if (document) await expect(page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  else if (!options.args) await expect(page.getByRole('button', { name: 'Open Web Page', exact: true })).toBeVisible();
  // Keep Google navigation assertions off the real network. Use the session
  // protocol: global CDP routing can strand a paused script request when Back
  // replaces a WebContents and the user navigates again during history restore.
  await app.evaluate(({ session, net }) => {
    session.fromPartition('persist:setdown-browser').protocol.handle('https', request => {
      const host = new URL(request.url).hostname;
      return host === 'www.google.com'
        ? new Response('<!doctype html><title>Google</title><input aria-label="Search">', { headers: { 'content-type': 'text/html' } })
        : net.fetch(request, { bypassCustomProtocolHandlers: true });
    });
  });
  // A fresh profile compiles uBlock's filter lists for several seconds and
  // first navigation waits for it; that cold start is part of fixture setup
  // (it must still complete), not of each test's 5s UI assertions.
  await page.evaluate(() => window.marktex.browser.extensions());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack ?? String(error)));
  return { get app() { return app; }, get page() { return page; }, root, origin, requests, headers, errors,
    /** Start the application again, as the desktop does for a link; that process hands its arguments to this one and exits. */
    launchAgain(...args: string[]) {
      return new Promise<void>((resolve, reject) => execFile(createRequire(import.meta.url)('electron') as string,
        [...headless, ...secureSwitches, '.', ...args], { env: { ...launchOptions.env, SETDOWN_NATIVE_DIALOGS: '1' } as NodeJS.ProcessEnv, timeout: 30_000 },
        error => error ? reject(error) : resolve()));
    },
    finishDownloads() { for (const res of slowDownloads) res.end(Buffer.alloc(131072, 'b')); },
    async restart() {
      await app.close();
      app = await electron.launch(launchOptions);
      page = await app.firstWindow();
      await focusApplication(app);
      await page.evaluate(() => window.marktex.browser.extensions());
      page.on('pageerror', error => errors.push(error.stack ?? String(error)));
    }, async dispose() {
    await disposeApplication(app); await new Promise<void>(resolve => server.close(() => resolve()));
    if (secure) { secure.closeAllConnections(); await new Promise<void>(resolve => secure!.close(() => resolve())); }
    await rm(root, { recursive: true, force: true });
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

/** The page of the layer that asks "Save Changes" above a live web page. The shell's own
 * dialog is used where no web page is showing. */
export async function closePromptLayer(app: TestApplication) {
  await expect.poll(() => app.windows().some(page => page.url().includes('close-prompt-overlay=1'))).toBe(true);
  return app.windows().find(page => page.url().includes('close-prompt-overlay=1'))!;
}
