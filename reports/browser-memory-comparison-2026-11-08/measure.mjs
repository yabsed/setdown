// Same web-only fixture, five real windows, fresh profiles. No user browser state.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const require = createRequire(path.join(root, 'package.json'));
const desktopRequire = createRequire(path.join(root, 'apps/desktop/package.json'));
const puppeteer = require('puppeteer-core'), { _electron, expect } = require('@playwright/test');
const product = process.argv[2], output = path.resolve(process.argv[3]);
assert(['chrome', 'firefox', 'setdown'].includes(product));
assert.equal(process.env.SETDOWN_ISOLATED_DISPLAY, '1');
assert(!existsSync(output), 'Output must be new');
const profile = await mkdtemp('/var/tmp/setdown-browser-comparison-');
const env = { ...process.env, XDG_CONFIG_HOME: path.join(profile, 'config'), XDG_CACHE_HOME: path.join(profile, 'cache') };
delete env.ELECTRON_RUN_AS_NODE;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const memory = pid => JSON.parse(execFileSync('python3', [path.join(here, '../memory-audit-2026-11-08/proc-memory.py'), String(pid)], { encoding: 'utf8' }));
const group = readFileSync('/proc/self/cgroup', 'utf8').match(/^0::(.+)$/m)?.[1];
assert(group);
const cgroup = path.join('/sys/fs/cgroup', group);
const groupState = () => Object.fromEntries(['memory.max', 'memory.current', 'memory.peak', 'memory.events'].map(k => [k, readFileSync(path.join(cgroup, k), 'utf8').trim()]));
assert.notEqual(groupState()['memory.max'], 'max');
const report = { product, complete: false, startedAt: new Date().toISOString(),
  fixture: { windows: 5, tabs: 10, sites: 5, paragraphsPerTab: 500, touchedArrayMiBPerTab: 8, idleSeconds: 75 },
  harnessHash: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  automation: product === 'setdown' ? 'Playwright Electron' : `Puppeteer ${require('puppeteer-core/package.json').version}`,
  cgroupBefore: groupState(), samples: [], crashes: [] };
