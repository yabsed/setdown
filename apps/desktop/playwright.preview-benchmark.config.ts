import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The same candidate-owned harness runs against both applications, using cwd
// for the app under test. Never substitute the baseline's older timing harness.
export default defineConfig(base, {
  retries: 0,
  workers: 1,
  testMatch: ['sample-document-cycles.spec.ts', 'sample-review-cold-cycles.spec.ts'],
  outputDir: process.env.SETDOWN_BENCH_OUTPUT,
});
