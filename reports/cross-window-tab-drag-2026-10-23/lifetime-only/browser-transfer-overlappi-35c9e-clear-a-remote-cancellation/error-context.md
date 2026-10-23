# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/transfer.spec.ts >> overlapping windows accept repeated terminal body drops and clear a remote cancellation
- Location: test/e2e/browser/transfer.spec.ts:11:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-tab-id="bd480df1-c1ed-4b32-a882-546a2ddf23f7"]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('[data-tab-id="bd480df1-c1ed-4b32-a882-546a2ddf23f7"]') with timeout 5000ms
  - waiting for locator('[data-tab-id="bd480df1-c1ed-4b32-a882-546a2ddf23f7"]')

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
        - tab "Second page ×" [selected]:
          - text: Second page
          - button "×"
      - button "New document"
      - button "New web tab"
      - button "New terminal"
    - button "Back" [disabled]: ←
    - button "Forward" [disabled]: →
    - button "Reload page": ↻
    - textbox "Address or file path":
      - /placeholder: Search or enter an address
      - text: http://127.0.0.1:41501/second
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
  1   | import { expect, test } from '@playwright/test';
  2   | import { execFile as execFileCallback } from 'node:child_process';
  3   | import { promisify } from 'node:util';
  4   | const execFile = promisify(execFileCallback);
  5   | 
  6   | import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
  7   | import { nativeInput } from '../../support/electron/native-input';
  8   | import { writeFile } from 'node:fs/promises';
  9   | 
  10  | for (const moving of ['web', 'terminal'] as const)
  11  | test(`overlapping windows accept repeated ${moving} body drops and clear a remote cancellation`, async () => {
  12  |   test.setTimeout(90_000);
  13  |   const f = await fixture();
  14  |   const pages = [f.page];
  15  |   f.app.on('window', page => page.on('pageerror', error => f.errors.push(error.message)));
  16  |   try {
  17  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  18  |     if (moving === 'web') await f.page.locator('.new-terminal-tab-button').click();
  19  |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-window')!.click());
  20  |     // Native web/preview children also emit Electron's window event. Select the
  21  |     // new application shell, not an asynchronously created spare page.
  22  |     const shells = async () => (await Promise.all(f.app.windows().filter(page => page.url() === f.page.url()).map(async page =>
  23  |       await page.locator('.shell').count().catch(() => 0) ? page : null))).filter(page => page !== null);
  24  |     await expect.poll(async () => (await shells()).length).toBe(2);
  25  |     const other = (await shells()).find(page => page !== f.page)!; pages.push(other);
  26  |     await other.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  27  |     await expect(other.getByRole('tab', { name: /Second page/ })).toBeVisible();
  28  |     if (moving === 'web') {
  29  |       await other.locator('.new-terminal-tab-button').click();
  30  |       await other.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  31  |       await expect(other.getByRole('tab', { name: /Research page/ })).toBeVisible();
  32  |     } else await other.locator('.new-terminal-tab-button').click();
  33  |     const selected = other.locator('.document-tab[aria-selected="true"]');
  34  |     const id = (await selected.getAttribute('data-tab-id'))!;
  35  |     const nativePage = moving === 'web' ? await f.app.evaluate(async ({ webContents }, origin) => {
  36  |       const page = webContents.getAllWebContents().find(page => page.getURL() === `${origin}/first`)!;
  37  |       await page.executeJavaScript('window.keptDragDraft = "SAME_LIVE_PAGE"'); return page.id;
  38  |     }, f.origin) : null;
  39  |     if (moving === 'terminal') await other.locator('.terminal-content:not(.inactive) .xterm-helper-textarea').pressSequentially('keep-this-unsubmitted');
  40  |     const windows = await Promise.all(pages.map(page => f.app.browserWindow(page)));
  41  |     await f.app.evaluate(({ webContents, ipcMain, WebContentsView }) => {
  42  |       const events: unknown[] = []; (globalThis as any).nativeDragTrace = events;
  43  |       for (const contents of webContents.getAllWebContents()) {
  44  |         contents.on('before-mouse-event', (_event, mouse) => { if (mouse.type !== 'mouseMove') events.push({ at: Date.now(), id: contents.id, mouse }); });
  45  |         contents.on('before-input-event', (_event, input) => { if (input.key === 'Escape') events.push({ at: Date.now(), id: contents.id, input }); });
  46  |         const send = contents.send.bind(contents);
  47  |         contents.send = (channel, ...args) => { if (channel === 'tabs:drag-state') events.push({ at: Date.now(), id: contents.id, channel, value: args[0] }); return send(channel, ...args); };
  48  |       }
  49  |       for (const channel of ['tabs:register-transfer', 'tabs:detach-to-window', 'tabs:cancel-transfer']) ipcMain.on(channel, (event, value) => events.push({ at: Date.now(), id: event.sender.id, channel, value }));
  50  |       const visible = WebContentsView.prototype.setVisible;
  51  |       WebContentsView.prototype.setVisible = function(value) { events.push({ at: Date.now(), id: this.webContents.id, visible: value }); return visible.call(this, value); };
  52  |     });
  53  |     for (let i = 0; i < windows.length; i++) {
  54  |       await windows[i].evaluate((window, i) => { window.setBounds({ x: i ? 850 : 100, y: i ? 130 : 100, width: 1000, height: 800 }); window.show(); }, i);
  55  |       await pages[i].evaluate(() => {
  56  |         const events: unknown[] = []; (globalThis as any).transferDragEvents = events;
  57  |         for (const type of ['dragstart', 'dragover', 'dragleave', 'drop', 'dragend']) window.addEventListener(type, event => {
  58  |           const e = event as DragEvent;
  59  |           events.push({ at: Date.now(), type, target: (e.target as Element | null)?.className, trusted: e.isTrusted, x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY,
  60  |             types: Array.from(e.dataTransfer?.types ?? []), effect: e.dataTransfer?.dropEffect,
  61  |             token: type === 'drop' ? e.dataTransfer?.getData('application/x-setdown-tab') : undefined });
  62  |         }, true);
  63  |       });
  64  |     }
  65  |     let owner = 1;
  66  |     for (let round = 0; round < 7; round++) {
  67  |       const destination = 1 - owner, canceled = round === 3;
  68  |       await windows[owner].evaluate(window => { window.focus(); window.webContents.focus(); });
  69  |       const tab = pages[owner].locator(`[data-tab-id="${id}"]`);
  70  |       const box = (await tab.boundingBox())!, body = (await pages[destination].locator('.group-body').boundingBox())!;
  71  |       const from = await windows[owner].evaluate((window, box) => { const b = window.getContentBounds(), z = window.webContents.getZoomFactor();
  72  |         return { x: b.x + (box.x + 35) * z, y: b.y + (box.y + 15) * z }; }, box);
  73  |       const to = await windows[destination].evaluate((window, { body, destination }) => { const b = window.getContentBounds(), z = window.webContents.getZoomFactor();
  74  |         return { x: b.x + (body.x + body.width * (destination ? .85 : .2)) * z, y: b.y + (body.y + body.height * .45) * z }; }, { body, destination });
  75  |       await nativeInput({ pointer: [from], button: 'down' });
  76  |       await nativeInput({ pointer: [{ x: from.x + 20, y: from.y + 15 }, { x: from.x + 20, y: to.y }, to] });
  77  |       await expect(pages[destination].locator('.group-drop-overlay')).toBeVisible();
  78  |       if (canceled) await nativeInput({ keys: ['Escape'] });
  79  |       await nativeInput({ button: 'up' });
  80  |       if (!canceled) {
> 81  |         await expect(pages[destination].locator(`[data-tab-id="${id}"]`)).toBeVisible();
      |                                                                           ^ Error: expect(locator).toBeVisible() failed
  82  |         await expect(tab).toHaveCount(0); owner = destination;
  83  |       } else await expect(tab).toBeVisible();
  84  |       for (const page of pages) {
  85  |         await expect(page.locator('.group-drop-overlay')).toBeHidden();
  86  |         await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  87  |         await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  88  |       }
  89  |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
  90  |     }
  91  |     if (nativePage) expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.keptDragDraft'), nativePage)).toBe('SAME_LIVE_PAGE');
  92  |     if (moving === 'terminal') await expect(pages[owner].locator('.xterm-rows')).toContainText('keep-this-unsubmitted');
  93  |     for (const window of windows) await window.dispose();
  94  |     expect(f.errors).toEqual([]);
  95  |   } finally {
  96  |     await writeFile(test.info().outputPath('native-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).nativeDragTrace ?? null), null, 2));
  97  |     await writeFile(test.info().outputPath('native-windows.json'), JSON.stringify(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), url: window.webContents.getURL(), loading: window.webContents.isLoadingMainFrame() }))), null, 2));
  98  |     await nativeInput({ keys: ['Escape'], button: 'up' });
  99  |     for (const [i, page] of pages.entries()) {
  100 |       await writeFile(test.info().outputPath(`window-${i}-drag-events.json`), JSON.stringify(await page.evaluate(() => (globalThis as any).transferDragEvents ?? null).catch(() => null), null, 2));
  101 |       await page.screenshot({ path: test.info().outputPath(`window-${i}.png`) }).catch(() => {});
  102 |     }
  103 |     await f.dispose();
  104 |   }
  105 | });
  106 | 
  107 | test('native web tab drag into another window preserves the page and uses the indicated tab strip', async () => {
  108 |   const f = await fixture();
  109 |   try {
  110 |     if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native tab drag requires isolated Xvfb.');
  111 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  112 |     const sourceTab = f.page.getByRole('tab', { name: /Research page/ });
  113 |     await expect(sourceTab).toBeVisible();
  114 |     const pageId = await f.app.evaluate(async ({ webContents }, origin) => {
  115 |       const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  116 |       await wc.executeJavaScript('document.querySelector("#draft").value = "KEEP_WEB_FORM"');
  117 |       return wc.id;
  118 |     }, f.origin);
  119 |     const created = f.app.waitForEvent('window');
  120 |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-window')!.click());
  121 |     const destination = await created;
  122 |     await expect(destination.locator('.shell')).toBeVisible();
  123 |     await destination.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  124 |     await expect(destination.getByRole('tab', { name: /Second page/ })).toBeVisible();
  125 |     const sourceNative = await f.app.browserWindow(f.page), destinationNative = await f.app.browserWindow(destination);
  126 |     await sourceNative.evaluate(window => { window.setBounds({ x: 0, y: 80, width: 800, height: 700 }); window.show(); });
  127 |     await destinationNative.evaluate(window => { window.setBounds({ x: 900, y: 80, width: 800, height: 700 }); window.show(); });
  128 |     await sourceNative.evaluate(window => { window.focus(); window.webContents.focus(); });
  129 |     const tabBox = (await sourceTab.boundingBox())!, stripBox = (await destination.locator('.tab-strip').boundingBox())!;
  130 |     const from = await sourceNative.evaluate((window, box) => {
  131 |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  132 |       return { x: Math.round(bounds.x + (box.x + 35) * zoom), y: Math.round(bounds.y + (box.y + 15) * zoom) };
  133 |     }, tabBox);
  134 |     const to = await destinationNative.evaluate((window, box) => {
  135 |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  136 |       return { x: Math.round(bounds.x + (box.x + box.width - 20) * zoom), y: Math.round(bounds.y + (box.y + 15) * zoom) };
  137 |     }, stripBox);
  138 |     await execFile('python3', ['-c', `
  139 | import ctypes, ctypes.util, sys, time
  140 | x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
  141 | x.XOpenDisplay.restype=ctypes.c_void_p
  142 | x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
  143 | t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
  144 | t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
  145 | d=x.XOpenDisplay(None)
  146 | if not d: raise RuntimeError('No isolated X display')
  147 | sx,sy,tx,ty=map(int,sys.argv[1:])
  148 | def move(px,py):
  149 |  t.XTestFakeMotionEvent(d,-1,px,py,0); x.XFlush(d); time.sleep(.04)
  150 | move(sx,sy); t.XTestFakeButtonEvent(d,1,1,0); x.XFlush(d); time.sleep(.1)
  151 | for i in range(1,31): move(round(sx+(tx-sx)*i/30),round(sy+(ty-sy)*i/30))
  152 | time.sleep(.3); x.XCloseDisplay(d)
  153 | `, String(from.x), String(from.y), String(to.x), String(to.y)]);
  154 |     await expect(destination.locator('.tab-drop-indicator')).toBeVisible();
  155 |     await destination.screenshot({ path: test.info().outputPath('cross-window-drop-target.png') });
  156 |     // Release through XTest too: DOM dispatch cannot verify OS drag routing.
  157 |     await execFile('python3', ['-c', `
  158 | import ctypes, ctypes.util
  159 | x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
  160 | x.XOpenDisplay.restype=ctypes.c_void_p; x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
  161 | t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
  162 | d=x.XOpenDisplay(None); t.XTestFakeButtonEvent(d,1,0,0); x.XFlush(d); x.XCloseDisplay(d)
  163 | `]);
  164 |     await expect(destination.locator('.tab-name')).toHaveText(['Second page', 'Research page']);
  165 |     await expect(sourceTab).toHaveCount(0);
  166 |     expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
  167 |     expect(await f.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), pageId)).toBe('KEEP_WEB_FORM');
  168 |     await expect(destination.locator('.tab-drop-indicator')).toBeHidden();
  169 |     await sourceNative.dispose(); await destinationNative.dispose();
  170 |   } finally { await f.dispose(); }
  171 | });
  172 | 
  173 | test('a popup moved to another window survives closing its original window', async () => {
  174 |   const f = await fixture();
  175 |   try {
  176 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  177 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
  178 |     await evaluatePage(f.app, f.origin, `
  179 |       window.child = window.open('about:blank');
  180 |       child.document.title = 'Transferred popup';
  181 |       child.document.body.innerHTML = '<input id="draft">';
```