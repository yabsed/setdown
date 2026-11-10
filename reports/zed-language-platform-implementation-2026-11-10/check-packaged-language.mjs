import { _electron, expect } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

assert.equal(process.env.SETDOWN_ISOLATED_DISPLAY, '1');
const desktop = path.resolve('apps/desktop');
const packaged = path.join(desktop, 'release/linux-unpacked');
const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-packaged-language-'));
const id = 'setdown-packaged-future', config = path.join(root, 'config');
const settings = path.join(config, 'Setdown'), directory = path.join(settings, 'language-packages');
const extension = path.join(directory, 'extensions', id), file = path.join(root, 'new.packaged-future');
const binary = path.join(packaged, 'resources/app.asar.unpacked/dist-electron/language-host/setdown-language-host');
let app;
try {
  await mkdir(path.join(extension, 'grammars'), { recursive: true });
  await mkdir(path.join(extension, 'languages/future'), { recursive: true });
  await copyFile(path.join(desktop, 'test/fixtures/language-package/make.wasm'), path.join(extension, 'grammars/make.wasm'));
  await writeFile(path.join(extension, 'extension.toml'), `id="${id}"\nname="Packaged future fixture"\nversion="1.0.0"\nschema_version=1\n[grammars.make]\nrepository="https://example.invalid/grammar"\nrev="fixture"\n`);
  await writeFile(path.join(extension, 'languages/future/config.toml'), 'name="Packaged Future"\ngrammar="make"\npath_suffixes=["packaged-future"]\n');
  await writeFile(path.join(extension, 'languages/future/highlights.scm'), '(comment) @comment\n');
  await writeFile(path.join(extension, '.setdown-package'), JSON.stringify({ version: '1.0.0', sha256: '1'.repeat(64) }));
  await writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ version: 1, checked: Date.now(), packages: [{ id, version: '1.0.0', sha256: '1'.repeat(64), url: 'https://example.invalid/package', profiles: [], bindings: [], languages: [{ id, sourceId: id, name: id, label: 'Packaged Future', extensions: ['.packaged-future'], filenames: [], filenamePatterns: [], shebangs: [], treeSitter: { extension: id, config: 'languages/future/config.toml' } }] }] }));
  const profiles = (await Promise.all(['profiles.json', 'zed-profiles.json'].map(name => readFile(path.join(desktop, 'src/main/language/catalog', name), 'utf8')))).flatMap(text => JSON.parse(text).profiles);
  await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers: Object.fromEntries(profiles.map(p => [p.id, { enabled: false }])), custom: [], preferred: {} }));
  await writeFile(file, '# héllo 😀 syntax marker\nall:\n');
  const inventory = await new Promise((resolve, reject) => {
    const child = spawn(binary, [path.join(root, 'inventory')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('Packaged host inventory timed out')); }, 15000);
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); try { assert.equal(code, 0, errors); resolve(JSON.parse(output.split('\n').find(line => line.startsWith('SETDOWN-LANGUAGE/1 ')).slice(19)).result); } catch (error) { reject(error); } });
    child.stdin.end(JSON.stringify({ id: 1, op: 'inventory' }) + '\n');
  });
  assert(inventory.servers.includes('yaml-language-server'));
  const { ELECTRON_RUN_AS_NODE: ignored, ...env } = process.env;
  app = await _electron.launch({ executablePath: path.join(packaged, 'setdown'), args: [file], chromiumSandbox: true, env: { ...env, XDG_CONFIG_HOME: config } });
  const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
  const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, path: app.getAppPath() }));
  assert(identity.packaged && identity.path.endsWith('/app.asar'));
  await expect.poll(() => page.locator('.editor-surface .view-lines').evaluate(root => {
    const span = [...root.querySelectorAll('.view-line span')].find(span => span.textContent?.includes('syntax') && span.children.length === 0);
    return span ? getComputedStyle(span).color : null;
  }), { timeout: 20000 }).toBe('rgb(110, 119, 129)');
  assert.deepEqual(errors, []);
  const result = { ...identity, nativeAdapters: inventory.servers.length, yamlAdapter: true, runtimePackage: id, actualWasmHighlight: true, errors };
  await writeFile(new URL('./packaged-language-result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  if (app) {
    await app.evaluate(({ app, BrowserWindow }) => { app.removeAllListeners('window-all-closed'); for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close().catch(() => {});
  }
  await rm(root, { recursive: true, force: true });
}
