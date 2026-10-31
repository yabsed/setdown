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
      - text: file:///tmp/setdown-browser-vmMYjy/notes.md
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
  15  |   const f = await fixture(moving === 'document');
  16  |   let input: Awaited<ReturnType<typeof waylandInput>> | null = null;
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
  33  |     // Mutter can warp the cursor on fullscreen entry. Establish the private
  34  |     // relative-input origin only after the window has reached its final mode.
  35  |     input = await waylandInput();
  36  |     await f.app.evaluate(({ app, ipcMain }) => {
  37  |       (globalThis as any).fullscreenDragTrace = [];
  38  |       (globalThis as any).dragCreatedWindows = 0;
  39  |       app.on('browser-window-created', () => (globalThis as any).dragCreatedWindows++);
  40  |       for (const channel of ['tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event'])
  41  |         ipcMain.on(channel, (_event, value) => (globalThis as any).fullscreenDragTrace.push({ channel, value }));
  42  |     });
  43  |     await f.page.evaluate(() => {
  44  |       (window as any).fullscreenDragEvents = [];
  45  |       for (const type of ['pointerdown', 'pointerup', 'dragstart', 'dragend']) window.addEventListener(type, event => {
  46  |         const e = event as MouseEvent;
  47  |         (window as any).fullscreenDragEvents.push({ type, x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.className });
  48  |       }, true);
  49  |     });
  50  |     const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
  51  |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  52  |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  53  |     }, point);
  54  |     const overlay = f.page.locator('.group-drop-overlay');
  55  |     for (const [round, placement] of ['left-top', 'right-top', 'left-bottom', 'right-bottom', 'fast-right', 'center', 'escape'].entries()) {
  56  |       if (round === 2) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
  57  |       const bounds = await owner.evaluate(window => window.getBounds());
  58  |       const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
  59  |       const from = await toScreen({ x: box.x + 40 + round % 2 * 20, y: box.y + box.height / 2 });
  60  |       await owner.evaluate((window, details) => (globalThis as any).fullscreenDragTrace.push({
  61  |         ...details, contentBounds: window.getContentBounds(),
  62  |       }), { placement, bounds, from, box, body });
  63  |       await input.send({ pointer: [from], button: 'down' });
  64  |       await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }] });
  65  |       const vertical = placement.endsWith('top') || placement.endsWith('bottom');
  66  |       const y = body.y + body.height * (placement.endsWith('top') ? .1 : placement.endsWith('bottom') ? .9 : .5);
  67  |       await input.send({ pointer: [await toScreen({ x: body.x + body.width / 2, y })] });
  68  |       if (vertical) {
> 69  |         await expect(overlay).toBeVisible();
      |                               ^ Error: expect(locator).toBeVisible() failed
  70  |         expect((await overlay.boundingBox())!.height).toBeCloseTo(body.height / 2, 0);
  71  |       } else await expect(overlay).toBeHidden();
  72  |       const left = placement.startsWith('left');
  73  |       const edge = await toScreen({ x: body.x + (left ? 1 : body.width - 1), y });
  74  |       if (placement === 'fast-right') {
  75  |         // No guide wait may hide the native center-to-edge release race.
  76  |         await input.send({ pointer: [edge], pointerIntervalMs: 0, button: 'up' });
  77  |       } else {
  78  |         if (placement !== 'center') {
  79  |           await input.send({ pointer: [edge] });
  80  |           await expect(overlay).toBeVisible();
  81  |           const guide = (await overlay.boundingBox())!;
  82  |           expect(guide.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  83  |           expect(guide.width).toBeCloseTo(body.width / 2, 0);
  84  |           expect(guide.height).toBeCloseTo(body.height, 0);
  85  |         }
  86  |         if (placement === 'escape') await input.send({ keys: ['Escape'] });
  87  |         await input.send({ button: 'up' });
  88  |       }
  89  |       const split = placement !== 'center' && placement !== 'escape';
  90  |       await expect(f.page.locator('.editor-group')).toHaveCount(split ? 2 : 1);
  91  |       await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  92  |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  93  |       expect(await f.app.evaluate(() => (globalThis as any).dragCreatedWindows)).toBe(0);
  94  |       expect(await owner.evaluate(window => window.getBounds())).toEqual(bounds);
  95  |       expect(await owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
  96  |       if (split) {
  97  |         const moved = (await f.page.locator('.editor-group').filter({ has: tab }).boundingBox())!;
  98  |         expect(moved.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  99  |         // Restore one group between independent native gestures.
  100 |         const other = f.page.locator('.editor-group').filter({ hasNot: tab }).locator('.tab-strip');
  101 |         const strip = (await other.boundingBox())!;
  102 |         const data = await f.page.evaluateHandle(() => new DataTransfer());
  103 |         await tab.dispatchEvent('dragstart', { dataTransfer: data });
  104 |         const point = { dataTransfer: data, clientX: strip.x + 10, clientY: strip.y + strip.height / 2 };
  105 |         await other.dispatchEvent('dragover', point); await other.dispatchEvent('drop', point); await data.dispose();
  106 |         await expect(f.page.locator('.editor-group')).toHaveCount(1);
  107 |       }
  108 |     }
  109 |     expect(f.errors).toEqual([]);
  110 |     await owner.dispose();
  111 |   } finally {
  112 |     await writeFile(test.info().outputPath('fullscreen-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).fullscreenDragTrace ?? []), null, 2));
  113 |     await writeFile(test.info().outputPath('fullscreen-drag-events.json'), JSON.stringify(await f.page.evaluate(() => (window as any).fullscreenDragEvents ?? []), null, 2));
  114 |     await input?.send({ keys: ['Escape'], button: 'up' });
  115 |     await f.page.screenshot({ path: test.info().outputPath('final.png') }).catch(() => {});
  116 |     await f.dispose(); await input?.close();
  117 |   }
  118 | });
  119 | 
  120 | const processFlag = (status: string, name: string) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)$`, 'm'))?.[1]);
  121 | if (compatibility) for (const inheritedRestriction of [false, true])
  122 | test(`default startup preserves document, terminal privileges and renderer sandbox on XWayland (inherited restriction: ${inheritedRestriction})`, async () => {
  123 |   expect(processFlag(await readFile('/proc/self/status', 'utf8'), 'NoNewPrivs'),
  124 |     'Run from an unrestricted parent to detect accidentally added restrictions.').toBe(0);
  125 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-display-startup-'));
  126 |   const profile = path.join(root, 'profile'), file = path.join(root, 'startup 문서 with spaces.md');
  127 |   await writeFile(file, '# Startup survives backend selection\n');
  128 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  129 |   const packaged = process.env.SETDOWN_TEST_PACKAGED_EXECUTABLE;
  130 |   const executable = packaged ?? createRequire(import.meta.url)('electron') as string;
  131 |   const launchArgs = ['--enable-automation', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  132 |     ...(packaged ? [] : ['.']), file];
  133 |   // A pre-existing restriction must survive; the handoff must never bypass it.
  134 |   const child = spawn(inheritedRestriction ? 'setpriv' : executable,
  135 |     inheritedRestriction ? ['--no-new-privs', executable, ...launchArgs] : launchArgs,
  136 |     { env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') }, stdio: ['ignore', 'ignore', 'pipe'] });
  137 |   let stderr = '';
  138 |   child.stderr.on('data', chunk => { stderr += String(chunk); });
  139 |   let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  140 |   let browserPid: number | undefined;
  141 |   try {
  142 |     await expect.poll(() => child.exitCode).toBe(0);
  143 |     const endpoint = async () => {
  144 |       const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
  145 |       if (!port) return '';
  146 |       return fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json())
  147 |         .then(data => data.webSocketDebuggerUrl as string).catch(() => '');
  148 |     };
  149 |     await expect.poll(endpoint).toMatch(/^ws:\/\//);
  150 |     browser = await chromium.connectOverCDP(await endpoint(), { timeout: 10_000 });
  151 |     const session = await browser.newBrowserCDPSession();
  152 |     const processes = await session.send('SystemInfo.getProcessInfo');
  153 |     browserPid = processes.processInfo.find(process => process.type === 'browser')!.id;
  154 |     await expect.poll(() => browser!.contexts()[0].pages().map(page => page.url())).toContainEqual(expect.stringContaining('/dist/index.html'));
  155 |     const page = browser.contexts()[0].pages().find(page => page.url().includes('/dist/index.html'))!;
  156 |     await expect(page.getByRole('tab', { name: /startup 문서 with spaces.md/ })).toBeVisible();
  157 |     expect(browser.contexts()[0].pages().filter(page => page.url().startsWith('data:text/html;charset=utf-8,'))).toHaveLength(0);
  158 |     expect(browserPid).not.toBe(child.pid);
  159 |     // Linux process titles can overwrite /proc/pid/cmdline. Query Chromium's
  160 |     // actual startup switches, including the backend selected before main.
  161 |     const args = (await session.send('Browser.getBrowserCommandLine')).arguments;
  162 |     expect(args.filter(arg => arg === '--ozone-platform=x11')).toHaveLength(1);
  163 |     expect(args).toContain(file);
  164 |     const mainStatus = await readFile(`/proc/${browserPid}/status`, 'utf8');
  165 |     const expectedFlag = Number(inheritedRestriction);
  166 |     expect(processFlag(mainStatus, 'NoNewPrivs')).toBe(expectedFlag);
  167 |     await page.locator('.new-terminal-tab-button').click();
  168 |     const terminal = page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
  169 |     await expect(terminal).toBeFocused();
```