// Diagnostic observations, not a performance-contract benchmark or an A/B comparison.
// Run through apps/desktop/scripts/with-isolated-display.sh. Uses a private profile.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '../../apps/desktop');
const require = createRequire(path.join(desktop, 'package.json'));
const { _electron, expect } = require('@playwright/test');
const scenario = process.argv[2] || 'markdown';
if (!['markdown', 'markdown-tabs', 'web', 'web-settled'].includes(scenario)) throw Error('Unknown scenario');
if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1') throw Error('Use the isolated display wrapper');
const output = path.join(here, `${scenario}.json`);
const profile = await mkdtemp('/var/tmp/setdown-memory-audit-');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readMemory = pid => JSON.parse(execFileSync('python3', [path.join(here, 'proc-memory.py'), ...(pid ? [String(pid)] : [])], { encoding: 'utf8' }));
const report = { startedAt: new Date().toISOString(), scenario,
  harnessHash: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: desktop, encoding: 'utf8' }).trim(),
  electron: require('electron/package.json').version,
  guards: { minimumHostAvailableMiB: 650, maximumTestPssMiB: 1100 },
  fixture: { markdownParagraphs: 80, webParagraphs: 1000, webTouchedArrayMiB: 8, externalPages: false },
  samples: [], complete: false };
