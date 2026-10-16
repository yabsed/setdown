import { buildUblock } from './browser/build-ublock.mjs';
import { patchExtensionPreload } from './browser/extension-preload.mjs';
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve('../..');
const output = path.resolve('dist-electron');
const exists = async file => fs.access(file).then(() => true, () => false);
await fs.mkdir(output, { recursive: true });
await buildUblock(root, output);
const compat = patchExtensionPreload(await fs.readFile(require.resolve('electron-chrome-extensions/preload'), 'utf8'));
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
// Firefox Reader View's extraction library (Apache-2.0), run inside the page
// on Esc. Keep the pinned submodule file verbatim; only copy it into place.
const readability = path.join(root, 'vendor/readability/Readability.js');
if (!await exists(readability)) {
  execFileSync('git', ['submodule', 'update', '--init', '--recursive', 'vendor/readability'], { cwd: root, stdio: 'inherit' });
}
await fs.copyFile(readability, path.join(output, 'readability.js'));
await fs.copyFile(path.join(root, 'vendor/readability/LICENSE.md'), path.join(output, 'READABILITY-LICENSE.txt'));
await fs.copyFile(path.join(root, 'vendor/min/LICENSE.txt'), path.join(output, 'MIN-LICENSE.txt')).catch(async () => {
  await fs.copyFile('src/browser-runtime/MIN-LICENSE.txt', path.join(output, 'MIN-LICENSE.txt'));
});
