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
]);
