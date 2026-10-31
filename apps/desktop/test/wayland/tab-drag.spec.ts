import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fixture } from '../support/browser/browser-fixture';
import { waylandInput } from '../support/electron/wayland-input';
import { focusApplication } from '../support/electron/electron-app';

const compatibility = process.env.SETDOWN_TEST_DISPLAY === 'xwayland';
if (compatibility) test('maximized split terminal drags into the right quarter of an existing website', async () => {
  const input = await waylandInput();
  const f = await fixture(false).catch(async error => { await input.close(); throw error; });
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await f.page.locator('.new-terminal-tab-button').click();
    const tab = f.page.getByRole('tab', { name: /Terminal 1/ });
    await expect(tab).toBeVisible();
    const owner = await f.app.browserWindow(f.page);
    const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
    }, point);
    const body = (await f.page.locator('.group-body').boundingBox())!, box = (await tab.boundingBox())!;
    const from = await toScreen({ x: box.x + 35, y: box.y + box.height / 2 });
    await input.send({ pointer: [from], button: 'down' });
    await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }, await toScreen({ x: 20, y: body.y + body.height / 2 })] });
    await input.send({ button: 'up' });
    await expect(f.page.locator('.editor-group')).toHaveCount(2);
    await owner.evaluate(window => window.maximize());
    await expect.poll(() => owner.evaluate(window => window.isMaximized())).toBe(true);
    await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(1920);
    await input.send({ resetPointer: true });
    const target = f.page.locator('.editor-group').filter({ has: f.page.getByRole('tab', { name: /Research page/ }) });
    const targetBody = (await target.locator('.group-body').boundingBox())!, source = (await tab.boundingBox())!;
    const start = await toScreen({ x: source.x + 55, y: source.y + source.height / 2 });
    await input.send({ pointer: [start], button: 'down' });
    await input.send({ pointer: [{ x: start.x + 20, y: start.y + 15 }] });
    for (const position of [{ x: .125, y: .25 }, { x: .5, y: .25 }, { x: .875, y: .25 }, { x: .99, y: .75 }]) {
      await input.send({ pointer: [await toScreen({ x: targetBody.x + targetBody.width * position.x,
        y: targetBody.y + targetBody.height * position.y })] });
      const guide = f.page.locator('.group-drop-overlay');
      await expect(guide).toBeVisible();
      if (position.x >= .75) {
        await expect.poll(async () => (await guide.boundingBox())?.x).toBeCloseTo(targetBody.x + targetBody.width / 2, 0);
        expect((await guide.boundingBox())!.height).toBeCloseTo(targetBody.height, 0);
      }
    }
    await input.send({ button: 'up' });
    await expect(f.page.locator('.editor-group')).toHaveCount(2);
    await expect.poll(async () => (await tab.boundingBox())!.x).toBeGreaterThan(900);
    expect(f.errors).toEqual([]);
  } finally {
    await f.page.screenshot({ path: test.info().outputPath('split-maximized-final.png') }).catch(() => {});
    await input.send({ keys: ['Escape'], button: 'up' });
    await f.dispose(); await input.close();
  }
});

