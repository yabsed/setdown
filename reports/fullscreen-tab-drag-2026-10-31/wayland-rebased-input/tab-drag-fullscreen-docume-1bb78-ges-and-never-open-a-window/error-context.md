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
      - text: file:///tmp/setdown-browser-YcpucH/notes.md
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
  33  |     // Fullscreen entry can warp the cursor after the device was initialized.
  34  |     await input.send({ resetPointer: true });
  35  |     await f.app.evaluate(({ app, ipcMain }) => {
  36  |       (globalThis as any).fullscreenDragTrace = [];
  37  |       (globalThis as any).dragCreatedWindows = 0;
  38  |       app.on('browser-window-created', () => (globalThis as any).dragCreatedWindows++);
  39  |       for (const channel of ['tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event'])
  40  |         ipcMain.on(channel, (_event, value) => (globalThis as any).fullscreenDragTrace.push({ channel, value }));
  41  |     });
  42  |     await f.page.evaluate(() => {
  43  |       (window as any).fullscreenDragEvents = [];
  44  |       for (const type of ['pointerdown', 'pointerup', 'dragstart', 'dragend']) window.addEventListener(type, event => {
  45  |         const e = event as MouseEvent;
  46  |         (window as any).fullscreenDragEvents.push({ type, x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.className });
  47  |       }, true);
  48  |     });
  49  |     const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
  50  |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  51  |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  52  |     }, point);
  53  |     const overlay = f.page.locator('.group-drop-overlay');
  54  |     for (const [round, placement] of ['left-top', 'right-top', 'left-bottom', 'right-bottom', 'fast-right', 'center', 'escape'].entries()) {
  55  |       if (round === 2) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
  56  |       const bounds = await owner.evaluate(window => window.getBounds());
  57  |       const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
  58  |       const from = await toScreen({ x: box.x + 40 + round % 2 * 20, y: box.y + box.height / 2 });
  59  |       await owner.evaluate((window, details) => (globalThis as any).fullscreenDragTrace.push({
  60  |         ...details, contentBounds: window.getContentBounds(),
  61  |       }), { placement, bounds, from, box, body });
  62  |       await input.send({ pointer: [from], button: 'down' });
  63  |       if (compatibility) await f.app.evaluate(({ screen, BrowserWindow }) => (globalThis as any).fullscreenDragTrace.push({
  64  |         cursor: screen.getCursorScreenPoint(), focused: BrowserWindow.getFocusedWindow()?.id,
  65  |       }));
  66  |       await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }] });
  67  |       const vertical = placement.endsWith('top') || placement.endsWith('bottom');
  68  |       const y = body.y + body.height * (placement.endsWith('top') ? .1 : placement.endsWith('bottom') ? .9 : .5);
  69  |       await input.send({ pointer: [await toScreen({ x: body.x + body.width / 2, y })] });
  70  |       if (vertical) {
> 71  |         await expect(overlay).toBeVisible();
      |                               ^ Error: expect(locator).toBeVisible() failed
  72  |         expect((await overlay.boundingBox())!.height).toBeCloseTo(body.height / 2, 0);
  73  |       } else await expect(overlay).toBeHidden();
  74  |       const left = placement.startsWith('left');
  75  |       const edge = await toScreen({ x: body.x + (left ? 1 : body.width - 1), y });
  76  |       if (placement === 'fast-right') {
  77  |         // No guide wait may hide the native center-to-edge release race.
  78  |         await input.send({ pointer: [edge], pointerIntervalMs: 0, button: 'up' });
  79  |       } else {
  80  |         if (placement !== 'center') {
  81  |           await input.send({ pointer: [edge] });
  82  |           await expect(overlay).toBeVisible();
  83  |           const guide = (await overlay.boundingBox())!;
  84  |           expect(guide.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  85  |           expect(guide.width).toBeCloseTo(body.width / 2, 0);
  86  |           expect(guide.height).toBeCloseTo(body.height, 0);
  87  |         }
  88  |         if (placement === 'escape') await input.send({ keys: ['Escape'] });
  89  |         await input.send({ button: 'up' });
  90  |       }
  91  |       const split = placement !== 'center' && placement !== 'escape';
  92  |       await expect(f.page.locator('.editor-group')).toHaveCount(split ? 2 : 1);
  93  |       await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  94  |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  95  |       expect(await f.app.evaluate(() => (globalThis as any).dragCreatedWindows)).toBe(0);
  96  |       expect(await owner.evaluate(window => window.getBounds())).toEqual(bounds);
  97  |       expect(await owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
  98  |       if (split) {
  99  |         const moved = (await f.page.locator('.editor-group').filter({ has: tab }).boundingBox())!;
  100 |         expect(moved.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  101 |         // Restore one group between independent native gestures.
  102 |         const other = f.page.locator('.editor-group').filter({ hasNot: tab }).locator('.tab-strip');
  103 |         const strip = (await other.boundingBox())!;
  104 |         const data = await f.page.evaluateHandle(() => new DataTransfer());
  105 |         await tab.dispatchEvent('dragstart', { dataTransfer: data });
  106 |         const point = { dataTransfer: data, clientX: strip.x + 10, clientY: strip.y + strip.height / 2 };
  107 |         await other.dispatchEvent('dragover', point); await other.dispatchEvent('drop', point); await data.dispose();
  108 |         await expect(f.page.locator('.editor-group')).toHaveCount(1);
  109 |       }
  110 |     }
  111 |     expect(f.errors).toEqual([]);
  112 |     await owner.dispose();
  113 |   } finally {
  114 |     await writeFile(test.info().outputPath('fullscreen-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).fullscreenDragTrace ?? []), null, 2));
  115 |     await writeFile(test.info().outputPath('fullscreen-drag-events.json'), JSON.stringify(await f.page.evaluate(() => (window as any).fullscreenDragEvents ?? []), null, 2));
  116 |     await input.send({ keys: ['Escape'], button: 'up' });
  117 |     await f.page.screenshot({ path: test.info().outputPath('final.png') }).catch(() => {});
  118 |     await f.dispose(); await input.close();
  119 |   }
  120 | });
  121 | 
  122 | const processFlag = (status: string, name: string) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)$`, 'm'))?.[1]);
  123 | if (compatibility) for (const inheritedRestriction of [false, true])
  124 | test(`default startup preserves document, terminal privileges and renderer sandbox on XWayland (inherited restriction: ${inheritedRestriction})`, async () => {
  125 |   expect(processFlag(await readFile('/proc/self/status', 'utf8'), 'NoNewPrivs'),
  126 |     'Run from an unrestricted parent to detect accidentally added restrictions.').toBe(0);
  127 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-display-startup-'));
  128 |   const profile = path.join(root, 'profile'), file = path.join(root, 'startup 문서 with spaces.md');
  129 |   await writeFile(file, '# Startup survives backend selection\n');
  130 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  131 |   const packaged = process.env.SETDOWN_TEST_PACKAGED_EXECUTABLE;
  132 |   const executable = packaged ?? createRequire(import.meta.url)('electron') as string;
  133 |   const launchArgs = ['--enable-automation', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  134 |     ...(packaged ? [] : ['.']), file];
  135 |   // A pre-existing restriction must survive; the handoff must never bypass it.
  136 |   const child = spawn(inheritedRestriction ? 'setpriv' : executable,
  137 |     inheritedRestriction ? ['--no-new-privs', executable, ...launchArgs] : launchArgs,
  138 |     { env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') }, stdio: ['ignore', 'ignore', 'pipe'] });
  139 |   let stderr = '';
  140 |   child.stderr.on('data', chunk => { stderr += String(chunk); });
  141 |   let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  142 |   let browserPid: number | undefined;
  143 |   try {
  144 |     await expect.poll(() => child.exitCode).toBe(0);
  145 |     const endpoint = async () => {
  146 |       const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
  147 |       if (!port) return '';
  148 |       return fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json())
  149 |         .then(data => data.webSocketDebuggerUrl as string).catch(() => '');
  150 |     };
  151 |     await expect.poll(endpoint).toMatch(/^ws:\/\//);
  152 |     browser = await chromium.connectOverCDP(await endpoint(), { timeout: 10_000 });
  153 |     const session = await browser.newBrowserCDPSession();
  154 |     const processes = await session.send('SystemInfo.getProcessInfo');
  155 |     browserPid = processes.processInfo.find(process => process.type === 'browser')!.id;
  156 |     await expect.poll(() => browser!.contexts()[0].pages().map(page => page.url())).toContainEqual(expect.stringContaining('/dist/index.html'));
  157 |     const page = browser.contexts()[0].pages().find(page => page.url().includes('/dist/index.html'))!;
  158 |     await expect(page.getByRole('tab', { name: /startup 문서 with spaces.md/ })).toBeVisible();
  159 |     expect(browser.contexts()[0].pages().filter(page => page.url().startsWith('data:text/html;charset=utf-8,'))).toHaveLength(0);
  160 |     expect(browserPid).not.toBe(child.pid);
  161 |     // Linux process titles can overwrite /proc/pid/cmdline. Query Chromium's
  162 |     // actual startup switches, including the backend selected before main.
  163 |     const args = (await session.send('Browser.getBrowserCommandLine')).arguments;
  164 |     expect(args.filter(arg => arg === '--ozone-platform=x11')).toHaveLength(1);
  165 |     expect(args).toContain(file);
  166 |     const mainStatus = await readFile(`/proc/${browserPid}/status`, 'utf8');
  167 |     const expectedFlag = Number(inheritedRestriction);
  168 |     expect(processFlag(mainStatus, 'NoNewPrivs')).toBe(expectedFlag);
  169 |     await page.locator('.new-terminal-tab-button').click();
  170 |     const terminal = page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
  171 |     await expect(terminal).toBeFocused();
```