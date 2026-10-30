# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/layout.spec.ts >> application menus preserve live video frames, playback and web view visibility
- Location: test/e2e/browser/layout.spec.ts:135:1

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Workspace folder', exact: true })

```

# Test source

```ts
  73  |       input.addEventListener('compositionstart', () => { (window as any).__addressIme.starts++; });
  74  |       input.addEventListener('compositionend', () => { (window as any).__addressIme.ends++; });
  75  |       input.addEventListener('blur', () => { (window as any).__addressIme.blur++; });
  76  |       window.addEventListener('blur', () => { (window as any).__addressIme.blur++; });
  77  |     });
  78  |     const cdp = await f.app.context().newCDPSession(f.page);
  79  |     await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  80  |     await expect(address).toBeFocused();
  81  |     const composingFrame = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
  82  |     await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(composingFrame + 5);
  83  |     expect(await f.page.evaluate(() => (window as any).__addressIme)).toEqual({ starts: 1, ends: 0, blur: 0 });
  84  |     await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  85  |     await cdp.detach();
  86  |     await address.fill(f.origin);
  87  |     const row = popup.getByRole('option', { name: /Chosen destination/ });
  88  |     await expect(row).toBeVisible();
  89  |     const rowBounds = (await row.boundingBox())!;
  90  |     const click = await f.app.evaluate(({ BrowserWindow }, point) => {
  91  |       const owner = BrowserWindow.getAllWindows()[0];
  92  |       const view = owner.contentView.children.find(view => 'webContents' in view
  93  |         && (view as Electron.WebContentsView).webContents.getURL().includes('location-overlay=1')) as Electron.WebContentsView;
  94  |       if (!view?.getVisible()) throw Error('Address dropdown is not natively visible');
  95  |       const root = owner.getContentBounds(), bounds = view.getBounds(), zoom = view.webContents.getZoomFactor();
  96  |       return { x: Math.round(root.x + bounds.x + (point.x + point.width / 2) * zoom),
  97  |         y: Math.round(root.y + bounds.y + (point.y + point.height / 2) * zoom) };
  98  |     }, rowBounds);
  99  |     if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native pointer input requires isolated Xvfb.');
  100 |     await execFile('python3', ['-c', `
  101 | import ctypes, ctypes.util, sys
  102 | x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
  103 | x.XOpenDisplay.restype=ctypes.c_void_p
  104 | x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
  105 | t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
  106 | t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
  107 | d=x.XOpenDisplay(None)
  108 | if not d: raise RuntimeError('No isolated X display')
  109 | t.XTestFakeMotionEvent(d,-1,int(sys.argv[1]),int(sys.argv[2]),0)
  110 | t.XTestFakeButtonEvent(d,1,1,0); t.XTestFakeButtonEvent(d,1,0,0); x.XFlush(d); x.XCloseDisplay(d)
  111 | `, String(click.x), String(click.y)]);
  112 |     await expect(address).toHaveValue(`${f.origin}/second`);
  113 |     await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
  114 |     const afterChoice = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
  115 |     await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(afterChoice + 5);
  116 |     await address.click(); await address.fill(`${f.origin}/second`);
  117 |     const destination = popup.getByRole('option', { name: /Second page/ });
  118 |     await expect(destination).toBeVisible();
  119 |     await address.press('ArrowDown');
  120 |     await expect(destination).toHaveAttribute('aria-selected', 'true');
  121 |     await address.press('Escape');
  122 |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
  123 |       .some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().includes('location-overlay=1')))).toBe(false);
  124 |     const leftAddress = f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).first();
  125 |     await leftAddress.fill(f.origin);
  126 |     await expect(popup.getByRole('option').first()).toBeVisible();
  127 |     const samePaneFrame = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
  128 |     await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(samePaneFrame + 5);
  129 |     await expect(leftAddress).toBeFocused();
  130 |     await leftAddress.press('Escape');
  131 |     expect(f.errors).toEqual([]);
  132 |   } finally { await f.dispose(); }
  133 | });
  134 | 
  135 | test('application menus preserve live video frames, playback and web view visibility', async () => {
  136 |   const f = await fixture();
  137 |   try {
  138 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  139 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
  140 |     await evaluatePage(f.app, f.origin, `(() => {
  141 |       const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
  142 |       const ctx = canvas.getContext('2d'); let frame = 0;
  143 |       setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 640, 480); }, 50);
  144 |       const video = document.createElement('video'); video.id = 'live-video'; video.muted = true;
  145 |       video.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:fill';
  146 |       video.srcObject = canvas.captureStream(20); document.body.append(video);
  147 |       window.presentedFrames = 0;
  148 |       const count = () => { window.presentedFrames++; video.requestVideoFrameCallback(count); };
  149 |       video.requestVideoFrameCallback(count); return video.play();
  150 |     })()`);
  151 |     await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(3);
  152 |     await f.page.getByRole('button', { name: 'View', exact: true }).click();
  153 |     await expect.poll(() => f.app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
  154 |     const menu = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
  155 |     await expect(menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true })).toBeVisible();
  156 |     const before = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
  157 |     await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(before + 5);
  158 |     expect(await evaluatePage(f.app, f.origin, 'document.querySelector("video").paused')).toBe(false);
  159 |     expect(await f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
  160 |       .some(view => view.getVisible() && 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === `${origin}/first`), f.origin)).toBe(true);
  161 |     await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
  162 |     await menu.getByRole('menuitem', { name: /^Theme/ }).hover();
  163 |     await expect(menu.getByRole('menuitemradio').first()).toBeVisible();
  164 |     const duringSubmenu = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
  165 |     await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(duringSubmenu + 5);
  166 |     await menu.screenshot({ path: test.info().outputPath('menu-layer.png'), omitBackground: true });
  167 |     await menu.keyboard.press('Escape');
  168 |     await expect(f.page.getByRole('button', { name: 'View', exact: true })).toHaveAttribute('aria-expanded', 'false');
  169 |     await f.page.getByRole('button', { name: 'View', exact: true }).click();
  170 |     await expect(menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true })).toBeVisible();
  171 |     await menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true }).click();
  172 |     await expect(f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true })).toHaveAttribute('aria-expanded', 'true');
