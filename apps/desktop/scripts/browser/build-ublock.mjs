import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Build the pinned uBlock/uAssets recipe without changing upstream source. */
export async function buildUblock(root, output) {
  const source = path.join(root, 'vendor/ublock-origin');
  const assetPins = { main: '026f4e1dae8973e85394954c473682d2845c99c2', prod: 'e885f3e7841eb31a2185d36ce76029931acebbb7' };
  const cache = path.join(root, 'node_modules/.cache/setdown-browser');
  const exists = async file => fs.access(file).then(() => true, () => false);
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
}
