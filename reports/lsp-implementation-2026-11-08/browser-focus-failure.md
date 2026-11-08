# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/focus.spec.ts >> new web tabs take selection without selecting the address, including after a stale native focus event
- Location: test/e2e/browser/focus.spec.ts:241:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByRole('tab', { name: /Google/ })
Expected: "true"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" getByRole('tab', { name: /Google/ }) with timeout 5000ms
  - waiting for getByRole('tab', { name: /Google/ })

```

```yaml
- main:
  - button "Toggle Folder Tools": Setdown
  - navigation "Application menu":
    - button "File"
    - button "View"
    - button "Edit"
    - button "Window"
  - region "Editor group":
    - navigation "Open documents":
      - tablist:
        - tab "notes.md ×":
          - text: notes.md
          - button "×"
        - tab "Research page ×":
          - text: Research page
          - button "×"
        - tab "◌ https://www.google.com/ ×" [selected]:
          - text: ◌ https://www.google.com/
          - button "×"
      - button "New document"
      - button "New web tab"
      - button "New terminal"
    - button "Back" [disabled]: ←
    - button "Forward" [disabled]: →
    - button "Stop loading": ×
    - textbox "Address or file path":
      - /placeholder: Search or enter an address
      - text: https://www.google.com/
    - button "Extensions menu"
    - button "Site controls"
    - button "Bookmark page"
    - button "Enter reader mode"
    - group "Website zoom":
      - button "Zoom website out"
      - button "Reset website zoom": 100%
      - button "Zoom website in"
