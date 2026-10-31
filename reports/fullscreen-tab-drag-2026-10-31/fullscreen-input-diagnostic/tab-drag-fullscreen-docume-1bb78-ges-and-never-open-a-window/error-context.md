# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tab-drag.spec.ts >> fullscreen document drags prioritize both side edges and never open a window
- Location: test/wayland/tab-drag.spec.ts:14:1

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
        - tab "notes.md ×" [selected]:
          - text: notes.md
          - button "×"
        - tab "Untitled.md ×":
          - text: Untitled.md
          - button "×"
      - button "New document"
      - button "New web tab"
      - button "New terminal"
    - button "Back" [disabled]: ←
    - button "Forward" [disabled]: →
    - button "Reload file": ↻
    - textbox "Address or file path":
      - /placeholder: Search or enter an address
      - text: file:///tmp/setdown-browser-9mouUW/notes.md
    - button "Open outline"
    - button "Switch to Editor"
    - group "Text zoom":
      - button "Zoom text out"
      - button "Reset text zoom": 100%
      - button "Zoom text in"
  - region "Rendered Markdown"
- alert
- alert
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
  40  |     await f.page.evaluate(() => {
  41  |       (window as any).fullscreenDragEvents = [];
  42  |       for (const type of ['pointerdown', 'pointerup', 'dragstart', 'dragend']) window.addEventListener(type, event => {
  43  |         const e = event as MouseEvent;
  44  |         (window as any).fullscreenDragEvents.push({ type, x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.className });
  45  |       }, true);
  46  |     });
  47  |     const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
  48  |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  49  |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  50  |     }, point);
  51  |     const overlay = f.page.locator('.group-drop-overlay');
  52  |     for (const [round, placement] of ['left-top', 'right-top', 'left-bottom', 'right-bottom', 'fast-right', 'center', 'escape'].entries()) {
  53  |       if (round === 2) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
  54  |       const bounds = await owner.evaluate(window => window.getBounds());
  55  |       const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
  56  |       const from = await toScreen({ x: box.x + 40 + round % 2 * 20, y: box.y + box.height / 2 });
  57  |       await owner.evaluate((window, details) => (globalThis as any).fullscreenDragTrace.push({
  58  |         ...details, contentBounds: window.getContentBounds(),
  59  |       }), { placement, bounds, from, box, body });
  60  |       await input.send({ pointer: [from], button: 'down' });
  61  |       await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }] });
  62  |       const vertical = placement.endsWith('top') || placement.endsWith('bottom');
  63  |       const y = body.y + body.height * (placement.endsWith('top') ? .1 : placement.endsWith('bottom') ? .9 : .5);
  64  |       await input.send({ pointer: [await toScreen({ x: body.x + body.width / 2, y })] });
  65  |       if (vertical) {
> 66  |         await expect(overlay).toBeVisible();
      |                               ^ Error: expect(locator).toBeVisible() failed
  67  |         expect((await overlay.boundingBox())!.height).toBeCloseTo(body.height / 2, 0);
  68  |       } else await expect(overlay).toBeHidden();
  69  |       const left = placement.startsWith('left');
  70  |       const edge = await toScreen({ x: body.x + (left ? 1 : body.width - 1), y });
  71  |       if (placement === 'fast-right') {
  72  |         // No guide wait may hide the native center-to-edge release race.
  73  |         await input.send({ pointer: [edge], pointerIntervalMs: 0, button: 'up' });
  74  |       } else {
  75  |         if (placement !== 'center') {
  76  |           await input.send({ pointer: [edge] });
  77  |           await expect(overlay).toBeVisible();
  78  |           const guide = (await overlay.boundingBox())!;
  79  |           expect(guide.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  80  |           expect(guide.width).toBeCloseTo(body.width / 2, 0);
  81  |           expect(guide.height).toBeCloseTo(body.height, 0);
  82  |         }
  83  |         if (placement === 'escape') await input.send({ keys: ['Escape'] });
  84  |         await input.send({ button: 'up' });
  85  |       }
  86  |       const split = placement !== 'center' && placement !== 'escape';
  87  |       await expect(f.page.locator('.editor-group')).toHaveCount(split ? 2 : 1);
  88  |       await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  89  |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  90  |       expect(await f.app.evaluate(() => (globalThis as any).dragCreatedWindows)).toBe(0);
  91  |       expect(await owner.evaluate(window => window.getBounds())).toEqual(bounds);
  92  |       expect(await owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
  93  |       if (split) {
  94  |         const moved = (await f.page.locator('.editor-group').filter({ has: tab }).boundingBox())!;
  95  |         expect(moved.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  96  |         // Restore one group between independent native gestures.
  97  |         const other = f.page.locator('.editor-group').filter({ hasNot: tab }).locator('.tab-strip');
  98  |         const strip = (await other.boundingBox())!;
  99  |         const data = await f.page.evaluateHandle(() => new DataTransfer());
  100 |         await tab.dispatchEvent('dragstart', { dataTransfer: data });
  101 |         const point = { dataTransfer: data, clientX: strip.x + 10, clientY: strip.y + strip.height / 2 };
  102 |         await other.dispatchEvent('dragover', point); await other.dispatchEvent('drop', point); await data.dispose();
  103 |         await expect(f.page.locator('.editor-group')).toHaveCount(1);
  104 |       }
  105 |     }
  106 |     expect(f.errors).toEqual([]);
  107 |     await owner.dispose();
  108 |   } finally {
  109 |     await writeFile(test.info().outputPath('fullscreen-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).fullscreenDragTrace ?? []), null, 2));
  110 |     await writeFile(test.info().outputPath('fullscreen-drag-events.json'), JSON.stringify(await f.page.evaluate(() => (window as any).fullscreenDragEvents ?? []), null, 2));
  111 |     await input.send({ keys: ['Escape'], button: 'up' });
  112 |     await f.page.screenshot({ path: test.info().outputPath('final.png') }).catch(() => {});
  113 |     await f.dispose(); await input.close();
  114 |   }
  115 | });
  116 | 
  117 | const processFlag = (status: string, name: string) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)$`, 'm'))?.[1]);
  118 | if (compatibility) for (const inheritedRestriction of [false, true])
  119 | test(`default startup preserves document, terminal privileges and renderer sandbox on XWayland (inherited restriction: ${inheritedRestriction})`, async () => {
  120 |   expect(processFlag(await readFile('/proc/self/status', 'utf8'), 'NoNewPrivs'),
  121 |     'Run from an unrestricted parent to detect accidentally added restrictions.').toBe(0);
  122 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-display-startup-'));
  123 |   const profile = path.join(root, 'profile'), file = path.join(root, 'startup 문서 with spaces.md');
  124 |   await writeFile(file, '# Startup survives backend selection\n');
  125 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  126 |   const packaged = process.env.SETDOWN_TEST_PACKAGED_EXECUTABLE;
  127 |   const executable = packaged ?? createRequire(import.meta.url)('electron') as string;
  128 |   const launchArgs = ['--enable-automation', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  129 |     ...(packaged ? [] : ['.']), file];
  130 |   // A pre-existing restriction must survive; the handoff must never bypass it.
  131 |   const child = spawn(inheritedRestriction ? 'setpriv' : executable,
  132 |     inheritedRestriction ? ['--no-new-privs', executable, ...launchArgs] : launchArgs,
  133 |     { env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') }, stdio: ['ignore', 'ignore', 'pipe'] });
  134 |   let stderr = '';
  135 |   child.stderr.on('data', chunk => { stderr += String(chunk); });
  136 |   let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  137 |   let browserPid: number | undefined;
  138 |   try {
  139 |     await expect.poll(() => child.exitCode).toBe(0);
  140 |     const endpoint = async () => {
  141 |       const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
  142 |       if (!port) return '';
  143 |       return fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json())
  144 |         .then(data => data.webSocketDebuggerUrl as string).catch(() => '');
  145 |     };
  146 |     await expect.poll(endpoint).toMatch(/^ws:\/\//);
  147 |     browser = await chromium.connectOverCDP(await endpoint(), { timeout: 10_000 });
  148 |     const session = await browser.newBrowserCDPSession();
  149 |     const processes = await session.send('SystemInfo.getProcessInfo');
  150 |     browserPid = processes.processInfo.find(process => process.type === 'browser')!.id;
  151 |     await expect.poll(() => browser!.contexts()[0].pages().map(page => page.url())).toContainEqual(expect.stringContaining('/dist/index.html'));
  152 |     const page = browser.contexts()[0].pages().find(page => page.url().includes('/dist/index.html'))!;
  153 |     await expect(page.getByRole('tab', { name: /startup 문서 with spaces.md/ })).toBeVisible();
  154 |     expect(browser.contexts()[0].pages().filter(page => page.url().startsWith('data:text/html;charset=utf-8,'))).toHaveLength(0);
  155 |     expect(browserPid).not.toBe(child.pid);
  156 |     // Linux process titles can overwrite /proc/pid/cmdline. Query Chromium's
  157 |     // actual startup switches, including the backend selected before main.
  158 |     const args = (await session.send('Browser.getBrowserCommandLine')).arguments;
  159 |     expect(args.filter(arg => arg === '--ozone-platform=x11')).toHaveLength(1);
  160 |     expect(args).toContain(file);
  161 |     const mainStatus = await readFile(`/proc/${browserPid}/status`, 'utf8');
  162 |     const expectedFlag = Number(inheritedRestriction);
  163 |     expect(processFlag(mainStatus, 'NoNewPrivs')).toBe(expectedFlag);
  164 |     await page.locator('.new-terminal-tab-button').click();
  165 |     const terminal = page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
  166 |     await expect(terminal).toBeFocused();
```