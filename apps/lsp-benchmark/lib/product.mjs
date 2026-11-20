import { createRequire } from 'node:module';
import { access, copyFile, mkdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { app, desktop, work } from './paths.mjs';

const require = createRequire(path.join(desktop, 'package.json'));

/** Setdown's language manager, built from the working tree. The bundle sits beside the
 * helper program and the Python stubs of the last desktop build, where the manager looks. */
export async function product() {
  const directory = path.join(work, 'product'), bundle = path.join(directory, 'bridge.cjs');
  const built = path.join(desktop, 'dist-electron');
  await access(path.join(built, 'language-host')).catch(() => {
    throw Error('The desktop app has no built language host. Run `npm run build:electron --workspace @setdown/desktop` first.');
  });
  await mkdir(directory, { recursive: true });
  for (const name of ['language-host', 'python-stubs']) {
    await rm(path.join(directory, name), { recursive: true, force: true });
    await symlink(path.join(built, name), path.join(directory, name));
  }
  // The schema files of the working tree, where the desktop build copies them from.
  await rm(path.join(directory, 'json-schemas'), { recursive: true, force: true });
  await symlink(path.join(desktop, 'src/main/language/catalog/json-schemas'), path.join(directory, 'json-schemas'));
  // The file Node loads before the Pyright server, where the desktop build copies it from.
  await copyFile(path.join(desktop, 'src/main/language/pyright-thread-entry.cjs'), path.join(directory, 'pyright-thread-entry.cjs'));
  // The same externals as the desktop build: tools that are started as their own programs
  // stay on disk, and are found from the repository's node_modules.
  await require('esbuild').build({ entryPoints: [path.join(app, 'product-bridge.ts')], outfile: bundle, bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning',
    alias: { electron: path.join(app, 'electron-stub.ts') },
    external: ['pyright', 'basedpyright', 'typescript', 'typescript-language-server', '@parcel/watcher', '@vscode/ripgrep', 'jsonc-parser'] });
  return require(bundle);
}
