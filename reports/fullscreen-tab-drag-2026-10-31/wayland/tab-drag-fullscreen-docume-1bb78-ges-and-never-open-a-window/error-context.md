# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tab-drag.spec.ts >> fullscreen document drags prioritize both side edges and never open a window
- Location: test/wayland/tab-drag.spec.ts:15:1

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
      - text: file:///tmp/setdown-browser-q7vUck/notes.md
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
  10  | import { nativeInput } from '../support/electron/native-input';
  11  | 
  12  | const compatibility = process.env.SETDOWN_TEST_DISPLAY === 'xwayland';
  13  | for (const mode of ['maximized', 'fullscreen'] as const)
  14  | for (const moving of ['web', 'document'] as const)
  15  | test(`${mode} ${moving} drags prioritize both side edges and never open a window`, async () => {
  16  |   const f = await fixture(moving === 'document');
  17  |   let input: Awaited<ReturnType<typeof waylandInput>> | null = null;
  18  |   try {
  19  |     if (moving === 'web') {
  20  |       await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  21  |       await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  22  |     } else await f.page.locator('.new-tab-button').click();
  23  |     const tab = f.page.getByRole('tab', { name: moving === 'web' ? /Second page/ : /notes.md/ });
  24  |     await tab.click();
  25  |     await expect(tab).toHaveAttribute('aria-selected', 'true');
  26  |     const owner = await f.app.browserWindow(f.page);
  27  |     await owner.evaluate((window, mode) => new Promise<void>(resolve => {
  28  |       window.once(mode === 'fullscreen' ? 'enter-full-screen' : 'maximize', () => resolve());
  29  |       if (mode === 'fullscreen') window.setFullScreen(true); else window.maximize();
  30  |     }), mode);
  31  |     await expect.poll(() => owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
  32  |     await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(1920);
  33  |     await focusApplication(f.app);
  34  |     // Mutter can warp the cursor on fullscreen entry. XTest supplies absolute
  35  |     // positions on XWayland; establish the native Wayland origin after entry.
  36  |     input = compatibility ? { send: nativeInput, close: async () => {} } : await waylandInput();
  37  |     await f.app.evaluate(({ app, ipcMain }) => {
  38  |       (globalThis as any).fullscreenDragTrace = [];
  39  |       (globalThis as any).dragCreatedWindows = 0;
  40  |       app.on('browser-window-created', () => (globalThis as any).dragCreatedWindows++);
  41  |       for (const channel of ['tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event'])
  42  |         ipcMain.on(channel, (_event, value) => (globalThis as any).fullscreenDragTrace.push({ channel, value }));
  43  |     });
  44  |     await f.page.evaluate(() => {
  45  |       (window as any).fullscreenDragEvents = [];
  46  |       for (const type of ['pointerdown', 'pointerup', 'dragstart', 'dragend']) window.addEventListener(type, event => {
  47  |         const e = event as MouseEvent;
  48  |         (window as any).fullscreenDragEvents.push({ type, x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.className });
  49  |       }, true);
  50  |     });
  51  |     const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
  52  |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  53  |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  54  |     }, point);
  55  |     const overlay = f.page.locator('.group-drop-overlay');
  56  |     for (const [round, placement] of ['left-top', 'right-top', 'left-bottom', 'right-bottom', 'fast-right', 'center', 'escape'].entries()) {
  57  |       if (round === 2) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
  58  |       const bounds = await owner.evaluate(window => window.getBounds());
  59  |       const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
  60  |       const from = await toScreen({ x: box.x + 40 + round % 2 * 20, y: box.y + box.height / 2 });
  61  |       await owner.evaluate((window, details) => (globalThis as any).fullscreenDragTrace.push({
  62  |         ...details, contentBounds: window.getContentBounds(),
  63  |       }), { placement, bounds, from, box, body });
  64  |       await input.send({ pointer: [from], button: 'down' });
  65  |       await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }] });
  66  |       const vertical = placement.endsWith('top') || placement.endsWith('bottom');
  67  |       const y = body.y + body.height * (placement.endsWith('top') ? .1 : placement.endsWith('bottom') ? .9 : .5);
  68  |       await input.send({ pointer: [await toScreen({ x: body.x + body.width / 2, y })] });
  69  |       if (vertical) {
> 70  |         await expect(overlay).toBeVisible();
      |                               ^ Error: expect(locator).toBeVisible() failed
  71  |         expect((await overlay.boundingBox())!.height).toBeCloseTo(body.height / 2, 0);
  72  |       } else await expect(overlay).toBeHidden();
  73  |       const left = placement.startsWith('left');
  74  |       const edge = await toScreen({ x: body.x + (left ? 1 : body.width - 1), y });
  75  |       if (placement === 'fast-right') {
  76  |         // No guide wait may hide the native center-to-edge release race.
  77  |         await input.send({ pointer: [edge], pointerIntervalMs: 0, button: 'up' });
  78  |       } else {
  79  |         if (placement !== 'center') {
  80  |           await input.send({ pointer: [edge] });
  81  |           await expect(overlay).toBeVisible();
  82  |           const guide = (await overlay.boundingBox())!;
  83  |           expect(guide.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  84  |           expect(guide.width).toBeCloseTo(body.width / 2, 0);
  85  |           expect(guide.height).toBeCloseTo(body.height, 0);
  86  |         }
  87  |         if (placement === 'escape') await input.send({ keys: ['Escape'] });
  88  |         await input.send({ button: 'up' });
  89  |       }
  90  |       const split = placement !== 'center' && placement !== 'escape';
  91  |       await expect(f.page.locator('.editor-group')).toHaveCount(split ? 2 : 1);
  92  |       await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  93  |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  94  |       expect(await f.app.evaluate(() => (globalThis as any).dragCreatedWindows)).toBe(0);
  95  |       expect(await owner.evaluate(window => window.getBounds())).toEqual(bounds);
  96  |       expect(await owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
  97  |       if (split) {
  98  |         const moved = (await f.page.locator('.editor-group').filter({ has: tab }).boundingBox())!;
  99  |         expect(moved.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  100 |         // Restore one group between independent native gestures.
  101 |         const other = f.page.locator('.editor-group').filter({ hasNot: tab }).locator('.tab-strip');
  102 |         const strip = (await other.boundingBox())!;
  103 |         const data = await f.page.evaluateHandle(() => new DataTransfer());
  104 |         await tab.dispatchEvent('dragstart', { dataTransfer: data });
  105 |         const point = { dataTransfer: data, clientX: strip.x + 10, clientY: strip.y + strip.height / 2 };
  106 |         await other.dispatchEvent('dragover', point); await other.dispatchEvent('drop', point); await data.dispose();
  107 |         await expect(f.page.locator('.editor-group')).toHaveCount(1);
  108 |       }
  109 |     }
  110 |     expect(f.errors).toEqual([]);
  111 |     await owner.dispose();
  112 |   } finally {
  113 |     await writeFile(test.info().outputPath('fullscreen-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).fullscreenDragTrace ?? []), null, 2));
  114 |     await writeFile(test.info().outputPath('fullscreen-drag-events.json'), JSON.stringify(await f.page.evaluate(() => (window as any).fullscreenDragEvents ?? []), null, 2));
  115 |     await input?.send({ keys: ['Escape'], button: 'up' });
  116 |     await f.page.screenshot({ path: test.info().outputPath('final.png') }).catch(() => {});
  117 |     await f.dispose(); await input?.close();
  118 |   }
  119 | });
  120 | 
  121 | const processFlag = (status: string, name: string) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)$`, 'm'))?.[1]);
  122 | if (compatibility) for (const inheritedRestriction of [false, true])
  123 | test(`default startup preserves document, terminal privileges and renderer sandbox on XWayland (inherited restriction: ${inheritedRestriction})`, async () => {
  124 |   expect(processFlag(await readFile('/proc/self/status', 'utf8'), 'NoNewPrivs'),
  125 |     'Run from an unrestricted parent to detect accidentally added restrictions.').toBe(0);
  126 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-display-startup-'));
  127 |   const profile = path.join(root, 'profile'), file = path.join(root, 'startup 문서 with spaces.md');
  128 |   await writeFile(file, '# Startup survives backend selection\n');
  129 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  130 |   const packaged = process.env.SETDOWN_TEST_PACKAGED_EXECUTABLE;
  131 |   const executable = packaged ?? createRequire(import.meta.url)('electron') as string;
  132 |   const launchArgs = ['--enable-automation', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  133 |     ...(packaged ? [] : ['.']), file];
  134 |   // A pre-existing restriction must survive; the handoff must never bypass it.
  135 |   const child = spawn(inheritedRestriction ? 'setpriv' : executable,
  136 |     inheritedRestriction ? ['--no-new-privs', executable, ...launchArgs] : launchArgs,
  137 |     { env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') }, stdio: ['ignore', 'ignore', 'pipe'] });
  138 |   let stderr = '';
  139 |   child.stderr.on('data', chunk => { stderr += String(chunk); });
  140 |   let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  141 |   let browserPid: number | undefined;
  142 |   try {
  143 |     await expect.poll(() => child.exitCode).toBe(0);
  144 |     const endpoint = async () => {
  145 |       const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
  146 |       if (!port) return '';
  147 |       return fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json())
  148 |         .then(data => data.webSocketDebuggerUrl as string).catch(() => '');
  149 |     };
  150 |     await expect.poll(endpoint).toMatch(/^ws:\/\//);
  151 |     browser = await chromium.connectOverCDP(await endpoint(), { timeout: 10_000 });
  152 |     const session = await browser.newBrowserCDPSession();
  153 |     const processes = await session.send('SystemInfo.getProcessInfo');
  154 |     browserPid = processes.processInfo.find(process => process.type === 'browser')!.id;
  155 |     await expect.poll(() => browser!.contexts()[0].pages().map(page => page.url())).toContainEqual(expect.stringContaining('/dist/index.html'));
  156 |     const page = browser.contexts()[0].pages().find(page => page.url().includes('/dist/index.html'))!;
  157 |     await expect(page.getByRole('tab', { name: /startup 문서 with spaces.md/ })).toBeVisible();
  158 |     expect(browser.contexts()[0].pages().filter(page => page.url().startsWith('data:text/html;charset=utf-8,'))).toHaveLength(0);
  159 |     expect(browserPid).not.toBe(child.pid);
  160 |     // Linux process titles can overwrite /proc/pid/cmdline. Query Chromium's
  161 |     // actual startup switches, including the backend selected before main.
  162 |     const args = (await session.send('Browser.getBrowserCommandLine')).arguments;
  163 |     expect(args.filter(arg => arg === '--ozone-platform=x11')).toHaveLength(1);
  164 |     expect(args).toContain(file);
  165 |     const mainStatus = await readFile(`/proc/${browserPid}/status`, 'utf8');
  166 |     const expectedFlag = Number(inheritedRestriction);
  167 |     expect(processFlag(mainStatus, 'NoNewPrivs')).toBe(expectedFlag);
  168 |     await page.locator('.new-terminal-tab-button').click();
  169 |     const terminal = page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
  170 |     await expect(terminal).toBeFocused();
```