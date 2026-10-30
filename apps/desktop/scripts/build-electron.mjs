import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['sharp', 'electron', 'jsonc-parser', 'crossnote', '@parcel/watcher', '@vscode/ripgrep', 'node-pty', '@xterm/headless', '@xterm/addon-serialize', 'electron-chrome-extensions', 'electron-chrome-web-store', 'turndown', 'turndown-plugin-gfm', 'sanitize-html', 'pyright', 'basedpyright', 'typescript', 'typescript-language-server'],
};
await mkdir('dist-electron', { recursive: true });
await Promise.all([
  build({ ...shared, entryPoints: ['src/launcher/main.ts'], outfile: 'dist-electron/launcher.cjs', format: 'cjs' }),
  build({ ...shared, entryPoints: ['src/browser-runtime/tab-drag-preload.ts'], outfile: 'dist-electron/tab-drag-preload.cjs', format: 'cjs' }),
  build({ ...shared, entryPoints: ["src/hwp-runtime/preload.ts"], outfile: "dist-electron/hwp-preload.cjs", format: "cjs" }),
  build({ ...shared, entryPoints: ['src/image-export-runtime/preload.ts'], outfile: 'dist-electron/image-export-preload.cjs', format: 'cjs' }),
  build({ bundle: true, platform: 'browser', target: 'chrome120', format: 'iife', entryPoints: ['src/image-export-runtime/index.ts'], outfile: 'dist-electron/image-export.js' }),
  copyFile('src/image-export-runtime/index.html', 'dist-electron/image-export.html'),
  build({ ...shared, entryPoints: ['src/main/main.ts'], outfile: 'dist-electron/main.cjs', format: 'cjs' }),
  build({ ...shared, entryPoints: ['src/preload/index.ts'], outfile: 'dist-electron/preload.cjs', format: 'cjs' }),
  build({ ...shared, entryPoints: ['src/main/preview/render-worker.ts'], outfile: 'dist-electron/render-worker.cjs', format: 'cjs' }),
  // Rendered block alignment/emphasis is also CPU work, not window/IPC work.
  build({ ...shared, entryPoints: ['src/main/preview/review-render-worker.ts'], outfile: 'dist-electron/review-render-worker.cjs', format: 'cjs' }),
  build({ ...shared, entryPoints: ['src/preview-runtime/preload.ts'], outfile: 'dist-electron/preview-preload.cjs', format: 'cjs' }),
  build({ bundle: true, platform: 'browser', target: 'chrome120', format: 'iife',
    entryPoints: ['src/preview-runtime/bridge.ts'], outfile: 'dist-electron/preview-bridge.js',
    sourcemap: false, legalComments: 'none' }),
]);

await copyFile('src/main/notebook/kernel-bridge.py', 'dist-electron/kernel-bridge.py');
await copyFile('src/main/notebook/notebook-inspect.py', 'dist-electron/notebook-inspect.py');

await import('./build-browser.mjs');

await copyFile('src/main/language/catalog/MASON-LICENSE', 'dist-electron/MASON-LICENSE');
await copyFile('scripts/language-profiles/upstream/HELIX-LICENSE', 'dist-electron/HELIX-LICENSE');
await copyFile('scripts/language-profiles/NOTICE', 'dist-electron/HELIX-PROFILES-NOTICE');

await import("./build-hwp.mjs");
