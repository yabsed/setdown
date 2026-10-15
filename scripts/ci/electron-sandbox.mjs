import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function sandboxPath(root) {
  const require = createRequire(path.resolve(root, 'apps/desktop/package.json'));
  // Electron 44 downloads its binary on first require, not during npm ci.
  // Resolve the executable through its public API before inspecting the helper;
  // finding package.json alone does not mean dist has been installed.
  const executable = require('electron');
  const sandbox = path.join(path.dirname(executable), 'chrome-sandbox');
  if (!statSync(sandbox).isFile()) throw Error(`Missing Electron sandbox: ${sandbox}`);
  return sandbox;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.platform !== 'linux' || process.argv.length < 3) throw Error('Usage (Linux): node electron-sandbox.mjs <checkout> [...]');
  // Resolve all paths before changing any permissions. Works with both hoisted
  // and workspace-local dependencies, independently for baseline and candidate.
  const sandboxes = process.argv.slice(2).map(sandboxPath);
  execFileSync('sudo', ['chown', 'root:root', '--', ...sandboxes], { stdio: 'inherit' });
  execFileSync('sudo', ['chmod', '4755', '--', ...sandboxes], { stdio: 'inherit' });
}
