// Research fixture only: bundles pinned upstream source; never imports into Setdown.
// Run from repo root through apps/desktop/scripts/with-isolated-display.sh.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.equal(process.env.SETDOWN_ISOLATED_DISPLAY, '1', 'Use the isolated-display wrapper');
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const output = path.resolve(process.argv[2] ?? path.join(root, 'reports/theme-research-2026-10-30/results'));
await mkdir(output, { recursive: true });
const temporary = await mkdtemp('/tmp/setdown-theme-research-');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const flags = Object.fromEntries(['DEBUG', 'CHROMIUM_MV2', 'CHROMIUM_MV3', 'FIREFOX_MV2', 'THUNDERBIRD', 'TEST', 'PLUS'].map(f => [`__${f}__`, 'false']));
const bundle = async (source, file, extra = {}) => build({
  stdin: { contents: source, resolveDir: root, loader: 'ts' },
  outfile: path.join(temporary, file), bundle: true, platform: 'browser', format: 'iife',
  define: flags, logLevel: 'warning', ...extra,
});
await bundle(`export { THEME_PROFILES } from './apps/desktop/src/core/theme/theme-catalog.ts';`, 'themes.mjs', { format: 'esm', platform: 'node' });
const { THEME_PROFILES: profiles } = await import(pathToFileURL(path.join(temporary, 'themes.mjs')).href);
await bundle(`
  import { ipcRenderer } from 'electron';
  import * as DarkReader from './vendor/darkreader/src/api/index.ts';
  DarkReader.setFetchMethod(window.fetch.bind(window));
  ipcRenderer.on('research:theme', (_event, { options, reset }) => {
    try {
      if (reset) DarkReader.disable();
      if (options) DarkReader.enable(options); else DarkReader.disable();
      ipcRenderer.send('research:applied');
    } catch (error) { ipcRenderer.send('research:error', String(error)); }
  });
`, 'preload.cjs', { platform: 'node', format: 'cjs', external: ['electron'] });
await bundle(`
  import { Terminal } from '@xterm/xterm';
  window.researchTerminal = new Terminal({ cols: 90, rows: 14, fontSize: 18, theme: { background: '#ffffff', foreground: '#242424' } });
  window.researchTerminal.open(document.getElementById('terminal'));
`, 'terminal.js');
let port;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/terminal.js' || url.pathname === '/terminal.css') {
    response.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript');
    response.end(await readFile(url.pathname.endsWith('.css') ? path.join(root, 'node_modules/@xterm/xterm/css/xterm.css') : path.join(temporary, 'terminal.js')));
    return;
  }
  if (url.pathname === '/foreign.css') {
    response.setHeader('Content-Type', 'text/css');
    response.end('.foreign { background: #fff; color: #000; padding: 12px; }');
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  if (url.pathname === '/terminal') {
    response.end('<!doctype html><link rel="stylesheet" href="/terminal.css"><body><div id="terminal"></div><script src="/terminal.js"></script>');
    return;
  }
  if (url.searchParams.has('csp')) response.setHeader('Content-Security-Policy', "script-src 'self'");
  const nativeDark = url.searchParams.has('dark');
  response.end(`<!doctype html><meta charset="utf-8"><title>Setdown theme research fixture</title>
    <style id="authored">
      :root { --card: #f2f2f2; } body { background: ${nativeDark ? '#111' : '#fff'}; color: ${nativeDark ? '#eee' : '#000'}; font: 18px system-ui; padding: 36px; }
      section { background: var(--card); color: #222; border: 1px solid #aaa; padding: 18px; margin: 18px 0; }
      a { color: #06c; } .cssom { color: #111; background: #eee; } input { padding: 10px; }
    </style>
    ${url.searchParams.has('foreign') ? `<link rel="stylesheet" href="http://localhost:${port}/foreign.css">` : ''}
    <h1>Setdown — web palette research</h1><p>Text, links, cards and live input retain their structure.</p>
    <a href="#sample">A blue link</a><section>CSS variable card · 한글 입력 유지</section>
    <input id="draft" value="unsaved draft"><p class="cssom">CSSOM mutation target</p>
    <p class="foreign">Cross-origin stylesheet target</p><div id="dynamic"></div>
    <svg width="100" height="24"><rect width="100" height="24" fill="#00aa00"/></svg>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
port = server.address().port;
await writeFile(path.join(temporary, 'main.cjs'), `
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
  app.whenReady().then(() => {
    global.window = new BrowserWindow({ width: 1100, height: 780, webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      preload: ${JSON.stringify(path.join(temporary, 'preload.cjs'))}
    } });
    global.window.loadURL(${JSON.stringify(`http://127.0.0.1:${port}/web`)});
  });
`);
const result = {
  upstream: execFileSync('git', ['-C', path.join(root, 'vendor/darkreader'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  appCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  isolatedDisplay: process.env.DISPLAY,
  runtime: {}, web: [], limitations: [], terminal: [], errors: [],
};
let app;
const optionsFor = profile => ({
  mode: profile.appearance === 'dark' ? 1 : 0, brightness: 100, contrast: 100, sepia: 0, grayscale: 0,
  darkSchemeBackgroundColor: profile.palette.surface, darkSchemeTextColor: profile.palette.text,
  lightSchemeBackgroundColor: profile.palette.surface, lightSchemeTextColor: profile.palette.text,
  useFont: false,
});
const luminance = color => {
  const rgb = color.startsWith('#') ? color.slice(1).match(/../g).map(x => parseInt(x, 16)) : color.match(/[\d.]+/g).slice(0, 3).map(Number);
  const values = rgb.map(c => (c /= 255) <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
};
const contrast = (a, b) => {
  // Dim xterm cells can use rgba; measure the composited foreground, not opaque RGB.
  if (a.startsWith('rgba(')) {
    const [r, g, blue, alpha] = a.match(/[\d.]+/g).map(Number);
    const background = b.startsWith('#') ? b.slice(1).match(/../g).map(x => parseInt(x, 16)) : b.match(/[\d.]+/g).slice(0, 3).map(Number);
    a = `rgb(${[r, g, blue].map((c, i) => c * alpha + background[i] * (1 - alpha)).join(', ')})`;
  }
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(x => parseInt(x, 16)).join(', ')})`;
try {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  app = await _electron.launch({ executablePath: require('electron'), args: [path.join(temporary, 'main.cjs')], chromiumSandbox: true, env });
  const page = await app.firstWindow();
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
  page.on('pageerror', error => result.errors.push(String(error)));
  result.runtime = await app.evaluate(() => process.versions);
  await page.waitForSelector('#draft');
  const apply = async (options, reset = true) => {
    await app.evaluate(async ({ BrowserWindow, ipcMain }, request) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(Error('Theme acknowledgment timeout')); }, 5000);
        const cleanup = () => { clearTimeout(timer); ipcMain.removeListener('research:applied', done); ipcMain.removeListener('research:error', fail); };
        const done = () => { cleanup(); resolve(); };
        const fail = (_event, error) => { cleanup(); reject(Error(error)); };
        ipcMain.once('research:applied', done); ipcMain.once('research:error', fail);
        BrowserWindow.getAllWindows()[0].webContents.send('research:theme', request);
      });
    }, { options, reset });
    // A bounded observation period, not a retry; this is not a latency benchmark.
    await page.waitForTimeout(350);
  };
  const readWeb = () => page.evaluate(() => {
    const colors = selector => { const style = getComputedStyle(document.querySelector(selector)); return { background: style.backgroundColor, color: style.color }; };
    return { body: colors('body'), card: colors('section'), link: colors('a'), cssom: colors('.cssom'), foreign: colors('.foreign'),
      draft: document.querySelector('#draft').value, focused: document.activeElement?.id,
      identity: window.researchIdentity, sheets: document.querySelectorAll('.darkreader').length,
      leakedAPI: typeof window.DarkReader, svgFill: getComputedStyle(document.querySelector('rect')).fill };
  });
  await page.locator('#draft').fill('preserved draft 한글');
  await page.evaluate(() => window.researchIdentity = 'same-document');
  // Preserve the failed naive-update hypothesis separately from cleanup-based updates.
  await apply(optionsFor(profiles[0]));
  await apply(optionsFor(profiles[1]), false);
  result.naiveUpdate = { from: profiles[0].id, to: profiles[1].id,
    expectedBackground: rgb(profiles[1].palette.surface), actual: await readWeb() };
  for (const profile of profiles) {
    await apply(optionsFor(profile));
    const web = await readWeb();
    assert.equal(web.body.background, rgb(profile.palette.surface));
    assert.equal(web.body.color, rgb(profile.palette.text));
    assert.equal(web.draft, 'preserved draft 한글');
    assert.equal(web.focused, 'draft');
    assert.equal(web.identity, 'same-document');
    assert.equal(web.leakedAPI, 'undefined');
    web.bodyContrast = contrast(web.body.color, web.body.background);
    web.linkContrast = contrast(web.link.color, web.body.background);
    await page.evaluate(() => { document.querySelector('#dynamic').innerHTML = '<p style="color:#000;background:#fff">Added after theme change</p>'; });
    await page.waitForTimeout(350);
    web.dynamic = await page.locator('#dynamic p').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    assert.equal(web.dynamic.background, rgb(profile.palette.surface));
    assert.equal(web.dynamic.color, rgb(profile.palette.text));
    await page.screenshot({ path: path.join(output, `web-${profile.id}.png`) });
    result.web.push({ theme: profile.id, ...web });
  }
  await apply(null);
  const restored = await readWeb();
  assert.equal(restored.body.background, 'rgb(255, 255, 255)');
  assert.equal(restored.body.color, 'rgb(0, 0, 0)');
  assert.equal(restored.sheets, 0);
  result.restored = restored;
  for (const variant of ['dark', 'csp', 'foreign']) {
    await page.goto(`http://127.0.0.1:${port}/web?${variant}`);
    const profile = profiles.find(p => p.id === (variant === 'dark' ? 'solarized-light' : 'github-dark'));
    await apply(optionsFor(profile));
    const before = await readWeb();
    await page.evaluate(() => document.querySelector('#authored').sheet.insertRule('.cssom { background: #ffffff; color: #000000; }', document.querySelector('#authored').sheet.cssRules.length));
    await page.waitForTimeout(500);
    const afterInsertRule = await readWeb();
    await page.evaluate(() => {
      const sheet = document.querySelector('#authored').sheet;
      sheet.cssRules[sheet.cssRules.length - 1].style.setProperty('background-color', '#aaffaa');
    });
    await page.waitForTimeout(500);
    result.limitations.push({ variant, theme: profile.id, before, afterInsertRule, afterDeclarationChange: await readWeb() });
    await page.screenshot({ path: path.join(output, `limitation-${variant}.png`) });
  }
  await page.goto(`http://127.0.0.1:${port}/terminal`);
  await page.waitForFunction(() => Boolean(window.researchTerminal));
  for (const profile of profiles) {
    for (const minimumContrastRatio of [1, 4.5]) {
      const samples = await page.evaluate(async ({ profile, minimumContrastRatio }) => {
        const term = window.researchTerminal;
        term.options.theme = { background: profile.palette.editorBackground, foreground: profile.palette.text };
        term.options.minimumContrastRatio = minimumContrastRatio;
        term.reset();
        const samples = [
          ['97', 'bright white'], ['93', 'bright yellow'], ['96', 'bright cyan'], ['34', 'blue'],
          ['38;5;229', '256-color yellow'], ['38;2;245;245;245', 'RGB near-white'],
          ['48;2;48;48;48;38;2;49;49;49', 'RGB foreground + RGB background'], ['7;37;40', 'inverse'],
          ['2;37', 'dim (separate policy)'], ['38;2;245;245;245', '\ue0b0'],
        ];
        await new Promise(resolve => term.write(samples.map(([sgr, label]) => `\x1b[${sgr}m${label}\x1b[0m`).join('\r\n'), resolve));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return Array.from(document.querySelectorAll('.xterm-rows > div')).slice(0, samples.length).map((row, i) => {
          const span = row.querySelector('span'), style = getComputedStyle(span);
          return { label: samples[i][1], color: style.color, background: style.backgroundColor === 'rgba(0, 0, 0, 0)' ? profile.palette.editorBackground : style.backgroundColor };
        });
      }, { profile, minimumContrastRatio });
      for (const sample of samples) sample.contrast = contrast(sample.color, sample.background);
      if (minimumContrastRatio === 4.5) for (const sample of samples.slice(0, 8)) assert.ok(sample.contrast >= 4.5, `${profile.id}/${sample.label}: ${sample.contrast}`);
      result.terminal.push({ theme: profile.id, minimumContrastRatio, samples });
      if (profile.id === 'solarized-light') await page.screenshot({ path: path.join(output, `terminal-solarized-light-${minimumContrastRatio}.png`) });
    }
  }
  result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.failure = String(error); throw error;
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  await app?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ status: result.status, webThemes: result.web.length, terminalCases: result.terminal.length, output }));
}
