// Paired five-window diagnostic. Run each version serially on the same isolated
// display/cgroup; this is separate from the required preview latency benchmark.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || existsSync(output)) throw Error('Use an isolated display and a fresh output file.');
const desktop = path.join(root, 'apps/desktop'), require = createRequire(path.join(desktop, 'package.json'));
const { _electron, expect } = require('@playwright/test');
const profile = await mkdtemp('/var/tmp/setdown-memory-mixed-');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const memory = pid => JSON.parse(execFileSync('python3', [path.join(here, '../memory-audit-2026-11-08/proc-memory.py'), String(pid)], { encoding: 'utf8' }));
const report = { complete: false, root, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), electron: require('electron/package.json').version,
  harnessHash: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  fixture: { windows: 5, markdownTabs: 5, webTabs: 5, activeMarkdown: 2, activeWeb: 3, webArrayMiB: 8, webParagraphs: 500, idleSeconds: 75 },
  guards: { hostAvailableMiB: 2048, appPssMiB: 2600 }, samples: [], crashes: [] };
const group = readFileSync('/proc/self/cgroup', 'utf8').match(/^0::(.+)$/m)?.[1];
const cgroup = group && path.join('/sys/fs/cgroup', group);
const cgroupState = () => cgroup ? Object.fromEntries(['memory.max', 'memory.current', 'memory.peak', 'memory.events'].map(name =>
  [name, readFileSync(path.join(cgroup, name), 'utf8').trim()])) : null;
