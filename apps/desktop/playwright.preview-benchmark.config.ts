import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { suites } from './scripts/test-suites.mjs';

// The same candidate-owned harness runs against both applications, using cwd
// for the app under test. Never substitute the baseline's older timing harness.
export default defineConfig(base, {
  retries: 0,
  workers: 1,
  testMatch: suites.benchmark.files.map(file => `**/${file}`),
  outputDir: process.env.SETDOWN_BENCH_OUTPUT,
});
