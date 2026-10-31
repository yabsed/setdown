# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terminal/terminal-launch.spec.ts >> XWayland startup preserves terminal privileges and renderer sandboxing (inherited restriction: false)
- Location: test/e2e/terminal/terminal-launch.spec.ts:19:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1   | import { chromium, expect, test, type Browser } from '@playwright/test';
  2   | import { spawn } from 'node:child_process';
  3   | import { createRequire } from 'node:module';
  4   | import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
  5   | import os from 'node:os';
  6   | import path from 'node:path';
  7   | 
  8   | const executable = createRequire(import.meta.url)('electron') as string;
  9   | type Launch = { phase: string; pid: number; argv: string[]; status: string };
  10  | const flag = (status: string, name: string) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)$`, 'm'))?.[1]);
  11  | async function launches(file: string): Promise<Launch[]> {
  12  |   return (await readFile(file, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  13  | }
  14  | function running(pid: number): boolean {
  15  |   try { process.kill(pid, 0); return true; } catch { return false; }
  16  | }
  17  | 
  18  | for (const inheritedRestriction of [false, true])
  19  | test(`XWayland startup preserves terminal privileges and renderer sandboxing (inherited restriction: ${inheritedRestriction})`, async () => {
  20  |   test.skip(process.platform !== 'linux', 'Linux process privilege flags and XWayland startup.');
  21  |   expect(process.env.SETDOWN_ISOLATED_DISPLAY).toBe('1');
  22  |   expect(process.env.DISPLAY).toBeTruthy();
  23  |   expect(flag(await readFile('/proc/self/status', 'utf8'), 'NoNewPrivs'), 'Run from an unrestricted parent to detect new restrictions.').toBe(0);
  24  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-launch-'));
  25  |   const report = path.join(root, 'launches.jsonl'), profile = path.join(root, 'profile');
  26  |   const document = path.join(root, '시작 문서 with spaces.txt');
  27  |   await writeFile(document, 'Startup document survived the display handoff.\n');
  28  |   const { ELECTRON_RUN_AS_NODE: _, NODE_OPTIONS: __, WAYLAND_DISPLAY: ___, WAYLAND_SOCKET: ____, ...env } = process.env;
  29  |   const args = [path.resolve('test/fixtures/terminal-launch.cjs'), document,
  30  |     ...(inheritedRestriction ? ['--ozone-platform', 'auto'] : ['--ozone-platform=auto']),
  31  |     '--remote-debugging-port=0', `--user-data-dir=${profile}`];
  32  |   // Use Xvfb's private X server, while exercising the Wayland-to-X11 policy.
  33  |   // The restricted case verifies that the fix never removes inherited policy.
  34  |   const child = spawn(inheritedRestriction ? 'setpriv' : executable,
  35  |     inheritedRestriction ? ['--no-new-privs', executable, ...args] : args, {
  36  |       env: { ...env, XDG_SESSION_TYPE: 'wayland', SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config'),
  37  |         SETDOWN_TEST_APP_ENTRY: path.resolve('dist-electron/main.cjs'), SETDOWN_TEST_LAUNCH_REPORT: report },
  38  |       stdio: ['ignore', 'pipe', 'pipe'],
  39  |     });
  40  |   let log = '', browser: Browser | undefined;
  41  |   child.stdout.on('data', data => { log += data; });
  42  |   child.stderr.on('data', data => { log += data; });
  43  |   child.on('error', error => { log += error.stack; });
  44  |   try {
  45  |     await expect.poll(async () => (await launches(report)).filter(row => row.phase === 'window').length,
> 46  |       { timeout: 20_000 }).toBe(1);
      |                            ^ Error: expect(received).toBe(expected) // Object.is equality
  47  |     const records = await launches(report), entries = records.filter(row => row.phase === 'entry');
  48  |     expect(entries).toHaveLength(2);
  49  |     const [before, after] = entries;
  50  |     expect(before.pid).toBe(child.pid);
  51  |     expect(after.pid).not.toBe(before.pid);
  52  |     expect(after.argv).toContain('--ozone-platform=x11');
  53  |     expect(after.argv).toContain(document);
  54  |     expect(after.argv).not.toContain('--ozone-platform=auto');
  55  |     expect(after.argv).not.toContain('--ozone-platform');
  56  |     const expectedFlag = Number(inheritedRestriction);
  57  |     expect(flag(before.status, 'NoNewPrivs')).toBe(expectedFlag);
  58  |     expect(flag(after.status, 'NoNewPrivs')).toBe(expectedFlag);
  59  |     expect(flag(after.status, 'Seccomp')).toBe(flag(before.status, 'Seccomp'));
  60  | 
  61  |     const portFile = path.join(profile, 'DevToolsActivePort');
  62  |     await expect.poll(() => readFile(portFile, 'utf8').catch(() => '')).toMatch(/^\d+\n/);
  63  |     const [port, endpoint] = (await readFile(portFile, 'utf8')).trim().split('\n');
  64  |     browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${endpoint}`);
  65  |     const context = browser.contexts()[0];
  66  |     await expect.poll(() => context.pages().length).toBeGreaterThan(0);
  67  |     const page = context.pages()[0];
  68  |     await expect(page.getByRole('tab', { name: /시작 문서 with spaces.txt/ })).toBeVisible();
  69  |     await expect(page.locator('.editor-surface .view-lines')).toContainText('Startup document survived the display handoff.');
  70  |     await page.locator('.new-terminal-tab-button').click();
  71  |     const input = page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
  72  |     await expect(input).toBeFocused();
  73  |     // Read the shell itself, not the status of grep/cat or a test-owned child.
  74  |     await input.pressSequentially('cat /proc/$$/status > shell-status.txt');
  75  |     await input.press('Enter');
  76  |     const statusFile = path.join(root, 'shell-status.txt');
  77  |     await expect.poll(() => readFile(statusFile, 'utf8').catch(() => '')).toContain('NoNewPrivs:');
  78  |     const shellStatus = await readFile(statusFile, 'utf8');
  79  |     expect(flag(shellStatus, 'NoNewPrivs')).toBe(expectedFlag);
  80  |     expect(flag(shellStatus, 'PPid')).toBe(after.pid);
  81  | 
  82  |     const cdp = await browser.newBrowserCDPSession();
  83  |     const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  84  |     const renderers = processInfo.filter((process: { type: string }) => process.type === 'renderer');
  85  |     expect(renderers.length).toBeGreaterThan(0);
  86  |     const rendererStatuses: string[] = [];
  87  |     for (const renderer of renderers) {
  88  |       const status = await readFile(`/proc/${renderer.id}/status`, 'utf8');
  89  |       rendererStatuses.push(status);
  90  |       expect(flag(status, 'NoNewPrivs')).toBe(1);
  91  |       expect(flag(status, 'Seccomp')).toBe(2);
  92  |     }
  93  |     await writeFile(test.info().outputPath('privileges.json'), JSON.stringify({ records, shellStatus, rendererStatuses }, null, 2));
  94  |     await page.screenshot({ path: test.info().outputPath('terminal-after-handoff.png') });
  95  |     await page.evaluate(() => window.close());
  96  |     await expect.poll(() => running(after.pid)).toBe(false);
  97  |   } finally {
  98  |     await browser?.close();
  99  |     const records = await launches(report);
  100 |     const pids = new Set([child.pid, ...records.map(row => row.pid)]);
  101 |     for (const pid of pids) if (pid && running(pid)) process.kill(pid, 'SIGTERM');
  102 |     await writeFile(test.info().outputPath('launch.log'), log);
  103 |     await writeFile(test.info().outputPath('launches.json'), JSON.stringify(records, null, 2));
  104 |     await rm(root, { recursive: true, force: true });
  105 |   }
  106 | });
  107 | 
```