> 173 |     await f.page.getByRole('button', { name: 'Workspace folder', exact: true }).click();
      |                                                                                 ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  174 |     const folders = f.page.getByRole('menu', { name: 'Choose workspace folder' });
  175 |     await expect(folders).toBeVisible();
  176 |     const folderFrames = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
  177 |     await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(folderFrames + 5);
  178 |     await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
  179 |     await folders.press('Escape');
  180 |     await expect(folders).toBeHidden();
  181 | 
  182 |     // Real native toolbar input is essential: the icon strip loses native focus
  183 |     // before this click reaches the shell. CDP click alone misses that race.
  184 |     const owner = await f.app.browserWindow(f.page);
  185 |     const extensionButton = f.page.getByRole('button', { name: 'Extensions menu', exact: true });
  186 |     await f.app.evaluate(({ app }) => {
  187 |       (globalThis as any).__createdIconStrips = 0;
  188 |       app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
  189 |         if (contents.getURL().endsWith('/extension-panel.html')) (globalThis as any).__createdIconStrips++;
  190 |       }));
  191 |     });
  192 |     for (let cycle = 1; cycle <= 3; cycle++) {
  193 |       const button = (await extensionButton.boundingBox())!;
  194 |       const point = await owner.evaluate((window, button) => { const bounds = window.getContentBounds(), z = window.webContents.getZoomFactor();
  195 |         return { x: bounds.x + (button.x + button.width / 2) * z, y: bounds.y + (button.y + button.height / 2) * z }; }, button);
  196 |       await nativeInput({ click: point });
  197 |       const stripExists = () => f.app.evaluate(({ webContents }) => webContents.getAllWebContents().some(wc => wc.getURL().endsWith('/extension-panel.html')));
  198 |       await expect.poll(stripExists).toBe(true);
  199 |       const start = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
  200 |       await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(start + 5);
  201 |       await nativeInput({ click: point });
  202 |       await expect.poll(stripExists).toBe(false);
  203 |       expect(await f.app.evaluate(() => (globalThis as any).__createdIconStrips)).toBe(cycle);
  204 |     }
  205 |     for (const cancel of [true, false]) {
  206 |       const tab = (await f.page.getByRole('tab', { name: /Research page/ }).boundingBox())!;
  207 |       const body = (await f.page.locator('.group-body').boundingBox())!;
  208 |       const points = await owner.evaluate((window, { tab, body }) => {
  209 |         const bounds = window.getContentBounds(), z = window.webContents.getZoomFactor();
  210 |         return [{ x: bounds.x + (tab.x + 35) * z, y: bounds.y + (tab.y + 15) * z },
  211 |           { x: bounds.x + (body.x + body.width * .98) * z, y: bounds.y + (body.y + body.height / 2) * z }];
  212 |       }, { tab, body });
  213 |       await nativeInput({ pointer: [points[0]], button: 'down' });
  214 |       await nativeInput({ pointer: [{ x: points[0].x + 20, y: points[0].y + 15 }, points[1]] });
  215 |       await expect(f.page.locator('.group-drop-overlay')).toBeVisible();
  216 |       const draggingFrames = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
  217 |       await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(draggingFrames + 8);
  218 |       await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
  219 |       expect(await owner.evaluate((window, origin) => window.contentView.children.some(view => view.getVisible()
  220 |         && 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === `${origin}/first`), f.origin)).toBe(true);
  221 |       if (cancel) await nativeInput({ keys: ['Escape'] });
  222 |       await nativeInput({ button: 'up' });
  223 |       await expect(f.page.locator('.editor-group')).toHaveCount(cancel ? 1 : 2);
  224 |       await expect(f.page.locator('.group-drop-overlay')).toBeHidden();
  225 |     }
  226 |     await owner.dispose();
  227 |     expect(await evaluatePage(f.app, f.origin, 'document.querySelector("video").paused')).toBe(false);
  228 |     expect(f.errors).toEqual([]);
  229 |   } finally { await nativeInput({ keys: ['Escape'], button: 'up' }); await f.dispose(); }
  230 | });
  231 | 
  232 | test('language sidebar leaves the native web page live and Escape belongs to its search', async () => {
  233 |   const f = await fixture();
  234 |   try {
  235 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  236 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
  237 |     const identity = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(c => c.getURL() === `${origin}/first`)!.id, f.origin);
  238 |     await evaluatePage(f.app, f.origin, `(() => {
  239 |       document.querySelector('#draft').value = 'Keep this draft'; window.sidebarFrames = 0; window.sidebarVisibilityChanges = 0;
  240 |       document.addEventListener('visibilitychange', () => window.sidebarVisibilityChanges++);
  241 |       const frame = () => { window.sidebarFrames++; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  242 |     })()`);
  243 |     await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
  244 |     await f.page.getByRole('button', { name: 'Language Support', exact: true }).click();
  245 |     const panel = f.page.getByRole('region', { name: 'Language Support', exact: true });
  246 |     await expect(panel.getByRole('searchbox')).toBeFocused();
  247 |     await panel.getByRole('searchbox').fill('anything');
  248 |     const before = await evaluatePage<number>(f.app, f.origin, 'window.sidebarFrames');
  249 |     await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.sidebarFrames')).toBeGreaterThan(before + 5);
  250 |     await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
  251 |     await panel.getByRole('searchbox').press('Escape');
  252 |     await expect(panel.getByRole('searchbox')).toHaveValue('');
  253 |     await panel.getByRole('searchbox').press('Escape');
  254 |     await expect(panel).toHaveCount(0);
  255 |     expect(await f.app.evaluate(({ BrowserWindow }, id) => {
  256 |       const child = BrowserWindow.getAllWindows()[0].contentView.children.find(v => 'webContents' in v && (v as Electron.WebContentsView).webContents.id === id);
  257 |       return child?.getVisible();
  258 |     }, identity)).toBe(true);
  259 |     expect(await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value')).toBe('Keep this draft');
  260 |     expect(await evaluatePage(f.app, f.origin, 'window.sidebarVisibilityChanges')).toBe(0);
  261 |     expect(f.errors).toEqual([]);
  262 |   } finally { await f.dispose(); }
  263 | });
  264 | 
  265 | test('website draggable CSS cannot consume home navigation input in web tab frames', async () => {
  266 |   const f = await fixture(false);
  267 |   try {
  268 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/draggable`);
  269 |     await expect(f.page.getByRole('tab', { name: /Website draggable regions/ })).toHaveAttribute('aria-selected', 'true');
  270 |     const inspect = () => evaluatePage<{ width: number; rail: string; button: string; pseudo: string; frame: string }>(f.app, f.origin, `({
  271 |       width: innerWidth,
  272 |       rail: getComputedStyle(document.querySelector('.rail')).getPropertyValue('-webkit-app-region'),
  273 |       button: getComputedStyle(document.querySelector('#home')).getPropertyValue('-webkit-app-region'),
```