import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fixture } from '../support/browser/browser-fixture';
import { waylandInput } from '../support/electron/wayland-input';

const compatibility = process.env.SETDOWN_TEST_DISPLAY === 'xwayland';
if (compatibility) test('default startup relaunches once on XWayland and preserves the requested document', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-display-startup-'));
  const profile = path.join(root, 'profile'), file = path.join(root, 'startup.md');
  await writeFile(file, '# Startup survives backend selection\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const child = spawn(createRequire(import.meta.url)('electron'),
    ['--enable-automation', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '.', file],
    { env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') }, stdio: ['ignore', 'ignore', 'pipe'] });
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
    await expect(page.getByRole('tab', { name: /startup.md/ })).toBeVisible();
    expect(browser.contexts()[0].pages().filter(page => page.url().startsWith('data:text/html;charset=utf-8,'))).toHaveLength(0);
    expect(browserPid).not.toBe(child.pid);
    // Linux process titles can overwrite /proc/pid/cmdline. Query Chromium's
    // actual startup switches, including the backend selected before main.
    const args = (await session.send('Browser.getBrowserCommandLine')).arguments;
    expect(args.filter(arg => arg === '--ozone-platform=x11')).toHaveLength(1);
    expect(args).toContain(file);
    await writeFile(test.info().outputPath('startup.json'), JSON.stringify({ initialPid: child.pid, finalPid: browserPid, args }, null, 2));
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