if (compatibility) test('existing terminal and website split right after maximizing the window', async () => {
  const input = await waylandInput();
  const f = await fixture(false).catch(async error => { await input.close(); throw error; });
  const trace: unknown[] = [];
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await f.page.locator('.new-terminal-tab-button').click();
    const tab = f.page.getByRole('tab', { name: /Terminal 1/ });
    await expect(tab).toBeVisible();
    await f.page.getByRole('tab', { name: /Research page/ }).click();
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
    const owner = await f.app.browserWindow(f.page);
    const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
    }, point);
    await f.app.evaluate(({ ipcMain }) => {
      (globalThis as any).maximizedTrace = [];
      for (const channel of ['tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event', 'browser:tab-drag-guide'])
        ipcMain.on(channel, (_event, ...args) => (globalThis as any).maximizedTrace.push({ at: Date.now(), channel, args }));
    });
    await f.page.evaluate(() => {
      (window as any).maximizedEvents = [];
      for (const type of ['pointerdown', 'pointerup', 'drag', 'dragstart', 'dragenter', 'dragover', 'drop', 'dragend', 'dragleave']) window.addEventListener(type, event => {
        const e = event as DragEvent;
        (window as any).maximizedEvents.push({ at: Date.now(), type, x: e.clientX, y: e.clientY,
          screenX: e.screenX, screenY: e.screenY, effect: e.dataTransfer?.dropEffect, trusted: e.isTrusted });
      }, true);
    });
    for (let round = -1; round < 12; round++) {
      if (round === 6) {
        await owner.evaluate(window => window.unmaximize());
        await expect.poll(() => owner.evaluate(window => window.isMaximized())).toBe(false);
        await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(1080);
        await input.send({ resetPointer: true });
      }
      if (round === 0 || round === 7) {
        await owner.evaluate(window => window.maximize());
        await expect.poll(() => owner.evaluate(window => window.isMaximized())).toBe(true);
        await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(1920);
        await input.send({ resetPointer: true });
      }
      if (round === 8) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
      const body = (await f.page.locator('.group-body').boundingBox())!, box = (await tab.boundingBox())!;
      const from = await toScreen({ x: box.x + 35 + round % 2 * 20, y: box.y + box.height / 2 });
      const y = body.y + body.height * (round % 2 ? .75 : .25);
      const center = await toScreen({ x: body.x + body.width * .5, y });
      const right = await toScreen({ x: body.x + body.width * (round % 3 ? .875 : .99), y });
      trace.push({ round, body, from, center, right });
      await input.send({ pointer: [from], button: 'down' });
      trace.push(await f.app.evaluate(({ screen }) => ({ cursor: screen.getCursorScreenPoint() })));
      await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }, center] });
      if (round === 0 || round === 1 || round === 7) {
        await input.send({ pointer: [right] });
        const receiver = f.app.windows().find(page => page.url().startsWith('data:text/html;charset=utf-8,'))!;
        trace.push({ receiver: await receiver.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })),
          native: await owner.evaluate(window => window.contentView.children.map((view: Electron.View) => ({ bounds: view.getBounds(), visible: view.getVisible() }))) });
        const guide = f.page.locator('.group-drop-overlay');
        await expect(guide).toBeVisible();
        await expect.poll(async () => (await guide.boundingBox())?.width).toBeCloseTo(body.width / 2, 0);
        const painted = (await guide.boundingBox())!;
        expect(painted.x).toBeCloseTo(body.x + body.width / 2, 0);
        expect(painted.height).toBeCloseTo(body.height, 0);
      }
      await input.send({ pointer: [right], pointerIntervalMs: 0, button: 'up' });
      await expect(f.page.locator('.editor-group')).toHaveCount(2);
      await expect.poll(async () => (await tab.boundingBox())!.x).toBeGreaterThan(body.x + body.width * .45);
      await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
      expect(await owner.evaluate(window => window.isMaximized())).toBe(round >= 0 && round !== 6);
      expect(await owner.evaluate(window => window.isFocused())).toBe(true);
      expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      const data = await f.page.evaluateHandle(() => new DataTransfer());
      const strip = f.page.locator('.editor-group').filter({ hasNot: tab }).locator('.tab-strip');
      const rect = (await strip.boundingBox())!;
      await tab.dispatchEvent('dragstart', { dataTransfer: data });
      const point = { dataTransfer: data, clientX: rect.x + 10, clientY: rect.y + rect.height / 2 };
      await strip.dispatchEvent('dragover', point); await strip.dispatchEvent('drop', point); await data.dispose();
      await expect(f.page.locator('.editor-group')).toHaveCount(1);
      await f.page.getByRole('tab', { name: /Research page/ }).click();
    }
    expect(f.errors).toEqual([]);
    await owner.dispose();
  } finally {
    await writeFile(test.info().outputPath('maximized-trace.json'), JSON.stringify({ steps: trace,
      ipc: await f.app.evaluate(() => (globalThis as any).maximizedTrace ?? []),
      dom: await f.page.evaluate(() => (window as any).maximizedEvents ?? []),
    }, null, 2));
    await f.page.screenshot({ path: test.info().outputPath('maximized-final.png') }).catch(() => {});
    await input.send({ keys: ['Escape'], button: 'up' });
    await f.dispose(); await input.close();
  }
});

