# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tab-drag.spec.ts >> default startup preserves document, terminal privileges and renderer sandbox on XWayland (inherited restriction: false)
- Location: test/wayland/tab-drag.spec.ts:13:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 1
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
  11  | const processFlag = (status: string, name: string) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)$`, 'm'))?.[1]);
  12  | if (compatibility) for (const inheritedRestriction of [false, true])
  13  | test(`default startup preserves document, terminal privileges and renderer sandbox on XWayland (inherited restriction: ${inheritedRestriction})`, async () => {
  14  |   expect(processFlag(await readFile('/proc/self/status', 'utf8'), 'NoNewPrivs'),
  15  |     'Run from an unrestricted parent to detect accidentally added restrictions.').toBe(0);
  16  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-display-startup-'));
  17  |   const profile = path.join(root, 'profile'), file = path.join(root, 'startup 문서 with spaces.md');
  18  |   await writeFile(file, '# Startup survives backend selection\n');
  19  |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  20  |   const packaged = process.env.SETDOWN_TEST_PACKAGED_EXECUTABLE;
  21  |   const executable = packaged ?? createRequire(import.meta.url)('electron') as string;
  22  |   const launchArgs = ['--enable-automation', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  23  |     ...(packaged ? [] : ['.']), file];
  24  |   // A pre-existing restriction must survive; the handoff must never bypass it.
  25  |   const child = spawn(inheritedRestriction ? 'setpriv' : executable,
  26  |     inheritedRestriction ? ['--no-new-privs', executable, ...launchArgs] : launchArgs,
  27  |     { env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') }, stdio: ['ignore', 'ignore', 'pipe'] });
  28  |   let stderr = '';
  29  |   child.stderr.on('data', chunk => { stderr += String(chunk); });
  30  |   let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  31  |   let browserPid: number | undefined;
  32  |   try {
  33  |     await expect.poll(() => child.exitCode).toBe(0);
  34  |     const endpoint = async () => {
  35  |       const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
  36  |       if (!port) return '';
  37  |       return fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json())
  38  |         .then(data => data.webSocketDebuggerUrl as string).catch(() => '');
  39  |     };
  40  |     await expect.poll(endpoint).toMatch(/^ws:\/\//);
  41  |     browser = await chromium.connectOverCDP(await endpoint(), { timeout: 10_000 });
  42  |     const session = await browser.newBrowserCDPSession();
  43  |     const processes = await session.send('SystemInfo.getProcessInfo');
  44  |     browserPid = processes.processInfo.find(process => process.type === 'browser')!.id;
  45  |     await expect.poll(() => browser!.contexts()[0].pages().map(page => page.url())).toContainEqual(expect.stringContaining('/dist/index.html'));
  46  |     const page = browser.contexts()[0].pages().find(page => page.url().includes('/dist/index.html'))!;
  47  |     await expect(page.getByRole('tab', { name: /startup 문서 with spaces.md/ })).toBeVisible();
  48  |     expect(browser.contexts()[0].pages().filter(page => page.url().startsWith('data:text/html;charset=utf-8,'))).toHaveLength(0);
  49  |     expect(browserPid).not.toBe(child.pid);
  50  |     // Linux process titles can overwrite /proc/pid/cmdline. Query Chromium's
  51  |     // actual startup switches, including the backend selected before main.
  52  |     const args = (await session.send('Browser.getBrowserCommandLine')).arguments;
  53  |     expect(args.filter(arg => arg === '--ozone-platform=x11')).toHaveLength(1);
  54  |     expect(args).toContain(file);
  55  |     const mainStatus = await readFile(`/proc/${browserPid}/status`, 'utf8');
  56  |     const expectedFlag = Number(inheritedRestriction);
> 57  |     expect(processFlag(mainStatus, 'NoNewPrivs')).toBe(expectedFlag);
      |                                                   ^ Error: expect(received).toBe(expected) // Object.is equality
  58  |     await page.locator('.new-terminal-tab-button').click();
  59  |     const terminal = page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
  60  |     await expect(terminal).toBeFocused();
  61  |     // $$ reads the actual interactive shell, not a test process or grep child.
  62  |     await terminal.pressSequentially('cat /proc/$$/status > shell-status.txt');
  63  |     await terminal.press('Enter');
  64  |     const statusFile = path.join(root, 'shell-status.txt');
  65  |     await expect.poll(() => readFile(statusFile, 'utf8').catch(() => '')).toContain('NoNewPrivs:');
  66  |     const shellStatus = await readFile(statusFile, 'utf8');
  67  |     expect(processFlag(shellStatus, 'NoNewPrivs')).toBe(expectedFlag);
  68  |     expect(processFlag(shellStatus, 'PPid')).toBe(browserPid);
  69  |     const rendererProcesses = (await session.send('SystemInfo.getProcessInfo')).processInfo
  70  |       .filter(process => process.type === 'renderer');
  71  |     expect(rendererProcesses.length).toBeGreaterThan(0);
  72  |     const rendererStatuses = [];
  73  |     for (const renderer of rendererProcesses) {
  74  |       const status = await readFile(`/proc/${renderer.id}/status`, 'utf8');
  75  |       rendererStatuses.push(status);
  76  |       expect(processFlag(status, 'NoNewPrivs')).toBe(1);
  77  |       expect(processFlag(status, 'Seccomp')).toBe(2);
  78  |     }
  79  |     await writeFile(test.info().outputPath('startup.json'), JSON.stringify({
  80  |       initialPid: child.pid, finalPid: browserPid, args, mainStatus, shellStatus, rendererStatuses,
  81  |     }, null, 2));
  82  |     await page.screenshot({ path: test.info().outputPath('terminal-after-startup.png') });
  83  |   } catch (error) {
  84  |     console.error('Startup verification failed:', String(error));
  85  |     throw error;
  86  |   } finally {
  87  |     await writeFile(test.info().outputPath('startup.log'), stderr);
  88  |     // This raw launch has no ElectronApplication handle. Terminate only the
  89  |     // browser PID returned by our private debugging connection, not user apps.
  90  |     if (browserPid) { try { process.kill(browserPid, 'SIGTERM'); } catch {} }
  91  |     await browser?.close();
  92  |     if (child.exitCode === null) child.kill();
  93  |     await rm(root, { recursive: true, force: true });
  94  |   }
  95  | });
  96  | 
  97  | for (const moving of ['web', 'document'] as const)
  98  | test(`${compatibility ? 'XWayland compatibility' : 'native Wayland'} ${moving} drag paints split and merge guides across windows`, async () => {
  99  |   const input = await waylandInput();
  100 |   const f = await fixture().catch(async error => { await input.close(); throw error; });
  101 |   const pages: Page[] = [f.page];
  102 |   const wire: string[] = [];
  103 |   f.app.process().stderr?.on('data', chunk => { for (const line of String(chunk).split('\n'))
  104 |     if (/data_offer|data_source|data_device|wl_keyboard.*key\(/.test(line)) wire.push(line); });
  105 |   try {
  106 |     await f.app.evaluate(({ ipcMain, webContents, app }) => {
  107 |       const trace: unknown[] = []; (globalThis as any).waylandDragTrace = trace;
  108 |       for (const channel of ['tabs:register-transfer', 'tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event'])
  109 |         ipcMain.on(channel, (event, value) => trace.push({ at: Date.now(), id: event.sender.id, channel, value }));
  110 |       const watch = (wc: Electron.WebContents) => {
  111 |         wc.on('focus', () => trace.push({ at: Date.now(), id: wc.id, type: 'focus' }));
  112 |         wc.on('blur', () => trace.push({ at: Date.now(), id: wc.id, type: 'blur' }));
  113 |         const send = wc.send.bind(wc);
  114 |         wc.send = (channel, ...args) => { if (channel === 'tabs:drag-state') trace.push({ at: Date.now(), id: wc.id, channel, value: args[0] }); return send(channel, ...args); };
  115 |       };
  116 |       for (const wc of webContents.getAllWebContents()) watch(wc);
  117 |       app.on('web-contents-created', (_event, wc) => watch(wc));
  118 |     });
  119 |     await input.send({ keyDown: ['Super_L'], keys: ['Left'], keyUp: ['Super_L'] });
  120 |     await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(960);
  121 |     if (moving === 'web') await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
  122 |     else await f.page.locator('.new-tab-button').click();
  123 |     const tab = f.page.getByRole('tab', { name: moving === 'web' ? /Research page/ : /notes.md/ });
  124 |     await expect(tab).toBeVisible();
  125 |     const id = (await tab.getAttribute('data-tab-id'))!;
  126 |     const nativeId = moving === 'web' ? await f.app.evaluate(async ({ webContents }, origin) => {
  127 |       const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
  128 |       await wc.executeJavaScript('document.querySelector("#draft").value="PRESERVED_WAYLAND_FORM"'); return wc.id;
  129 |     }, f.origin) : null;
  130 |     await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-window')!.click());
  131 |     const shells = async () => (await Promise.all(f.app.windows().filter(page => page.url() === f.page.url()).map(async page =>
  132 |       await page.locator('.shell').count().catch(() => 0) ? page : null))).filter(page => page !== null);
  133 |     await expect.poll(async () => (await shells()).length).toBe(2);
  134 |     const other = (await shells()).find(page => page !== f.page)!; pages.push(other);
  135 |     await expect(other.locator('.shell')).toBeVisible();
  136 |     await input.send({ keyDown: ['Super_L'], keys: ['Right'], keyUp: ['Super_L'] });
  137 |     await expect.poll(() => other.evaluate(() => innerWidth)).toBe(960);
  138 |     if (moving === 'web') await other.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
  139 |     else await other.getByRole('button', { name: 'New Document', exact: true }).click();
  140 |     await expect(other.getByRole('tab', { name: moving === 'web' ? /Second page/ : /Untitled/ })).toBeVisible();
  141 |     const bounds = await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  142 |       .filter(window => window.isVisible()).map(window => window.getBounds()));
  143 |     expect(bounds).toHaveLength(2);
  144 |     if (compatibility) {
  145 |       expect(await f.app.evaluate(({ app }) => app.commandLine.getSwitchValue('ozone-platform'))).toBe('x11');
  146 |       expect(bounds[0].x).not.toBe(bounds[1].x);
  147 |     } else {
  148 |       // Native Wayland reports identical origins for physically separate windows.
  149 |       expect(bounds[0].x).toBe(bounds[1].x); expect(bounds[0].y).toBe(bounds[1].y);
  150 |     }
  151 |     await writeFile(test.info().outputPath('wayland-reported-bounds.json'), JSON.stringify(bounds, null, 2));
  152 |     for (const page of pages) await page.evaluate(() => {
  153 |       const trace: unknown[] = []; (globalThis as any).waylandDomTrace = trace;
  154 |       for (const type of ['dragenter', 'dragover', 'dragleave', 'drop', 'dragend']) window.addEventListener(type, event => {
  155 |         const e = event as DragEvent;
  156 |         trace.push({ at: Date.now(), type, x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.className,
  157 |           trusted: e.isTrusted, prevented: e.defaultPrevented, buttons: e.buttons, button: e.button,
```