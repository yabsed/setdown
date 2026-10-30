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

Locator: getByRole('tab', { name: /Second page/ })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('tab', { name: /Second page/ }) with timeout 5000ms
  - waiting for getByRole('tab', { name: /Second page/ })

```

```yaml
- main:
  - button "Toggle Folder Tools": Setdown
  - navigation "Application menu":
    - button "File"
    - button "View"
    - button "Edit"
    - button "Window"
  - region "Editor group"
  - img "Setdown"
  - text: Setdown
  - heading "Write plain. Read beautifully." [level=1]
  - paragraph: Read Markdown beautifully, then double-click anywhere to edit it.
  - button "New Document"
  - button "Open File"
  - button "Open Folder"
  - button "Open Web Page"
  - text: Ctrl/Cmd+N · Ctrl/Cmd+O
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
> 27  |     await expect(other.getByRole('tab', { name: /Second page/ })).toBeVisible();
      |                                                                   ^ Error: expect(locator).toBeVisible() failed
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
  49  |       for (const channel of ['browser:tab-drag-input', 'tabs:drag-target', 'tabs:register-transfer', 'tabs:detach-to-window', 'tabs:cancel-transfer']) ipcMain.on(channel, (event, value) => events.push({ at: Date.now(), id: event.sender.id, channel, value }));
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
  60  |             types: Array.from(e.dataTransfer?.types ?? []), effect: e.dataTransfer?.dropEffect, buttons: e.buttons, button: e.button,
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
  71  |       // After Escape the next drag starts in the same tab. Use a distinct grab
  72  |       // point so X11 does not interpret the rapid press as a double-click.
  73  |       const from = await windows[owner].evaluate((window, { box, round }) => { const b = window.getContentBounds(), z = window.webContents.getZoomFactor();
  74  |         return { x: b.x + (box.x + 35 + (round % 2) * 30) * z, y: b.y + (box.y + 15) * z }; }, { box, round });
  75  |       const to = await windows[destination].evaluate((window, { body, destination }) => { const b = window.getContentBounds(), z = window.webContents.getZoomFactor();
  76  |         return { x: b.x + (body.x + body.width * (destination ? .85 : .2)) * z, y: b.y + (body.y + body.height * .45) * z }; }, { body, destination });
  77  |       await nativeInput({ pointer: [from], button: 'down' });
  78  |       await nativeInput({ pointer: [{ x: from.x + 20, y: from.y + 15 }, { x: from.x + 20, y: to.y }, to] });
  79  |       await expect(pages[destination].locator('.group-drop-overlay')).toBeVisible();
  80  |       if (canceled) await nativeInput({ keys: ['Escape'] });
  81  |       await nativeInput({ button: 'up' });
  82  |       if (!canceled) {
  83  |         await expect(pages[destination].locator(`[data-tab-id="${id}"]`)).toBeVisible();
  84  |         await expect(tab).toHaveCount(0); owner = destination;
  85  |       } else await expect(tab).toBeVisible();
  86  |       for (const page of pages) {
  87  |         await expect(page.locator('.group-drop-overlay')).toBeHidden();
  88  |         await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  89  |         await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  90  |       }
  91  |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
  92  |     }
  93  |     if (nativePage) expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.keptDragDraft'), nativePage)).toBe('SAME_LIVE_PAGE');
  94  |     if (moving === 'terminal') await expect(pages[owner].locator('.xterm-rows')).toContainText('keep-this-unsubmitted');
  95  |     for (const window of windows) await window.dispose();
  96  |     expect(f.errors).toEqual([]);
  97  |   } finally {
  98  |     await writeFile(test.info().outputPath('native-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).nativeDragTrace ?? null), null, 2));
  99  |     await writeFile(test.info().outputPath('native-windows.json'), JSON.stringify(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), url: window.webContents.getURL(), loading: window.webContents.isLoadingMainFrame() }))), null, 2));
  100 |     await nativeInput({ keys: ['Escape'], button: 'up' });
  101 |     for (const [i, page] of pages.entries()) {
  102 |       await writeFile(test.info().outputPath(`window-${i}-drag-events.json`), JSON.stringify(await page.evaluate(() => (globalThis as any).transferDragEvents ?? null).catch(() => null), null, 2));
  103 |       await page.screenshot({ path: test.info().outputPath(`window-${i}.png`) }).catch(() => {});
  104 |     }
  105 |     await f.dispose();
  106 |   }
  107 | });
  108 | 
  109 | test('native web tab drag into another window preserves the page and uses the indicated tab strip', async () => {
  110 |   const f = await fixture();
  111 |   try {
  112 |     if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native tab drag requires isolated Xvfb.');
  113 |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  114 |     const sourceTab = f.page.getByRole('tab', { name: /Research page/ });
  115 |     await expect(sourceTab).toBeVisible();
  116 |     const pageId = await f.app.evaluate(async ({ webContents }, origin) => {
  117 |       const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  118 |       await wc.executeJavaScript('document.querySelector("#draft").value = "KEEP_WEB_FORM"');
  119 |       return wc.id;
  120 |     }, f.origin);
  121 |     const created = f.app.waitForEvent('window');
  122 |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-window')!.click());
  123 |     const destination = await created;
  124 |     await expect(destination.locator('.shell')).toBeVisible();
  125 |     await destination.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  126 |     await expect(destination.getByRole('tab', { name: /Second page/ })).toBeVisible();
  127 |     const sourceNative = await f.app.browserWindow(f.page), destinationNative = await f.app.browserWindow(destination);
```