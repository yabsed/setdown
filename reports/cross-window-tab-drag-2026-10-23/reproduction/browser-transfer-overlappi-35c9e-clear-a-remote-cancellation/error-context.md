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

Locator:  locator('.group-drop-overlay')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" locator('.group-drop-overlay') with timeout 5000ms
  - waiting for locator('.group-drop-overlay')
    14 × locator resolved to <div hidden="" class="group-drop-overlay"></div>
       - unexpected value "hidden"

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
      - text: http://127.0.0.1:42449/second
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
  15  |   f.app.on('window', page => page.on('pageerror', error => console.error('New shell error:', error.message)));
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
  41  |     for (let i = 0; i < windows.length; i++) {
  42  |       await windows[i].evaluate((window, i) => { window.setBounds({ x: i ? 850 : 100, y: i ? 130 : 100, width: 1000, height: 800 }); window.show(); }, i);
  43  |       await pages[i].evaluate(() => {
  44  |         const events: unknown[] = []; (globalThis as any).transferDragEvents = events;
  45  |         for (const type of ['dragstart', 'dragover', 'dragleave', 'drop', 'dragend']) window.addEventListener(type, event => {
  46  |           const e = event as DragEvent;
  47  |           events.push({ type, trusted: e.isTrusted, x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY,
  48  |             types: Array.from(e.dataTransfer?.types ?? []), effect: e.dataTransfer?.dropEffect,
  49  |             token: type === 'drop' ? e.dataTransfer?.getData('application/x-setdown-tab') : undefined });
  50  |         }, true);
  51  |       });
  52  |     }
  53  |     let owner = 1;
  54  |     for (let round = 0; round < 7; round++) {
  55  |       const destination = 1 - owner, canceled = round === 3;
  56  |       await windows[owner].evaluate(window => { window.focus(); window.webContents.focus(); });
  57  |       const tab = pages[owner].locator(`[data-tab-id="${id}"]`);
  58  |       const box = (await tab.boundingBox())!, body = (await pages[destination].locator('.group-body').boundingBox())!;
  59  |       const from = await windows[owner].evaluate((window, box) => { const b = window.getContentBounds(), z = window.webContents.getZoomFactor();
  60  |         return { x: b.x + (box.x + 35) * z, y: b.y + (box.y + 15) * z }; }, box);
  61  |       const to = await windows[destination].evaluate((window, { body, destination }) => { const b = window.getContentBounds(), z = window.webContents.getZoomFactor();
  62  |         return { x: b.x + (body.x + body.width * (destination ? .85 : .2)) * z, y: b.y + (body.y + body.height * .45) * z }; }, { body, destination });
  63  |       await nativeInput({ pointer: [from], button: 'down' });
  64  |       await nativeInput({ pointer: [{ x: from.x + 20, y: from.y + 15 }, { x: from.x + 20, y: to.y }, to] });
> 65  |       await expect(pages[destination].locator('.group-drop-overlay')).toBeVisible();
      |                                                                       ^ Error: expect(locator).toBeVisible() failed
  66  |       if (canceled) await nativeInput({ keys: ['Escape'] });
  67  |       await nativeInput({ button: 'up' });
  68  |       if (!canceled) {
  69  |         await expect(pages[destination].locator(`[data-tab-id="${id}"]`)).toBeVisible();
  70  |         await expect(tab).toHaveCount(0); owner = destination;
  71  |       } else await expect(tab).toBeVisible();
  72  |       for (const page of pages) {
  73  |         await expect(page.locator('.group-drop-overlay')).toBeHidden();
  74  |         await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  75  |         await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  76  |       }
  77  |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
  78  |     }
  79  |     if (nativePage) expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.keptDragDraft'), nativePage)).toBe('SAME_LIVE_PAGE');
  80  |     if (moving === 'terminal') await expect(pages[owner].locator('.xterm-rows')).toContainText('keep-this-unsubmitted');
  81  |     for (const window of windows) await window.dispose();
  82  |     expect(f.errors).toEqual([]);
  83  |   } finally {
  84  |     await writeFile(test.info().outputPath('native-windows.json'), JSON.stringify(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), url: window.webContents.getURL(), loading: window.webContents.isLoadingMainFrame() }))), null, 2));
  85  |     await nativeInput({ keys: ['Escape'], button: 'up' });
  86  |     for (const [i, page] of pages.entries()) {
  87  |       await writeFile(test.info().outputPath(`window-${i}-drag-events.json`), JSON.stringify(await page.evaluate(() => (globalThis as any).transferDragEvents ?? null).catch(() => null), null, 2));
  88  |       await page.screenshot({ path: test.info().outputPath(`window-${i}.png`) }).catch(() => {});
  89  |     }
  90  |     await f.dispose();
  91  |   }
  92  | });
  93  | 
  94  | test('native web tab drag into another window preserves the page and uses the indicated tab strip', async () => {
  95  |   const f = await fixture();
  96  |   try {
  97  |     if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native tab drag requires isolated Xvfb.');
  98  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  99  |     const sourceTab = f.page.getByRole('tab', { name: /Research page/ });
  100 |     await expect(sourceTab).toBeVisible();
  101 |     const pageId = await f.app.evaluate(async ({ webContents }, origin) => {
  102 |       const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  103 |       await wc.executeJavaScript('document.querySelector("#draft").value = "KEEP_WEB_FORM"');
  104 |       return wc.id;
  105 |     }, f.origin);
  106 |     const created = f.app.waitForEvent('window');
  107 |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-window')!.click());
  108 |     const destination = await created;
  109 |     await expect(destination.locator('.shell')).toBeVisible();
  110 |     await destination.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  111 |     await expect(destination.getByRole('tab', { name: /Second page/ })).toBeVisible();
  112 |     const sourceNative = await f.app.browserWindow(f.page), destinationNative = await f.app.browserWindow(destination);
  113 |     await sourceNative.evaluate(window => { window.setBounds({ x: 0, y: 80, width: 800, height: 700 }); window.show(); });
  114 |     await destinationNative.evaluate(window => { window.setBounds({ x: 900, y: 80, width: 800, height: 700 }); window.show(); });
  115 |     await sourceNative.evaluate(window => { window.focus(); window.webContents.focus(); });
  116 |     const tabBox = (await sourceTab.boundingBox())!, stripBox = (await destination.locator('.tab-strip').boundingBox())!;
  117 |     const from = await sourceNative.evaluate((window, box) => {
  118 |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  119 |       return { x: Math.round(bounds.x + (box.x + 35) * zoom), y: Math.round(bounds.y + (box.y + 15) * zoom) };
  120 |     }, tabBox);
  121 |     const to = await destinationNative.evaluate((window, box) => {
  122 |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  123 |       return { x: Math.round(bounds.x + (box.x + box.width - 20) * zoom), y: Math.round(bounds.y + (box.y + 15) * zoom) };
  124 |     }, stripBox);
  125 |     await execFile('python3', ['-c', `
  126 | import ctypes, ctypes.util, sys, time
  127 | x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
  128 | x.XOpenDisplay.restype=ctypes.c_void_p
  129 | x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
  130 | t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
  131 | t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
  132 | d=x.XOpenDisplay(None)
  133 | if not d: raise RuntimeError('No isolated X display')
  134 | sx,sy,tx,ty=map(int,sys.argv[1:])
  135 | def move(px,py):
  136 |  t.XTestFakeMotionEvent(d,-1,px,py,0); x.XFlush(d); time.sleep(.04)
  137 | move(sx,sy); t.XTestFakeButtonEvent(d,1,1,0); x.XFlush(d); time.sleep(.1)
  138 | for i in range(1,31): move(round(sx+(tx-sx)*i/30),round(sy+(ty-sy)*i/30))
  139 | time.sleep(.3); x.XCloseDisplay(d)
  140 | `, String(from.x), String(from.y), String(to.x), String(to.y)]);
  141 |     await expect(destination.locator('.tab-drop-indicator')).toBeVisible();
  142 |     await destination.screenshot({ path: test.info().outputPath('cross-window-drop-target.png') });
  143 |     // Release through XTest too: DOM dispatch cannot verify OS drag routing.
  144 |     await execFile('python3', ['-c', `
  145 | import ctypes, ctypes.util
  146 | x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
  147 | x.XOpenDisplay.restype=ctypes.c_void_p; x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
  148 | t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
  149 | d=x.XOpenDisplay(None); t.XTestFakeButtonEvent(d,1,0,0); x.XFlush(d); x.XCloseDisplay(d)
  150 | `]);
  151 |     await expect(destination.locator('.tab-name')).toHaveText(['Second page', 'Research page']);
  152 |     await expect(sourceTab).toHaveCount(0);
  153 |     expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
  154 |     expect(await f.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), pageId)).toBe('KEEP_WEB_FORM');
  155 |     await expect(destination.locator('.tab-drop-indicator')).toBeHidden();
  156 |     await sourceNative.dispose(); await destinationNative.dispose();
  157 |   } finally { await f.dispose(); }
  158 | });
  159 | 
  160 | test('a popup moved to another window survives closing its original window', async () => {
  161 |   const f = await fixture();
  162 |   try {
  163 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  164 |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
  165 |     await evaluatePage(f.app, f.origin, `
```