const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
const servers = [], urls = [];
let browser, app, pid, watch, stopped = false;
const shells = [], pages = [];
async function close() {
  if (app) {
    await app.evaluate(({ app, BrowserWindow }) => { app.removeAllListeners('window-all-closed'); for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
  if (browser) await browser.close().catch(() => {});
}
function guard() {
  const available = Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m)[1]);
  const snapshot = pid ? memory(pid) : null;
  if (available < 2048 * 1024 || (snapshot && snapshot.totalPssKiB > 2600 * 1024)) {
    stopped = true; report.guardSnapshot = snapshot; throw Error('Memory guard stopped this test');
  }
}
async function inventory() {
  if (app) return app.evaluate(({ BrowserWindow, webContents }) => ({ windows: BrowserWindow.getAllWindows().length,
    contents: webContents.getAllWebContents().map(w => ({ id: w.id, pid: w.getOSProcessId(), role: w.getURL().startsWith('http://127.') ? 'web' : w.getType() })) }));
  const ps = await browser.pages();
  return { windows: new Set(await Promise.all(ps.map(p => p.windowId()))).size, tabs: ps.length,
    visibility: await Promise.all(ps.map(p => p.evaluate(() => document.visibilityState))) };
}
async function sample(label) {
  guard(); assert(!stopped);
  const state = await inventory(), data = memory(pid);
  assert.equal(data.unavailablePids.length, 0, 'Incomplete PSS measurement');
  report.samples.push({ label, ...state, ...data }); await save();
  console.log(product, label, Math.round(data.totalPssKiB / 1024), 'MiB PSS', state.windows, 'windows');
}
try {
  guard();
  for (let n = 1; n <= 5; n++) {
    // Distinct loopback IPs are distinct sites: do not force all ten pages into
    // one same-site browser renderer. Each window holds two pages of its site.
    const server = createServer((req, res) => {
      const id = `${n}${req.url}`;
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>Fixture ${id}</title><h1>Fixture ${id}</h1>${Array.from({ length: 500 }, (_, i) => `<p>Reading paragraph ${i}: fixed local page ${id}.</p>`).join('')}
        <script>window.fixtureBuffer = new Uint8Array(8 * 1024 * 1024).fill(42);</script>`);
    });
    await new Promise(resolve => server.listen(0, `127.0.0.${n}`, resolve)); servers.push(server);
    urls.push(['a', 'b'].map(suffix => `http://127.0.0.${n}:${server.address().port}/${suffix}`));
  }
  if (product === 'setdown') {
    app = await _electron.launch({ executablePath: desktopRequire('electron'), cwd: path.join(root, 'apps/desktop'), args: ['.'], chromiumSandbox: true, env });
    pid = app.process().pid; shells.push(await app.firstWindow());
    await shells[0].waitForFunction(() => !!document.querySelector('.shell'));
    await shells[0].evaluate(() => window.marktex.browser.extensions());
    report.version = await app.evaluate(() => process.versions);
    await app.evaluate(({ app }) => { globalThis.comparisonCrashes = []; app.on('render-process-gone', (_e, _wc, d) => { if (d.reason !== 'clean-exit') globalThis.comparisonCrashes.push(d); }); });
  } else {
    browser = await puppeteer.launch({ browser: product === 'chrome' ? 'chrome' : 'firefox', executablePath: product === 'chrome' ? '/usr/bin/google-chrome' : '/usr/bin/firefox',
      headless: false, userDataDir: path.join(profile, 'browser'), defaultViewport: null, env,
      args: product === 'chrome' ? ['--ozone-platform=x11'] : [] });
    pid = browser.process().pid; report.version = await browser.version(); report.launchArgs = browser.process().spawnargs;
    const initial = await browser.pages(); assert.equal(initial.length, 1); pages.push(initial[0]);
    await browser.setWindowBounds(await initial[0].windowId(), { width: 1100, height: 850 });
  }
  watch = setInterval(() => { try { guard(); } catch (e) { report.error = String(e); void save(); void close(); } }, 5000);
  await sample('one-empty-window');
  for (let n = 0; n < 5; n++) {
    if (app) {
      if (n) {
        const created = app.waitForEvent('window');
        await shells[0].evaluate(() => window.marktex.executeApplicationMenuItem('menu-new-window'));
        shells.push(await created);
      }
      const shell = shells[n]; await shell.waitForFunction(() => !!document.querySelector('.shell'));
      await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.setSize(1100, 850); });
      for (const [i, url] of urls[n].entries()) {
        await shell.evaluate(url => window.marktex.openLink(url), url);
        await expect(shell.getByRole('tab', { selected: true })).toContainText(`Fixture ${n + 1}/${i ? 'b' : 'a'}`);
        await expect.poll(() => app.context().pages().some(p => p.url() === url)).toBe(true);
        const p = app.context().pages().find(p => p.url() === url);
        assert.equal(await p.evaluate(() => window.fixtureBuffer?.length), 8 * 1024 * 1024);
      }
      assert.equal(await shell.getByRole('tab').count(), 2);
    } else {
      const first = n ? await browser.newPage({ type: 'window', windowBounds: { width: 1100, height: 850 } }) : pages[0];
      if (n) pages.push(first);
      await first.goto(urls[n][0], { waitUntil: 'load' });
      const second = await browser.newPage(); pages.push(second);
      assert.equal(await first.windowId(), await second.windowId(), 'Second tab belongs to its own window');
      await second.goto(urls[n][1], { waitUntil: 'load' });
      for (const p of [first, second]) {
        p.on('error', e => report.crashes.push(String(e)));
        assert.equal(await p.evaluate(() => window.fixtureBuffer?.length), 8 * 1024 * 1024);
      }
    }
    await sleep(3000); await sample(`loaded-${n + 1}-windows`);
    assert.equal(report.samples.at(-1).windows, n + 1);
  }
  await sleep(35_000); await sample('idle-35s');
  await sleep(40_000); await sample('idle-75s');
  // Check all ten real bodies on return. No forced garbage collection.
  if (app) {
    report.managed = await shells[0].evaluate(() => window.marktex.getMemorySnapshot?.());
    for (let n = 0; n < 5; n++) for (const [i, url] of urls[n].entries()) {
      const tab = shells[n].getByRole('tab', { name: new RegExp(`Fixture ${n + 1}/${i ? 'b' : 'a'}(?:\\s|$)`) });
      await expect(tab).toHaveCount(1); await tab.click();
      await expect.poll(async () => {
        const p = app.context().pages().find(p => p.url() === url);
        return p ? p.locator('h1').textContent().catch(() => null) : null;
      }).toBe(`Fixture ${n + 1}/${i ? 'b' : 'a'}`);
    }
    report.crashes = await app.evaluate(() => globalThis.comparisonCrashes);
  } else {
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]; await p.bringToFront();
      assert.equal(await p.$eval('h1', e => e.textContent), `Fixture ${Math.floor(i / 2) + 1}/${i % 2 ? 'b' : 'a'}`);
    }
    assert.equal((await browser.pages()).length, 10);
  }
  await sample('reopened-all-tabs');
  assert.equal(report.crashes.length, 0); report.complete = true;
} catch (e) { report.error = String(e); console.error(report.error); process.exitCode = 1; }
finally {
  clearInterval(watch); await close();
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  report.cgroupAfter = groupState(); report.finishedAt = new Date().toISOString();
  await rm(profile, { recursive: true, force: true }); await save();
}
