# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tab-drag.spec.ts >> fullscreen document drags prioritize both side edges and never open a window
- Location: test/wayland/tab-drag.spec.ts:13:1

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
      - text: file:///tmp/setdown-browser-iRuiNZ/notes.md
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
  9   | 
  10  | const compatibility = process.env.SETDOWN_TEST_DISPLAY === 'xwayland';
  11  | for (const mode of ['maximized', 'fullscreen'] as const)
  12  | for (const moving of ['web', 'document'] as const)
  13  | test(`${mode} ${moving} drags prioritize both side edges and never open a window`, async () => {
  14  |   const input = await waylandInput();
  15  |   const f = await fixture(moving === 'document').catch(async error => { await input.close(); throw error; });
  16  |   try {
  17  |     if (moving === 'web') {
  18  |       await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  19  |       await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  20  |     } else await f.page.locator('.new-tab-button').click();
  21  |     const tab = f.page.getByRole('tab', { name: moving === 'web' ? /Second page/ : /notes.md/ });
  22  |     await tab.click();
  23  |     await expect(tab).toHaveAttribute('aria-selected', 'true');
  24  |     const owner = await f.app.browserWindow(f.page);
  25  |     await owner.evaluate((window, mode) => mode === 'fullscreen' ? window.setFullScreen(true) : window.maximize(), mode);
  26  |     await expect.poll(() => owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
  27  |     await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(1920);
  28  |     await f.app.evaluate(({ app, ipcMain }) => {
  29  |       (globalThis as any).fullscreenDragTrace = [];
  30  |       (globalThis as any).dragCreatedWindows = 0;
  31  |       app.on('browser-window-created', () => (globalThis as any).dragCreatedWindows++);
  32  |       for (const channel of ['tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event'])
  33  |         ipcMain.on(channel, (_event, value) => (globalThis as any).fullscreenDragTrace.push({ channel, value }));
  34  |     });
  35  |     const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
  36  |       const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
  37  |       return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
  38  |     }, point);
  39  |     const overlay = f.page.locator('.group-drop-overlay');
  40  |     for (const [round, placement] of ['left-top', 'right-top', 'left-bottom', 'right-bottom', 'fast-right', 'center', 'escape'].entries()) {
  41  |       if (round === 2) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
  42  |       const bounds = await owner.evaluate(window => window.getBounds());
  43  |       const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
  44  |       const from = await toScreen({ x: box.x + 40 + round % 2 * 20, y: box.y + box.height / 2 });
  45  |       await input.send({ pointer: [from], button: 'down' });
  46  |       await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }] });
  47  |       const vertical = placement.endsWith('top') || placement.endsWith('bottom');
  48  |       const y = body.y + body.height * (placement.endsWith('top') ? .1 : placement.endsWith('bottom') ? .9 : .5);
  49  |       await input.send({ pointer: [await toScreen({ x: body.x + body.width / 2, y })] });
  50  |       if (vertical) {
> 51  |         await expect(overlay).toBeVisible();
      |                               ^ Error: expect(locator).toBeVisible() failed
  52  |         expect((await overlay.boundingBox())!.height).toBeCloseTo(body.height / 2, 0);
  53  |       } else await expect(overlay).toBeHidden();
  54  |       const left = placement.startsWith('left');
  55  |       const edge = await toScreen({ x: body.x + (left ? 1 : body.width - 1), y });
  56  |       if (placement === 'fast-right') {
  57  |         // No guide wait may hide the native center-to-edge release race.
  58  |         await input.send({ pointer: [edge], pointerIntervalMs: 0, button: 'up' });
  59  |       } else {
  60  |         if (placement !== 'center') {
  61  |           await input.send({ pointer: [edge] });
  62  |           await expect(overlay).toBeVisible();
  63  |           const guide = (await overlay.boundingBox())!;
  64  |           expect(guide.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), 0);
  65  |           expect(guide.width).toBeCloseTo(body.width / 2, 0);
  66  |           expect(guide.height).toBeCloseTo(body.height, 0);
  67  |         }
  68  |         if (placement === 'escape') await input.send({ keys: ['Escape'] });
  69  |         await input.send({ button: 'up' });
  70  |       }
  71  |       const split = placement !== 'center' && placement !== 'escape';
  72  |       await expect(f.page.locator('.editor-group')).toHaveCount(split ? 2 : 1);
  73  |       await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
  74  |       expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  75  |       expect(await f.app.evaluate(() => (globalThis as any).dragCreatedWindows)).toBe(0);
  76  |       expect(await owner.evaluate(window => window.getBounds())).toEqual(bounds);
  77  |       expect(await owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
  78  |       if (split) {
  79  |         const moved = (await tab.boundingBox())!;
  80  |         expect(moved.x).toBeCloseTo(body.x + (left ? 0 : body.width / 2), -1);
  81  |         // Restore one group between independent native gestures.
  82  |         const other = f.page.locator('.editor-group').filter({ hasNot: tab }).locator('.tab-strip');
  83  |         const strip = (await other.boundingBox())!;
  84  |         const data = await f.page.evaluateHandle(() => new DataTransfer());
  85  |         await tab.dispatchEvent('dragstart', { dataTransfer: data });
  86  |         const point = { dataTransfer: data, clientX: strip.x + 10, clientY: strip.y + strip.height / 2 };
  87  |         await other.dispatchEvent('dragover', point); await other.dispatchEvent('drop', point); await data.dispose();
  88  |         await expect(f.page.locator('.editor-group')).toHaveCount(1);
  89  |       }
  90  |     }
  91  |     expect(f.errors).toEqual([]);
  92  |     await owner.dispose();
  93  |   } finally {
  94  |     await writeFile(test.info().outputPath('fullscreen-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).fullscreenDragTrace ?? []), null, 2));
  95  |     await input.send({ keys: ['Escape'], button: 'up' });
  96  |     await f.page.screenshot({ path: test.info().outputPath('final.png') }).catch(() => {});
  97  |     await f.dispose(); await input.close();
  98  |   }
  99  | });
  100 | 
  101 | const processFlag = (status: string, name: string) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)$`, 'm'))?.[1]);
  102 | if (compatibility) for (const inheritedRestriction of [false, true])
  103 | test(`default startup preserves document, terminal privileges and renderer sandbox on XWayland (inherited restriction: ${inheritedRestriction})`, async () => {
  104 |   expect(processFlag(await readFile('/proc/self/status', 'utf8'), 'NoNewPrivs'),
  105 |     'Run from an unrestricted parent to detect accidentally added restrictions.').toBe(0);
  106 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-display-startup-'));
  107 |   const profile = path.join(root, 'profile'), file = path.join(root, 'startup 문서 with spaces.md');
  108 |   await writeFile(file, '# Startup survives backend selection\n');
  109 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  110 |   const packaged = process.env.SETDOWN_TEST_PACKAGED_EXECUTABLE;
  111 |   const executable = packaged ?? createRequire(import.meta.url)('electron') as string;
  112 |   const launchArgs = ['--enable-automation', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  113 |     ...(packaged ? [] : ['.']), file];
  114 |   // A pre-existing restriction must survive; the handoff must never bypass it.
  115 |   const child = spawn(inheritedRestriction ? 'setpriv' : executable,
  116 |     inheritedRestriction ? ['--no-new-privs', executable, ...launchArgs] : launchArgs,
  117 |     { env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') }, stdio: ['ignore', 'ignore', 'pipe'] });
  118 |   let stderr = '';
  119 |   child.stderr.on('data', chunk => { stderr += String(chunk); });
  120 |   let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  121 |   let browserPid: number | undefined;
  122 |   try {
  123 |     await expect.poll(() => child.exitCode).toBe(0);
  124 |     const endpoint = async () => {
  125 |       const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
  126 |       if (!port) return '';
  127 |       return fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json())
  128 |         .then(data => data.webSocketDebuggerUrl as string).catch(() => '');
  129 |     };
  130 |     await expect.poll(endpoint).toMatch(/^ws:\/\//);
  131 |     browser = await chromium.connectOverCDP(await endpoint(), { timeout: 10_000 });
  132 |     const session = await browser.newBrowserCDPSession();
  133 |     const processes = await session.send('SystemInfo.getProcessInfo');
  134 |     browserPid = processes.processInfo.find(process => process.type === 'browser')!.id;
  135 |     await expect.poll(() => browser!.contexts()[0].pages().map(page => page.url())).toContainEqual(expect.stringContaining('/dist/index.html'));
  136 |     const page = browser.contexts()[0].pages().find(page => page.url().includes('/dist/index.html'))!;
  137 |     await expect(page.getByRole('tab', { name: /startup 문서 with spaces.md/ })).toBeVisible();
  138 |     expect(browser.contexts()[0].pages().filter(page => page.url().startsWith('data:text/html;charset=utf-8,'))).toHaveLength(0);
  139 |     expect(browserPid).not.toBe(child.pid);
  140 |     // Linux process titles can overwrite /proc/pid/cmdline. Query Chromium's
  141 |     // actual startup switches, including the backend selected before main.
  142 |     const args = (await session.send('Browser.getBrowserCommandLine')).arguments;
  143 |     expect(args.filter(arg => arg === '--ozone-platform=x11')).toHaveLength(1);
  144 |     expect(args).toContain(file);
  145 |     const mainStatus = await readFile(`/proc/${browserPid}/status`, 'utf8');
  146 |     const expectedFlag = Number(inheritedRestriction);
  147 |     expect(processFlag(mainStatus, 'NoNewPrivs')).toBe(expectedFlag);
  148 |     await page.locator('.new-terminal-tab-button').click();
  149 |     const terminal = page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
  150 |     await expect(terminal).toBeFocused();
  151 |     // $$ reads the actual interactive shell, not a test process or grep child.
```