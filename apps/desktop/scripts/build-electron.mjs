import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['electron', 'crossnote', '@parcel/watcher', '@vscode/ripgrep'],
};
await Promise.all([
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
