import { defineConfig } from '@playwright/test';
import { validateSuites } from './scripts/test-suites.mjs';

validateSuites();
export default defineConfig({ testDir: './test/wayland', timeout: 90_000, workers: 1, reporter: 'line' });
