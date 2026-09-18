import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['electron', 'crossnote'],
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist-electron/main.cjs',
    format: 'cjs',
  }),
  build({
    ...shared,
    entryPoints: ['src/preload/index.ts'],
    outfile: 'dist-electron/preload.cjs',
    format: 'cjs',
  }),
  // 조판 전용 utility process. 메인이 IPC를 처리하는 동안 다른 코어에서 돈다.
  build({
    ...shared,
    entryPoints: ['src/main/preview/render-worker.ts'],
    outfile: 'dist-electron/render-worker.cjs',
    format: 'cjs',
  }),
  build({
    ...shared,
    entryPoints: ['src/preview/preload.ts'],
    outfile: 'dist-electron/preview-preload.cjs',
    format: 'cjs',
  }),
  // Viewer WebContents 안에서 도는 다리. 인라인 <script>로 들어가므로 sourcemap 없이
  // 하나의 IIFE로 묶는다.
  build({
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    entryPoints: ['src/preview/bridge.ts'],
    outfile: 'dist-electron/preview-bridge.js',
    sourcemap: false,
    legalComments: 'none',
  }),
]);
