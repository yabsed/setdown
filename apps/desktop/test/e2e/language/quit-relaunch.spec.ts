import { chromium, expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication } from '../../support/electron/electron-app';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const freePort = () => new Promise<number>(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address() as net.AddressInfo; server.close(() => resolve(port)); }); });
/** Whether the window can ask about a language tool: the lookup of the program on this computer. */
const lookup = (page: Page) => page.evaluate(() => window.marktex.language.catalog(undefined, 'clangd').then(catalog => catalog.entries.some(entry => entry.id === 'clangd') ? 'answered' : 'no such tool', error => String(error)));

// After the last window closes the app gives its language tools a few seconds to leave. For that
// time the process still exists, and it has already given up its services. The app started
// again in that time was handed to that process, which opened a window in which every language
// said "Server discovery cancelled." — and which closed again, or stayed like that for good when
// the shutdown never finished. The start belongs to a new process.
test('the app started again while it is quitting opens in a new process, where language support works', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-quit-relaunch-'));
  const project = path.join(root, 'project'), bin = path.join(root, 'bin'), config = path.join(root, 'config');
  await mkdir(project); await mkdir(bin);
  // A tool that is running when the app quits and does not leave when asked, as a large one may not.
  // It ends when its input closes, so nothing of it outlives the test.
  await writeFile(path.join(bin, 'clangd'), '#!/bin/sh\ntrap "" TERM\ncat >/dev/null\n'); await chmod(path.join(bin, 'clangd'), 0o755);
  const file = path.join(project, 'main.cpp'); await writeFile(file, 'int main() { return 0; }\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...base } = process.env;
  const env = { ...base, XDG_CONFIG_HOME: config, SETDOWN_LSP_INHERIT_ENV: '1', SETDOWN_NATIVE_DIALOGS: '1', PATH: `${bin}${path.delimiter}${base.PATH ?? ''}` } as Record<string, string>;
  const profileOwner = async () => {
    for (const name of await readdir(config).catch(() => [])) { const target = await readlink(path.join(config, name, 'SingletonLock')).catch(() => ''); if (target) return Number(target.split('-').at(-1)); }
    return 0;
  };
  const application = await electron.launch({ args: ['.', file], env });
  let second: ChildProcess | undefined, successor = 0;
  try {
    const page = await application.firstWindow();
    await expect(page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' })).toBeVisible();
    expect(await lookup(page)).toBe('answered');
    const first = await application.evaluate(() => process.pid);
    // The person closes the only window. The test keeps the shutdown open, as a tool that is slow
    // to leave does, so that the second start arrives inside it every time.
    await application.evaluate(({ app, BrowserWindow }) => {
      const state = { quits: 0, starts: 0, hold: (event: { preventDefault(): void }) => { state.quits++; event.preventDefault(); } };
      (globalThis as unknown as { quitProbe: typeof state }).quitProbe = state;
      app.on('will-quit', state.hold);
      app.on('second-instance', () => { state.starts++; });
      BrowserWindow.getAllWindows()[0].close();
    });
    const probe = () => application.evaluate(({ BrowserWindow }) => { const { quits, starts } = (globalThis as unknown as { quitProbe: { quits: number; starts: number } }).quitProbe; return { quits, starts, windows: BrowserWindow.getAllWindows().length }; });
    await expect.poll(async () => (await probe()).quits, { timeout: 30_000 }).toBeGreaterThan(0);
    // The app is started again, as from a launcher: a second process that hands its start to the one holding the profile.
    const port = await freePort();
    second = spawn(createRequire(import.meta.url)('electron') as string, ['.', `--remote-debugging-port=${port}`], { env, cwd: process.cwd(), stdio: 'ignore' });
    await expect.poll(async () => (await probe()).starts, { timeout: 60_000 }).toBe(1);
    // The quitting process was told of the start. It shows nothing: it has no services to serve a window with.
    await page.waitForTimeout(500).catch(() => new Promise(resolve => setTimeout(resolve, 500)));
    expect(await probe()).toMatchObject({ starts: 1, windows: 0 });
    // Its tools have left, and it ends.
    await application.evaluate(({ app }) => { app.off('will-quit', (globalThis as unknown as { quitProbe: { hold(): void } }).quitProbe.hold); app.quit(); }).catch(() => {});
    await expect.poll(() => alive(first), { timeout: 30_000 }).toBe(false);
    // The start is served by a new process,
    await expect.poll(async () => { const owner = await profileOwner(); return owner && owner !== first && alive(owner) ? (successor = owner) : 0; }, { timeout: 60_000 }).toBeGreaterThan(0);
    // which shows a window where a language tool can be looked up.
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
    await expect.poll(async () => !!(browser ??= await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined)), { timeout: 60_000 }).toBe(true);
    let fresh: Page | undefined;
    await expect.poll(async () => {
      for (const candidate of browser!.contexts().flatMap(context => context.pages())) if (await candidate.evaluate(() => !!window.marktex?.language).catch(() => false)) fresh = candidate;
      return !!fresh;
    }, { timeout: 60_000 }).toBe(true);
    expect(await lookup(fresh!)).toBe('answered');
    await browser!.close().catch(() => {});
  } finally {
    second?.kill('SIGKILL');
    // The new process is not the test's own: it is asked to quit, and removed if it does not.
    if (successor && alive(successor)) {
      process.kill(successor, 'SIGTERM');
      for (let waited = 0; waited < 10_000 && alive(successor); waited += 200) await new Promise(resolve => setTimeout(resolve, 200));
      if (alive(successor)) process.kill(successor, 'SIGKILL');
    }
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
