import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Standalone audit: production sources and the normal suite manifest stay unchanged.
export default defineConfig({ resolve: { alias: { electron: fileURLToPath(new URL('../../apps/desktop/node_modules/electron/index.js', import.meta.url)) } }, test: {
  include: ['reports/bug-audit-2026-10-22/*.test.ts'],
  maxWorkers: 1, fileParallelism: false, testTimeout: 10_000,
} });
