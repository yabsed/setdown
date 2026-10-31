# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/layout.spec.ts >> HTML hover stays painted and clickable beside a live native web pane
- Location: test/e2e/browser/layout.spec.ts:11:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { execFile as execFileCallback } from 'node:child_process';
  3   | import { promisify } from 'node:util';
  4   | import { writeFile } from 'node:fs/promises';
  5   | const execFile = promisify(execFileCallback);
  6   |
  7   | import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
  8   | import { nativeInput } from '../../support/electron/native-input';
  9   | import { waylandInput } from '../../support/electron/wayland-input';
  10  |
  11  | test('HTML hover stays painted and clickable beside a live native web pane', async ({}, info) => {
  12  |   const f = await fixture(false);
  13  |   try {
  14  |     const file = `${f.root}/heading.html`;
  15  |     await writeFile(file, `${' '.repeat(45)}<h1>Heading</h1>\n`);
  16  |     await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
  17  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  18  |     const webTab = f.page.getByRole('tab', { name: /Research page/ });
  19  |     const data = await f.page.evaluateHandle(() => new DataTransfer());
  20  |     await webTab.dispatchEvent('dragstart', { dataTransfer: data });
  21  |     const body = f.page.locator('.group-body'), bounds = (await body.boundingBox())!;
  22  |     const point = { dataTransfer: data, clientX: bounds.x + bounds.width - 5, clientY: bounds.y + bounds.height / 2 };
  23  |     await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point); await data.dispose();
  24  |     await expect(f.page.locator('.editor-group')).toHaveCount(2);
  25  |     await evaluatePage(f.app, f.origin, 'window.keptDraft = document.querySelector("#draft"); keptDraft.value = "keep native input"; window.keptPage = crypto.randomUUID(); keptPage');
  26  |     const pageIdentity = await evaluatePage(f.app, f.origin, 'keptPage');
  27  |     await f.page.getByRole('tab', { name: /heading.html/ }).click();
  28  |     const heading = f.page.locator('.view-line span span').filter({ hasText: /^h1$/ }).first();
  29  |     await heading.hover();
  30  |     const hover = f.page.locator('.monaco-resizable-hover:visible');
  31  |     await expect(hover).toContainText('The h1 element');
  32  |     await f.page.screenshot({ path: info.outputPath('html-hover-beside-web.png') });
  33  |     await expect.poll(() => hover.evaluate(node => {
  34  |       const popup = node.getBoundingClientRect();
  35  |       const group = node.closest('.group-content, .editor-group')!.getBoundingClientRect();
  36  |       return popup.left >= group.left && popup.right <= group.right
  37  |         && popup.top >= group.top && popup.bottom <= group.bottom;
> 38  |     })).toBe(true);
      |         ^ Error: expect(received).toBe(expected) // Object.is equality
  39  |     // DOM hit testing alone cannot detect a native WebContentsView above shell
  40  |     // pixels. A real OS click must reach the MDN link in the complete popup.
  41  |     await hover.locator('a').filter({ hasText: 'MDN' }).evaluate(node => node.addEventListener('click', event => {
  42  |       event.preventDefault(); event.stopPropagation(); (window as any).__hoverLinkClicked = true;
  43  |     }, { capture: true }));
  44  |     const link = (await hover.locator('a').filter({ hasText: 'MDN' }).boundingBox())!;
  45  |     const screen = await f.app.evaluate(({ BrowserWindow }, point) => {
  46  |       const owner = BrowserWindow.getAllWindows()[0], bounds = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
  47  |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  48  |     }, { x: link.x + link.width / 2, y: link.y + link.height / 2 });
  49  |     await nativeInput({ click: screen });
  50  |     await expect.poll(() => f.page.evaluate(() => (window as any).__hoverLinkClicked)).toBe(true);
  51  |     expect(await evaluatePage(f.app, f.origin, '({ id: keptPage, same: keptDraft === document.querySelector("#draft"), value: keptDraft.value })'))
  52  |       .toEqual({ id: pageIdentity, same: true, value: 'keep native input' });
  53  |     expect(f.errors).toEqual([]);
  54  |   } finally { await f.dispose(); }
  55  | });
  56  |
  57  | test('fast right-edge drops split two live websites instead of tearing off a window', async () => {
  58  |   test.setTimeout(90_000);
  59  |   const compositor = process.env.SETDOWN_TEST_DISPLAY === 'xwayland' ? await waylandInput() : null;
  60  |   const input = compositor ? compositor.send : nativeInput;
  61  |   const f = await fixture(false).catch(async error => { await compositor?.close(); throw error; });
  62  |   try {
  63  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  64  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  65  |     const tab = f.page.getByRole('tab', { name: /Second page/ });
  66  |     await expect(tab).toHaveAttribute('aria-selected', 'true');
  67  |     const owner = await f.app.browserWindow(f.page);
  68  |     await owner.evaluate(window => window.setBounds({ x: 0, y: 0, width: 1920, height: 1030 }));
  69  |     if (process.env.SETDOWN_TEST_DISPLAY === 'xwayland') {
  70  |       await owner.evaluate(window => window.maximize());
  71  |       await expect.poll(() => owner.evaluate(window => window.isMaximized())).toBe(true);
  72  |     }
  73  |     await f.app.evaluate(({ ipcMain, webContents, app }) => {
  74  |       (globalThis as any).rightDropTrace = [];
  75  |       const watch = (contents: Electron.WebContents) => contents.on('before-input-event', (_event, value) => {
  76  |         if (value.key === 'Escape') (globalThis as any).rightDropTrace.push({ at: Date.now(), contents: contents.id, key: value });
  77  |       });
  78  |       for (const contents of webContents.getAllWebContents()) watch(contents);
  79  |       app.on('web-contents-created', (_event, contents) => watch(contents));
  80  |       for (const channel of ['tab-drag-surface:event', 'tabs:drag-target', 'tabs:detach-to-window', 'browser:tab-drag-guide']) {
  81  |         ipcMain.on(channel, (_event, ...args) => (globalThis as any).rightDropTrace.push({ at: Date.now(), channel, args }));
  82  |       }
  83  |     });
  84  |     const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
  85  |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  86  |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  87  |     }, point);
  88  |     for (let round = 0; round < 12; round++) {
  89  |       if (round === 6) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
  90  |       const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
  91  |       const from = await toScreen({ x: box.x + 35 + round % 2 * 30, y: box.y + box.height / 2 });
  92  |       const center = await toScreen({ x: body.x + body.width / 2, y: body.y + body.height / 2 });
  93  |       const right = await toScreen({ x: body.x + body.width - (round % 2 ? 1 : 20), y: body.y + body.height / 2 });
  94  |       const windowBounds = await owner.evaluate(window => window.getBounds());
  95  |       await input({ pointer: [from], button: 'down' });
  96  |       await input({ pointer: [{ x: from.x + 20, y: from.y + 15 }, center] });
  97  |       expect(await owner.evaluate(window => window.getBounds())).toEqual(windowBounds);
  98  |       expect(await owner.evaluate(window => window.isResizable())).toBe(process.env.SETDOWN_TEST_DISPLAY === 'xwayland');
  99  |       if (process.env.SETDOWN_TEST_DISPLAY === 'xwayland') expect(await owner.evaluate(window => window.isMaximized())).toBe(true);
  100 |       // Release at the right edge immediately: waiting for the guide first
  101 |       // masks stale center-guide ownership in native event delivery.
  102 |       await input({ pointer: [right], pointerIntervalMs: 0, button: 'up' });
  103 |       await expect(f.page.locator('.editor-group'), `right-edge split, round ${round}`).toHaveCount(2);
  104 |       await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  105 |       expect(await owner.evaluate(window => window.isResizable())).toBe(true);
  106 |       expect((await tab.boundingBox())!.x).toBeGreaterThan(body.x + body.width * .45);
  107 |       // Return the tab for the next independent OS gesture.
  108 |       const data = await f.page.evaluateHandle(() => new DataTransfer());
  109 |       await tab.dispatchEvent('dragstart', { dataTransfer: data });
  110 |       const target = f.page.locator('.tab-strip').first(), strip = (await target.boundingBox())!;
  111 |       const point = { dataTransfer: data, clientX: strip.x + 10, clientY: strip.y + strip.height / 2 };
  112 |       await target.dispatchEvent('dragover', point); await target.dispatchEvent('drop', point);
  113 |       await data.dispose();
  114 |       await expect(f.page.locator('.editor-group')).toHaveCount(1);
  115 |     }
  116 |     for (const resizable of [true, false]) {
  117 |       await owner.evaluate((window, value) => window.setResizable(value), resizable);
  118 |       await f.app.evaluate(({ webContents }, resizable) => (globalThis as any).rightDropTrace.push({
  119 |         cancellation: resizable, focused: webContents.getFocusedWebContents()?.id,
  120 |       }), resizable);
  121 |       const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
  122 |       const from = await toScreen({ x: box.x + (resizable ? 40 : 95), y: box.y + box.height / 2 });
  123 |       await input({ pointer: [from], button: 'down' });
  124 |       await input({ pointer: [{ x: from.x + 20, y: from.y + 15 },
  125 |         await toScreen({ x: body.x + body.width - 1, y: body.y + body.height / 2 })] });
  126 |       await expect(f.page.locator('.group-drop-overlay')).toBeVisible();
  127 |       await input({ keys: ['Escape'] });
  128 |       await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  129 |       await input({ button: 'up' });
  130 |       await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  131 |       expect(await owner.evaluate(window => window.isResizable())).toBe(resizable);
  132 |       await expect(f.page.locator('.editor-group')).toHaveCount(1);
  133 |     }
  134 |     await owner.dispose();
  135 |   } finally {
  136 |     await writeFile(test.info().outputPath('right-drop-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).rightDropTrace), null, 2));
  137 |     await input({ keys: ['Escape'] }); await input({ button: 'up' });
  138 |     await f.dispose(); await compositor?.close();
```
