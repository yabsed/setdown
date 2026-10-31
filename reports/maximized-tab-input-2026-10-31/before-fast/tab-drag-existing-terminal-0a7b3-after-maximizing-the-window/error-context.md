# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tab-drag.spec.ts >> existing terminal and website split right after maximizing the window
- Location: test/wayland/tab-drag.spec.ts:12:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 864
Received:   8

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1   | import { chromium, expect, test, type Page } from '@playwright/test';
  2   | import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
  3   | import { spawn } from 'node:child_process';
  4   | import { createRequire } from 'node:module';
  5   | import path from 'node:path';
  6   | import os from 'node:os';
  7   | import { fixture } from '../support/browser/browser-fixture';
  8   | import { waylandInput } from '../support/electron/wayland-input';
  9   | import { focusApplication } from '../support/electron/electron-app';
  10  | 
  11  | const compatibility = process.env.SETDOWN_TEST_DISPLAY === 'xwayland';
  12  | test('existing terminal and website split right after maximizing the window', async () => {
  13  |   const input = await waylandInput();
  14  |   const f = await fixture(false).catch(async error => { await input.close(); throw error; });
  15  |   const trace: unknown[] = [];
  16  |   try {
  17  |     await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  18  |     await f.page.locator('.new-terminal-tab-button').click();
  19  |     const tab = f.page.getByRole('tab', { name: /Terminal 1/ });
  20  |     await expect(tab).toBeVisible();
  21  |     await f.page.getByRole('tab', { name: /Research page/ }).click();
  22  |     await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
  23  |     const owner = await f.app.browserWindow(f.page);
  24  |     const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
  25  |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  26  |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  27  |     }, point);
  28  |     await f.app.evaluate(({ ipcMain }) => {
  29  |       (globalThis as any).maximizedTrace = [];
  30  |       for (const channel of ['tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event', 'browser:tab-drag-guide'])
  31  |         ipcMain.on(channel, (_event, ...args) => (globalThis as any).maximizedTrace.push({ at: Date.now(), channel, args }));
  32  |     });
  33  |     await f.page.evaluate(() => {
  34  |       (window as any).maximizedEvents = [];
  35  |       for (const type of ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend', 'dragleave']) window.addEventListener(type, event => {
  36  |         const e = event as DragEvent;
  37  |         (window as any).maximizedEvents.push({ at: Date.now(), type, x: e.clientX, y: e.clientY,
  38  |           screenX: e.screenX, screenY: e.screenY, effect: e.dataTransfer?.dropEffect, trusted: e.isTrusted });
  39  |       }, true);
  40  |     });
  41  |     for (let round = -1; round < 12; round++) {
  42  |       if (round === 0) {
  43  |         await owner.evaluate(window => window.maximize());
  44  |         await expect.poll(() => owner.evaluate(window => window.isMaximized())).toBe(true);
  45  |         await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(1920);
  46  |         await input.send({ resetPointer: true });
  47  |       }
  48  |       const body = (await f.page.locator('.group-body').boundingBox())!, box = (await tab.boundingBox())!;
  49  |       const from = await toScreen({ x: box.x + 35 + round % 2 * 20, y: box.y + box.height / 2 });
  50  |       const y = body.y + body.height * (round % 2 ? .75 : .25);
  51  |       const center = await toScreen({ x: body.x + body.width * .5, y });
  52  |       const right = await toScreen({ x: body.x + body.width * (round % 3 ? .875 : .99), y });
  53  |       trace.push({ round, body, from, center, right });
  54  |       await input.send({ pointer: [from], button: 'down' });
  55  |       await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }, center] });
  56  |       await input.send({ pointer: [right], pointerIntervalMs: 0, button: 'up' });
  57  |       await expect(f.page.locator('.editor-group')).toHaveCount(2);