for (const mode of ['maximized', 'fullscreen'] as const)
for (const moving of ['web', 'document'] as const)
test(`${mode} ${moving} drags follow all eight split cells and never open a window`, async () => {
  const input = await waylandInput();
  const f = await fixture(false).catch(async error => { await input.close(); throw error; });
  try {
    const owner = await f.app.browserWindow(f.page);
    await owner.evaluate((window, mode) => new Promise<void>(resolve => {
      window.once(mode === 'fullscreen' ? 'enter-full-screen' : 'maximize', () => resolve());
      if (mode === 'fullscreen') window.setFullScreen(true); else window.maximize();
    }), mode);
    await expect.poll(() => owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
    await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(1920);
    await focusApplication(f.app);
    // Fullscreen entry can warp the cursor after the device was initialized.
    await input.send({ resetPointer: true });
    if (moving === 'web') {
      await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
      await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    } else {
      await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), path.join(f.root, 'notes.md'));
      await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
      await f.page.locator('.new-tab-button').click();
    }
    const tab = f.page.getByRole('tab', { name: moving === 'web' ? /Second page/ : /notes.md/ });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await f.app.evaluate(({ app, ipcMain }) => {
      (globalThis as any).fullscreenDragTrace = [];
      (globalThis as any).dragCreatedWindows = 0;
      app.on('browser-window-created', () => (globalThis as any).dragCreatedWindows++);
      for (const channel of ['tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event'])
        ipcMain.on(channel, (_event, value) => (globalThis as any).fullscreenDragTrace.push({ channel, value }));
    });
    await f.page.evaluate(() => {
      (window as any).fullscreenDragEvents = [];
      for (const type of ['pointerdown', 'pointerup', 'drag', 'dragstart', 'dragend']) window.addEventListener(type, event => {
        const e = event as MouseEvent;
        (window as any).fullscreenDragEvents.push({ type, x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.className });
      }, true);
    });
    const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
    }, point);
    const overlay = f.page.locator('.group-drop-overlay');
    const placements = [
      { name: '1', x: .125, y: .25, direction: 'left' }, { name: '2', x: .375, y: .25, direction: 'up' },
      { name: '3', x: .625, y: .25, direction: 'up' }, { name: '4', x: .875, y: .25, direction: 'right' },
      { name: '5', x: .125, y: .75, direction: 'left' }, { name: '6', x: .375, y: .75, direction: 'down' },
      { name: '7', x: .625, y: .75, direction: 'down' }, { name: '8', x: .875, y: .75, direction: 'right' },
      { name: 'left-top', x: 0, y: .1, direction: 'left' }, { name: 'right-top', x: 1, y: .1, direction: 'right' },
      { name: 'left-bottom', x: 0, y: .9, direction: 'left' }, { name: 'right-bottom', x: 1, y: .9, direction: 'right' },
      { name: 'fast-right', x: 1, y: .5, direction: 'right' }, { name: 'center', x: .5, y: .55, direction: 'down' },
      { name: 'escape', x: 1, y: .5, direction: 'right' },
    ] as const;
    for (const [round, placement] of placements.entries()) {
      if (round === 2) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
      const bounds = await owner.evaluate(window => window.getBounds());
      const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
      const from = await toScreen({ x: box.x + 40 + round % 2 * 20, y: box.y + box.height / 2 });
      await owner.evaluate((window, details) => (globalThis as any).fullscreenDragTrace.push({
        ...details, contentBounds: window.getContentBounds(),
        children: window.contentView.children.map((view: Electron.View) => ({ bounds: view.getBounds(), visible: view.getVisible(),
          url: 'webContents' in view ? (view as Electron.WebContentsView).webContents.getURL() : '' })),
      }), { placement, bounds, from, box, body });
      await input.send({ pointer: [from], button: 'down' });
      if (compatibility) await f.app.evaluate(({ screen, BrowserWindow }) => (globalThis as any).fullscreenDragTrace.push({
        cursor: screen.getCursorScreenPoint(), focused: BrowserWindow.getFocusedWindow()?.id,
      }));
      await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }] });
      // Approach from the middle first so side cells must replace a vertical
      // guide immediately. At the center the grid selects the lower half.
      const y = body.y + body.height * placement.y;
      await input.send({ pointer: [await toScreen({ x: body.x + body.width / 2, y })] });
      await expect(overlay).toBeVisible();
      expect((await overlay.boundingBox())!.height).toBeCloseTo(body.height / 2, 0);
      const horizontal = placement.direction === 'left' || placement.direction === 'right';
      const destination = await toScreen({ x: body.x + Math.max(1, Math.min(body.width - 1, body.width * placement.x)), y });
      if (placement.name === 'fast-right') {
        // No guide wait may hide the native center-to-edge release race.
        await input.send({ pointer: [destination], pointerIntervalMs: 0, button: 'up' });
      } else {
        await input.send({ pointer: [destination] });
        await expect(overlay).toBeVisible();
        const guide = (await overlay.boundingBox())!;
        expect(guide.x).toBeCloseTo(body.x + (placement.direction === 'right' ? body.width / 2 : 0), 0);
        expect(guide.y).toBeCloseTo(body.y + (placement.direction === 'down' ? body.height / 2 : 0), 0);
        expect(guide.width).toBeCloseTo(body.width / (horizontal ? 2 : 1), 0);
        expect(guide.height).toBeCloseTo(body.height / (horizontal ? 1 : 2), 0);
        if (placement.name === 'escape') await input.send({ keys: ['Escape'] });
        await input.send({ button: 'up' });
      }
      const split = placement.name !== 'escape';
      await expect(f.page.locator('.editor-group')).toHaveCount(split ? 2 : 1);
      await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
      expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      expect(await f.app.evaluate(() => (globalThis as any).dragCreatedWindows)).toBe(0);
      expect(await owner.evaluate(window => window.getBounds())).toEqual(bounds);
      expect(await owner.evaluate((window, mode) => mode === 'fullscreen' ? window.isFullScreen() : window.isMaximized(), mode)).toBe(true);
      if (split) {
        const moved = (await f.page.locator('.editor-group').filter({ has: tab }).boundingBox())!;
        const remaining = (await f.page.locator('.editor-group').filter({ hasNot: tab }).boundingBox())!;
        const axis = horizontal ? 'x' : 'y';
        if (placement.direction === 'left' || placement.direction === 'up') expect(moved[axis]).toBeLessThan(remaining[axis]);
        else expect(moved[axis]).toBeGreaterThan(remaining[axis]);
        expect(moved[horizontal ? 'width' : 'height']).toBeCloseTo(remaining[horizontal ? 'width' : 'height'], 0);
        // Restore one group between independent native gestures.
        const other = f.page.locator('.editor-group').filter({ hasNot: tab }).locator('.tab-strip');
        const strip = (await other.boundingBox())!;
        const data = await f.page.evaluateHandle(() => new DataTransfer());
        await tab.dispatchEvent('dragstart', { dataTransfer: data });
        const point = { dataTransfer: data, clientX: strip.x + 10, clientY: strip.y + strip.height / 2 };
        await other.dispatchEvent('dragover', point); await other.dispatchEvent('drop', point); await data.dispose();
        await expect(f.page.locator('.editor-group')).toHaveCount(1);
      }
    }
    expect(f.errors).toEqual([]);
    await owner.dispose();
  } finally {
    await writeFile(test.info().outputPath('fullscreen-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).fullscreenDragTrace ?? []), null, 2));
    await writeFile(test.info().outputPath('fullscreen-drag-events.json'), JSON.stringify(await f.page.evaluate(() => (window as any).fullscreenDragEvents ?? []), null, 2));
    await input.send({ keys: ['Escape'], button: 'up' });
    await f.page.screenshot({ path: test.info().outputPath('final.png') }).catch(() => {});
    await f.dispose(); await input.close();
  }
});

