# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/layout.spec.ts >> website draggable CSS cannot consume home navigation input in web tab frames
- Location: test/e2e/browser/layout.spec.ts:209:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Object {
    "button": "no-drag",
-   "frame": "no-drag",
+   "frame": "drag",
    "pseudo": "no-drag",
    "rail": "no-drag",
    "width": Any<Number>,
  }

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  121 |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
  122 |       .some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().includes('location-overlay=1')))).toBe(false);
  123 |     const leftAddress = f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).first();
  124 |     await leftAddress.fill(f.origin);
  125 |     await expect(popup.getByRole('option').first()).toBeVisible();
  126 |     const samePaneFrame = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
  127 |     await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(samePaneFrame + 5);
  128 |     await expect(leftAddress).toBeFocused();
  129 |     await leftAddress.press('Escape');
  130 |     expect(f.errors).toEqual([]);
  131 |   } finally { await f.dispose(); }
  132 | });
  133 | 
  134 | test('application menus preserve live video frames, playback and web view visibility', async () => {
  135 |   const f = await fixture();
  136 |   try {
  137 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  138 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
  139 |     await evaluatePage(f.app, f.origin, `(() => {
  140 |       const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
  141 |       const ctx = canvas.getContext('2d'); let frame = 0;
  142 |       setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 640, 480); }, 50);
  143 |       const video = document.createElement('video'); video.id = 'live-video'; video.muted = true;
  144 |       video.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:fill';
  145 |       video.srcObject = canvas.captureStream(20); document.body.append(video);
  146 |       window.presentedFrames = 0;
  147 |       const count = () => { window.presentedFrames++; video.requestVideoFrameCallback(count); };
  148 |       video.requestVideoFrameCallback(count); return video.play();
  149 |     })()`);
  150 |     await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(3);
  151 |     await f.page.getByRole('button', { name: 'View', exact: true }).click();
  152 |     await expect.poll(() => f.app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
  153 |     const menu = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
  154 |     await expect(menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true })).toBeVisible();
  155 |     const before = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
  156 |     await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(before + 5);
  157 |     expect(await evaluatePage(f.app, f.origin, 'document.querySelector("video").paused')).toBe(false);
  158 |     expect(await f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
  159 |       .some(view => view.getVisible() && 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === `${origin}/first`), f.origin)).toBe(true);
  160 |     await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
  161 |     await menu.getByRole('menuitem', { name: /^Theme/ }).hover();
  162 |     await expect(menu.getByRole('menuitemradio').first()).toBeVisible();
  163 |     const duringSubmenu = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
  164 |     await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(duringSubmenu + 5);
  165 |     await menu.screenshot({ path: test.info().outputPath('menu-layer.png'), omitBackground: true });
  166 |     await menu.keyboard.press('Escape');
  167 |     await expect(f.page.getByRole('button', { name: 'View', exact: true })).toHaveAttribute('aria-expanded', 'false');
  168 |     await f.page.getByRole('button', { name: 'View', exact: true }).click();
  169 |     await expect(menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true })).toBeVisible();
  170 |     await menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true }).click();
  171 |     await expect(f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true })).toHaveAttribute('aria-expanded', 'true');
  172 |     expect(f.errors).toEqual([]);
  173 |   } finally { await f.dispose(); }
  174 | });
  175 | 
  176 | test('language sidebar leaves the native web page live and Escape belongs to its search', async () => {
  177 |   const f = await fixture();
  178 |   try {
  179 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  180 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
  181 |     const identity = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(c => c.getURL() === `${origin}/first`)!.id, f.origin);
  182 |     await evaluatePage(f.app, f.origin, `(() => {
  183 |       document.querySelector('#draft').value = 'Keep this draft'; window.sidebarFrames = 0; window.sidebarVisibilityChanges = 0;
  184 |       document.addEventListener('visibilitychange', () => window.sidebarVisibilityChanges++);
  185 |       const frame = () => { window.sidebarFrames++; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  186 |     })()`);
  187 |     await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
  188 |     await f.page.getByRole('button', { name: 'Language Support', exact: true }).click();
  189 |     const panel = f.page.getByRole('region', { name: 'Language Support', exact: true });
  190 |     await expect(panel.getByRole('searchbox')).toBeFocused();
  191 |     await panel.getByRole('searchbox').fill('anything');
  192 |     const before = await evaluatePage<number>(f.app, f.origin, 'window.sidebarFrames');
  193 |     await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.sidebarFrames')).toBeGreaterThan(before + 5);
  194 |     await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
  195 |     await panel.getByRole('searchbox').press('Escape');
  196 |     await expect(panel.getByRole('searchbox')).toHaveValue('');
  197 |     await panel.getByRole('searchbox').press('Escape');
  198 |     await expect(panel).toHaveCount(0);
  199 |     expect(await f.app.evaluate(({ BrowserWindow }, id) => {
  200 |       const child = BrowserWindow.getAllWindows()[0].contentView.children.find(v => 'webContents' in v && (v as Electron.WebContentsView).webContents.id === id);
  201 |       return child?.getVisible();
  202 |     }, identity)).toBe(true);
  203 |     expect(await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value')).toBe('Keep this draft');
  204 |     expect(await evaluatePage(f.app, f.origin, 'window.sidebarVisibilityChanges')).toBe(0);
  205 |     expect(f.errors).toEqual([]);
  206 |   } finally { await f.dispose(); }
  207 | });
  208 | 
  209 | test('website draggable CSS cannot consume home navigation input in web tab frames', async () => {
  210 |   const f = await fixture(false);
  211 |   try {
  212 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/draggable`);
  213 |     await expect(f.page.getByRole('tab', { name: /Website draggable regions/ })).toHaveAttribute('aria-selected', 'true');
  214 |     const inspect = () => evaluatePage<{ width: number; rail: string; button: string; pseudo: string; frame: string }>(f.app, f.origin, `({
  215 |       width: innerWidth,
  216 |       rail: getComputedStyle(document.querySelector('.rail')).getPropertyValue('-webkit-app-region'),
  217 |       button: getComputedStyle(document.querySelector('#home')).getPropertyValue('-webkit-app-region'),
  218 |       pseudo: getComputedStyle(document.querySelector('.rail'), '::before').getPropertyValue('-webkit-app-region'),
  219 |       frame: getComputedStyle(document.querySelector('iframe').contentDocument.querySelector('#home')).getPropertyValue('-webkit-app-region')
  220 |     })`);
> 221 |     await expect.poll(inspect).toEqual({ width: expect.any(Number), rail: 'no-drag', button: 'no-drag', pseudo: 'no-drag', frame: 'no-drag' });
      |                                ^ Error: expect(received).toEqual(expected) // deep equality
  222 |     expect((await inspect()).width).toBeGreaterThan(800);
  223 |     const contents = await f.app.evaluateHandle(({ webContents }, origin) => webContents.getAllWebContents()
  224 |       .find(wc => wc.getURL().startsWith(origin))!, f.origin);
  225 |     await contents.evaluate(wc => {
  226 |       wc.focus();
  227 |       wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 32, y: 32 });
  228 |       wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 32, y: 32 });
  229 |     });
  230 |     await expect.poll(() => evaluatePage(f.app, f.origin, '({clicks:homeClicks,hash:location.hash})'))
  231 |       .toEqual({ clicks: 1, hash: '#home' });
  232 |     const point = await evaluatePage<{ x: number; y: number }>(f.app, f.origin, `(() => {
  233 |       const frame = document.querySelector('iframe'), region = frame.getBoundingClientRect();
  234 |       const button = frame.contentDocument.querySelector('#home').getBoundingClientRect();
  235 |       return { x: region.left + frame.clientLeft + button.left + button.width / 2,
  236 |         y: region.top + frame.clientTop + button.top + button.height / 2 };
  237 |     })()`);
  238 |     await contents.evaluate((wc, point) => {
  239 |       wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  240 |       wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  241 |     }, point);
  242 |     await expect.poll(() => evaluatePage(f.app, f.origin, 'document.querySelector("iframe").contentWindow.homeClicks')).toBe(1);
  243 |     await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
  244 |     await expect.poll(() => evaluatePage(f.app, f.origin, 'homeClicks')).toBe(0);
  245 |     await expect.poll(inspect).toEqual({ width: expect.any(Number), rail: 'no-drag', button: 'no-drag', pseudo: 'no-drag', frame: 'no-drag' });
  246 |     await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(650, 820));
  247 |     await expect.poll(async () => (await inspect()).width).toBeLessThan(800);
  248 |     expect((await inspect()).button).toBe('no-drag');
  249 |     expect(f.errors).toEqual([]);
  250 |   } finally { await f.dispose(); }
  251 | });
  252 | 
  253 | test('tab widths stay stable when adding tabs and updating web page titles', async () => {
  254 |   const f = await fixture();
  255 |   try {
  256 |     const notes = f.page.getByRole('tab', { name: /notes.md/ });
  257 |     await expect(notes).toBeVisible();
  258 |     const originalWidth = (await notes.boundingBox())!.width;
  259 |     await f.page.getByRole('button', { name: 'New web tab', exact: true }).click();
  260 |     const web = f.page.locator('.document-tab[aria-selected="true"]');
  261 |     // New renderer process + navigation + title can exceed the default 5s
  262 |     // expect budget on a loaded headless machine; widths are asserted after.
  263 |     await expect(web).toContainText('Google', { timeout: 15_000 });
  264 |     const widths = () => f.page.locator('.document-tab').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().width));
  265 |     const settled = await widths();
  266 |     expect(settled[0]).toBe(originalWidth);
  267 |     await evaluatePage(f.app, 'https://www.google.com/', 'document.title = "A much longer website title that should only change the text inside its tab"; true');
  268 |     await expect(web).toContainText('A much longer website title', { timeout: 15_000 });
  269 |     expect(await widths()).toEqual(settled);
  270 |     await evaluatePage(f.app, 'https://www.google.com/', 'document.title = "Google"; true');
  271 |     await expect(web).toContainText('Google', { timeout: 15_000 });
  272 |     expect(await widths()).toEqual(settled);
  273 |     await f.page.getByRole('button', { name: 'New document', exact: true }).click();
  274 |     await expect(f.page.locator('.document-tab')).toHaveCount(3);
  275 |     await expect(f.page.locator('.editor-surface')).toBeVisible();
  276 |     expect((await widths()).slice(0, 2)).toEqual(settled);
  277 |     expect(f.errors).toEqual([]);
  278 |   } finally { await f.dispose(); }
  279 | });
  280 | 
  281 | 
```