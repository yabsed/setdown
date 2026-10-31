# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tab-drag.spec.ts >> maximized document drags prioritize both side edges and never open a window
- Location: test/wayland/tab-drag.spec.ts:14:1

# Error details

```
Error: expect(locator).toBeHidden() failed

Locator:  locator('.group-drop-overlay')
Expected: hidden
Received: visible
Timeout:  5000ms

Call log:
  - Expect "toBeHidden" locator('.group-drop-overlay') with timeout 5000ms
  - waiting for locator('.group-drop-overlay')
    14 × locator resolved to <div class="group-drop-overlay"></div>
       - unexpected value "visible"

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
  12  | for (const mode of ['maximized', 'fullscreen'] as const)
  13  | for (const moving of ['web', 'document'] as const)
  14  | test(`${mode} ${moving} drags prioritize both side edges and never open a window`, async () => {
  15  |   const input = await waylandInput();
  16  |   const f = await fixture(moving === 'document').catch(async error => { await input.close(); throw error; });
  17  |   try {
  18  |     if (moving === 'web') {
  19  |       await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  20  |       await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  21  |     } else await f.page.locator('.new-tab-button').click();
  22  |     const tab = f.page.getByRole('tab', { name: moving === 'web' ? /Second page/ : /notes.md/ });
  23  |     await tab.click();
  24  |     await expect(tab).toHaveAttribute('aria-selected', 'true');
  25  |     const owner = await f.app.browserWindow(f.page);
  26  |     await owner.evaluate((window, mode) => new Promise<void>(resolve => {
  27  |       window.once(mode === 'fullscreen' ? 'enter-full-screen' : 'maximize', () => resolve());
  28  |       if (mode === 'fullscreen') window.setFullScreen(true); else window.maximize();
  29  |     }), mode);
  30  |     await expect.poll(() => owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
  31  |     await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(1920);
  32  |     await focusApplication(f.app);
  33  |     await f.app.evaluate(({ app, ipcMain }) => {
  34  |       (globalThis as any).fullscreenDragTrace = [];
  35  |       (globalThis as any).dragCreatedWindows = 0;
  36  |       app.on('browser-window-created', () => (globalThis as any).dragCreatedWindows++);
  37  |       for (const channel of ['tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event'])
  38  |         ipcMain.on(channel, (_event, value) => (globalThis as any).fullscreenDragTrace.push({ channel, value }));
  39  |     });
  40  |     const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
  41  |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  42  |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  43  |     }, point);
  44  |     const overlay = f.page.locator('.group-drop-overlay');
  45  |     for (const [round, placement] of ['left-top', 'right-top', 'left-bottom', 'right-bottom', 'fast-right', 'center', 'escape'].entries()) {
  46  |       if (round === 2) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
  47  |       const bounds = await owner.evaluate(window => window.getBounds());
  48  |       const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
  49  |       const from = await toScreen({ x: box.x + 40 + round % 2 * 20, y: box.y + box.height / 2 });
  50  |       await input.send({ pointer: [from], button: 'down' });
  51  |       await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }] });
  52  |       const vertical = placement.endsWith('top') || placement.endsWith('bottom');
  53  |       const y = body.y + body.height * (placement.endsWith('top') ? .1 : placement.endsWith('bottom') ? .9 : .5);
  54  |       await input.send({ pointer: [await toScreen({ x: body.x + body.width / 2, y })] });
  55  |       if (vertical) {
  56  |         await expect(overlay).toBeVisible();
  57  |         expect((await overlay.boundingBox())!.height).toBeCloseTo(body.height / 2, 0);
> 58  |       } else await expect(overlay).toBeHidden();
      |                                    ^ Error: expect(locator).toBeHidden() failed
  59  |       const left = placement.startsWith('left');
  60  |       const edge = await toScreen({ x: body.x + (left ? 1 : body.width - 1), y });
  61  |       if (placement === 'fast-right') {
  62  |         // No guide wait may hide the native center-to-edge release race.
  63  |         await input.send({ pointer: [edge], pointerIntervalMs: 0, button: 'up' });
  64  |       } else {
  65  |         if (placement !== 'center') {
  66  |           await input.send({ pointer: [edge] });
  67  |           await expect(overlay).toBeVisible();
  68  |           const guide = (await overlay.boundingBox())!;
  69  |           expect(guide.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  70  |           expect(guide.width).toBeCloseTo(body.width / 2, 0);
  71  |           expect(guide.height).toBeCloseTo(body.height, 0);
  72  |         }
  73  |         if (placement === 'escape') await input.send({ keys: ['Escape'] });
  74  |         await input.send({ button: 'up' });
  75  |       }
  76  |       const split = placement !== 'center' && placement !== 'escape';
  77  |       await expect(f.page.locator('.editor-group')).toHaveCount(split ? 2 : 1);
  78  |       await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  79  |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  80  |       expect(await f.app.evaluate(() => (globalThis as any).dragCreatedWindows)).toBe(0);
  81  |       expect(await owner.evaluate(window => window.getBounds())).toEqual(bounds);
  82  |       expect(await owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
  83  |       if (split) {
  84  |         const moved = (await f.page.locator('.editor-group').filter({ has: tab }).boundingBox())!;
  85  |         expect(moved.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  86  |         // Restore one group between independent native gestures.
  87  |         const other = f.page.locator('.editor-group').filter({ hasNot: tab }).locator('.tab-strip');
  88  |         const strip = (await other.boundingBox())!;
  89  |         const data = await f.page.evaluateHandle(() => new DataTransfer());
  90  |         await tab.dispatchEvent('dragstart', { dataTransfer: data });
  91  |         const point = { dataTransfer: data, clientX: strip.x + 10, clientY: strip.y + strip.height / 2 };
  92  |         await other.dispatchEvent('dragover', point); await other.dispatchEvent('drop', point); await data.dispose();
  93  |         await expect(f.page.locator('.editor-group')).toHaveCount(1);
  94  |       }
  95  |     }
  96  |     expect(f.errors).toEqual([]);
  97  |     await owner.dispose();
  98  |   } finally {
  99  |     await writeFile(test.info().outputPath('fullscreen-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).fullscreenDragTrace ?? []), null, 2));
  100 |     await input.send({ keys: ['Escape'], button: 'up' });
  101 |     await f.page.screenshot({ path: test.info().outputPath('final.png') }).catch(() => {});
  102 |     await f.dispose(); await input.close();
  103 |   }
  104 | });
  105 | 
  106 | const processFlag = (status: string, name: string) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)$`, 'm'))?.[1]);
  107 | if (compatibility) for (const inheritedRestriction of [false, true])
  108 | test(`default startup preserves document, terminal privileges and renderer sandbox on XWayland (inherited restriction: ${inheritedRestriction})`, async () => {
  109 |   expect(processFlag(await readFile('/proc/self/status', 'utf8'), 'NoNewPrivs'),
  110 |     'Run from an unrestricted parent to detect accidentally added restrictions.').toBe(0);
  111 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-display-startup-'));
  112 |   const profile = path.join(root, 'profile'), file = path.join(root, 'startup 문서 with spaces.md');
  113 |   await writeFile(file, '# Startup survives backend selection\n');
  114 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  115 |   const packaged = process.env.SETDOWN_TEST_PACKAGED_EXECUTABLE;
  116 |   const executable = packaged ?? createRequire(import.meta.url)('electron') as string;
  117 |   const launchArgs = ['--enable-automation', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  118 |     ...(packaged ? [] : ['.']), file];
  119 |   // A pre-existing restriction must survive; the handoff must never bypass it.
  120 |   const child = spawn(inheritedRestriction ? 'setpriv' : executable,
  121 |     inheritedRestriction ? ['--no-new-privs', executable, ...launchArgs] : launchArgs,
  122 |     { env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') }, stdio: ['ignore', 'ignore', 'pipe'] });
  123 |   let stderr = '';
  124 |   child.stderr.on('data', chunk => { stderr += String(chunk); });
  125 |   let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  126 |   let browserPid: number | undefined;
  127 |   try {
  128 |     await expect.poll(() => child.exitCode).toBe(0);
  129 |     const endpoint = async () => {
  130 |       const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
  131 |       if (!port) return '';
  132 |       return fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json())
  133 |         .then(data => data.webSocketDebuggerUrl as string).catch(() => '');
  134 |     };
  135 |     await expect.poll(endpoint).toMatch(/^ws:\/\//);
  136 |     browser = await chromium.connectOverCDP(await endpoint(), { timeout: 10_000 });
  137 |     const session = await browser.newBrowserCDPSession();
  138 |     const processes = await session.send('SystemInfo.getProcessInfo');
  139 |     browserPid = processes.processInfo.find(process => process.type === 'browser')!.id;
  140 |     await expect.poll(() => browser!.contexts()[0].pages().map(page => page.url())).toContainEqual(expect.stringContaining('/dist/index.html'));
  141 |     const page = browser.contexts()[0].pages().find(page => page.url().includes('/dist/index.html'))!;
  142 |     await expect(page.getByRole('tab', { name: /startup 문서 with spaces.md/ })).toBeVisible();
  143 |     expect(browser.contexts()[0].pages().filter(page => page.url().startsWith('data:text/html;charset=utf-8,'))).toHaveLength(0);
  144 |     expect(browserPid).not.toBe(child.pid);
  145 |     // Linux process titles can overwrite /proc/pid/cmdline. Query Chromium's
  146 |     // actual startup switches, including the backend selected before main.
  147 |     const args = (await session.send('Browser.getBrowserCommandLine')).arguments;
  148 |     expect(args.filter(arg => arg === '--ozone-platform=x11')).toHaveLength(1);
  149 |     expect(args).toContain(file);
  150 |     const mainStatus = await readFile(`/proc/${browserPid}/status`, 'utf8');
  151 |     const expectedFlag = Number(inheritedRestriction);
  152 |     expect(processFlag(mainStatus, 'NoNewPrivs')).toBe(expectedFlag);
  153 |     await page.locator('.new-terminal-tab-button').click();
  154 |     const terminal = page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
  155 |     await expect(terminal).toBeFocused();
  156 |     // $$ reads the actual interactive shell, not a test process or grep child.
  157 |     await terminal.pressSequentially('cat /proc/$$/status > shell-status.txt');
  158 |     await terminal.press('Enter');
```