const processFlag = (status: string, name: string) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)$`, 'm'))?.[1]);
if (compatibility) for (const inheritedRestriction of [false, true])
test(`default startup preserves document, terminal privileges and renderer sandbox on XWayland (inherited restriction: ${inheritedRestriction})`, async () => {
  expect(processFlag(await readFile('/proc/self/status', 'utf8'), 'NoNewPrivs'),
    'Run from an unrestricted parent to detect accidentally added restrictions.').toBe(0);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-display-startup-'));
  const profile = path.join(root, 'profile'), file = path.join(root, 'startup 문서 with spaces.md');
  await writeFile(file, '# Startup survives backend selection\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const packaged = process.env.SETDOWN_TEST_PACKAGED_EXECUTABLE;
  const executable = packaged ?? createRequire(import.meta.url)('electron') as string;
  const launchArgs = ['--enable-automation', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    ...(packaged ? [] : ['.']), file];
  // A pre-existing restriction must survive; the handoff must never bypass it.
  const child = spawn(inheritedRestriction ? 'setpriv' : executable,
    inheritedRestriction ? ['--no-new-privs', executable, ...launchArgs] : launchArgs,
    { env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  let browserPid: number | undefined;
  try {
    await expect.poll(() => child.exitCode).toBe(0);
    const endpoint = async () => {
      const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
      if (!port) return '';
      return fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json())
        .then(data => data.webSocketDebuggerUrl as string).catch(() => '');
    };
    await expect.poll(endpoint).toMatch(/^ws:\/\//);
    browser = await chromium.connectOverCDP(await endpoint(), { timeout: 10_000 });
    const session = await browser.newBrowserCDPSession();
    const processes = await session.send('SystemInfo.getProcessInfo');
    browserPid = processes.processInfo.find(process => process.type === 'browser')!.id;
    await expect.poll(() => browser!.contexts()[0].pages().map(page => page.url())).toContainEqual(expect.stringContaining('/dist/index.html'));
    const page = browser.contexts()[0].pages().find(page => page.url().includes('/dist/index.html'))!;
    await expect(page.getByRole('tab', { name: /startup 문서 with spaces.md/ })).toBeVisible();
    expect(browser.contexts()[0].pages().filter(page => page.url().startsWith('data:text/html;charset=utf-8,'))).toHaveLength(0);
    expect(browserPid).not.toBe(child.pid);
    // Linux process titles can overwrite /proc/pid/cmdline. Query Chromium's
    // actual startup switches, including the backend selected before main.
    const args = (await session.send('Browser.getBrowserCommandLine')).arguments;
    expect(args.filter(arg => arg === '--ozone-platform=x11')).toHaveLength(1);
    expect(args).toContain(file);
    const mainStatus = await readFile(`/proc/${browserPid}/status`, 'utf8');
    const expectedFlag = Number(inheritedRestriction);
    expect(processFlag(mainStatus, 'NoNewPrivs')).toBe(expectedFlag);
    await page.locator('.new-terminal-tab-button').click();
    const terminal = page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');
    await expect(terminal).toBeFocused();
    // $$ reads the actual interactive shell, not a test process or grep child.
    await terminal.pressSequentially('cat /proc/$$/status > shell-status.txt');
    await terminal.press('Enter');
    const statusFile = path.join(root, 'shell-status.txt');
    await expect.poll(() => readFile(statusFile, 'utf8').catch(() => '')).toContain('NoNewPrivs:');
    const shellStatus = await readFile(statusFile, 'utf8');
    expect(processFlag(shellStatus, 'NoNewPrivs')).toBe(expectedFlag);
    expect(processFlag(shellStatus, 'PPid')).toBe(browserPid);
    const rendererProcesses = (await session.send('SystemInfo.getProcessInfo')).processInfo
      .filter(process => process.type === 'renderer');
    expect(rendererProcesses.length).toBeGreaterThan(0);
    const rendererStatuses = [];
    for (const renderer of rendererProcesses) {
      const status = await readFile(`/proc/${renderer.id}/status`, 'utf8');
      rendererStatuses.push(status);
      expect(processFlag(status, 'NoNewPrivs')).toBe(1);
      expect(processFlag(status, 'Seccomp')).toBe(2);
    }
    await writeFile(test.info().outputPath('startup.json'), JSON.stringify({
      initialPid: child.pid, finalPid: browserPid, args, mainStatus, shellStatus, rendererStatuses,
    }, null, 2));
    await page.screenshot({ path: test.info().outputPath('terminal-after-startup.png') });
  } catch (error) {
    console.error('Startup verification failed:', String(error));
    throw error;
  } finally {
    await writeFile(test.info().outputPath('startup.log'), stderr);
    // This raw launch has no ElectronApplication handle. Terminate only the
    // browser PID returned by our private debugging connection, not user apps.
    if (browserPid) { try { process.kill(browserPid, 'SIGTERM'); } catch {} }
    await browser?.close();
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
});

for (const moving of ['web', 'document'] as const)
test(`${compatibility ? 'XWayland compatibility' : 'native Wayland'} ${moving} drag paints split and merge guides across windows`, async () => {
  const input = await waylandInput();
  const f = await fixture().catch(async error => { await input.close(); throw error; });
  const pages: Page[] = [f.page];
  const wire: string[] = [];
  f.app.process().stderr?.on('data', chunk => { for (const line of String(chunk).split('\n'))
    if (/data_offer|data_source|data_device|wl_keyboard.*key\(/.test(line)) wire.push(line); });
  try {
    await f.app.evaluate(({ ipcMain, webContents, app }) => {
      const trace: unknown[] = []; (globalThis as any).waylandDragTrace = trace;
      for (const channel of ['tabs:register-transfer', 'tabs:drag-target', 'tabs:detach-to-window', 'tabs:cancel-transfer', 'tab-drag-surface:event'])
        ipcMain.on(channel, (event, value) => trace.push({ at: Date.now(), id: event.sender.id, channel, value }));
      const watch = (wc: Electron.WebContents) => {
        wc.on('focus', () => trace.push({ at: Date.now(), id: wc.id, type: 'focus' }));
        wc.on('blur', () => trace.push({ at: Date.now(), id: wc.id, type: 'blur' }));
        const send = wc.send.bind(wc);
        wc.send = (channel, ...args) => { if (channel === 'tabs:drag-state') trace.push({ at: Date.now(), id: wc.id, channel, value: args[0] }); return send(channel, ...args); };
      };
      for (const wc of webContents.getAllWebContents()) watch(wc);
      app.on('web-contents-created', (_event, wc) => watch(wc));
    });
    await input.send({ keyDown: ['Super_L'], keys: ['Left'], keyUp: ['Super_L'] });
    await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(960);
    if (moving === 'web') await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    else await f.page.locator('.new-tab-button').click();
    const tab = f.page.getByRole('tab', { name: moving === 'web' ? /Research page/ : /notes.md/ });
    await expect(tab).toBeVisible();
    const id = (await tab.getAttribute('data-tab-id'))!;
    const nativeId = moving === 'web' ? await f.app.evaluate(async ({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      await wc.executeJavaScript('document.querySelector("#draft").value="PRESERVED_WAYLAND_FORM"'); return wc.id;
    }, f.origin) : null;
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-window')!.click());
    const shells = async () => (await Promise.all(f.app.windows().filter(page => page.url() === f.page.url()).map(async page =>
      await page.locator('.shell').count().catch(() => 0) ? page : null))).filter(page => page !== null);
    await expect.poll(async () => (await shells()).length).toBe(2);
    const other = (await shells()).find(page => page !== f.page)!; pages.push(other);
    await expect(other.locator('.shell')).toBeVisible();
    await input.send({ keyDown: ['Super_L'], keys: ['Right'], keyUp: ['Super_L'] });
    await expect.poll(() => other.evaluate(() => innerWidth)).toBe(960);
    if (moving === 'web') await other.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    else await other.getByRole('button', { name: 'New Document', exact: true }).click();
    await expect(other.getByRole('tab', { name: moving === 'web' ? /Second page/ : /Untitled/ })).toBeVisible();
    const bounds = await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .filter(window => window.isVisible()).map(window => window.getBounds()));
    expect(bounds).toHaveLength(2);
    if (compatibility) {
      expect(await f.app.evaluate(({ app }) => app.commandLine.getSwitchValue('ozone-platform'))).toBe('x11');
      expect(bounds[0].x).not.toBe(bounds[1].x);
    } else {
      // Native Wayland reports identical origins for physically separate windows.
      expect(bounds[0].x).toBe(bounds[1].x); expect(bounds[0].y).toBe(bounds[1].y);
    }
    await writeFile(test.info().outputPath('wayland-reported-bounds.json'), JSON.stringify(bounds, null, 2));
    for (const page of pages) await page.evaluate(() => {
      const trace: unknown[] = []; (globalThis as any).waylandDomTrace = trace;
      for (const type of ['dragenter', 'dragover', 'dragleave', 'drop', 'dragend']) window.addEventListener(type, event => {
        const e = event as DragEvent;
        trace.push({ at: Date.now(), type, x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.className,
          trusted: e.isTrusted, prevented: e.defaultPrevented, buttons: e.buttons, button: e.button,
          effect: e.dataTransfer?.dropEffect, allowed: e.dataTransfer?.effectAllowed, types: [...(e.dataTransfer?.types ?? [])] });
      });
    });
    let owner = 0;
    for (let round = 0; round < 40; round++) {
      console.log('Wayland drag round', round);
      const destination = 1 - owner, canceled = [2, 8, 20, 28].includes(round), strip = [4, 6, 9, 11].includes(round) || round >= 12 && round % 2 === 0;
      const source = pages[owner].locator(`[data-tab-id="${id}"]`);
      const box = (await source.boundingBox())!;
      const body = (await pages[destination].locator(strip ? '.tab-strip' : '.group-body').first().boundingBox())!;
      // Physical positions are known from our private compositor's tiling;
      // Electron global bounds deliberately cannot be used for this input.
      const from = { x: owner * 960 + box.x + 35 + (round % 4) * 12, y: box.y + 15 };
      const to = { x: destination * 960 + body.x + body.width * (round === 1 ? .92 : .5), y: body.y + (strip ? 15 : body.height * .5) };
      await input.send({ pointer: [from], button: 'down' });
      await input.send({ pointer: [{ x: from.x + 20, y: from.y + 15 }, { x: from.x + 20, y: to.y }, to] });
      await expect(pages[destination].locator(strip ? '.tab-drop-indicator' : '.group-drop-overlay')).toBeVisible();
      const nativeWindow = await f.app.browserWindow(pages[destination]);
      if (moving === 'web' && round === 0) {
        // Shell screenshots do not include sibling native web views. Inspect
        // and capture the actual transparent guide renderer above the page too.
        const nativeGuide = () => nativeWindow.evaluate(async window => {
          const layer = window.contentView.children.find((view: Electron.View) => 'webContents' in view
            && (view as Electron.WebContentsView).webContents.getURL().startsWith('data:text/html;charset=utf-8,')) as Electron.WebContentsView;
          if (!layer?.getVisible()) return null;
          return layer.webContents.executeJavaScript(`(() => {
            const guide = document.querySelector('.guide'); if (!guide) return null;
            const bounds = guide.getBoundingClientRect();
            return { width: bounds.width, height: bounds.height, fill: getComputedStyle(guide).backgroundColor,
              page: getComputedStyle(document.body).backgroundColor };
          })()`);
        });
        await expect.poll(nativeGuide).toMatchObject({ width: 960, height: expect.any(Number),
          fill: expect.stringMatching(/^rgba\(.+, 0\.\d+\)$/), page: 'rgba(0, 0, 0, 0)' });
        const nativeCapture = await nativeWindow.evaluate(async window => {
          const layer = window.contentView.children.find((view: Electron.View) => 'webContents' in view
            && (view as Electron.WebContentsView).webContents.getURL().startsWith('data:text/html;charset=utf-8,')) as Electron.WebContentsView;
          return (await layer.webContents.capturePage()).toPNG().toString('base64');
        });
        await writeFile(test.info().outputPath('native-guide-layer.png'), Buffer.from(nativeCapture, 'base64'));
      }
      if (round < 12) {
        const capture = await nativeWindow.evaluate(async window => (await window.capturePage()).toPNG().toString('base64'));
        await writeFile(test.info().outputPath(`guide-${round}.png`), Buffer.from(capture, 'base64'));
      }
      await nativeWindow.dispose();
      if (canceled) await input.send({ keys: ['Escape'] });
      await input.send({ button: 'up' });
      if (!canceled) {
        await expect(pages[destination].locator(`[data-tab-id="${id}"]`)).toBeVisible();
        await expect(source).toHaveCount(0); owner = destination;
        if (round === 1) await expect(pages[owner].locator('.editor-group')).toHaveCount(2);
      } else await expect(source).toBeVisible();
      for (const page of pages) {
        await expect(page.locator('.group-drop-overlay')).toBeHidden();
        await expect(page.locator('.tab-drop-indicator')).toBeHidden();
        await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
      }
      expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
    }
    if (nativeId) expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), nativeId)).toBe('PRESERVED_WAYLAND_FORM');
    expect(f.errors).toEqual([]);
  } finally {
    await writeFile(test.info().outputPath('wayland-wire.log'), wire.join('\n'));
    await writeFile(test.info().outputPath('wayland-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).waylandDragTrace), null, 2));
    for (const [i, page] of pages.entries()) await writeFile(test.info().outputPath(`dom-${i}.json`), JSON.stringify(await page.evaluate(() => (globalThis as any).waylandDomTrace ?? null), null, 2));
    await input.send({ keys: ['Escape'], button: 'up' });
    for (const [i, page] of pages.entries()) await page.screenshot({ path: test.info().outputPath(`final-${i}.png`) }).catch(() => {});
    await f.dispose(); await input.close();
  }
});
