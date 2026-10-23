# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace/tab-detach.spec.ts >> native drag return the window after showing an insertion guide
- Location: test/e2e/workspace/tab-detach.spec.ts:18:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('.tab-name')
Timeout: 5000ms
- Expected  - 1
+ Received  + 1

  Array [
-   "Untitled 2.md",
    "Untitled.md",
+   "Untitled 2.md",
  ]

Call log:
  - Expect "toHaveText" locator('.tab-name') with timeout 5000ms
  - waiting for locator('.tab-name')
    14 × locator resolved to 2 elements

```

# Test source

```ts
  1   | import { electron } from '../../support/electron/electron-app';
  2   | import { expect, test } from '@playwright/test';
  3   | import { mkdtemp, rm, writeFile } from 'node:fs/promises';
  4   | import os from 'node:os';
  5   | import path from 'node:path';
  6   | import { previews } from '../../support/preview/preview-view';
  7   | import { disposeApplication, focusApplication } from '../../support/electron/electron-app';
  8   | import { nativeInput } from '../../support/electron/native-input';
  9   | 
  10  | async function shellWindows(application: Awaited<ReturnType<typeof electron.launch>>) {
  11  |   const candidates = application.windows();
  12  |   const matches = await Promise.all(candidates.map(async (page) =>
  13  |     await page.locator('#app').count().catch(() => 0) > 0 ? page : null));
  14  |   return matches.filter((page): page is NonNullable<typeof page> => page !== null);
  15  | }
  16  | 
  17  | for (const outcome of ['above', 'left', 'right', 'below', 'cancel', 'return'] as const)
  18  | test(`native drag ${outcome} the window after showing an insertion guide`, async () => {
  19  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-native-detach-'));
  20  |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  21  |   const app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: root } });
  22  |   const page = await app.firstWindow();
  23  |   try {
  24  |     await focusApplication(app);
  25  |     const nativeWindow = await app.browserWindow(page);
  26  |     await nativeWindow.evaluate(window => window.setBounds({ x: 400, y: 300, width: 900, height: 650 }));
  27  |     await app.evaluate(({ ipcMain, BrowserWindow }) => {
  28  |       const inputs: unknown[] = [];
  29  |       (globalThis as any).dragInputs = inputs;
  30  |       BrowserWindow.getAllWindows()[0].webContents.on('before-input-event', (_event, input) => inputs.push(input));
  31  |       for (const name of ['tabs:detach-to-window', 'tabs:cancel-transfer']) ipcMain.on(name, (_event, value) => inputs.push({ name, value }));
  32  |     });
  33  |     await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-document')!.click());
  34  |     await page.locator('.new-tab-button').click();
  35  |     await expect(page.locator('.tab-name')).toHaveText(['Untitled.md', 'Untitled 2.md']);
  36  |     await page.evaluate(() => {
  37  |       const events: unknown[] = [];
  38  |       for (const type of ['dragstart', 'drag', 'dragover', 'dragleave', 'drop', 'dragend']) {
  39  |         window.addEventListener(type, event => {
  40  |           const e = event as DragEvent;
  41  |           events.push({ type, x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY,
  42  |             effect: e.dataTransfer?.dropEffect, buttons: e.buttons, related: (e.relatedTarget as Element | null)?.className ?? null,
  43  |             window: { x: window.screenX, y: window.screenY, width: innerWidth, height: innerHeight } });
  44  |         }, true);
  45  |       }
  46  |       (window as typeof window & { detachEvents: unknown[] }).detachEvents = events;
  47  |     });
  48  |     const box = (await page.locator('.document-tab').last().boundingBox())!;
  49  |     const from = await nativeWindow.evaluate((window, box) => {
  50  |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  51  |       return { x: bounds.x + (box.x + box.width / 2) * zoom, y: bounds.y + (box.y + box.height / 2) * zoom };
  52  |     }, box);
  53  |     await nativeInput({ pointer: [from], button: 'down' });
  54  |     await nativeInput({ pointer: [10, 20, 30].map(dx => ({ x: from.x + dx, y: from.y })) });
  55  |     await expect(page.locator('.tab-drop-indicator')).toBeVisible();
  56  |     // Jump straight out of the strip, as in a quick tear-off. No synthetic DOM
  57  |     // drag events stand in for the OS boundary, release, or cancellation.
  58  |     const outside = outcome === 'left' ? { x: 280, y: from.y }
  59  |       : outcome === 'right' ? { x: 1420, y: from.y }
  60  |       : { x: from.x + 30, y: outcome === 'below' ? 1030 : 180 };
  61  |     await nativeInput({ pointer: [outside] });
  62  |     if (outcome === 'cancel') await nativeInput({ keys: ['Escape'] });
  63  |     if (outcome === 'return') {
  64  |       const first = (await page.locator('.document-tab').first().boundingBox())!;
  65  |       const back = await nativeWindow.evaluate((window, box) => {
  66  |         const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  67  |         return { x: bounds.x + (box.x + 30) * zoom, y: bounds.y + (box.y + box.height / 2) * zoom };
  68  |       }, first);
  69  |       await nativeInput({ pointer: [1, 2, 3, 4].map(step => ({
  70  |         x: outside.x + (back.x - outside.x) * step / 4, y: outside.y + (back.y - outside.y) * step / 4,
  71  |       })) });
  72  |       await expect(page.locator('.tab-drop-indicator')).toBeVisible();
  73  |       await expect.poll(async () => (await page.locator('.tab-drop-indicator').boundingBox())!.x).toBeCloseTo(first.x - 1, 0);
  74  |     }
  75  |     await nativeInput({ button: 'up' });
  76  |     await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  77  |     if (outcome === 'cancel' || outcome === 'return') {
> 78  |       await expect(page.locator('.tab-name')).toHaveText(outcome === 'cancel'
      |                                               ^ Error: expect(locator).toHaveText(expected) failed
  79  |         ? ['Untitled.md', 'Untitled 2.md'] : ['Untitled 2.md', 'Untitled.md']);
  80  |       await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  81  |     } else {
  82  |       await expect.poll(async () => (await shellWindows(app)).length).toBe(2);
  83  |       await expect(page.locator('.tab-name')).toHaveText(['Untitled.md']);
  84  |       const detached = (await shellWindows(app)).find(candidate => candidate !== page)!;
  85  |       await expect(detached.locator('.tab-name')).toHaveText(['Untitled 2.md']);
  86  |     }
  87  |     await nativeWindow.dispose();
  88  |   } finally {
  89  |     await nativeInput({ button: 'up' });
  90  |     const events = await page.evaluate(() => (window as typeof window & { detachEvents?: unknown[] }).detachEvents).catch(() => []);
  91  |     await writeFile(test.info().outputPath('drag-events.json'), JSON.stringify(events, null, 2));
  92  |     await writeFile(test.info().outputPath('native-inputs.json'), JSON.stringify(await app.evaluate(() => (globalThis as any).dragInputs), null, 2));
  93  |     await page.screenshot({ path: test.info().outputPath('source-window.png') }).catch(() => {});
  94  |     await disposeApplication(app);
  95  |     await rm(root, { recursive: true, force: true });
  96  |   }
  97  | });
  98  | 
  99  | for (const outcome of ['detach', 'cancel', 'return', 'split', 'sole'] as const)
  100 | test(`source group center clears the guide during native drag: ${outcome}`, async () => {
  101 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-center-detach-'));
  102 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  103 |   const app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: root } });
  104 |   const page = await app.firstWindow();
  105 |   try {
  106 |     await focusApplication(app);
  107 |     const window = await app.browserWindow(page);
  108 |     await window.evaluate(window => window.setBounds({ x: 200, y: 150, width: 1000, height: 700 }));
  109 |     await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-document')!.click());
  110 |     if (outcome !== 'sole') await page.locator('.new-tab-button').click();
  111 |     const tab = page.locator('.document-tab').last(), tabName = await tab.locator('.tab-name').innerText();
  112 |     const toScreen = (point: { x: number; y: number }) => window.evaluate((window, point) => {
  113 |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  114 |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  115 |     }, point);
  116 |     const box = (await tab.boundingBox())!;
  117 |     const from = await toScreen({ x: box.x + 40, y: box.y + box.height / 2 });
  118 |     await nativeInput({ pointer: [from], button: 'down' });
  119 |     await nativeInput({ pointer: [10, 20, 30].map(dx => ({ x: from.x + dx, y: from.y })) });
  120 |     await expect(page.locator('.tab-drop-indicator')).toBeVisible();
  121 |     const body = (await page.locator('.group-body').boundingBox())!;
  122 |     const edge = await toScreen({ x: body.x + body.width * .98, y: body.y + body.height / 2 });
  123 |     if (outcome !== 'sole') {
  124 |       await nativeInput({ pointer: [edge] });
  125 |       await expect(page.locator('.group-drop-overlay')).toBeVisible();
  126 |     }
  127 |     await nativeInput({ pointer: [await toScreen({ x: body.x + body.width / 2, y: body.y + body.height / 2 })] });
  128 |     // Feedback must disappear before release, while the OS drag is still held.
  129 |     await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  130 |     await expect(page.locator('.group-drop-overlay')).toBeHidden();
  131 |     await page.screenshot({ path: test.info().outputPath('center-no-guide.png') });
  132 |     if (outcome === 'cancel') await nativeInput({ keys: ['Escape'] });
  133 |     if (outcome === 'return') {
  134 |       const first = (await page.locator('.document-tab').first().boundingBox())!;
  135 |       await nativeInput({ pointer: [await toScreen({ x: first.x + 3, y: first.y + first.height / 2 })] });
  136 |       await expect(page.locator('.tab-drop-indicator')).toBeVisible();
  137 |     }
  138 |     if (outcome === 'split') {
  139 |       await nativeInput({ pointer: [edge] });
  140 |       await expect(page.locator('.group-drop-overlay')).toBeVisible();
  141 |     }
  142 |     await nativeInput({ button: 'up' });
  143 |     if (outcome === 'detach' || outcome === 'sole') {
  144 |       await expect.poll(async () => (await shellWindows(app)).some(candidate => candidate !== page)).toBe(true);
  145 |       const detached = (await shellWindows(app)).find(candidate => candidate !== page)!;
  146 |       await expect(detached.locator('.tab-name')).toHaveText([tabName]);
  147 |       if (outcome === 'sole') {
  148 |         await expect.poll(() => page.isClosed()).toBe(true);
  149 |         await expect.poll(async () => (await shellWindows(app)).length).toBe(1);
  150 |       } else {
  151 |         await expect(page.locator('.tab-name')).toHaveText(['Untitled.md']);
  152 |         await expect.poll(async () => (await shellWindows(app)).length).toBe(2);
  153 |       }
  154 |     } else {
  155 |       await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  156 |       await expect(page.locator('.editor-group')).toHaveCount(outcome === 'split' ? 2 : 1);
  157 |       await expect(page.locator('.tab-name')).toHaveText(outcome === 'return'
  158 |         ? ['Untitled 2.md', 'Untitled.md'] : ['Untitled.md', 'Untitled 2.md']);
  159 |     }
  160 |     if (outcome !== 'sole') {
  161 |       await expect(page.locator('.group-drop-overlay')).toBeHidden();
  162 |       await expect(page.locator('.tab-drop-indicator')).toBeHidden();
  163 |       await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  164 |     }
  165 |     await window.dispose();
  166 |   } finally {
  167 |     await nativeInput({ button: 'up' });
  168 |     await disposeApplication(app); await rm(root, { recursive: true, force: true });
  169 |   }
  170 | });
  171 | 
  172 | for (const dropArea of ['body', 'tab strip'] as const) test(`detaching a tab restores its preview at the same position via ${dropArea}`, async () => {
  173 |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-e2e-'));
  174 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  175 |   const application = await electron.launch({
  176 |     args: ['.', path.resolve('test/fixtures/sample.md')],
  177 |     env: { ...environment, XDG_CONFIG_HOME: configRoot },
  178 |   });
```