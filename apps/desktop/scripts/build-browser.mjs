import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve('../..');
const output = path.resolve('dist-electron');
const source = path.join(root, 'vendor/ublock-origin');
const assetPins = { main: '026f4e1dae8973e85394954c473682d2845c99c2', prod: 'e885f3e7841eb31a2185d36ce76029931acebbb7' };
const cache = path.join(root, 'node_modules/.cache/setdown-browser');
const exists = async file => fs.access(file).then(() => true, () => false);
await fs.mkdir(output, { recursive: true });
if (!await exists(path.join(source, 'src/js/start.js'))) {
  execFileSync('git', ['submodule', 'update', '--init', '--recursive', 'vendor/ublock-origin'], { cwd: root, stdio: 'inherit' });
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
const fingerprint = JSON.stringify({ commit, assetPins, recipe: 2 });
const extension = path.join(output, 'ublock');
if (await fs.readFile(path.join(extension, 'setdown-build.json'), 'utf8').catch(() => '') !== fingerprint) {
  for (const [name, pin] of Object.entries(assetPins)) {
    const dir = path.join(cache, pin);
    let cachedCommit;
    try { cachedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Incomplete or absent cache. */ }
    if (cachedCommit !== pin) {
      await fs.mkdir(dir, { recursive: true });
      execFileSync('git', ['init', '--quiet'], { cwd: dir });
      execFileSync('git', ['fetch', '--depth', '1', 'https://github.com/uBlockOrigin/uAssets.git', pin], { cwd: dir, stdio: 'inherit' });
      execFileSync('git', ['checkout', '--detach', '--quiet', 'FETCH_HEAD'], { cwd: dir });
    }
    if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim() !== pin) throw Error(`Wrong uAssets ${name} revision`);
  }
  // Portable equivalent of upstream copy-common-files.sh and make-chromium.sh.
  await fs.rm(extension, { recursive: true, force: true });
  await fs.mkdir(extension, { recursive: true });
  const copy = (from, to) => fs.cp(from, to, { recursive: true, filter: file => path.basename(file) !== '.git' });
  for (const dir of ['css', 'img', 'js', 'lib', 'web_accessible_resources', '_locales']) await copy(path.join(source, 'src', dir), path.join(extension, dir));
  for (const file of await fs.readdir(path.join(source, 'src'))) if (file.endsWith('.html')) await copy(path.join(source, 'src', file), path.join(extension, file));
  for (const platform of ['common', 'chromium']) for (const file of await fs.readdir(path.join(source, 'platform', platform))) {
    if (!/\.(js|json|html)$/.test(file)) continue;
    await copy(path.join(source, 'platform', platform, file), path.join(extension, file.endsWith('.js') ? 'js' : '', file));
  }
  await copy(path.join(source, 'assets'), path.join(extension, 'assets'));
  const version = (await fs.readFile(path.join(source, 'dist/version'), 'utf8')).trim();
  await fs.rm(path.join(extension, 'assets', /^\d+\.\d+\.\d+$/.test(version) ? 'assets.dev.json' : 'assets.json'), { force: true });
  const main = path.join(cache, assetPins.main), prod = path.join(cache, assetPins.prod);
  for (const dir of ['pgl.yoyo.org', 'publicsuffix.org', 'urlhaus-filter']) await copy(path.join(main, 'thirdparties', dir), path.join(extension, 'assets/thirdparties', dir));
  for (const name of ['easylist', 'easyprivacy']) await copy(path.join(prod, `thirdparties/${name}.txt`), path.join(extension, `assets/thirdparties/easylist/${name}.txt`));
  for (const name of ['badlists.txt', 'badware.min.txt', 'filters.min.txt', 'privacy.min.txt', 'quick-fixes.min.txt', 'unbreak.min.txt']) await copy(path.join(prod, 'filters', name), path.join(extension, 'assets/ublock', name));
  await copy(path.join(extension, '_locales/nb'), path.join(extension, '_locales/no'));
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.version = version;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await copy(path.join(source, 'LICENSE.txt'), path.join(extension, 'LICENSE.txt'));
  await fs.writeFile(path.join(extension, 'setdown-build.json'), fingerprint);
}
// Preserve Electron's native blocking header event. The pinned compatibility
// library replaces it with an event that has no native response-header source.
let compat = await fs.readFile(require.resolve('electron-chrome-extensions/preload'), 'utf8');
const broken = 'onHeadersReceived: new ExtensionEvent("webRequest.onHeadersReceived")';
if (compat.split(broken).length !== 2) throw Error('Review the extension header adapter for the installed library version.');
compat = compat.replace(broken, 'onHeadersReceived: base.onHeadersReceived');
// There is no enterprise policy backend in Setdown. Aliasing managed storage
// to local storage makes uBO cache the whole local store inside itself on each
// startup, including its previous cachedManagedStorage value. Repeated starts
// grow that recursive cache until the background page cannot initialize.
const managedAlias = 'managed: local,';
if (compat.split(managedAlias).length !== 2) throw Error('Review the managed storage adapter for the installed library version.');
compat = compat.replace(managedAlias, 'managed: undefined,');
const fix = await build({ entryPoints: ['src/browser-runtime/extension-preload.ts'], bundle: true, write: false, platform: 'node', format: 'iife', external: ['electron'], target: 'node22' });
// Extension background pages are not sandboxed; .cjs preserves require even
// inside the desktop package's type:module scope.
await fs.writeFile(path.join(output, 'chrome-extension-api.preload.cjs'), compat + '\n' + fix.outputFiles[0].text);
const compatRoot = path.dirname(path.dirname(require.resolve('electron-chrome-extensions/preload')));
await fs.copyFile(path.join(compatRoot, 'LICENSE-GPL'), path.join(output, 'EXTENSION-COMPAT-LICENSE.txt'));
await Promise.all([
  ...['places-preload', 'page-preload'].map(name => build({ entryPoints: [`src/browser-runtime/${name}.ts`], outfile: `dist-electron/${name}.cjs`, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] })),
  build({ entryPoints: ['src/browser-runtime/places.ts'], outfile: 'dist-electron/places.js', bundle: true, platform: 'browser', format: 'iife', target: 'chrome140' }),
]);
await fs.writeFile(path.join(output, 'places.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"><script src="places.js"></script>');
await fs.copyFile(path.join(root, 'vendor/min/LICENSE.txt'), path.join(output, 'MIN-LICENSE.txt')).catch(async () => {
  await fs.copyFile('src/browser-runtime/MIN-LICENSE.txt', path.join(output, 'MIN-LICENSE.txt'));
});
