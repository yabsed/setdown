import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { build, transform } from 'esbuild';
import { compileModule } from 'svelte/compiler';
import { _electron } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
assert.equal(process.env.SETDOWN_ISOLATED_DISPLAY, '1', 'Use with-isolated-display.sh');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'setdown-photo-research-'));
const appRequire = createRequire(path.join(root, 'apps/desktop/package.json'));
const revisions = Object.fromEntries(['.', 'vendor/fabric.js', 'vendor/svelte-chop-chop', 'vendor/filerobot-image-editor']
  .map(directory => [directory, execFileSync('git', ['-C', path.join(root, directory), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()]));
let application;
const errors = [];
try {
  const bundle = await build({
    entryPoints: [path.join(here, 'cases.svelte.ts')], bundle: true, write: false,
    format: 'iife', globalName: 'PhotoResearch', platform: 'browser', conditions: ['browser'],
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      '@fabricjs/browser': path.join(root, 'vendor/fabric.js/packages/browser/src/index.ts'),
      '@fabricjs/core': path.join(root, 'vendor/fabric.js/packages/core/src/index.ts'),
    },
    plugins: [{ name: 'svelte-runes', setup(builder) {
      builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path: filename }) => {
        const stripped = await transform(await readFile(filename, 'utf8'), { loader: 'ts', target: 'esnext' });
        return { contents: compileModule(stripped.code, { filename, generate: 'client' }).js.code,
          loader: 'js', resolveDir: path.dirname(filename) };
      });
    } }],
  });
  const main = path.join(temporary, 'main.cjs');
  await writeFile(path.join(temporary, 'fixture.html'), '<!doctype html><title>Photo editing research</title>');
  await writeFile(main, `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 900, height: 650, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.loadFile(require('node:path').join(__dirname, 'fixture.html'));
});`);
  const { ELECTRON_RUN_AS_NODE: ignored, ...env } = process.env;
  application = await _electron.launch({ executablePath: appRequire('electron'), chromiumSandbox: true,
    args: [main, `--user-data-dir=${path.join(temporary, 'profile')}`], env });
  const page = await application.firstWindow();
  await page.waitForURL(url => url.protocol === 'file:');
  assert.equal(await page.evaluate(() => isSecureContext), true);
  page.on('pageerror', error => errors.push(error.message));
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => PhotoResearch.runCases());
  const versions = await application.evaluate(() => process.versions);
  assert.deepEqual(errors, []);
  // Control checks validate the fixture/renderer; upstream defects are recorded as observations.
  assert.deepEqual(result.fabric.canonical, { width: 80, height: 40, opaquePixels: 3200 });
  assert.deepEqual(result.fabric.encodedDimensions, { width: 80, height: 40, mime: 'image/png' });
  assert.deepEqual(result.fabric.filterPixel, [126, 126, 126, 255]);
  for (const [name, url] of Object.entries(result.artifacts)) {
    await writeFile(path.join(here, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  delete result.artifacts;
  const evidence = { capturedAt: new Date().toISOString(), revisions, versions,
    environment: { isolatedDisplay: true, waylandRemoved: !process.env.WAYLAND_DISPLAY,
      privateRuntime: process.env.XDG_RUNTIME_DIR?.startsWith('/tmp/setdown-display-runtime.'), chromiumSandbox: true },
    scope: 'Pinned source probes in real Electron; not application integration, benchmark, native keyboard, or GPU coverage.',
    errors, ...result };
  await writeFile(path.join(here, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (application) await application.close();
  await rm(temporary, { recursive: true, force: true });
}
