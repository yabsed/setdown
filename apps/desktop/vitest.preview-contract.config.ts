import { defineConfig } from 'vitest/config';
import base from './vitest.config';

export default defineConfig({
  ...base,
  test: { ...base.test, include: [
    'src/architecture-boundaries.test.ts',
    'src/protocol/preview-preparation.test.ts',
    'src/main/preview/preview-presentation.test.ts',
    'src/main/preview/review-preparation.test.ts',
    'src/main/windows/workspace-zoom.test.ts',
    'src/core/preview/preview-install.test.ts',
    'src/preview-runtime/content-controller.test.ts',
    'src/preview-runtime/source-atlas.test.ts',
    'src/preview-runtime/viewport-controller.test.ts',
    'src/renderer/reader/reader-preparation.test.ts',
    'src/renderer/project/source-control/review-presentation.test.ts',
    'src/renderer/project/source-control/source-control-controller.test.ts',
    'src/renderer/project/source-control/git-review-latency.test.ts',
  ] },
});