let app, watch, safetyStop;
const save = () => writeFile(output, JSON.stringify(report, null, 2));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>Audit ${req.url}</title><h1>Memory audit fixture</h1>
    ${Array.from({ length: 1000 }, (_, i) => `<p>Paragraph ${i}: fixed local browsing workload.</p>`).join('')}
    <script>window.auditArray = new Uint8Array(8*1024*1024);window.auditArray.fill(42);
      window.auditFrames=0;function frame(){window.auditFrames++;requestAnimationFrame(frame)}frame();</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function guard() {
  if (safetyStop) throw Error(safetyStop);
  const m = readMemory(app?.process().pid);
  if (m.hostKiB.MemAvailable < 650 * 1024 || (app && m.totalPssKiB > 1100 * 1024)) {
    safetyStop = `Resource guard: available ${Math.round(m.hostKiB.MemAvailable / 1024)} MiB, fixture PSS ${Math.round(m.totalPssKiB / 1024)} MiB`;
    report.guardSnapshot = m;
    throw Error(safetyStop);
  }
}
async function inventory() {
  return app.evaluate(async ({ app, BrowserWindow, webContents }) => {
    const owners = BrowserWindow.getAllWindows();
    const shells = new Set(owners.map(w => w.webContents.id));
    const attached = new Map(owners.flatMap(w => w.contentView.children.filter(v => 'webContents' in v)
      .map(v => [v.webContents.id, { owner: w.id, nativeVisible: v.getVisible(), bounds: v.getBounds() }])));
    const contents = [];
    for (const wc of webContents.getAllWebContents()) {
      const url = wc.getURL();
      const role = shells.has(wc.id) ? 'shell' : url.startsWith('marktex-preview:') ? 'preview'
        : url.startsWith('http://127.0.0.1:') ? 'fixture-web' : url.startsWith('chrome-extension:') ? 'extension'
        : url.includes('places') ? 'places' : url.includes('overlay') ? 'overlay' : 'other';
      const entry = { id: wc.id, pid: wc.getOSProcessId(), role, attached: attached.get(wc.id) ?? null };
      if (role === 'fixture-web' || role === 'preview') {
        entry.dom = await wc.executeJavaScript(`({visibility:document.visibilityState,
          frames:window.auditFrames ?? null, elements:document.getElementsByTagName('*').length,
          marker:document.body?.innerText.includes('Memory audit fixture') ?? false,
          previewBlocks:document.querySelectorAll('[data-source-line]').length,
          heap:performance.memory ? {used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize} : null})`).catch(() => null);
      }
      contents.push(entry);
    }
    return { windows: owners.length, contents, metrics: app.getAppMetrics().map(m => ({pid:m.pid,type:m.type,name:m.name,memory:m.memory})),
      mainMemory: process.memoryUsage(), versions: process.versions };
  });
}
async function sample(label, settle = 3000) {
  await sleep(settle); await guard();
  const native = await inventory();
  const memory = readMemory(app.process().pid);
  report.samples.push({ label, ...memory, ...native }); await save();
  console.log(`${label}: ${Math.round(memory.totalPssKiB / 1024)} MiB PSS; windows=${native.windows}; contents=${native.contents.length}; available=${Math.round(memory.hostKiB.MemAvailable / 1024)} MiB`);
}
async function openFile(page, number) {
  const file = path.join(profile, `audit-${number}.md`);
  await writeFile(file, '# Memory audit fixture\n\n' + Array.from({ length: 80 }, (_, i) => `## Section ${i}\n\nParagraph ${i}. Local Markdown content with **bold text**, a [link](https://example.com), and inline math $a^2+b^2=c^2$.\n`).join('\n'));
  await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
  await expect(page.getByRole('tab', { selected: true })).toContainText(`audit-${number}.md`);
  await expect.poll(async () => (await inventory()).contents.filter(c => c.role === 'preview' && c.dom?.marker).length).toBe(number);
}
async function newWindow(page) {
  await guard();
  const next = app.waitForEvent('window');
  await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-new-window'));
  const result = await next;
  await result.waitForFunction(() => !!window.marktex && !!document.querySelector('.shell'));
  return result;
}
async function openWeb(page, number) {
  await guard();
  await page.evaluate(url => window.marktex.openLink(url), `${origin}/tab-${number}`);
  await expect(page.getByRole('tab', { selected: true })).toContainText(`Audit /tab-${number}`);
  await expect.poll(async () => (await inventory()).contents.filter(c => c.role === 'fixture-web' && c.dom?.marker).length).toBe(number);
}
try {
  await guard();
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  app = await _electron.launch({ executablePath: require('electron'), cwd: desktop, args: ['.'], chromiumSandbox: true,
    env: { ...env, XDG_CONFIG_HOME: path.join(profile, 'config'), XDG_CACHE_HOME: path.join(profile, 'cache') } });
  watch = setInterval(() => {
    guard().catch(async error => {
      if (report.guardStopped) return;
      report.guardStopped = String(error); await save();
      // Destroy only this isolated fixture. Never touch the user's app or other processes.
      await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
      await app.close().catch(() => {});
    });
  }, 1500);
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.marktex && !!document.querySelector('.shell'));
  await sample('empty-1-window');
  if (scenario === 'markdown-tabs') {
    for (let n = 1; n <= 5; n++) { await openFile(page, n); await sample(`markdown-${n}-tabs-1-window`); }
    for (let n = 5; n > 1; n--) {
      await page.getByRole('tab', { selected: true }).getByTitle('Close tab', { exact: true }).click();
      await expect(page.getByRole('tab', { selected: true })).toContainText(`audit-${n - 1}.md`);
    }
    await sample('markdown-tabs-close-to-1-5s', 5000);
    await sample('markdown-tabs-close-to-1-30s', 25000);
  } else if (scenario === 'markdown') {
    await openFile(page, 1); await sample('markdown-1-window');
    for (let n = 2; n <= 5; n++) {
      const next = await newWindow(page); await openFile(next, n); await sample(`markdown-${n}-windows`);
    }
    await app.evaluate(({ BrowserWindow }) => {
      const keepId = Math.min(...BrowserWindow.getAllWindows().map(w => w.webContents.id));
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.id !== keepId) w.close();
    });
    await sample('markdown-close-to-1-5s', 5000);
    await sample('markdown-close-to-1-30s', 25000);
  } else {
    // Match the repository browser fixture: wait for fresh-profile filter compilation.
    // Keep its cost visible as a separate sample, before loading any web page.
    await page.evaluate(() => window.marktex.browser.extensions());
    await sample('browser-runtime-ready-no-web-tabs');
    if (scenario === 'web-settled') await sample('browser-runtime-idle-30s-no-web-tabs', 30000);
    for (let n = 1; n <= 5; n++) { await openWeb(page, n); await sample(`web-${n}-tabs-1-window`); }
    await sample('web-5-tabs-hidden-visibility', 2200);
    for (let n = 5; n > 1; n--) {
      await page.getByRole('tab', { selected: true }).getByTitle('Close tab', { exact: true }).click();
      await expect.poll(async () => (await inventory()).contents.filter(c => c.role === 'fixture-web').length).toBe(n - 1);
    }
    await sample('web-close-to-1-5s', 5000); await sample('web-close-to-1-30s', 25000);
    for (let n = 2; n <= 5; n++) { const next = await newWindow(page); await openWeb(next, n); await sample(`web-${n}-windows`); }
  }
  report.complete = true;
} catch (error) { report.error = String(error); console.error(report.error); }
finally {
  clearInterval(watch);
  if (app) {
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true }); await save();
}