> 58  |       await expect.poll(async () => (await tab.boundingBox())!.x).toBeGreaterThan(body.x + body.width * .45);
      |                                                                   ^ Error: expect(received).toBeGreaterThan(expected)
  59  |       await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  60  |       expect(await owner.evaluate(window => window.isMaximized())).toBe(round >= 0);
  61  |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  62  |       const data = await f.page.evaluateHandle(() => new DataTransfer());
  63  |       const strip = f.page.locator('.editor-group').filter({ hasNot: tab }).locator('.tab-strip');
  64  |       const rect = (await strip.boundingBox())!;
  65  |       await tab.dispatchEvent('dragstart', { dataTransfer: data });
  66  |       const point = { dataTransfer: data, clientX: rect.x + 10, clientY: rect.y + rect.height / 2 };
  67  |       await strip.dispatchEvent('dragover', point); await strip.dispatchEvent('drop', point); await data.dispose();
  68  |       await expect(f.page.locator('.editor-group')).toHaveCount(1);
  69  |       await f.page.getByRole('tab', { name: /Research page/ }).click();
  70  |     }
  71  |     expect(f.errors).toEqual([]);
  72  |     await owner.dispose();
  73  |   } finally {
  74  |     await writeFile(test.info().outputPath('maximized-trace.json'), JSON.stringify({ steps: trace,
  75  |       ipc: await f.app.evaluate(() => (globalThis as any).maximizedTrace ?? []),
  76  |       dom: await f.page.evaluate(() => (window as any).maximizedEvents ?? []),
  77  |     }, null, 2));
  78  |     await f.page.screenshot({ path: test.info().outputPath('maximized-final.png') }).catch(() => {});
  79  |     await input.send({ keys: ['Escape'], button: 'up' });
  80  |     await f.dispose(); await input.close();
  81  |   }
  82  | });
  83  | 
  84  | for (const mode of ['maximized', 'fullscreen'] as const)
  85  | for (const moving of ['web', 'document'] as const)
  86  | test(`${mode} ${moving} drags follow all eight split cells and never open a window`, async () => {
  87  |   const input = await waylandInput();
  88  |   const f = await fixture(false).catch(async error => { await input.close(); throw error; });
  89  |   try {
  90  |     const owner = await f.app.browserWindow(f.page);
  91  |     await owner.evaluate((window, mode) => new Promise<void>(resolve => {
  92  |       window.once(mode === 'fullscreen' ? 'enter-full-screen' : 'maximize', () => resolve());
  93  |       if (mode === 'fullscreen') window.setFullScreen(true); else window.maximize();
  94  |     }), mode);
  95  |     await expect.poll(() => owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
  96  |     await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(1920);
  97  |     await focusApplication(f.app);
  98  |     // Fullscreen entry can warp the cursor after the device was initialized.
  99  |     await input.send({ resetPointer: true });
  100 |     if (moving === 'web') {
  101 |       await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  102 |       await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  103 |     } else {
  104 |       await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), path.join(f.root, 'notes.md'));
  105 |       await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
  106 |       await f.page.locator('.new-tab-button').click();
  107 |     }
  108 |     const tab = f.page.getByRole('tab', { name: moving === 'web' ? /Second page/ : /notes.md/ });
  109 |     await tab.click();
  110 |     await expect(tab).toHaveAttribute('aria-selected', 'true');
  111 |     await f.app.evaluate(({ app, ipcMain }) => {
  112 |       (globalThis as any).fullscreenDragTrace = [];
  113 |       (globalThis as any).dragCreatedWindows = 0;
  114 |       app.on('browser-window-created', () => (globalThis as any).dragCreatedWindows++);
  115 |       for (const channel of ['tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event'])
  116 |         ipcMain.on(channel, (_event, value) => (globalThis as any).fullscreenDragTrace.push({ channel, value }));
  117 |     });
  118 |     await f.page.evaluate(() => {
  119 |       (window as any).fullscreenDragEvents = [];
  120 |       for (const type of ['pointerdown', 'pointerup', 'dragstart', 'dragend']) window.addEventListener(type, event => {
  121 |         const e = event as MouseEvent;
  122 |         (window as any).fullscreenDragEvents.push({ type, x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.className });
  123 |       }, true);
  124 |     });
  125 |     const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
  126 |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  127 |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  128 |     }, point);
  129 |     const overlay = f.page.locator('.group-drop-overlay');
  130 |     const placements = [
  131 |       { name: '1', x: .125, y: .25, direction: 'left' }, { name: '2', x: .375, y: .25, direction: 'up' },
  132 |       { name: '5', x: .625, y: .25, direction: 'up' }, { name: '6', x: .875, y: .25, direction: 'right' },
  133 |       { name: '3', x: .125, y: .75, direction: 'left' }, { name: '4', x: .375, y: .75, direction: 'down' },
  134 |       { name: '7', x: .625, y: .75, direction: 'down' }, { name: '8', x: .875, y: .75, direction: 'right' },
  135 |       { name: 'left-top', x: 0, y: .1, direction: 'left' }, { name: 'right-top', x: 1, y: .1, direction: 'right' },
  136 |       { name: 'left-bottom', x: 0, y: .9, direction: 'left' }, { name: 'right-bottom', x: 1, y: .9, direction: 'right' },
  137 |       { name: 'fast-right', x: 1, y: .5, direction: 'right' }, { name: 'center', x: .5, y: .55, direction: 'down' },
  138 |       { name: 'escape', x: 1, y: .5, direction: 'right' },
  139 |     ] as const;
  140 |     for (const [round, placement] of placements.entries()) {
  141 |       if (round === 2) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
  142 |       const bounds = await owner.evaluate(window => window.getBounds());
  143 |       const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
  144 |       const from = await toScreen({ x: box.x + 40 + round % 2 * 20, y: box.y + box.height / 2 });
  145 |       await owner.evaluate((window, details) => (globalThis as any).fullscreenDragTrace.push({
  146 |         ...details, contentBounds: window.getContentBounds(),
  147 |         children: window.contentView.children.map((view: Electron.View) => ({ bounds: view.getBounds(), visible: view.getVisible(),
  148 |           url: 'webContents' in view ? (view as Electron.WebContentsView).webContents.getURL() : '' })),
  149 |       }), { placement, bounds, from, box, body });
  150 |       await input.send({ pointer: [from], button: 'down' });
  151 |       if (compatibility) await f.app.evaluate(({ screen, BrowserWindow }) => (globalThis as any).fullscreenDragTrace.push({
  152 |         cursor: screen.getCursorScreenPoint(), focused: BrowserWindow.getFocusedWindow()?.id,
  153 |       }));
  154 |       await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }] });
  155 |       // Approach from the middle first so side cells must replace a vertical
  156 |       // guide immediately. At the center the grid selects the lower half.
  157 |       const y = body.y + body.height * placement.y;
  158 |       await input.send({ pointer: [await toScreen({ x: body.x + body.width / 2, y })] });
```