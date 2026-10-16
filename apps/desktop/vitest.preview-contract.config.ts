import { defineConfig } from 'vitest/config';
import base from './vitest.config';
import { suites } from './scripts/test-suites.mjs';

export default defineConfig({
  ...base, test: { ...base.test, include: suites.unit.previewContract },
});
