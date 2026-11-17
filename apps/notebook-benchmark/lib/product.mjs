import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, desktop, work } from './paths.mjs';

const require = createRequire(path.join(desktop, 'package.json'));

/** Setdown's own notebook rules and stub catalog, built from the working tree. */
export async function product() {
  const directory = path.join(work, 'product'), bundle = path.join(directory, 'bridge.cjs'), stubs = path.join(directory, 'python-stubs');
  await mkdir(directory, { recursive: true });
  // Self-contained, so the work folder can be anywhere: dependencies are bundled from
  // their module builds, which a bundler can follow where a UMD wrapper hides its requires.
  await require('esbuild').build({ entryPoints: [path.join(app, 'product-bridge.ts')], outfile: bundle, bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', mainFields: ['module', 'main'], logLevel: 'warning' });
  const { buildPythonStubs } = await import(pathToFileURL(path.join(desktop, 'scripts/build-python-stubs.mjs')).href);
  await buildPythonStubs(stubs, path.join(directory, 'licenses'));
  return { ...require(bundle), stubs, analyzer: { entry: require.resolve('basedpyright/index.js'), version: require('basedpyright/package.json').version } };
}