report.cgroupBefore = cgroupState();
if (!cgroup || report.cgroupBefore['memory.max'] === 'max') throw Error('A finite OS memory limit is required.');
const save = () => writeFile(output, JSON.stringify(report, null, 2));
let app, watch, stopping = false;
const server = createServer((req, res) => {
  const number = req.url.slice(1);
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><title>Mixed web ${number}</title><h1>Mixed website ${number}</h1>
    ${Array.from({ length: 500 }, (_, i) => `<p>Fixed reading workload ${i}, window ${number}.</p>`).join('')}
    <script>window.fixtureBuffer = new Uint8Array(8 * 1024 * 1024).fill(42);</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function dispose() {
  if (!app) return;
  await app.evaluate(({ app, BrowserWindow }) => {
    app.removeAllListeners('window-all-closed'); for (const owner of BrowserWindow.getAllWindows()) owner.destroy();
  }).catch(() => {});
  await app.close().catch(() => {});
}
function guard() {
  const snapshot = app ? memory(app.process().pid) : { totalPssKiB: 0, hostKiB: { MemAvailable: Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m)[1]) } };
  if (stopping || snapshot.hostKiB.MemAvailable < 2048 * 1024 || snapshot.totalPssKiB > 2600 * 1024) {
    stopping = true; report.guardSnapshot = snapshot; throw Error('Stopped this fixture at its memory guard.');
  }
}
async function sample(label) {
  guard();
  const inventory = await app.evaluate(({ BrowserWindow, webContents, app }) => ({
    windows: BrowserWindow.getAllWindows().length,
    contents: webContents.getAllWebContents().map(wc => ({ id: wc.id, pid: wc.getOSProcessId(),
      role: wc.getURL().startsWith('marktex-preview:') ? 'preview' : wc.getURL().startsWith('http://127.0.0.1:') ? 'web' : wc.getType() })),
    metrics: app.getAppMetrics().map(metric => ({ pid: metric.pid, name: metric.name, type: metric.type })),
  }));
  const snapshot = memory(app.process().pid);
  report.samples.push({ label, ...snapshot, ...inventory }); await save();
  console.log(`${label}: ${Math.round(snapshot.totalPssKiB / 1024)} MiB PSS, ${inventory.windows} windows, ${inventory.contents.length} contents`);
}
try {
  guard();
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  app = await _electron.launch({ executablePath: require('electron'), cwd: desktop, args: ['.'], chromiumSandbox: true,
    env: { ...env, XDG_CONFIG_HOME: path.join(profile, 'config'), XDG_CACHE_HOME: path.join(profile, 'cache') } });
  const shells = [await app.firstWindow()];
  await shells[0].waitForFunction(() => !!document.querySelector('.shell'));
  await shells[0].evaluate(() => window.marktex.browser.extensions());
  await app.evaluate(({ app }) => {
    globalThis.fixtureCrashes = [];
    app.on('render-process-gone', (_event, _contents, details) => { if (details.reason !== 'clean-exit') globalThis.fixtureCrashes.push(details); });
  });
  watch = setInterval(() => { try { guard(); } catch (error) { report.error = String(error); void save(); void dispose(); } }, 5000);
  await sample('one-empty-window-browser-runtime-ready');
  for (let n = 1; n <= 5; n++) {
    guard();
    if (n > 1) {
      const created = app.waitForEvent('window');
      await shells[0].evaluate(() => window.marktex.executeApplicationMenuItem('menu-new-window'));
      shells.push(await created);
    }
    const page = shells[n - 1]; await page.waitForFunction(() => !!document.querySelector('.shell'));
    const file = path.join(profile, `mixed-${n}.md`);
    await writeFile(file, `# Mixed Markdown ${n}\n\n` + Array.from({ length: 80 }, (_, i) => `## Section ${i}\n\nFixed **text** and math $a^2+b^2=c^2$.\n`).join('\n'));
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
    await expect(page.getByRole('tab', { selected: true })).toContainText(`mixed-${n}.md`);
    await page.evaluate(url => window.marktex.openLink(url), `${origin}/${n}`);
    await expect(page.getByRole('tab', { selected: true })).toContainText(`Mixed web ${n}`);
    if (n % 2 === 0) await page.getByRole('tab', { name: new RegExp(`mixed-${n}.md`) }).click();
    await sleep(3000); await sample(`mixed-${n}-windows`);
  }
  await sleep(35_000); await sample('five-windows-idle-35s');
  await sleep(40_000); await sample('five-windows-idle-75s');
  report.managedSnapshot = await shells[0].evaluate(() => window.marktex.getMemorySnapshot?.() ?? null);
  // Returning to every inactive tab must keep all ten logical tabs usable.
  for (let n = 1; n <= 5; n++) {
    const page = shells[n - 1];
    await page.getByRole('tab', { name: new RegExp(`mixed-${n}.md`) }).click();
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await expect.poll(() => app.evaluate(async ({ BrowserWindow }, number) => {
      const owner = BrowserWindow.getAllWindows().find(window => window.getTitle().includes(`mixed-${number}.md`));
      const view = owner?.contentView.children.find(view => 'webContents' in view && view.getVisible() && view.webContents.getURL().startsWith('marktex-preview:'));
      return view ? view.webContents.executeJavaScript('document.body.innerText').catch(() => '') : '';
    }, n)).toContain(`Mixed Markdown ${n}`);
    await page.getByRole('tab', { name: new RegExp(`Mixed web ${n}`) }).click();
    await expect.poll(() => app.evaluate(async ({ webContents }, url) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === url);
      return wc ? wc.executeJavaScript('document.querySelector("h1")?.textContent').catch(() => null) : null;
    }, `${origin}/${n}`)).toBe(`Mixed website ${n}`);
    await expect(page.getByRole('tab')).toHaveCount(2);
  }
  await sample('all-ten-tabs-reopened');
  report.crashes = await app.evaluate(() => globalThis.fixtureCrashes);
  if (report.crashes.length) throw Error('A renderer exited abnormally.');
  report.complete = true;
} catch (error) { report.error = String(error); console.error(report.error); process.exitCode = 1; }
finally {
  clearInterval(watch); await dispose();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.cgroupAfter = cgroupState();
  await rm(profile, { recursive: true, force: true }); await save();
}