- alert
- alert
```

# Test source

```ts
  151 |       const point = { clientX: box.x + box.width * .98, clientY: box.y + box.height / 2, dataTransfer: data };
  152 |       await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
  153 |       await webTab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
  154 |       await expect(f.page.locator('.location-bar')).toHaveCount(2);
  155 |       await f.page.getByRole('tab', { name: /notes.md/ }).click();
  156 |     } else {
  157 |       await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.focus(), f.origin);
  158 |     }
  159 |     const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).last();
  160 |     const box = (await address.boundingBox())!;
  161 |     const point = await f.app.evaluate(({ BrowserWindow }, box) => {
  162 |       const window = BrowserWindow.getAllWindows()[0], bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  163 |       return { x: bounds.x + (box.x + box.width / 2) * zoom, y: bounds.y + (box.y + box.height / 2) * zoom };
  164 |     }, box);
  165 |     await nativeInput({ click: point });
  166 |     await expect(address).toBeFocused();
  167 |     // Let activation, Places results, and native overlay visibility settle.
  168 |     await f.page.waitForTimeout(500);
  169 |     await f.page.screenshot({ path: test.info().outputPath('address-native-focus.png') });
  170 |     expect(await f.page.evaluate(() => document.hasFocus())).toBe(true);
  171 |     const nativeFocus = await f.app.evaluate(({ BrowserWindow, webContents }) => ({
  172 |       focused: webContents.getFocusedWebContents()?.getURL(),
  173 |       windows: BrowserWindow.getAllWindows().map(window => ({ id: window.webContents.id, url: window.webContents.getURL(), visible: window.isVisible() })),
  174 |       owner: webContents.getFocusedWebContents()?.id === BrowserWindow.getAllWindows()[0].webContents.id,
  175 |     }));
  176 |     await test.info().attach('native-focus.json', { body: JSON.stringify(nativeFocus), contentType: 'application/json' });
  177 |     await nativeInput({ text: 'keyboardworks' });
  178 |     await expect(address).toHaveValue('keyboardworks');
  179 |     expect(nativeFocus.owner).toBe(true);
  180 |     expect(await f.page.evaluate(() => document.hasFocus())).toBe(true);
  181 |   } finally { await f.dispose(); }
  182 | });
  183 | 
  184 | test('mouse-focused address edits survive empty suggestions and keep typing, caret and composition', async () => {
  185 |   const f = await fixture();
  186 |   try {
  187 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  188 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
  189 |     await f.page.evaluate(url => window.marktex.browser.bookmark(url, 'Address editing fixture', true), `${f.origin}/first`);
  190 |     await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.focus(), f.origin);
  191 |     const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true });
  192 |     const input = (await address.boundingBox())!;
  193 |     const point = await f.app.evaluate(({ BrowserWindow }, rect) => {
  194 |       const owner = BrowserWindow.getAllWindows()[0], bounds = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
  195 |       return { x: Math.round(bounds.x + (rect.x + rect.width / 2) * zoom), y: Math.round(bounds.y + (rect.y + rect.height / 2) * zoom) };
  196 |     }, input);
  197 |     if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native address click requires isolated Xvfb.');
  198 |     await execFile('python3', ['-c', `
  199 | import ctypes, ctypes.util, sys
  200 | x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
  201 | x.XOpenDisplay.restype=ctypes.c_void_p
  202 | x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
  203 | t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
  204 | t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
  205 | d=x.XOpenDisplay(None)
  206 | if not d: raise RuntimeError('No isolated X display')
  207 | t.XTestFakeMotionEvent(d,-1,int(sys.argv[1]),int(sys.argv[2]),0)
  208 | t.XTestFakeButtonEvent(d,1,1,0); t.XTestFakeButtonEvent(d,1,0,0); x.XFlush(d); x.XCloseDisplay(d)
  209 | `, String(point.x), String(point.y)]);
  210 |     await expect(address).toBeFocused();
  211 |     expect(await address.evaluate((input: HTMLInputElement) => input.selectionStart === 0 && input.selectionEnd === input.value.length)).toBe(true);
  212 |     await expect.poll(() => f.app.windows().some(page => page.url().includes('location-overlay=1'))).toBe(true);
  213 |     const popup = f.app.windows().find(page => page.url().includes('location-overlay=1'))!;
  214 |     // Native title updates can replace a bookmark's label; its URL is the
  215 |     // stable identity of the matching row needed for this input regression.
  216 |     const suggestion = popup.getByRole('option').filter({ hasText: `${f.origin}/first` });
  217 |     await expect(suggestion).toBeVisible();
  218 |     // Each character spans the actual Places debounce: the first unmatched
  219 |     // character closes an already-open popup while the same edit continues.
  220 |     const query = 'no-history-match-928471';
  221 |     await address.pressSequentially(query, { delay: 140 });
  222 |     await expect(address).toHaveValue(query); await expect(address).toBeFocused();
  223 |     expect(await address.evaluate((input: HTMLInputElement) => ({ start: input.selectionStart, end: input.selectionEnd }))).toEqual({ start: query.length, end: query.length });
  224 |     await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.some(view =>
  225 |       'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().includes('location-overlay=1') && view.getVisible()))).toBe(false);
  226 |     await address.press('Home'); await address.pressSequentially('kept-', { delay: 140 });
  227 |     await expect(address).toHaveValue(`kept-${query}`);
  228 |     await address.press('Control+a'); await address.pressSequentially(f.origin, { delay: 140 });
  229 |     await expect(address).toHaveValue(f.origin);
  230 |     await expect(suggestion).toBeVisible();
  231 |     const cdp = await f.app.context().newCDPSession(f.page);
  232 |     await address.press('Control+a');
  233 |     await cdp.send('Input.imeSetComposition', { text: '한글', selectionStart: 2, selectionEnd: 2 });
  234 |     await cdp.send('Input.insertText', { text: '한글' }); await cdp.detach();
  235 |     await expect(address).toHaveValue('한글'); await expect(address).toBeFocused();
  236 |     await address.press('Escape'); await expect(address).toHaveValue(`${f.origin}/first`);
  237 |     expect(f.errors).toEqual([]);
  238 |   } finally { await f.dispose(); }
  239 | });
  240 | 
  241 | test('new web tabs take selection without selecting the address, including after a stale native focus event', async () => {
  242 |   const f = await fixture();
  243 |   try {
  244 |     await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  245 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  246 |     const previous = f.page.getByRole('tab', { name: /Research page/ });
  247 |     await expect(previous).toHaveAttribute('aria-selected', 'true');
  248 |     const previousId = (await previous.getAttribute('data-tab-id'))!;
  249 |     await f.page.getByRole('button', { name: 'New web tab', exact: true }).click();
  250 |     const blank = f.page.getByRole('tab', { name: /Google/ });
> 251 |     await expect(blank).toHaveAttribute('aria-selected', 'true');
      |                         ^ Error: expect(locator).toHaveAttribute(expected) failed
  252 |     const address = f.page.getByRole('textbox', { name: 'Address or file path' });
  253 |     await expect(address).not.toBeFocused();
  254 |     expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
  255 |     const blankId = (await blank.getAttribute('data-tab-id'))!;
  256 |     // Native focus can already be in flight when a visible page is hidden.
  257 |     const received = await f.page.evaluateHandle(id => {
  258 |       const state = { received: false };
  259 |       const unsubscribe = window.marktex.browser.onEvent(event => {
  260 |         if (event.type !== 'focus' || event.id !== id) return;
  261 |         unsubscribe(); requestAnimationFrame(() => { state.received = true; });
  262 |       });
  263 |       return state;
  264 |     }, previousId);
  265 |     await f.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0].webContents.send('browser:event', { type: 'focus', id }), previousId);
  266 |     await expect.poll(() => received.evaluate(state => state.received)).toBe(true);
  267 |     await received.dispose();
  268 |     await expect(blank).toHaveAttribute('aria-selected', 'true');
  269 |     await previous.click();
  270 |     await f.page.keyboard.press('Control+t');
  271 |     // Each new tab spawns a renderer process and navigates; on a loaded
  272 |     // headless machine that exceeds Playwright's default 5s expect budget.
  273 |     await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveCount(2, { timeout: 15_000 });
  274 |     const selected = f.page.locator('.document-tab[aria-selected="true"]');
  275 |     await expect(selected).toContainText('Google', { timeout: 15_000 });
  276 |     expect(await selected.getAttribute('data-tab-id')).not.toBe(blankId);
  277 |     await expect(address).not.toBeFocused();
  278 |     expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
  279 |     await f.page.keyboard.press('Control+l');
  280 |     await expect(address).toBeFocused();
  281 |     expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === 0
  282 |       && (input as HTMLInputElement).selectionEnd === (input as HTMLInputElement).value.length)).toBe(true);
  283 |     await f.page.keyboard.press('Control+t');
  284 |     await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveCount(3, { timeout: 15_000 });
  285 |     await expect(address).not.toBeFocused();
  286 |     expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
  287 |     expect(f.errors).toEqual([]);
  288 |   } finally { await f.dispose(); }
  289 | });
  290 | 
  291 | test('address focus selects the whole URL for mouse, keyboard, and native page shortcuts', async () => {
  292 |   const f = await fixture();
  293 |   try {
  294 |     const address = f.page.getByRole('textbox', { name: 'Address or file path' });
  295 |     const selected = () => address.evaluate(input => {
  296 |       const value = input as HTMLInputElement;
  297 |       return value.selectionStart === 0 && value.selectionEnd === value.value.length;
  298 |     });
  299 |     await expect(address).not.toBeFocused();
  300 |     await address.click();
  301 |     expect(await selected()).toBe(true);
  302 |     await f.page.keyboard.type('replacement');
  303 |     await expect(address).toHaveValue('replacement');
  304 |     await address.fill(`${f.origin}/first`); await address.press('Enter');
  305 |     await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('Research page');
  306 |     await f.app.evaluate(({ webContents }, origin) => {
  307 |       const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  308 |       page.focus(); page.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: ['control'] });
  309 |       page.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: ['control'] });
  310 |     }, f.origin);
  311 |     await expect(address).toBeFocused();
  312 |     expect(await selected()).toBe(true);
  313 |     await f.page.keyboard.type('fresh input');
  314 |     await expect(address).toHaveValue('fresh input');
  315 |     expect(f.errors).toEqual([]);
  316 |   } finally { await f.dispose(); }
  317 | });
  318 | 
  319 | 
```