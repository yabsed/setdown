import { build } from 'vite';
import { compilerWorkerBuild } from './compiler-worker-build.mjs';

await build({ plugins: [await compilerWorkerBuild()],
  // Debug maps are optional build artifacts, never a runtime requirement.
  // Low-memory validation builds use the same setting for both compared apps.
  build: { sourcemap: process.env.SETDOWN_BUILD_SOURCEMAP !== '0' },
});
