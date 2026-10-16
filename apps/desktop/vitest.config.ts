import { defineConfig } from 'vitest/config';
import { suites, validateSuites } from './scripts/test-suites.mjs';

validateSuites();
export default defineConfig({
  test: { maxWorkers: 2, include: suites.unit.include, exclude: ['vendor/**', 'node_modules/**'] },
});
