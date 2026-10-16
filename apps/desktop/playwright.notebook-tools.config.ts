import { validateSuites } from './scripts/test-suites.mjs';
validateSuites();
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './test/notebook-tools', timeout: 180_000, workers: 1, retries: 0, reporter: 'line' });
