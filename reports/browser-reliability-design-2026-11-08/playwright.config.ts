import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'diagnostic.spec.ts', timeout: 90_000,
  workers: 1, retries: 0, reporter: 'line', outputDir: process.env.SETDOWN_REPORT_OUTPUT || './artifacts' });
